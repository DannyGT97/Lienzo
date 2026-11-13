import { readUiScale } from '../ui/ui-scale';
import { SLIDER_STEPS, clampOpacityPct, clampSizeFine, formatOpacity, formatSize, posToSize, sizeToPos } from './brush-size';

type Mode = 'size' | 'opacity';

export interface ToolSlidersOptions {
  getSize(): number;
  setSize(px: number): void;
  /** Opacity in percent (0.1..100). */
  getOpacity(): number;
  setOpacity(pct: number): void;
}

const HOLD_DELAY_MS = 380;
const HOLD_REPEAT_MS = 70;
const POP_GAP = 6;
const POP_MARGIN = 8;

/**
 * The round size and opacity readouts under the tool column. Tapping one opens a popup beside the column with a
 * vertical slider, arrows that move the value by a tenth (single) or by one (double), and a button that swaps
 * between size and opacity; holding an arrow repeats it.
 */
export function mountToolSliders(o: ToolSlidersOptions): { refresh(): void; close(): void } {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const bubbles: Record<Mode, HTMLElement> = { size: $('bubble-size'), opacity: $('bubble-opacity') };
  const pop = $('tc-pop');
  const slider = $<HTMLInputElement>('tcp-slider');
  let mode: Mode | null = null;

  const text = (el: HTMLElement, value: string): void => {
    el.firstElementChild!.textContent = value;
  };

  function refresh(): void {
    text(bubbles.size, formatSize(o.getSize()));
    text(bubbles.opacity, formatOpacity(o.getOpacity()));
    if (mode === 'size') slider.value = String(sizeToPos(o.getSize()));
    else if (mode === 'opacity') slider.value = String(Math.round(o.getOpacity() * 10));
  }

  function place(): void {
    if (!mode) return;
    const column = bubbles[mode].closest('#toolcol') ?? bubbles[mode];
    const anchor = bubbles[mode].getBoundingClientRect();
    const colRect = column.getBoundingClientRect();
    // The popover is zoomed by the interface scale: its own lengths are in unscaled pixels, the rects on screen.
    const k = readUiScale();
    pop.style.height = `${Math.min(360, (window.innerHeight - 2 * POP_MARGIN) / k)}px`;
    const { width, height } = pop.getBoundingClientRect();
    const left = Math.min(colRect.right + POP_GAP, window.innerWidth - width - POP_MARGIN);
    const top = Math.min(window.innerHeight - height - POP_MARGIN, Math.max(POP_MARGIN, anchor.top + anchor.height / 2 - height / 2));
    pop.style.left = `${Math.max(POP_MARGIN, left) / k}px`;
    pop.style.top = `${top / k}px`;
  }

  function open(next: Mode): void {
    mode = next;
    pop.hidden = false;
    pop.classList.toggle('mode-opacity', next === 'opacity');
    slider.min = next === 'size' ? '0' : '1';
    slider.max = next === 'size' ? String(SLIDER_STEPS) : '1000';
    slider.setAttribute('aria-label', next === 'size' ? 'Tamaño del pincel' : 'Opacidad');
    for (const m of ['size', 'opacity'] as const) bubbles[m].classList.toggle('active', m === next);
    refresh();
    place();
  }

  function close(): void {
    mode = null;
    pop.hidden = true;
    for (const m of ['size', 'opacity'] as const) bubbles[m].classList.remove('active');
  }

  const nudge = (delta: number): void => {
    if (mode === 'size') o.setSize(clampSizeFine(o.getSize() + delta));
    else if (mode === 'opacity') o.setOpacity(clampOpacityPct(o.getOpacity() + delta));
  };

  for (const m of ['size', 'opacity'] as const) bubbles[m].addEventListener('click', () => (mode === m ? close() : open(m)));
  $('tcp-swap').addEventListener('click', () => open(mode === 'size' ? 'opacity' : 'size'));
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    if (mode === 'size') o.setSize(posToSize(v));
    else if (mode === 'opacity') o.setOpacity(clampOpacityPct(v / 10));
  });

  pop.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
    const delta = Number(b.dataset.step);
    let delay = 0;
    let repeat = 0;
    const stop = (): void => {
      window.clearTimeout(delay);
      window.clearInterval(repeat);
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      nudge(delta);
      stop();
      delay = window.setTimeout(() => (repeat = window.setInterval(() => nudge(delta), HOLD_REPEAT_MS)), HOLD_DELAY_MS);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
    // A keyboard press arrives as a click without a pointer.
    b.addEventListener('click', (e) => {
      if (e.detail === 0) nudge(delta);
    });
  });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!mode) return;
      const t = e.target as Node;
      if (!pop.contains(t) && !bubbles.size.contains(t) && !bubbles.opacity.contains(t)) close();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (mode && e.key === 'Escape') close();
  });
  window.addEventListener('resize', close);
  refresh();
  return { refresh, close };
}
