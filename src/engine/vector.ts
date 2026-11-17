import { Stroke, type BrushSettings } from './brush';
import type { Layer, PaintTarget } from './document';
import type { Rect } from './tiles';

/**
 * Vector lines. A vector layer keeps the strokes as pen samples plus the brush they were drawn with, and its pixels are
 * only the picture of them (like a tone layer's screen): moving a point, thinning a line or erasing a whole line
 * redraws the layer from the strokes, so nothing is lost to the resampling a pixel edit would cause.
 *
 * Own design: the pen builds a vector stroke from raw samples without smoothing them, and a later correction step
 * simplifies the finished stroke (neighbour averaging, corner cutting and Douglas–Peucker thinning).
 */
export interface VectorPoint {
  x: number;
  y: number;
  /** Pen pressure, 0..1. */
  p: number;
}

export interface VectorStroke {
  id: number;
  points: VectorPoint[];
  /** The brush it is drawn with (stabilization is baked into the points, so it is always 0 here). */
  brush: BrushSettings;
}

/** The brush as a vector stroke keeps it: nothing that depends on how the pen moved at the time. */
export function vectorBrush(b: BrushSettings): BrushSettings {
  const { stabilizationBySpeed: _s, correction: _c, viewScale: _k, entryRamp: _e, ...rest } = b;
  return { ...rest, erase: false, stabilization: 0 };
}

// ---- drawing -------------------------------------------------------------------------------------

/** Lay one stroke down on the surface of `target`; returns the area it touched. */
export function paintVectorStroke(target: PaintTarget, s: VectorStroke): Rect | null {
  const pen = new Stroke({ ...target, lockAlpha: false }, s.brush);
  let dirty: Rect | null = null;
  for (const q of s.points) dirty = union(dirty, pen.addPoint(q.x, q.y, q.p));
  pen.finish();
  return dirty;
}

/** Redraw the whole layer from its strokes; returns the area that was covered before or after (null = nothing either way). */
export function rasterizeVector(layer: Layer): Rect | null {
  const had = layer.surface.tileCount > 0;
  layer.surface.clear();
  let dirty: Rect | null = null;
  for (const s of layer.vector ?? []) dirty = union(dirty, paintVectorStroke({ id: layer.id, surface: layer.surface, lockAlpha: false }, s));
  return had ? { x: 0, y: 0, w: layer.surface.width, h: layer.surface.height } : dirty;
}

// ---- correction ----------------------------------------------------------------------------------

