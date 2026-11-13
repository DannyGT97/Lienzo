export interface Pt {
  x: number;
  y: number;
}

export type Poly = Pt[];

export const rectPoly = (x0: number, y0: number, x1: number, y1: number): Poly => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

export function area(poly: Poly): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export function bounds(poly: Poly): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/** Even-odd point-in-polygon test. */
export function contains(poly: Poly, p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A closed Catmull-Rom curve through the points (each one is passed through), sampled `per` times per span. */
export function smoothClosed(pts: readonly Pt[], per = 12): Poly {
  const n = pts.length;
  if (n < 3) return pts.map((q) => ({ ...q }));
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

/** Keep the part of a convex polygon where (p - a)·n >= 0 (Sutherland–Hodgman). */
export function clipHalfPlane(poly: Poly, a: Pt, n: Pt): Poly {
  const out: Poly = [];
  const side = (p: Pt): number => (p.x - a.x) * n.x + (p.y - a.y) * n.y;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const dp = side(p);
    const dq = side(q);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

/**
 * Cut a convex polygon along the line through a and b, leaving a gutter of
 * `gutter` pixels between the two halves. Returns null when the line misses
 * the polygon or leaves a sliver.
 */
export function splitConvex(poly: Poly, a: Pt, b: Pt, gutter: number): [Poly, Poly] | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return null;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const h = gutter / 2;
  const left = clipHalfPlane(poly, { x: a.x + n.x * h, y: a.y + n.y * h }, n);
  const right = clipHalfPlane(poly, { x: a.x - n.x * h, y: a.y - n.y * h }, { x: -n.x, y: -n.y });
  const ok = (p: Poly): boolean => p.length >= 3 && area(p) > 4;
  return ok(left) && ok(right) ? [left, right] : null;
}

/** First point where the segment from→to crosses the polygon outline, nearest to `to`. */
export function lastCrossing(poly: Poly, from: Pt, to: Pt): Pt | null {
  let best: { t: number; p: Pt } | null = null;
  const d = { x: to.x - from.x, y: to.y - from.y };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - from.x) * e.y - (a.y - from.y) * e.x) / den;
    const u = ((a.x - from.x) * d.y - (a.y - from.y) * d.x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!best || t > best.t)) {
      best = { t, p: { x: from.x + d.x * t, y: from.y + d.y * t } };
    }
  }
  return best?.p ?? null;
}

/** True when the segment a→b has an end inside the polygon or crosses its outline. */
export function segmentTouches(poly: Poly, a: Pt, b: Pt): boolean {
  return contains(poly, a) || contains(poly, b) || lastCrossing(poly, a, b) !== null;
}
