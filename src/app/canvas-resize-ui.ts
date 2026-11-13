import type { Document } from '../engine/document';
import type { Pt } from '../engine/geometry';
import { anchoredWindow } from '../engine/page-ops';
import type { Rect } from '../engine/tiles';
import { makeDraggable, type DialogDrag } from '../ui/drag-dialog';
import { CENTER, HANDLES, dragHandle, handleCursor, handlePoint, hitHandle, type Anchor, type Handle } from './canvas-resize';
import { formatLength, fromPx, toPx, validate, type Unit } from './new-doc';

// "Cambiar tamaño del lienzo": a small floating panel (Ancho, Altura, Unidad, Punto de referencia) plus handles on the
// canvas. Both edit the same window over the old page; Aceptar applies it as one history step. It is not a modal
// dialog, because the canvas has to stay usable while it is open; its title bar moves it out of the way.

export interface CanvasResizeDeps {
  doc: () => Document;
  /** Screen pixels per page pixel. */
  scale: () => number;
  redraw: () => void;
  /** Bring the whole window into view. */
  showRect: (r: Rect) => void;
  /** Apply the window to the page; false when nothing was done. */
  commit: (r: Rect) => boolean;
  touch: () => boolean;
}

const ACCENT = '#2f7bff';
const UNITS: Unit[] = ['px', 'mm', 'cm', 'in'];
const SIDES = [0, 0.5, 1] as const;

export interface CanvasResizeUi {
  readonly active: boolean;
  open(): void;
  close(): void;
  /** True when the press landed on a handle (the drag is then ours); otherwise the canvas is left alone while the panel is open. */
  down(p: Pt): boolean;
  move(p: Pt): void;
  up(): void;
  cursorAt(p: Pt): string | null;
  drawOverlay(c: CanvasRenderingContext2D): void;
}

