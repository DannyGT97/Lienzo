import { adjustLut, isAdjustable, type AdjustLut } from '../engine/adjust';
import type { Document, Layer } from '../engine/document';
import { paintTarget } from '../engine/document';
import { createTick } from '../engine/cooperate';
import { applyAreaFilterAsync, applyPixelFilterAsync } from '../engine/filter-run';
import { poolRunner } from '../engine/filter-pool';
import { FILTERS, defaultValues, previewScale, type AreaFilter, type FilterContext, type PixelFilter } from '../engine/filters';
import { combineCommands, patchCommand, type Command, type History } from '../engine/history';
import { descendants } from '../engine/layer-tree';
import { Selection } from '../engine/selection';
import type { Rect } from '../engine/tiles';
import type { TileRecorder } from '../engine/transform';

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
  /** A notice that stays up while something takes a while (it ends with `done`); left out in tests. */
  busy?: (text: string) => { done(): void };
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
 * While the sliders move, only what is on screen is filtered (a page can be many megapixels, the screen about one), piece by
 * piece from the middle of the screen out, on the workers of the device (see engine/filter-run.ts): the window is never held, what
 * is done shows at once, and a newer slider value stops the preview in progress and starts over. "Aplicar" then filters the whole
 * area (nothing, if the preview already did). Own design (the references do not say how their previews are scheduled).
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
    /** What the previews did, one step per layer: undone before the next preview shows. */
    shown: Command[];
    /** The preview is the renderer applying the correction's table (nothing was filtered yet). */
    gpu: boolean;
    panel: HTMLElement;
    /** Stops the preview that is waiting to run, if any. */
    cancelWait: (() => void) | null;
    /** How long the last whole preview took: heavy filters wait longer between previews so the slider stays responsive. */
    cost: number;
    /** The part of the page the preview has filtered: null = all of it (or nothing is known yet, before the first preview). */
    covered: Rect | null;
    /** Waits for the view to come to rest before the preview is made again where it moved to. */
    cancelView: (() => void) | null;
    /** Counts the previews asked for: a preview that is not the latest stops at its next piece. */
    ticket: number;
    /** The session was cancelled: whatever is still being worked on is thrown away. */
    dead: boolean;
    /** "Aplicar" was pressed: the whole layer is being filtered. */
    applying: boolean;
    /** What each layer was before the filter (and the area it worked on), to go on from one pass to the next. */
    recs: Map<Layer, { rec: TileRecorder; frame?: Rect }>;
    /** What is on the layers is the filter on the whole of it, finished (so "Aplicar" has nothing left to do). */
    settled: boolean;
  }
  let s: Session | null = null;

  /**
   * Filtering is done one after another, never two at once: a new session (or a new preview) waits for the one before it to put its
   * pieces back or take them away, so it never reads a layer that is half filtered.
   */
  let chain: Promise<void> = Promise.resolve();
  const unionRect = (a: Rect, b: Rect): Rect => {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
  };
  const tick = createTick();

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
   * A preview covers the screen and a margin around it (a quarter of a screen each side), so zooming out a little or panning does not
   * show the filter cut off at the old edge. It is made again only when the view has come to rest somewhere it does not reach. The
   * pieces nearest to the middle of the screen come first, so the margin is only worked on once what is seen is done.
   */
  const VIEW_MARGIN = 0.25;
  /** The margin is cut down so that the preview never works on more than this many pixels (beyond what is on screen). */
  const WIDE_PIXELS = 3_000_000;
  /** How long the view must rest before a preview is made again for it (ms). */
  const VIEW_REST_MS = 200;

  /** The part of the page a preview works on (null = all of it): what is on screen and a margin, unless `all`. */
  function targetOf(scope: PreviewScope, layer: Layer): Rect | null {
    const { width, height } = paintTarget(layer).surface;
    const view = scope === 'all' ? null : d.viewRect();
    return previewRect(view ? widen(view, width, height) : null, width, height, 'view').rect;
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

  /** Take back what the previews did on every layer (the last one first) and redraw where it was. */
  function revert(session: Session): void {
    const regions = session.shown.map((c) => c.region);
    for (let i = session.shown.length - 1; i >= 0; i--) session.shown[i]!.undo();
    session.shown = [];
    for (const region of regions) {
      if (!region) continue;
      for (const layer of session.layers) d.refreshLayer(layer, region);
      d.render(region);
    }
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

  const setNote = (session: Session, text: string | null): void => {
    const note = session.panel.querySelector<HTMLElement>('.note');
    if (!note) return;
    note.hidden = text === null;
    if (text !== null) note.textContent = text;
  };

  /**
   * The filter on the layers, piece by piece; stops when a newer preview is asked for. A fresh preview takes the previous one back first;
   * a `refine` pass goes on over what the one before it did (a preview made smaller, now made at full size) without showing the
   * picture unfiltered in between. Returns whether a full-size pass should follow (this one was made smaller and finished).
   */
  async function work(session: Session, ticket: number, scope: PreviewScope, refine = false): Promise<boolean> {
    const stop = (): boolean => session.dead || ticket !== session.ticket;
    if (stop()) return false; // a newer preview was asked for while this one waited its turn
    if (session.gpu) {
      session.gpu = false;
      d.setPreview(null);
    }
    let earlier: Rect[] = [];
    if (refine) {
      earlier = session.shown.map((c) => c.region).filter((r): r is Rect => !!r);
      session.shown = []; // the patch of this pass holds the whole of the change (it goes on over the recorder of the last one)
    } else {
      revert(session);
      session.recs.clear();
    }
    session.settled = false;
    const began = performance.now();
    const def = FILTERS[session.id]!;
    const view = d.viewRect();
    const near = view ? { x: view.x + view.w / 2, y: view.y + view.h / 2 } : undefined;
    // What was written is drawn once a frame, not at every piece.
    const dirty = new Map<Layer, Rect>();
    let frame = 0;
    const flush = (): void => {
      frame = 0;
      for (const [layer, r] of dirty) {
        d.refreshLayer(layer, r);
        d.render(r);
      }
      dirty.clear();
    };
    const mark = (layer: Layer, r: Rect): void => {
      const old = dirty.get(layer);
      if (!old) dirty.set(layer, r);
      else {
        const x0 = Math.min(old.x, r.x);
        const y0 = Math.min(old.y, r.y);
        dirty.set(layer, { x: x0, y: y0, w: Math.max(old.x + old.w, r.x + r.w) - x0, h: Math.max(old.y + old.h, r.y + r.h) - y0 });
      }
      if (!frame) frame = requestAnimationFrame(flush);
    };
    setNote(session, refine ? 'Afinando…' : 'Calculando…');
    let covered: Rect | null = null;
    let whole = true;
    let complete = true;
    let smaller = false;
    try {
      for (const layer of session.layers) {
        const surface = paintTarget(layer).surface;
        const rect = targetOf(scope, layer);
        covered = rect;
        if (rect) whole = false;
        const sel = d.selection();
        const prior = refine ? session.recs.get(layer) : undefined;
        const o = { runner: poolRunner, tick, stop, ...(near ? { near } : {}), onPiece: (r: Rect) => mark(layer, r), ...(prior ? { recorder: prior.rec } : {}) };
        let result;
        if (def.kind === 'pixel') {
          // A pixel filter is limited to the part shown by narrowing the selection to it.
          let eff: Selection | null = sel;
          if (rect) {
            eff = Selection.rect(surface.width, surface.height, rect);
            if (sel) eff.combine(sel, 'intersect');
          }
          result = await applyPixelFilterAsync(surface, layer.id, eff, def as PixelFilter, session.values, d.colors(), o);
        } else {
          // A big area is previewed smaller (and finished at full size once it is done): far less to work out while a slider moves.
          const scale = refine || scope === 'all' ? 1 : previewScale(def as AreaFilter, session.values, rect ? rect.w * rect.h : surface.width * surface.height);
          if (scale > 1) smaller = true;
          result = await applyAreaFilterAsync(surface, layer.id, sel, def as AreaFilter, session.values, d.colors(), {
            ...o,
            scale,
            ...(rect ? { limit: rect } : {}),
            ...(prior?.frame ? { frame: prior.frame } : {}),
          });
          session.recs.set(layer, { rec: result.recorder, ...(result.frame ? { frame: result.frame } : {}) });
        }
        if (result.patch) {
          const rect2 = earlier.reduce((a, b) => unionRect(a, b), result.patch.rect);
          session.shown.push(patchCommand(d.doc(), { ...result.patch, rect: rect2 }, def.title));
        }
        if (!result.complete) {
          complete = false;
          break;
        }
      }
    } finally {
      if (frame) cancelAnimationFrame(frame);
      flush();
    }
    if (session.dead) return false;
    if (!complete || stop()) return false; // a newer preview takes over; it says what is being done
    session.covered = covered;
    session.cost = performance.now() - began;
    if (smaller) return true; // the full-size pass says when it is done
    setNote(session, null);
    session.settled = whole;
    return false;
  }

  /** Show the filter with the current values on what is on screen (or, `all`, on the whole layers: what "Aplicar" does). */
  function preview(scope: PreviewScope = 'view', cpuOnly = false): Promise<void> {
    const session = s;
    if (!session) return Promise.resolve();
    const tables = cpuOnly ? null : tablesFor(session);
    if (tables) {
      session.gpu = true;
      setNote(session, null);
      d.setPreview(tables);
      return Promise.resolve();
    }
    const ticket = ++session.ticket;
    const run = chain.then(async () => {
      const again = await work(session, ticket, scope);
      // The preview was made smaller: the same area is now done at full size, unless a newer preview has been asked for meanwhile.
      if (again && !session.dead && ticket === session.ticket) await work(session, ++session.ticket, scope, true);
    });
    chain = run.catch(() => undefined);
    return run;
  }

  /** Ask for a preview with the latest values: any number of asks before it runs make just one. */
  function schedule(): void {
    if (!s || s.cancelWait) return;
    const run = (): void => {
      if (!s) return;
      s.cancelWait = null;
      void preview('view');
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
        if (!s || s.applying) return;
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
      s = { id, layers, values: defaultValues(def), shown: [], gpu: false, panel, cancelWait: null, cost: 0, covered: null, cancelView: null, ticket: 0, dead: false, applying: false, recs: new Map(), settled: false };
      if (skipped) d.say(skipped === 1 ? 'Una capa elegida no se puede filtrar y se queda como está.' : `${skipped} capas elegidas no se pueden filtrar y se quedan como están.`);
      void preview();
      d.refreshUi();
      return true;
    },
    apply(): void {
      const session = s;
      if (!session || session.applying) return;
      session.applying = true;
      unschedule();
      session.ticket++; // the preview in flight stops
      for (const b of session.panel.querySelectorAll('button')) b.disabled = true;
      const busy = d.busy?.('Aplicando el filtro…');
      void (async () => {
        try {
          // The previews only covered what was on screen (or were only drawn): filter the whole area, unless it already is.
          if (!session.settled || session.gpu) await preview('all', true);
        } finally {
          busy?.done();
        }
        if (s !== session || session.dead) return;
        const cmd = combineCommands(FILTERS[session.id]!.title, session.shown);
        if (cmd) d.history().push(cmd);
        else d.say('El filtro no ha cambiado nada.');
        close();
      })();
    },
    cancel(): void {
      const session = s;
      if (!session || session.applying) return;
      session.dead = true;
      session.ticket++;
      close();
      // What is still being worked on stops at its next piece; once it has, everything shown is taken back.
      chain = chain.then(() => revert(session)).catch(() => undefined);
    },
    viewChanged(): void {
      if (!s || s.gpu || s.applying) return; // the renderer shows it on the whole page, wherever the view is
      const session = s;
      if (!session.covered) return; // everything is filtered: nothing to catch up with
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
        if (!session.cancelWait) void preview('view');
      }, VIEW_REST_MS);
      session.cancelView = () => clearTimeout(timer);
    },
  };
  return api;
}
