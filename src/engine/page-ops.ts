import type { Balloon } from './balloon';
import type { Document, Layer } from './document';
import type { Guides } from './guides';
import type { Command } from './history';
import type { Panel } from './panels';
import type { Ruler } from './rulers';
import type { Pt } from './geometry';
import { resampleSurface, type ResampleMethod } from './resample';
import { TILE, TiledSurface, type Rect } from './tiles';
import { settle } from './overflow';

/** An operation on the whole page: every layer changes with it. */
export type PageOp =
  | { kind: 'crop'; rect: Rect }
  /** The new page is this window over the old one, in old-page coordinates; it may reach past the page (new area is empty). */
  | { kind: 'resize'; rect: Rect }
  | { kind: 'rotate'; turns: 1 | 2 | 3 } // quarter turns clockwise
  | { kind: 'flip'; axis: 'h' | 'v' }
  /** The whole picture re-sampled to a new size (what the resolution dialog does). */
  | { kind: 'scale'; width: number; height: number; method: ResampleMethod };

/** What a page operation changes: the size, the layers (new objects, new pixels) and the guides. */
interface PageContent {
  width: number;
  height: number;
  layers: Layer[];
  guides: Guides;
  rulers: Ruler[];
}

/** Where a point of the old page ends up on the new one (null = cut off). `w`/`h` are the old page size. */
type PointMap = (x: number, y: number) => Pt | null;

function pointMap(op: PageOp, w: number, h: number): { map: PointMap; width: number; height: number } {
  if (op.kind === 'crop' || op.kind === 'resize') {
    const r = op.rect;
    return {
      // The far edge belongs to the window (a frame corner on the page border stays); pixel centres never sit on it.
      map: (x, y) => (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h ? null : { x: x - r.x, y: y - r.y }),
      width: r.w,
      height: r.h,
    };
  }
  if (op.kind === 'scale') {
    return { map: (x, y) => ({ x: (x * op.width) / w, y: (y * op.height) / h }), width: op.width, height: op.height };
  }
  if (op.kind === 'flip') {
    return { map: op.axis === 'h' ? (x, y) => ({ x: w - x, y }) : (x, y) => ({ x, y: h - y }), width: w, height: h };
  }
  if (op.turns === 2) return { map: (x, y) => ({ x: w - x, y: h - y }), width: w, height: h };
  if (op.turns === 1) return { map: (x, y) => ({ x: h - y, y: x }), width: h, height: w };
  return { map: (x, y) => ({ x: y, y: w - x }), width: h, height: w };
}

/**
 * Copy the pixels of a surface to a new page size, moving each one where `map` says (pixel corners, so a pixel at
 * (x, y) lands at the pixel whose area contains its image). Only tiles that hold pixels are visited. `base` is what
 * the surface holds where it has no tile: new tiles start from it (a mask that shows everything starts at 255).
 */
function remapSurface(src: TiledSurface, width: number, height: number, op: PageOp, base: 0 | 255 = 0): TiledSurface {
  const out = new TiledSurface(width, height);
  const { map } = pointMap(op, src.width, src.height);
  // A pixel is a unit square: map its centre, then take the pixel that holds the image of the centre.
  for (const [tx, ty, tile] of src.entries()) {
    for (let y = 0; y < TILE; y++) {
      const sy = ty * TILE + y;
      if (sy >= src.height) break;
      for (let x = 0; x < TILE; x++) {
        const sx = tx * TILE + x;
        if (sx >= src.width) break;
        const i = (y * TILE + x) * 4;
        if (tile[i + 3] === 0 && base === 0) continue;
        const p = map(sx + 0.5, sy + 0.5);
        if (!p) continue;
        const dx = Math.floor(p.x);
        const dy = Math.floor(p.y);
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        const dtx = Math.floor(dx / TILE);
        const dty = Math.floor(dy / TILE);
        let dst = out.get(dtx, dty);
        if (!dst) {
          dst = out.ensure(dtx, dty);
          if (base === 255) dst.fill(255);
        }
        const o = ((dy % TILE) * TILE + (dx % TILE)) * 4;
        dst[o] = tile[i]!;
        dst[o + 1] = tile[i + 1]!;
        dst[o + 2] = tile[i + 2]!;
        dst[o + 3] = tile[i + 3]!;
      }
    }
  }
  return out;
}

