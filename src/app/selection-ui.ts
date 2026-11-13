import { traceContours } from './outline-trace';
import type { Document } from '../engine/document';
import { paintTarget } from '../engine/document';
import { flattenRegion } from '../engine/composite';
import { History, patchCommand } from '../engine/history';
import { Selection, encloseArea, lookPixels, selectColorRange, eraseOutside, eraseSelection, fillSelection, wandSelect, type CombineMode, type LookPicture } from '../engine/selection';
import { livewire } from '../engine/livewire';
import type { StrokePatch } from '../engine/brush';
import type { Layer } from '../engine/document';
import type { Pt } from '../engine/geometry';
import { TILE, type Rect } from '../engine/tiles';

export type SelTool =
  | 'selrect' | 'selellipse' | 'sellasso' | 'wand'
  | 'selpoly' | 'selmagnet' | 'selpen' | 'selerase' | 'selshrink';
/** Fill tools that are drawn on the canvas (the bucket itself is a click and has its own entry point). */
export type FillTool = 'enclose' | 'lassofill';
const SEL_TOOLS: ReadonlySet<string> = new Set<SelTool>(['selrect', 'selellipse', 'sellasso', 'wand', 'selpoly', 'selmagnet', 'selpen', 'selerase', 'selshrink']);
const FILL_TOOLS: ReadonlySet<string> = new Set<FillTool>(['enclose', 'lassofill']);
export const isSelectionTool = (t: string): t is SelTool => SEL_TOOLS.has(t);
export const isFillTool = (t: string): t is FillTool => FILL_TOOLS.has(t);
/** Tools that build a path click by click instead of by dragging. */
const isPathTool = (t: string): boolean => t === 'selpoly' || t === 'selmagnet';

export interface SelectionDeps {
  doc: () => Document;
  view: { x: number; y: number; scale: number; rot?: number; flip?: boolean; tilt?: number };
  overlay: HTMLCanvasElement;
  history: () => History;
  render: (region?: Rect | null) => void;
  refreshLayer: (layer: Layer, rect: Rect) => void;
  refreshUi: () => void;
  redrawOverlay: () => void;
  activeLayer: () => Layer;
  color: () => readonly [number, number, number];
  /** The "transparent colour" is on: painting areas takes pixels away instead of adding colour. */
  transparent: () => boolean;
  say: (msg: string) => void;
  /** The page point under a point of the stage (CSS pixels from its top left corner), whatever way the view is turned. */
  screenToDoc: (sx: number, sy: number) => Pt;
  /** Radius of the main brush in page pixels: the width of the selection pen. */
  brushRadius: () => number;
  /** Shows or hides the Close / Cancel bar used while a click-by-click path is open. */
  pathBar: (open: boolean) => void;
  options: () => { mode: CombineMode; tolerance: number; contiguous: boolean; allLayers: boolean; grow: number; gap: number; reference: boolean; antialias: boolean };
}

const WAND_FLATTEN_LIMIT = 16_000_000; // pixels: above this the wand looks at the active layer only