/** Distance from (x, y) to the segment a–b. */
function segmentDistance(x: number, y: number, a: VectorPoint, b: VectorPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

/**
 * Keep the points that matter (Douglas–Peucker): a point is dropped when the line without it stays within `tolerance`
 * pixels. The ends always stay, and the pressure of a kept point is its own, so a thin-to-thick line keeps its swell.
 * Pressure is part of the shape: a point whose removal would change the width by more than `pressureTolerance` stays too.
 */
export function simplifyPoints(points: readonly VectorPoint[], tolerance: number, pressureTolerance = 0.12): VectorPoint[] {
  const n = points.length;
  if (n <= 2) return points.map((q) => ({ ...q }));
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const todo: [number, number][] = [[0, n - 1]];
  while (todo.length) {
    const [lo, hi] = todo.pop()!;
    let worst = -1;
    let at = -1;
    const a = points[lo]!;
    const b = points[hi]!;
    for (let i = lo + 1; i < hi; i++) {
      const q = points[i]!;
      const t = hi > lo ? (i - lo) / (hi - lo) : 0;
      const wantP = a.p + (b.p - a.p) * t;
      // Spatial error in pixels; the pressure error counts as if one whole unit of pressure were 8 x the tolerance.
      const e = Math.max(segmentDistance(q.x, q.y, a, b), (Math.abs(q.p - wantP) / Math.max(1e-6, pressureTolerance)) * tolerance);
      if (e > worst) {
        worst = e;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      todo.push([lo, at], [at, hi]);
    }
  }
  const out: VectorPoint[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ ...points[i]! });
  return out;
}

/** Corner cutting (Chaikin): each round replaces every corner by two points a quarter in; the ends stay where they are. */
export function smoothPoints(points: readonly VectorPoint[], rounds: number): VectorPoint[] {
  let cur = points.map((q) => ({ ...q }));
  for (let r = 0; r < rounds && cur.length > 2; r++) {
    const next: VectorPoint[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, p: a.p * 0.75 + b.p * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, p: a.p * 0.25 + b.p * 0.75 },
      );
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

/**
 * Average each point with its neighbours `radius` points either side (the ends stay put, and the window narrows towards
 * them), which removes the quick shake of a hand that corner cutting alone leaves behind.
 */
export function relaxPoints(points: readonly VectorPoint[], radius: number): VectorPoint[] {
  const n = points.length;
  const out = points.map((q) => ({ ...q }));
  if (radius < 1 || n < 3) return out;
  for (let i = 1; i < n - 1; i++) {
    const r = Math.min(radius, i, n - 1 - i);
    let x = 0;
    let y = 0;
    let w = 0;
    for (let k = -r; k <= r; k++) {
      const wk = r + 1 - Math.abs(k); // triangle window: the point itself counts most
      x += points[i + k]!.x * wk;
      y += points[i + k]!.y * wk;
      w += wk;
    }
    out[i]!.x = x / w;
    out[i]!.y = y / w;
  }
  return out;
}

/**
 * The correction applied when a vector stroke is finished or when "Simplificar" is used: `strength` 0..1 (0 = untouched).
 * The averaging window grows with the strength, and the points are thinned so that the line stays within a fraction of its own
 * width of the smoothed path. `size` is the brush diameter in pixels.
 */
export function correctPoints(points: readonly VectorPoint[], strength: number, size: number): VectorPoint[] {
  const s = Math.min(1, Math.max(0, strength));
  // Samples closer than a pixel say nothing new (a held pen), and would only make the corner cutting clump.
  const dedup: VectorPoint[] = [];
  for (const q of points) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= 0.75) dedup.push({ ...q });
    else last.p = Math.max(last.p, q.p);
  }
  if (dedup.length < 2 && points.length >= 2) dedup.push({ ...points[points.length - 1]! });
  if (s <= 0) return dedup;
  const smoothed = smoothPoints(relaxPoints(dedup, Math.round(s * 8)), s > 0.5 ? 1 : 0);
  return simplifyPoints(smoothed, 0.25 + s * Math.max(1, size) * 0.12);
}

// ---- editing -------------------------------------------------------------------------------------

/** The points the "Punto de control" tool shows: the ones that survive a thinning at `tolerance` (indexes into `points`). */
export function controlIndexes(points: readonly VectorPoint[], tolerance: number): number[] {
  const kept = simplifyPoints(points, tolerance);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < points.length && k < kept.length; i++) {
    const q = points[i]!;
    const w = kept[k]!;
    if (q.x === w.x && q.y === w.y && q.p === w.p) {
      out.push(i);
      k++;
    }
  }
  if (out[out.length - 1] !== points.length - 1) out.push(points.length - 1);
  return out;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Drag the control point `controls[which]` by (dx, dy): the points between its neighbours follow with a smooth falloff, so
 * the line bends instead of kinking. The neighbours (and everything beyond them) stay where they are.
 */
export function reshape(points: readonly VectorPoint[], controls: readonly number[], which: number, dx: number, dy: number): VectorPoint[] {
  const out = points.map((q) => ({ ...q }));
  const at = controls[which];
  if (at === undefined) return out;
  const lo = controls[which - 1] ?? at;
  const hi = controls[which + 1] ?? at;
  for (let i = lo; i <= hi; i++) {
    const w = i === at ? 1 : i < at ? smoothstep((i - lo) / Math.max(1, at - lo)) : smoothstep((hi - i) / Math.max(1, hi - at));
    out[i]!.x += dx * w;
    out[i]!.y += dy * w;
  }
  return out;
}

function distanceToSegment(a: VectorPoint, b: VectorPoint, x: number, y: number): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * vx + (y - a.y) * vy) / len2));
  return Math.hypot(a.x + vx * t - x, a.y + vy * t - y);
}

/**
 * Add points along the segments that pass within `radius` of (x, y), about `radius / 3` apart, so a line that was
 * simplified down to its ends can still be bent or thickened locally. Segments elsewhere are left alone; pressure is
 * interpolated. Own design (a stroke that only has its end points has nothing for a local edit to move).
 */
