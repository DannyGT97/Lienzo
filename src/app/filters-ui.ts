import { adjustLut, isAdjustable, type AdjustLut } from '../engine/adjust';
import type { Document, Layer } from '../engine/document';
import { paintTarget } from '../engine/document';
import { FILTERS, applyAreaFilter, applyPixelFilter, defaultValues, type FilterContext } from '../engine/filters';
import { combineCommands, patchCommand, type Command, type History } from '../engine/history';
import { descendants } from '../engine/layer-tree';
import { Selection } from '../engine/selection';
import type { Rect } from '../engine/tiles';

export interface FiltersDeps {
  doc: () => Document;
  history: () => History;
  /** The layers the command is for: the ticked ones, or the active one. A folder stands for the pixel layers inside it. */
  layers: () => Layer[];
  selection: () => Selection | null;
  colors: () => FilterContext;
  render: (region?: Rect | null) => void;
  /** Show a tonal correction on layers by their tables, without touching their pixels (null ends it). */
  setPreview: (tables: ReadonlyMap<number, AdjustLut> | null) => void;
  refreshLayer: (layer: Layer, rect: Rect) => void;
  refreshUi: () => void;
  say: (msg: string) => void;
  /** The part of the page on screen right now (page coordinates), or null when it is not known. */
  viewRect: () => Rect | null;
  /** The element the floating panel is placed in. */
  host: HTMLElement;
}

export type PreviewScope = 'all' | 'view' | 'window';

/** The most pixels a window preview works on (see `previewRect`). */
export const PREVIEW_PIXELS = 400_000;

/**
 * What part of the layer a preview filters. `all` is everything; `view` everything on screen (so a layer clipped to
 * another is filtered wherever it can be seen, not just near the middle); `window` a window around the middle of
 * the view, only when the view holds more than PREVIEW_PIXELS (a slow filter being dragged). `rect` is null when the
 * whole layer is covered; `partial` says that what is on screen is not all filtered yet.
 */
export function previewRect(view: Rect | null, width: number, height: number, scope: PreviewScope): { rect: Rect | null; partial: boolean } {
  if (scope === 'all' || !view) return { rect: null, partial: false };
  let r = view;
  if (scope === 'window' && r.w * r.h > PREVIEW_PIXELS) {
    const k = Math.sqrt(PREVIEW_PIXELS / (r.w * r.h));
    const w = Math.max(1, Math.round(r.w * k));
    const h = Math.max(1, Math.round(r.h * k));
    r = { x: Math.round(r.x + (r.w - w) / 2), y: Math.round(r.y + (r.h - h) / 2), w, h };
  }
  if (r.x <= 0 && r.y <= 0 && r.x + r.w >= width && r.y + r.h >= height) return { rect: null, partial: false }; // the whole page is covered
  return { rect: r, partial: scope === 'window' && r !== view };
}

/**
 * Filters on the active layer (inside the selection when there is one). A small floating panel holds the filter's
 * sliders: every change shows the result on the layer at once, "Aplicar" keeps it as one undoable step and
 * "Cancelar" puts the layer back.
 *
 * While the sliders move, only what is on screen is filtered (a page can be many megapixels, the screen about one),
 * and at most one preview is made per frame however many slider events arrive. "Aplicar" then filters the whole
 * area. Own design (the references do not say how their previews are scheduled).
 */