function mapPanel(p: Panel, map: PointMap): Panel | null {
  const pts = p.points.map((q) => map(q.x, q.y));
  if (pts.some((q) => !q)) return null; // a frame cut by the crop is left out
  return { ...p, points: pts as Pt[] };
}

function mapBalloon(b: Balloon, map: PointMap): Balloon | null {
  if (b.pts) {
    // A curve is mapped point by point; its box is whatever they now span.
    const pts = b.pts.map((q) => map(q.x, q.y));
    const tip = b.tail ? map(b.tail.x, b.tail.y) : null;
    if (pts.some((q) => !q)) return null;
    const xs = (pts as Pt[]).map((q) => q.x);
    const ys = (pts as Pt[]).map((q) => q.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { ...b, pts: pts as Pt[], x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, tail: tip };
  }
  const a = map(b.x, b.y);
  const c = map(b.x + b.w, b.y + b.h);
  if (!a || !c) return null;
  const tail = b.tail ? map(b.tail.x, b.tail.y) : null;
  return { ...b, x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y), tail };
}

function build(doc: Document, op: PageOp): PageContent | null {
  const { map, width, height } = pointMap(op, doc.width, doc.height);
  if (width < 1 || height < 1) return null;
  // Rulers and out-of-window points move with the page like everything else (a window only shifts them, so they may end up outside it).
  const shiftPt = op.kind === 'crop' || op.kind === 'resize' ? (q: Pt): Pt => ({ x: q.x - op.rect.x, y: q.y - op.rect.y }) : (q: Pt): Pt => map(q.x, q.y) ?? q;
  const sx = width / doc.width;
  const sy = height / doc.height;
  const k = Math.sqrt(sx * sy); // sizes that are not along an axis (borders, text, brush) follow the mean scale
  const surface = (src: TiledSurface, base: 0 | 255 = 0): TiledSurface =>
    op.kind === 'scale' ? resampleSurface(src, width, height, op.method, { base }) : remapSurface(src, width, height, op, base);
  const layers = doc.layers.map((l): Layer => {
    const copy: Layer = { ...l, surface: surface(l.surface) };
    delete copy.overflow;
    // A window only shifts what lies beyond the page, so it moves with the page (and may come back into view).
    // Turning or scaling the page drops it: it has no page to be turned or scaled with.
    if (l.overflow && (op.kind === 'crop' || op.kind === 'resize')) {
      const kept = settle([{ surface: l.overflow.surface, x: l.overflow.x - op.rect.x, y: l.overflow.y - op.rect.y }], width, height, copy.surface);
      if (kept.overflow) copy.overflow = kept.overflow;
    }
    if (l.source) copy.source = surface(l.source);
    if (l.mask) copy.mask = { ...l.mask, surface: surface(l.mask.surface, l.mask.base) };
    if (l.panels) copy.panels = l.panels.map((p) => mapPanel(p, map)).filter((p): p is Panel => !!p);
    if (l.balloons) copy.balloons = l.balloons.map((b) => mapBalloon(b, map)).filter((b): b is Balloon => !!b);
    // Strokes keep every point (one past the window stays where the shift puts it) so they redraw like the pixels.
    if (l.vector) copy.vector = l.vector.map((s) => ({ ...s, points: s.points.map((q) => ({ ...q, ...(map(q.x, q.y) ?? shiftPt(q)) })) }));
    if (op.kind === 'scale') {
      if (copy.panels) copy.panels = copy.panels.map((p) => ({ ...p, border: p.border * k }));
      if (copy.balloons) copy.balloons = copy.balloons.map((b) => ({ ...b, fontSize: b.fontSize * k, border: b.border * k }));
      if (copy.vector) copy.vector = copy.vector.map((s) => ({ ...s, brush: { ...s.brush, size: s.brush.size * k } }));
    }
    delete copy.renderedTiles; // the objects are drawn again on the new page
    return copy;
  });
  const g = doc.guides;
  const swapAxes = op.kind === 'rotate' && op.turns !== 2;
  // A window moves a guide by its corner; the other axis must not decide whether the guide survives.
  const win = op.kind === 'crop' || op.kind === 'resize' ? op.rect : null;
  const mapV = (x: number): number | null => (win ? x - win.x : map(x, doc.height / 2)?.x ?? null);
  const mapH = (y: number): number | null => (win ? y - win.y : map(doc.width / 2, y)?.y ?? null);
  const mapVAsH = (x: number): number | null => map(x, doc.height / 2)?.y ?? null;
  const mapHAsV = (y: number): number | null => map(doc.width / 2, y)?.x ?? null;
  const keep = (list: (number | null)[], limit: number): number[] => list.filter((v): v is number => v !== null && v >= 0 && v <= limit).map((v) => Math.round(v));
  const guides: Guides = swapAxes
    ? { v: keep(g.h.map(mapHAsV), width), h: keep(g.v.map(mapVAsH), height) }
    : { v: keep(g.v.map(mapV), width), h: keep(g.h.map(mapH), height) };
  const rulers = doc.rulers.map((r) => ({ ...r, pts: r.pts.map(shiftPt) }));
  return { width, height, layers, guides, rulers };
}