export function createCanvasResizeUi(deps: CanvasResizeDeps): CanvasResizeUi {
  let panel: HTMLDialogElement | null = null;
  let target: Document | null = null;
  let rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  let anchor: Anchor | null = CENTER;
  let unit: Unit = 'px';
  let grabbed: Handle | null = null;
  let drag: DialogDrag | null = null;

  const reach = (): number => (deps.touch() ? 24 : 12) / deps.scale();
  const q = <T extends HTMLElement>(sel: string): T => panel!.querySelector<T>(sel)!;

  function build(): HTMLDialogElement {
    const d = document.createElement('dialog');
    d.id = 'cs-resize';
    d.innerHTML = `
      <h3>Tamaño del lienzo</h3>
      <label>Ancho <input id="cs-w" type="number" step="any" min="1" inputmode="decimal"></label>
      <label>Altura <input id="cs-h" type="number" step="any" min="1" inputmode="decimal"></label>
      <label>Unidad <select id="cs-unit">${UNITS.map((u) => `<option value="${u}">${u}</option>`).join('')}</select></label>
      <div class="cs-anchor"><span>Punto de referencia</span>
        <div class="cs-grid">${SIDES.map((y) => SIDES.map((x) => `<button type="button" data-ax="${x}" data-ay="${y}" aria-label="Punto de referencia"></button>`).join('')).join('')}</div>
      </div>
      <p class="cs-err" aria-live="polite"></p>
      <div class="cs-buttons">
        <button type="button" id="cs-reset">Reiniciar</button>
        <button type="button" id="cs-cancel">Cancelar</button>
        <button type="button" id="cs-ok" class="primary">Aceptar</button>
      </div>`;
    document.body.append(d);
    drag = makeDraggable(d, d.querySelector('h3')!);
    return d;
  }

  const read = (id: string): number => toPx(Number(q<HTMLInputElement>(id).value), unit, target!.dpi);

  /** Show the window in the panel; the field being typed in keeps its text. */
  function sync(except?: HTMLInputElement): void {
    const dpi = target!.dpi;
    for (const [id, px] of [['#cs-w', rect.w], ['#cs-h', rect.h]] as const) {
      const input = q<HTMLInputElement>(id);
      if (input !== except) input.value = formatLength(fromPx(px, unit, dpi), unit);
    }
    q<HTMLSelectElement>('#cs-unit').value = unit;
    for (const b of panel!.querySelectorAll<HTMLButtonElement>('.cs-grid button')) {
      b.classList.toggle('on', anchor !== null && Number(b.dataset.ax) === anchor.x && Number(b.dataset.ay) === anchor.y);
    }
    const bad = problem();
    q('.cs-err').textContent = bad ?? '';
    q<HTMLButtonElement>('#cs-ok').disabled = bad !== null;
    deps.redraw();
  }

  const problem = (): string | null => validate(rect.w, rect.h, target!.dpi);

  /** The window for a new size (in pixels) around the chosen reference point; with no point, the near corner stays. */
  function resized(w: number, h: number): Rect {
    return anchor ? anchoredWindow(target!.width, target!.height, w, h, anchor) : { ...rect, w, h };
  }

  function onSize(input: HTMLInputElement): void {
    const w = Math.round(input.id === 'cs-w' ? read('#cs-w') : rect.w);
    const h = Math.round(input.id === 'cs-h' ? read('#cs-h') : rect.h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return; // half-typed
    rect = resized(w, h);
    sync(input);
  }

  function wire(): void {
    for (const id of ['#cs-w', '#cs-h']) {
      const input = q<HTMLInputElement>(id);
      input.addEventListener('input', () => onSize(input));
      input.addEventListener('change', () => {
        sync();
        deps.showRect(rect);
      });
    }
    q<HTMLSelectElement>('#cs-unit').addEventListener('change', (e) => {
      unit = (e.target as HTMLSelectElement).value as Unit;
      sync();
    });
    q('.cs-grid').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      anchor = { x: Number(b.dataset.ax) as Anchor['x'], y: Number(b.dataset.ay) as Anchor['y'] };
      rect = resized(rect.w, rect.h);
      sync();
      deps.showRect(rect);
    });
    q('#cs-reset').addEventListener('click', () => {
      reset();
      sync();
      deps.showRect(rect);
    });
    q('#cs-cancel').addEventListener('click', () => api.close());
    q('#cs-ok').addEventListener('click', accept);
    panel!.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        api.close();
      } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        accept();
      }
    });
    panel!.addEventListener('cancel', (e) => {
      e.preventDefault();
      api.close();
    });
  }

  function reset(): void {
    rect = { x: 0, y: 0, w: target!.width, h: target!.height };
    anchor = CENTER;
  }

  function accept(): void {
    if (!target || problem()) return;
    const r = rect;
    api.close();
    deps.commit(r);
  }

  const api: CanvasResizeUi = {
    get active() {
      return target !== null;
    },
    open() {
      if (target) return;
      target = deps.doc();
      if (!panel) {
        panel = build();
        wire();
      }
      reset();
      sync();
      panel.show();
      drag?.keepInside(); // it reopens where it was left, unless the window got smaller meanwhile
      q<HTMLInputElement>('#cs-w').select();
    },
    close() {
      if (!target) return;
      target = null;
      grabbed = null;
      panel?.close();
      deps.redraw();
    },
    down(p) {
      if (!target) return false;
      if (deps.doc() !== target) {
        api.close(); // another document came forward
        return false;
      }
      grabbed = hitHandle(rect, p, reach());
      return grabbed !== null;
    },
    move(p) {
      if (!target || !grabbed) return;
      rect = dragHandle(rect, grabbed, p);
      anchor = null; // dragged by hand: no reference point any more
      sync();
    },
    up() {
      if (!grabbed) return;
      grabbed = null;
      deps.showRect(rect); // a window dragged past the edge of the stage is brought back into view
    },
    cursorAt(p) {
      const h = target ? (grabbed ?? hitHandle(rect, p, reach())) : null;
      return h ? handleCursor(h) : null;
    },
    drawOverlay(c) {
      if (!target) return;
      const s = deps.scale();
      const page = { x: 0, y: 0, w: target.width, h: target.height };
      c.save();
      // What the new page leaves out is dimmed; what it adds is tinted.
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.beginPath();
      c.rect(page.x, page.y, page.w, page.h);
      c.rect(rect.x, rect.y, rect.w, rect.h);
      c.fill('evenodd');
      c.fillStyle = 'rgba(47,123,255,0.12)';
      c.beginPath();
      c.rect(rect.x, rect.y, rect.w, rect.h);
      c.rect(page.x, page.y, page.w, page.h);
      c.fill('evenodd');
      c.lineWidth = 1.5 / s;
      c.strokeStyle = ACCENT;
      c.setLineDash([6 / s, 4 / s]);
      c.strokeRect(rect.x, rect.y, rect.w, rect.h);
      c.setLineDash([]);
      const size = (deps.touch() ? 14 : 9) / s;
      c.fillStyle = '#fff';
      for (const h of HANDLES) {
        const pt = handlePoint(rect, h);
        c.fillRect(pt.x - size / 2, pt.y - size / 2, size, size);
        c.strokeRect(pt.x - size / 2, pt.y - size / 2, size, size);
      }
      c.restore();
    },
  };
  return api;
}