export function createFiltersUi(d: FiltersDeps): {
  readonly active: boolean;
  start(id: string): boolean;
  /** Whether there is a layer a filter can act on. */
  canStart(): boolean;
  apply(): void;
  cancel(): void;
  /** The view moved or zoomed: show the filter on what is on screen now. */
  viewChanged(): void;
} {
  interface Session {
    id: string;
    layers: Layer[];
    values: Record<string, number>;
    /** What the preview did, one step per layer: undo it before showing the next one. */
    shown: Command[];
    /** The preview is the renderer applying the correction's table (nothing was filtered yet). */
    gpu: boolean;
    panel: HTMLElement;
    /** Stops the preview that is waiting to run, if any. */
    cancelWait: (() => void) | null;
    /** How long the last preview took: heavy filters wait longer so the slider stays responsive. */
    cost: number;
    /** How long filtering everything on screen took (0 until it has been done): decides whether a drag may use the small window. */
    viewCost: number;
    /** Completes the small-window preview with everything on screen once the slider rests. */
    cancelSettle: (() => void) | null;
    /** The part of the page the preview has filtered: null = all of it (or nothing is known yet, before the first preview). */
    covered: Rect | null;
    /** Waits for the view to come to rest before the preview is made again where it moved to. */
    cancelView: (() => void) | null;
  }
  let s: Session | null = null;

  /**
   * The layers a filter acts on: the ticked pixel layers that are visible and not locked; a folder stands for the pixel
   * layers inside it. Whatever else is ticked is left as it is (counted in `skipped`).
   */
  function plan(): { layers: Layer[]; skipped: number } {
    const doc = d.doc();
    const layers: Layer[] = [];
    let skipped = 0;
    const add = (l: Layer, nested: boolean): void => {
      if (l.kind === 'folder') {
        for (const m of descendants(doc, l.id)) if (m.kind !== 'folder') add(m, true);
        return;
      }
      if (layers.includes(l)) return;
      if ((l.kind === 'raster' || l.kind === 'tone') && l.visible && !l.locked) layers.push(l);
      else if (!nested || l.kind === 'raster' || l.kind === 'tone') skipped++;
    };
    for (const l of d.layers()) add(l, false);
    layers.sort((x, y) => doc.layers.indexOf(x) - doc.layers.indexOf(y)); // lowest first, as in the document
    return { layers, skipped };
  }

  /**
   * Only when filtering everything on screen has proved slow does a drag preview just a window around the middle of
   * the view (and say so); the slider coming to rest completes it, so what is on screen always ends up showing
   * exactly what "Aplicar" will do.
   */
  /** A full-screen preview slower than this (ms) makes drags use the window. */
  const SLOW_MS = 90;
  /** How long the slider rests before the window preview is completed (ms). */
  const SETTLE_MS = 160;
  /**
   * A preview covers the screen and a margin around it (half a screen each side), so zooming out a little or panning does not
   * show the filter cut off at the old edge. It is made again only when the view has come to rest somewhere it does not reach.
   */
  const VIEW_MARGIN = 0.5;
  /** The margin is cut down so that the preview never works on more than this many pixels (beyond what is on screen). */
  const WIDE_PIXELS = 5_000_000;
  /** How long the view must rest before a preview is made again for it (ms). */
  const VIEW_REST_MS = 200;

  /**
   * The area a preview works on: the selection (or the layer), cut down to what is on screen unless `all`, and
   * (`window`) to a window around the middle of the view. `partial` says that what is on screen is not all filtered
   * yet; what is off screen is not shown, so it does not count.
   */
  function areaOf(scope: PreviewScope, layer: Layer): { sel: Selection | null; partial: boolean; rect: Rect | null; limit?: Rect } {
    const sel = d.selection();
    const { width, height } = paintTarget(layer).surface;
    let view = scope === 'all' ? null : d.viewRect();
    if (view && scope === 'view') view = widen(view, width, height);
    const r = previewRect(view, width, height, scope);
    if (!r.rect) return { sel, partial: false, rect: null };
    const shown = Selection.rect(width, height, r.rect);
    if (sel) shown.combine(sel, 'intersect');
    // With no selection of the person's, a neighbourhood filter is simply limited to the rectangle (no coverage to work out).
    return { sel: shown, partial: r.partial, rect: r.rect, limit: sel ? undefined : r.rect };
  }

  /** The view and a margin around it, as far as the pixel budget allows (never less than the view). */
  function widen(view: Rect, width: number, height: number): Rect {
    let k = VIEW_MARGIN;
    const area = (m: number): number => view.w * (1 + 2 * m) * view.h * (1 + 2 * m);
    while (k > 0 && area(k) > Math.max(WIDE_PIXELS, view.w * view.h)) k -= 0.05;
    k = Math.max(0, k);
    const x = Math.max(0, Math.round(view.x - view.w * k));
    const y = Math.max(0, Math.round(view.y - view.h * k));
    return { x, y, w: Math.min(width, Math.round(view.x + view.w * (1 + k))) - x, h: Math.min(height, Math.round(view.y + view.h * (1 + k))) - y };
  }

  /** Take back what the last preview did, on every layer (the last one first). */
  function undoShown(): void {
    if (!s) return;
    for (let i = s.shown.length - 1; i >= 0; i--) s.shown[i]!.undo();
    s.shown = [];
  }

  /**
   * A tonal correction that is a look-up table (brightness, levels, curve, balance, invert, posterize, binarize, gradient map) on
   * plain pixel layers, with no selection to limit it, is previewed by the renderer on the whole page at once, at any zoom,
   * instead of filtering pixels on the CPU where only a part of the page could be shown at a time.
   */
  function tablesFor(session: Session): Map<number, AdjustLut> | null {
    if (!isAdjustable(session.id) || d.selection() || session.layers.some((l) => l.kind !== 'raster')) return null;
    const lut = adjustLut({ filter: session.id, values: session.values, main: d.colors().main, sub: d.colors().sub });
    return lut ? new Map(session.layers.map((l) => [l.id, lut])) : null;
  }

  /** Show the filter with the current values (taking back the previous preview first). `cpuOnly`: really filter the pixels. */
  function preview(scope: PreviewScope = 'view', cpuOnly = false): void {
    if (!s) return;
    const tables = cpuOnly ? null : tablesFor(s);
    if (tables) {
      undoShown();
      s.gpu = true;
      s.panel.querySelector<HTMLElement>('.note')!.hidden = true;
      d.setPreview(tables);
      return;
    }
    if (s.gpu) {
      s.gpu = false;
      d.setPreview(null);
    }
    const began = performance.now();
    const { layers, id, values } = s;
    undoShown();
    const def = FILTERS[id]!;
    let partial = false;
    let covered: Rect | null = null;
    const done: { layer: Layer; rect: Rect }[] = [];
    for (const layer of layers) {
      const surface = paintTarget(layer).surface;
      const area = areaOf(scope, layer);
      partial = partial || area.partial;
      covered = area.rect;
      let patch = null;
      let rect: Rect | null = null;
      if (def.kind === 'pixel') {
        patch = applyPixelFilter(surface, layer.id, area.sel, def, values, d.colors());
        rect = patch?.rect ?? null;
      } else {
        const r = applyAreaFilter(surface, layer.id, area.limit ? null : area.sel, def, values, d.colors(), area.limit);
        if (r && 'tooLarge' in r) {
          // Nothing is left half done: what was shown on the layers before this one is taken back.
          undoShown();
          for (const x of done) {
            d.refreshLayer(x.layer, x.rect);
            d.render(x.rect);
          }
          d.say('La zona es demasiado grande para este filtro: selecciona una parte más pequeña.');
          return;
        }
        patch = r?.patch ?? null;
        rect = r?.rect ?? null;
      }
      if (patch) s.shown.push(patchCommand(d.doc(), patch, def.title));
      if (rect) {
        done.push({ layer, rect });
        d.refreshLayer(layer, rect);
        d.render(rect);
      }
    }
    s.panel.querySelector<HTMLElement>('.note')!.hidden = !partial;
    s.covered = covered;
    s.cost = performance.now() - began;
    if (scope === 'view') s.viewCost = s.cost;
  }

  /** Ask for a preview with the latest values: any number of asks before it runs make just one. */
  function schedule(): void {
    if (!s || s.cancelWait) return;
    const run = (): void => {
      if (!s) return;
      s.cancelWait = null;
      s.cancelSettle?.();
      s.cancelSettle = null;
      if (s.viewCost > SLOW_MS) {
        preview('window');
        const timer = window.setTimeout(() => {
          if (!s) return;
          s.cancelSettle = null;
          preview('view');
        }, SETTLE_MS);
        s.cancelSettle = () => clearTimeout(timer);
      } else preview('view');
    };
    if (s.cost < 40) {
      const frame = requestAnimationFrame(run); // light filters follow the slider frame by frame
      s.cancelWait = () => cancelAnimationFrame(frame);
    } else {
      const timer = window.setTimeout(run, Math.min(250, s.cost)); // heavy ones get one preview per short pause
      s.cancelWait = () => clearTimeout(timer);
    }
  }

  function unschedule(): void {
    s?.cancelWait?.();
    if (s) s.cancelWait = null;
    s?.cancelSettle?.();
    if (s) s.cancelSettle = null;
    s?.cancelView?.();
    if (s) s.cancelView = null;
  }

  function close(): void {
    if (!s) return;
    unschedule();
    s.panel.remove();
    s = null;
    d.setPreview(null);
    d.refreshUi();
  }

  function buildPanel(id: string): HTMLElement {
    const def = FILTERS[id]!;
    const panel = document.createElement('div');
    panel.id = 'filter-panel';
    const title = document.createElement('strong');
    title.textContent = def.title;
    const note = document.createElement('small');
    note.className = 'note';
    note.hidden = true;
    note.textContent = 'Mientras mueves el control solo se ve la zona central; al soltarlo se completa.';
    panel.append(title, note);
    for (const param of def.params) {
      const label = document.createElement('label');
      const text = document.createElement('span');
      const readout = document.createElement('output');
      const unit = param.unit ?? '';
      const show = (v: number): string => `${v}${unit}`;
      text.textContent = param.label;
      readout.textContent = show(param.value);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = String(param.min);
      range.max = String(param.max);
      range.step = String(param.step);
      range.value = String(param.value);
      range.addEventListener('input', () => {
        if (!s) return;
        s.values[param.id] = Number(range.value);
        readout.textContent = show(Number(range.value));
        schedule();
      });
      label.append(text, readout, range);
      panel.append(label);
    }
    const row = document.createElement('div');
    row.className = 'row';
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'Aplicar';
    ok.addEventListener('click', () => api.apply());
    const no = document.createElement('button');
    no.textContent = 'Cancelar';
    no.addEventListener('click', () => api.cancel());
    row.append(ok, no);
    panel.append(row);
    return panel;
  }

  const api = {
    get active() {
      return s !== null;
    },
    canStart: () => plan().layers.length > 0,
    start(id: string): boolean {
      if (s) api.cancel();
      const def = FILTERS[id];
      if (!def) return false;
      const { layers, skipped } = plan();
      if (!layers.length) {
        const only = d.layers();
        const one = only.length === 1 && only[0]!.kind !== 'folder' ? only[0]! : null;
        if (!one) d.say('No hay capas de píxeles visibles y sin bloquear que filtrar en lo elegido.');
        else if (one.kind !== 'raster' && one.kind !== 'tone') d.say('Elige una capa de píxeles para aplicar el filtro.');
        else if (one.locked) d.say('La capa está bloqueada: desbloquéala para aplicar el filtro.');
        else d.say('La capa está oculta: muéstrala para aplicar el filtro.');
        return false;
      }
      const panel = buildPanel(id);
      d.host.append(panel);
      s = { id, layers, values: defaultValues(def), shown: [], gpu: false, panel, cancelWait: null, cost: 0, viewCost: 0, cancelSettle: null, covered: null, cancelView: null };
      if (skipped) d.say(skipped === 1 ? 'Una capa elegida no se puede filtrar y se queda como está.' : `${skipped} capas elegidas no se pueden filtrar y se quedan como están.`);
      preview();
      d.refreshUi();
      return true;
    },
    apply(): void {
      if (!s) return;
      unschedule();
      preview('all', true); // the previews only covered what was on screen (or were only drawn): filter the whole area
      const cmd = combineCommands(FILTERS[s.id]!.title, s.shown);
      if (cmd) d.history().push(cmd);
      else d.say('El filtro no ha cambiado nada.');
      close();
    },
    cancel(): void {
      if (!s) return;
      const { layers, shown } = s;
      const regions = shown.map((c) => c.region);
      unschedule();
      undoShown();
      close();
      // A step is not tied to a layer here, so every filtered layer is redrawn where any step changed.
      for (const region of regions) {
        if (!region) continue;
        for (const layer of layers) d.refreshLayer(layer, region);
        d.render(region);
      }
    },
    viewChanged(): void {
      if (!s || s.gpu) return; // the renderer shows it on the whole page, wherever the view is
      const session = s;
      if (!session.covered) return; // everything is filtered: nothing to catch up with
      if (session.cancelSettle) return; // a window preview is about to be completed for the view as it is
      const view = d.viewRect();
      const c = session.covered;
      if (view && view.x >= c.x && view.y >= c.y && view.x + view.w <= c.x + c.w && view.y + view.h <= c.y + c.h) {
        session.cancelView?.();
        session.cancelView = null;
        return; // what is on screen is inside what was filtered
      }
      // Moved somewhere the preview does not reach: filter there, but only once the view rests (not at every frame of a zoom).
      session.cancelView?.();
      const timer = window.setTimeout(() => {
        if (s !== session) return;
        session.cancelView = null;
        if (!session.cancelWait) preview('view');
      }, VIEW_REST_MS);
      session.cancelView = () => clearTimeout(timer);
    },
  };
  return api;
}