/**
 * The window that gives a page of `width` x `height` from a page of `oldW` x `oldH`, the old one held at `anchor`
 * (0 = left/top, 0.5 = centre, 1 = right/bottom on each axis): the new page grows or shrinks around that point.
 */
export function anchoredWindow(oldW: number, oldH: number, width: number, height: number, anchor: { x: number; y: number }): Rect {
  return { x: Math.round((oldW - width) * anchor.x) + 0, y: Math.round((oldH - height) * anchor.y) + 0, w: width, h: height }; // + 0 turns -0 into 0
}

/**
 * Crop, resize, rotate or flip the whole page. Returns the history step (already applied), or null when it makes no
 * sense (an empty window, a crop that covers everything, a resize that changes nothing). Callers redraw object and
 * tone layers and reset the selection.
 */
export function applyPageOp(doc: Document, op: PageOp, label: string): Command | null {
  if (op.kind === 'resize') {
    const r = { x: Math.round(op.rect.x), y: Math.round(op.rect.y), w: Math.round(op.rect.w), h: Math.round(op.rect.h) };
    if (r.w < 1 || r.h < 1 || (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height)) return null;
    op = { kind: 'resize', rect: r };
  }
  if (op.kind === 'scale') {
    op = { ...op, width: Math.round(op.width), height: Math.round(op.height) };
    if (op.width < 1 || op.height < 1 || (op.width === doc.width && op.height === doc.height)) return null;
  }
  if (op.kind === 'crop') {
    const x = Math.max(0, Math.floor(op.rect.x));
    const y = Math.max(0, Math.floor(op.rect.y));
    const r = { x, y, w: Math.min(doc.width, Math.ceil(op.rect.x + op.rect.w)) - x, h: Math.min(doc.height, Math.ceil(op.rect.y + op.rect.h)) - y };
    if (r.w < 1 || r.h < 1 || (r.w === doc.width && r.h === doc.height)) return null;
    op = { kind: 'crop', rect: r };
  }
  const before: PageContent = { width: doc.width, height: doc.height, layers: doc.layers, guides: doc.guides, rulers: doc.rulers };
  const after = build(doc, op);
  if (!after) return null;
  const put = (c: PageContent): void => {
    doc.width = c.width;
    doc.height = c.height;
    doc.layers = c.layers;
    doc.guides = c.guides;
    doc.rulers = c.rulers;
  };
  put(after);
  return { label, region: null, pageChange: true, undo: () => put(before), redo: () => put(after) };
}
