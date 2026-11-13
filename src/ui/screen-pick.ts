import { toHex, type RGB } from './color';

/**
 * A colour taken from anything on screen, as the eyedropper of Clip Studio's colour window does it: the pointer
 * moves over the canvas or over the interface and a chip beside it shows the colour under it; a click (or lifting the
 * finger) takes it, Esc or a right click gives up.
 *
 * A web page cannot read the pixels of the screen, so each thing under the pointer is asked for its own colour: a
 * canvas gives the pixel under the pointer, an image its pixel, a shape its fill, anything else its background.
 * Whoever owns a special canvas (the drawing itself, which is painted on the graphics card) says what is under the
 * pointer through `sample`. Layers that are only partly opaque are laid over what is behind them.
 */

/** Straight colour 0..255 and its coverage 0..1. */
export type Rgba = readonly [number, number, number, number];

export interface ScreenPickOptions {
  /** Colour of an element at a screen point, or undefined to let the generic reading decide. null: nothing painted there. */
  sample?: (el: Element, x: number, y: number) => Rgba | null | undefined;
  /** Hidden while picking (a window that would cover what the person wants to pick). */
  hide?: HTMLElement | null;
}

let scratch: CanvasRenderingContext2D | null | undefined;
function scratchContext(): CanvasRenderingContext2D | null {
  if (scratch === undefined) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    scratch = c.getContext('2d', { willReadFrequently: true });
  }
  return scratch;
}

/** Any CSS colour (rgb(), hex, names, color-mix()...) as a colour, by letting the browser paint it. */
function cssColor(value: string): Rgba | null {
  if (!value || value === 'none' || value === 'transparent') return null;
  const ctx = scratchContext();
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return d[3]! === 0 ? null : [d[0]!, d[1]!, d[2]!, d[3]! / 255];
}

function readCanvas(c: HTMLCanvasElement, x: number, y: number): Rgba | null {
  const r = c.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || c.width === 0) return null;
  const px = Math.min(c.width - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * c.width)));
  const py = Math.min(c.height - 1, Math.max(0, Math.floor(((y - r.top) / r.height) * c.height)));
  try {
    const ctx = c.getContext('2d'); // null for a canvas that is not a 2D one: it is skipped
    if (!ctx) return null;
    const d = ctx.getImageData(px, py, 1, 1).data;
    return d[3]! === 0 ? null : [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  } catch {
    return null; // tainted: its pixels are not ours to read
  }
}

function readImage(img: HTMLImageElement, x: number, y: number): Rgba | null {
  const r = img.getBoundingClientRect();
  const ctx = scratchContext();
  if (!ctx || !img.complete || img.naturalWidth === 0 || r.width <= 0 || r.height <= 0) return null;
  const sx = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * img.naturalWidth)));
  const sy = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(((y - r.top) / r.height) * img.naturalHeight)));
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return d[3]! === 0 ? null : [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  } catch {
    return null;
  }
}

function readElement(el: Element, x: number, y: number): Rgba | null {
  if (el instanceof HTMLCanvasElement) return readCanvas(el, x, y);
  if (el instanceof HTMLImageElement) return readImage(el, x, y);
  const style = getComputedStyle(el);
  if (el instanceof SVGGraphicsElement && !(el instanceof SVGSVGElement)) {
    return cssColor(style.fill) ?? cssColor(style.stroke);
  }
  return cssColor(style.backgroundColor);
}

/** The colour on screen at a point: what is painted on top, laid over what shows through it. */
export function colorAt(x: number, y: number, sample?: ScreenPickOptions['sample']): RGB | null {
  const found: Rgba[] = []; // top to bottom
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-screen-pick]')) continue;
    const special = sample?.(el, x, y);
    const hit = special === undefined ? readElement(el, x, y) : special;
    if (!hit) continue;
    found.push(hit);
    if (hit[3] >= 0.999) break;
  }
  if (!found.length) return null;
  const base = found[found.length - 1]!;
  let r = base[0];
  let g = base[1];
  let b = base[2];
  let a = base[3];
  for (let i = found.length - 2; i >= 0; i--) {
    const [fr, fg, fb, fa] = found[i]!;
    const out = fa + a * (1 - fa);
    r = (fr * fa + r * a * (1 - fa)) / out;
    g = (fg * fa + g * a * (1 - fa)) / out;
    b = (fb * fa + b * a * (1 - fa)) / out;
    a = out;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** Resolves with the picked colour, or null when the person gave up (or nothing was painted where they chose). */
export function pickFromScreen(opts: ScreenPickOptions = {}): Promise<RGB | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'screen-pick';
    overlay.dataset.screenPick = '';
    const chip = document.createElement('div');
    chip.className = 'screen-pick-chip';
    chip.innerHTML = '<i></i><span></span>';
    chip.hidden = true;
    overlay.append(chip);
    const swatch = chip.querySelector('i') as HTMLElement;
    const label = chip.querySelector('span') as HTMLElement;
    const hidden = opts.hide ? opts.hide.style.visibility : '';
    if (opts.hide) opts.hide.style.visibility = 'hidden';

    const show = (e: PointerEvent): RGB | null => {
      const rgb = colorAt(e.clientX, e.clientY, opts.sample);
      chip.hidden = !rgb;
      if (rgb) {
        swatch.style.background = toHex(rgb);
        label.textContent = toHex(rgb);
        // Up and to the side of a finger or a pen, where the hand does not cover it.
        const touch = e.pointerType !== 'mouse';
        const w = chip.offsetWidth;
        const h = chip.offsetHeight;
        const left = Math.min(Math.max(4, e.clientX + (touch ? -w / 2 : 18)), window.innerWidth - w - 4);
        const top = Math.min(Math.max(4, e.clientY - (touch ? h + 56 : h + 12)), window.innerHeight - h - 4);
        chip.style.left = `${left}px`;
        chip.style.top = `${top}px`;
      }
      return rgb;
    };
    const done = (rgb: RGB | null): void => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (opts.hide) opts.hide.style.visibility = hidden;
      resolve(rgb);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    overlay.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      overlay.setPointerCapture?.(e.pointerId);
      show(e);
      e.preventDefault();
    });
    overlay.addEventListener('pointermove', (e) => void show(e));
    overlay.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      done(show(e));
    });
    overlay.addEventListener('pointercancel', () => done(null));
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      done(null);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
  });
}