/** Interactive selection: the four selection tools, the outline on the canvas, and what can be done with a selection. */
export function createSelectionUi(d: SelectionDeps): {
  readonly current: Selection | null;
  readonly dragging: boolean;
  down(tool: SelTool | FillTool, e: PointerEvent, p: Pt): void;
  move(p: Pt): void;
  up(): void;
  /** A click-by-click path (polyline, magnetic lasso) is open and waiting for more points. */
  readonly pathOpen: boolean;
  /** Close the open path into a selection. */
  closePath(): void;
  /** Drop the open path without selecting anything. */
  cancelPath(): void;
  /** Drop a drag in progress (not a path) without selecting anything: a second finger or an undo took over. */
  abortDrag(): void;
  drawOverlay(ctx: CanvasRenderingContext2D): void;
  selectAll(): void;
  deselect(): void;
  reselect(): void;
  /** Replace the selection from outside (used after a transform), as an undoable step. */
  replace(sel: Selection | null, label: string): void;
  invert(): void;
  grow(px: number): void;
  feather(px: number): void;
  eraseSelected(): boolean;
  eraseOutsideSelection(): boolean;
  fillSelected(): boolean;
  /** Bucket fill: paint the area that looks like the clicked pixel with the main colour.  */
  fillAt(p: Pt): void;
  /** Select every pixel whose colour is close to `color`. */
  selectColor(color: readonly [number, number, number], tolerance: number): void;
  toggleOutline(): void;
  outlineVisible(): boolean;
  hasSelection(): boolean;
  canEditPixels(): boolean;
  /** Called when the document changes (new page): the selection no longer applies. */
  reset(): void;
} {
  let current: Selection | null = null;
  let previous: Selection | null = null; // for "select again"
  let showOutline = true;
  let version = 0;
  /** The last bucket tap and when it finished (see `fillAt`). */
  let lastFill: { key: string; at: number } | null = null;
  const REPEAT_FILL_MS = 1500;
  type Drag = {
    tool: SelTool | FillTool;
    mode: CombineMode;
    start: Pt;
    pts: Pt[];
    now: Pt;
    /** Magnetic lasso: the picture the path follows, and the route from the last anchor to the pointer. */
    pixel?: (x: number, y: number) => [number, number, number, number];
    live?: Pt[];
    liveAt?: { x: number; y: number; t: number };
    lastClick?: { x: number; y: number; t: number };
  };
  let drag: Drag | null = null;
  let cache: { key: string; path: Path2D } | null = null;

  const effectiveMode = (e: PointerEvent, tool: SelTool | FillTool): CombineMode => {
    if (tool === 'selerase' || tool === 'selshrink') return 'subtract';
    if (tool === 'selpen') return e.altKey ? 'subtract' : 'add';
    return e.shiftKey ? 'add' : e.altKey ? 'subtract' : d.options().mode;
  };
  const freehand = (t: string): boolean => t === 'sellasso' || t === 'enclose' || t === 'lassofill';
  const penLike = (t: string): boolean => t === 'selpen' || t === 'selerase' || t === 'selshrink';

  /** Replace the selection and make that step undoable. */
  function setSelection(next: Selection | null, label: string): void {
    const before = current;
    if (!before && !next) return;
    if (before) previous = before;
    current = next && !next.isEmpty ? next : null;
    version++;
    const after = current;
    d.history().push({
      label,
      region: null,
      undo: () => {
        current = before;
        version++;
        d.redrawOverlay();
        d.refreshUi();
      },
      redo: () => {
        current = after;
        version++;
        d.redrawOverlay();
        d.refreshUi();
      },
    });
    d.redrawOverlay();
    d.refreshUi();
  }

  /** Merge a new shape into the selection the way the mode says. */
  function commit(shape: Selection, mode: CombineMode, label: string): void {
    const base = mode === 'replace' || !current ? null : current.clone();
    if (!base) {
      setSelection(mode === 'subtract' || mode === 'intersect' ? null : shape, label);
      return;
    }
    base.combine(shape, mode);
    setSelection(base, label);
  }

  function shapeOf(dr: Drag): Selection | null {
    const doc = d.doc();
    const a = dr.start;
    const b = dr.now;
    if (dr.tool === 'selrect' || dr.tool === 'selellipse') {
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      if (r.w < 1 || r.h < 1) return null;
      return dr.tool === 'selrect' ? Selection.rect(doc.width, doc.height, r) : Selection.ellipse(doc.width, doc.height, r);
    }
    if (dr.tool === 'sellasso') return dr.pts.length < 3 ? null : Selection.polygon(doc.width, doc.height, dr.pts);
    return null;
  }

  /**
   * The picture the wand and the bucket look at: the whole page (when it is small enough) or the active layer.
   * With "referred layers only" and no reference layer in the document there is nothing to look at: null.
   */
  function lookAt(): LookPicture | null {
    const doc = d.doc();
    const o = d.options();
    const layer = d.activeLayer();
    const refs = doc.layers.some((l) => l.role === 'reference');
    if (o.reference && !refs) {
      d.say('No hay capas de referencia: márcalas con el botón de referencia de la paleta de capas.');
      return null;
    }
    if ((o.allLayers || o.reference) && doc.width * doc.height <= WAND_FLATTEN_LIMIT) {
      // Reference layers, when there are any, are what the tools look at; otherwise everything shown except drafts.
      // The page is composed one tile at a time, only where a tool looks (a flood fill that stays inside a closed
      // area never composes the rest of the page).
      const copts = refs ? ({ only: 'reference' } as const) : ({ output: true } as const);
      return {
        width: doc.width,
        height: doc.height,
        tile(tx, ty) {
          const rect = { x: tx * TILE, y: ty * TILE, w: Math.min(TILE, doc.width - tx * TILE), h: Math.min(TILE, doc.height - ty * TILE) };
          const part = flattenRegion(doc, rect, copts);
          if (rect.w === TILE) return part; // a full-width tile already has the stride of a tile
          const out = new Uint8ClampedArray(TILE * TILE * 4);
          for (let row = 0; row < rect.h; row++) out.set(part.subarray(row * rect.w * 4, (row + 1) * rect.w * 4), row * TILE * 4);
          return out;
        },
      };
    }
    if (o.allLayers) d.say('El lienzo es muy grande: se mira solo la capa activa.');
    const src = layer.source ?? layer.surface;
    return { width: doc.width, height: doc.height, tile: (tx, ty) => src.get(tx, ty) ?? null };
  }

  function wand(p: Pt, mode: CombineMode): void {
    const doc = d.doc();
    const o = d.options();
    const look = lookAt();
    if (!look) return;
    const shape = wandSelect(doc.width, doc.height, look, Math.floor(p.x), Math.floor(p.y), { tolerance: o.tolerance, contiguous: o.contiguous, gap: o.gap });
    if (shape.isEmpty) return;
    commit(shape, mode, o.reference ? 'Selección por capas de referencia' : 'Selección automática');
  }

  const labelOf: Record<SelTool, string> = {
    selrect: 'Selección rectangular',
    selellipse: 'Selección elíptica',
    sellasso: 'Selección con lazo',
    wand: 'Selección automática',
    selpoly: 'Selección con polilínea',
    selmagnet: 'Selección con lazo magnético',
    selpen: 'Pluma de selección',
    selerase: 'Borrar de la selección',
    selshrink: 'Reducir selección',
  };

  /** Close the path being built and turn it into a selection. */
  function finishPath(): void {
    const dr = drag;
    if (!dr || !isPathTool(dr.tool)) return;
    drag = null;
    d.pathBar(false);
    if (dr.pts.length >= 3) commit(Selection.polygon(d.doc().width, d.doc().height, dr.pts), dr.mode, labelOf[dr.tool as SelTool]);
    else d.say('Hacen falta al menos tres puntos para cerrar la selección.');
    d.redrawOverlay();
  }

  /** The route from the last anchor to `p` along the strongest edges (magnetic lasso). */
  function route(dr: Drag, p: Pt): Pt[] {
    const doc = d.doc();
    const from = dr.pts[dr.pts.length - 1]!;
    return dr.pixel ? livewire(doc.width, doc.height, dr.pixel, from, p) : [from, p];
  }

  // ---- pixel operations ------------------------------------------------------------------------
  const canEditPixels = (): boolean => {
    const l = d.activeLayer();
    return (l.kind === 'raster' || l.kind === 'tone') && !l.locked;
  };
  /** Say why the active layer cannot be painted on. */
  const refuse = (): void => d.say(d.activeLayer().locked ? 'La capa está bloqueada: desbloquéala para editarla.' : 'Elige una capa de píxeles para rellenar.');

  function apply(label: string, run: (surface: Layer['surface'], id: number, sel: Selection) => StrokePatch | null): boolean {
    if (!current || !canEditPixels()) return false;
    const layer = d.activeLayer();
    const target = paintTarget(layer);
    const patch = run(target.surface, layer.id, current);
    if (!patch) return true;
    d.history().push(patchCommand(d.doc(), patch, label));
    d.refreshLayer(layer, patch.rect);
    d.render(patch.rect);
    d.refreshUi();
    return true;
  }

  // ---- outline on the canvas -----------------------------------------------------------------
  /**
   * The outline is a thin dashed line in screen space (same look as the preview while dragging), so it stays
   * the same at any zoom. It is traced from the mask sampled on a grid of at most ~100k points.
   */
  function outlinePath(): Path2D | null {
    if (!current) return null;
    const { overlay, view } = d;
    const dpr = window.devicePixelRatio || 1;
    const key = `${version}|${overlay.width}x${overlay.height}|${view.x.toFixed(1)},${view.y.toFixed(1)},${view.scale.toFixed(4)}|${view.rot}${view.flip ? 'f' : ''}${view.tilt ? view.tilt.toFixed(4) : ''}`;
    if (cache?.key === key) return cache.path;
    const cssW = overlay.width / dpr;
    const cssH = overlay.height / dpr;
    const step = Math.max(2, Math.ceil(Math.sqrt((cssW * cssH) / 100000)));
    // One ring of samples around the screen stays empty, so every outline closes just outside the view.
    const gw = Math.ceil(cssW / step) + 3;
    const gh = Math.ceil(cssH / step) + 3;
    const samples = new Uint8Array(gw * gh);
    // Screen -> page is affine: map three points once instead of converting every sample.
    const o0 = d.screenToDoc(0, 0);
    const ox = d.screenToDoc(1, 0);
    const oy = d.screenToDoc(0, 1);
    const ax = ox.x - o0.x;
    const ay = ox.y - o0.y;
    const bx = oy.x - o0.x;
    const by = oy.y - o0.y;
    for (let gy = 1; gy < gh - 1; gy++) {
      const sy = (gy - 1) * step;
      for (let gx = 1; gx < gw - 1; gx++) {
        const sx = (gx - 1) * step;
        samples[gy * gw + gx] = current.at(Math.floor(o0.x + ax * sx + bx * sy), Math.floor(o0.y + ay * sx + by * sy));
      }
    }
    const path = new Path2D();
    for (const loop of traceContours(samples, gw, gh)) {
      loop.forEach(([x, y], i) => {
        const px = (x - 1) * step * dpr;
        const py = (y - 1) * step * dpr;
        if (i) path.lineTo(px, py);
        else path.moveTo(px, py);
      });
      path.closePath();
    }
    cache = { key, path };
    return path;
  }

  /** "Reduce selection": the pen takes away only a band of its own width along the edge it passes over. */
  function shrinkEdge(stroke: Selection): void {
    if (!current) return;
    const inner = current.clone();
    inner.grow(-Math.max(1, d.brushRadius()));
    const band = current.clone();
    band.combine(inner, 'subtract');
    band.combine(stroke, 'intersect');
    const next = current.clone();
    next.combine(band, 'subtract');
    setSelection(next, labelOf.selshrink);
  }

  /** Paint an area with the main colour on the active layer, limited by the selection if there is one. */
  function fillArea(area: Selection, label: string, antialias = false): void {
    if (area.isEmpty) return;
    // Regions found by colour are all-or-nothing per pixel; softening them first leaves the selection's own limit as it is.
    if (antialias) area.smooth();
    if (current) area.combine(current, 'intersect');
    const layer = d.activeLayer();
    const surface = paintTarget(layer).surface;
    const patch = d.transparent() ? eraseSelection(surface, layer.id, area) : fillSelection(surface, layer.id, area, d.color());
    if (!patch) return;
    d.history().push(patchCommand(d.doc(), patch, label));
    d.refreshLayer(layer, patch.rect);
    d.render(patch.rect);
    d.refreshUi();
  }

  /** "Enclose and fill" and "lasso fill": the loop that was drawn decides what gets painted. */
  function finishFillDrag(dr: Drag): void {
    if (!canEditPixels()) {
      refuse();
      return;
    }
    if (dr.pts.length < 3) return;
    const doc = d.doc();
    const o = d.options();
    if (dr.tool === 'lassofill') {
      fillArea(Selection.polygon(doc.width, doc.height, dr.pts), 'Relleno con lazo');
      return;
    }
    const look = lookAt();
    if (!look) return;
    const area = encloseArea(doc.width, doc.height, lookPixels(look), dr.pts, o.tolerance);
    if (o.grow > 0 && !area.isEmpty) area.grow(o.grow);
    fillArea(area, 'Encerrar y rellenar', o.antialias);
  }

  const api = {
    get current() {
      return current;
    },
    get dragging() {
      return drag !== null;
    },
    get pathOpen() {
      return drag !== null && isPathTool(drag.tool);
    },
    closePath: finishPath,
    cancelPath(): void {
      if (!drag || !isPathTool(drag.tool)) return;
      drag = null;
      d.pathBar(false);
      d.redrawOverlay();
    },
    abortDrag(): void {
      if (!drag || isPathTool(drag.tool)) return;
      drag = null;
      d.redrawOverlay();
    },
    down(tool: SelTool | FillTool, e: PointerEvent, p: Pt): void {
      const mode = effectiveMode(e, tool);
      if (tool === 'wand') {
        wand(p, mode);
        return;
      }
      if (isPathTool(tool)) {
        const now = performance.now();
        if (!drag || drag.tool !== tool) {
          const picture = tool === 'selmagnet' ? lookAt() : null;
          if (tool === 'selmagnet' && !picture) return;
          drag = { tool, mode, start: p, pts: [p], now: p, pixel: picture ? lookPixels(picture) : undefined, live: [], lastClick: { x: p.x, y: p.y, t: now } };
          d.pathBar(true);
          d.redrawOverlay();
          return;
        }
        const k = d.view.scale;
        const first = drag.pts[0]!;
        const lc = drag.lastClick;
        const twice = !!lc && now - lc.t < 350 && Math.hypot(p.x - lc.x, p.y - lc.y) * k < 8;
        if (twice || (drag.pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * k <= 10)) {
          finishPath();
          return;
        }
        const leg = route(drag, p);
        for (let i = 1; i < leg.length; i++) drag.pts.push(leg[i]!);
        drag.live = [];
        drag.lastClick = { x: p.x, y: p.y, t: now };
        d.redrawOverlay();
        return;
      }
      drag = { tool, mode, start: p, pts: [p], now: p };
    },
    move(p: Pt): void {
      if (!drag) return;
      drag.now = p;
      if (freehand(drag.tool) || penLike(drag.tool)) {
        const last = drag.pts[drag.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * d.view.scale >= 2) drag.pts.push(p);
      } else if (drag.tool === 'selmagnet' && drag.pixel) {
        // The route follows the edges but costs a search per update, so only refresh it when the pointer has moved.
        const at = drag.liveAt;
        const t = performance.now();
        if (!at || (Math.hypot(p.x - at.x, p.y - at.y) * d.view.scale >= 4 && t - at.t >= 40)) {
          drag.live = route(drag, p);
          drag.liveAt = { x: p.x, y: p.y, t };
        }
      }
      d.redrawOverlay();
    },
    up(): void {
      if (!drag || isPathTool(drag.tool)) return; // a path is built click by click
      const dr = drag;
      drag = null;
      const doc = d.doc();
      if (dr.tool === 'enclose' || dr.tool === 'lassofill') {
        finishFillDrag(dr);
      } else if (penLike(dr.tool)) {
        const stroke = Selection.stroke(doc.width, doc.height, dr.pts, d.brushRadius());
        if (dr.tool === 'selshrink') shrinkEdge(stroke);
        else commit(stroke, dr.mode, labelOf[dr.tool as SelTool]);
      } else {
        const shape = shapeOf(dr);
        if (shape) commit(shape, dr.mode, labelOf[dr.tool as SelTool]);
        else if (dr.tool !== 'wand' && dr.mode === 'replace') setSelection(null, 'Deseleccionar'); // a click without dragging clears
      }
      d.redrawOverlay();
    },
    drawOverlay(ctx: CanvasRenderingContext2D): void {
      if (current && showOutline) {
        const path = outlinePath();
        if (path) {
          // The same pair of dashed lines as the shape being dragged: white, then black filling the gaps.
          const k = window.devicePixelRatio || 1;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = 'rgba(70, 130, 255, 0.14)';
          ctx.fill(path, 'evenodd');
          ctx.lineWidth = 1.5 * k;
          ctx.lineJoin = 'round';
          ctx.setLineDash([6 * k, 4 * k]);
          ctx.strokeStyle = '#fff';
          ctx.stroke(path);
          ctx.strokeStyle = '#000';
          ctx.lineDashOffset = 5 * k;
          ctx.stroke(path);
          ctx.restore();
        }
      }
      if (drag) {
        // Preview of the shape being drawn (the context is in document space here).
        const s = d.view.scale;
        ctx.save();
        ctx.lineWidth = 1.5 / s;
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.beginPath();
        const a = drag.start;
        const b = drag.now;
        if (penLike(drag.tool)) {
          // The pen: show the band it is sweeping, in the colour of what it will do.
          ctx.setLineDash([]);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(1 / s, 2 * d.brushRadius());
          ctx.strokeStyle = drag.tool === 'selpen' ? 'rgba(70,130,255,0.45)' : 'rgba(255,90,90,0.45)';
          drag.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          if (drag.pts.length === 1) ctx.lineTo(drag.pts[0]!.x + 0.01, drag.pts[0]!.y);
          ctx.stroke();
          ctx.restore();
          return;
        }
        if (drag.tool === 'selrect') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        else if (drag.tool === 'selellipse') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        else {
          drag.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          if (isPathTool(drag.tool)) {
            // The open path: what is fixed so far, the route to the pointer, and the closing mark on the first point.
            if (drag.tool === 'selmagnet') for (const q of (drag.live ?? []).slice(1)) ctx.lineTo(q.x, q.y);
            else ctx.lineTo(b.x, b.y);
          }
        }
        ctx.stroke();
        ctx.strokeStyle = '#000';
        ctx.lineDashOffset = 5 / s;
        ctx.stroke();
        if (isPathTool(drag.tool)) {
          ctx.setLineDash([]);
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#000';
          for (const [i, q] of drag.pts.entries()) {
            if (i && i < drag.pts.length - 1 && drag.tool === 'selmagnet') continue; // routes have many points: mark the ends only
            ctx.beginPath();
            ctx.arc(q.x, q.y, (i === 0 ? 5 : 3) / s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    },
    selectAll(): void {
      const doc = d.doc();
      setSelection(Selection.all(doc.width, doc.height), 'Seleccionar todo');
    },
    deselect(): void {
      setSelection(null, 'Deseleccionar');
    },
    replace(sel: Selection | null, label: string): void {
      setSelection(sel, label);
    },
    reselect(): void {
      if (previous && !current) setSelection(previous.clone(), 'Volver a seleccionar');
    },
    invert(): void {
      if (!current) return;
      const next = current.clone();
      next.invert();
      setSelection(next, 'Invertir selección');
    },
    grow(px: number): void {
      if (!current) return;
      const next = current.clone();
      next.grow(px);
      setSelection(next, px > 0 ? 'Expandir selección' : 'Contraer selección');
    },
    feather(px: number): void {
      if (!current) return;
      const next = current.clone();
      next.feather(px);
      setSelection(next, 'Desenfocar el borde');
    },
    eraseSelected: () => apply('Borrar selección', eraseSelection),
    eraseOutsideSelection: () => apply('Borrar fuera de la selección', eraseOutside),
    fillSelected: () => apply('Rellenar selección', (s, id, sel) => (d.transparent() ? eraseSelection(s, id, sel) : fillSelection(s, id, sel, d.color()))),
    fillAt(p: Pt): void {
      if (!canEditPixels()) {
        refuse();
        return;
      }
      const doc = d.doc();
      const o = d.options();
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      // Tapping the same spot again at once (nothing drawn, no option or colour changed since) would find the same area
      // and paint it the same way: answer it without repeating the work, so a burst of taps does not pile up.
      const again = `${x},${y},${d.activeLayer().id},${version},${d.history().revision},${d.color().join()},${JSON.stringify(o)}`;
      if (lastFill && lastFill.key === again && performance.now() - lastFill.at < REPEAT_FILL_MS) return;
      const look = lookAt();
      if (!look) return;
      if (current && current.at(x, y) < 128) {
        d.say('Toca dentro de la selección para rellenar; fuera de ella no se rellena.');
        return;
      }
      // An active selection limits the fill: the search stays inside it instead of flooding the whole page first.
      const area = wandSelect(doc.width, doc.height, look, x, y, { tolerance: o.tolerance, contiguous: o.contiguous, gap: o.gap, within: current });
      if (area.isEmpty) return;
      if (o.grow > 0) area.grow(o.grow); // cover the anti-aliased rim around the area
      fillArea(area, 'Relleno', o.antialias);
      // An area that spans the whole page is what a leak looks like: the outline the person meant to fill inside has an opening.
      const span = area.bounds();
      if (o.contiguous && !current && span && span.w >= doc.width * 0.98 && span.h >= doc.height * 0.98 && o.gap < 20) {
        d.say('El relleno ocupó toda la página: el contorno puede tener una abertura. Sube «Cerrar huecos» o cierra la línea.');
      }
      // What the next identical tap would see: the picture after this fill.
      lastFill = { key: `${x},${y},${d.activeLayer().id},${version},${d.history().revision},${d.color().join()},${JSON.stringify(o)}`, at: performance.now() };
    },
    selectColor(color: readonly [number, number, number], tolerance: number): void {
      const look = lookAt();
      if (!look) return;
      const doc = d.doc();
      const shape = selectColorRange(doc.width, doc.height, lookPixels(look), color, tolerance);
      if (shape.isEmpty) {
        d.say('No hay píxeles de ese color.');
        return;
      }
      commit(shape, d.options().mode, 'Seleccionar gama de color');
    },
    toggleOutline(): void {
      showOutline = !showOutline;
      d.redrawOverlay();
    },
    outlineVisible: () => showOutline,
    hasSelection: () => current !== null,
    canEditPixels,
    reset(): void {
      current = null;
      previous = null;
      if (drag && isPathTool(drag.tool)) d.pathBar(false);
      drag = null;
      cache = null;
      version++;
    },
  };
  return api;
}