function densifyNear(points: readonly VectorPoint[], x: number, y: number, radius: number): VectorPoint[] {
  const step = Math.max(1, radius / 3);
  const out: VectorPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    out.push({ ...a });
    const b = points[i + 1];
    if (!b || distanceToSegment(a, b, x, y) >= radius) continue;
    const n = Math.min(200, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
    }
  }
  return out;
}

/** "Pellizcar": pull the points within `radius` of (x, y) towards it by `amount` (0..1), strongest at the middle. */
export function pinch(points: readonly VectorPoint[], x: number, y: number, radius: number, amount: number): VectorPoint[] {
  return densifyNear(points, x, y, radius).map((q) => {
    const d = Math.hypot(q.x - x, q.y - y);
    if (d >= radius) return { ...q };
    const w = smoothstep(1 - d / radius) * amount;
    return { x: q.x + (x - q.x) * w, y: q.y + (y - q.y) * w, p: q.p };
  });
}

/** "Ajustar grosor de línea": scale the pressure of the points within `radius` of (x, y) by `factor` at the middle, fading to nothing at the edge. */
export function adjustWidthNear(points: readonly VectorPoint[], x: number, y: number, radius: number, factor: number): VectorPoint[] {
  const dense = densifyNear(points, x, y, radius);
  const out = dense.map((q) => {
    const d = Math.hypot(q.x - x, q.y - y);
    if (d >= radius) return { ...q };
    const w = smoothstep(1 - d / radius);
    return { ...q, p: Math.min(1, Math.max(0.02, q.p * (1 + (factor - 1) * w))) };
  });
  // Nothing got thicker or thinner (full pressure already, say): give the line back as it was, without the extra points.
  return out.some((q, i) => Math.abs(q.p - dense[i]!.p) > 1e-6) ? out : points.map((q) => ({ ...q }));
}

/** The same line with its brush diameter scaled (at least 1 px). */
export function scaleBrush(s: VectorStroke, factor: number): VectorStroke {
  return { ...s, brush: { ...s.brush, size: Math.max(1, s.brush.size * factor) } };
}

// ---- hit testing ---------------------------------------------------------------------------------

/** Distance from (x, y) to the line's edge: 0 when the point is on the line itself (the nearest width is used). */
export function distanceToStroke(s: VectorStroke, x: number, y: number): number {
  const pts = s.points;
  if (pts.length === 0) return Infinity;
  let best = Infinity;
  let halfWidth = 0;
  const radius = (q: VectorPoint): number => Math.max(0.5, (s.brush.size * Math.max(0.05, 1 - s.brush.pressureSize * (1 - q.p))) / 2);
  if (pts.length === 1) return Math.max(0, Math.hypot(x - pts[0]!.x, y - pts[0]!.y) - radius(pts[0]!));
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segmentDistance(x, y, pts[i]!, pts[i + 1]!);
    if (d < best) {
      best = d;
      halfWidth = Math.min(radius(pts[i]!), radius(pts[i + 1]!)) ; // the thinner end: a point must really be on the ink
    }
  }
  return Math.max(0, best - halfWidth);
}

/** The strokes whose ink comes within `reach` pixels of (x, y), topmost (last drawn) first. */
export function strokesAt(strokes: readonly VectorStroke[], x: number, y: number, reach: number): VectorStroke[] {
  const hit: VectorStroke[] = [];
  for (let i = strokes.length - 1; i >= 0; i--) if (distanceToStroke(strokes[i]!, x, y) <= reach) hit.push(strokes[i]!);
  return hit;
}

/** "Borrar tocando": drop every line the eraser circle at (x, y) touches. */
export function eraseTouching(strokes: readonly VectorStroke[], x: number, y: number, radius: number): { kept: VectorStroke[]; removed: VectorStroke[] } {
  const kept: VectorStroke[] = [];
  const removed: VectorStroke[] = [];
  for (const s of strokes) (distanceToStroke(s, x, y) <= radius ? removed : kept).push(s);
  return { kept, removed };
}

/** A copy of the strokes that edits can change without touching the history's snapshot. */
export const cloneStrokes = (strokes: readonly VectorStroke[]): VectorStroke[] => strokes.map((s) => ({ ...s, points: s.points.map((q) => ({ ...q })), brush: { ...s.brush } }));

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
