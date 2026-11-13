import type { Pt } from './geometry';
import type { Command } from './history';

/**
 * Drawing rulers (Lienzo's own design; Clip Studio's ruler formulas are not known):
 * - `line`: a straight line (two points) that strokes can be made to follow.
 * - `curve`: a smooth curve through the points the user drew (Catmull-Rom).
 * - `pen`: a polyline through the points that were clicked.
 * - `figure`: an ellipse or a rectangle (`shape`) given by two opposite corners.
 * - `special`: a family of guides (`shape`): parallel lines, rays from a centre, or concentric circles.
 * - `perspective`: one vanishing point whose rays strokes can follow.
 * - `persp2` / `persp3`: two or three vanishing points. With two, the vertical (perpendicular to the horizon
 *   through them) is the third direction.
 * - `symmetry`: an axis (two points) across which every stroke is mirrored.
 */
export type RulerKind = 'line' | 'perspective' | 'symmetry' | 'curve' | 'pen' | 'figure' | 'special' | 'persp2' | 'persp3';
export type FigureShape = 'ellipse' | 'rect';
export type SpecialShape = 'parallel' | 'radial' | 'concentric';

export interface Ruler {
  id: number;
  kind: RulerKind;
  /** Two points for a line, an axis, a figure or a parallel family; the centre then a direction point for radial; the centre for concentric; one for a vanishing point; as many as drawn for a curve or pen. */
  pts: Pt[];
  /** Which figure, or which family of special guides. */
  shape?: FigureShape | SpecialShape;
  /** Special: how many guides (each side of the base for parallel, rings for concentric, rays for radial). */
  count?: number;
  /** Special: distance between parallel lines or between rings, in pixels. */
  gap?: number;
}

export interface RulerSet {
  rulers: Ruler[];
  nextRulerId: number;
}

export const DEFAULT_SPECIAL_COUNT: Record<SpecialShape, number> = { parallel: 10, concentric: 10, radial: 12 };
export const DEFAULT_SPECIAL_GAP = 60;

/** The point of the infinite line through a and b that is nearest to p. */
export function projectOnLine(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** p reflected across the line through a and b. */
export function mirrorAcross(p: Pt, a: Pt, b: Pt): Pt {
  const f = projectOnLine(p, a, b);
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
}

const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y);

// ---- Paths (curve, pen and figure rulers) ----

/** A sampled path with the arc length at each vertex, so a stroke can remember where along it the pen is. */
export interface RulerPath {
  pts: Pt[];
  closed: boolean;
  /** cum[i] = arc length from the first vertex to vertex i; for a closed path the last segment returns to the first vertex. */
  cum: number[];
  total: number;
}

function buildPath(pts: Pt[], closed: boolean): RulerPath {
  const cum = [0];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) cum.push(cum[i]! + dist(pts[i]!, pts[(i + 1) % pts.length]!));
  return { pts, closed, cum, total: cum[n]! };
}

/** A Catmull-Rom spline through the points, sampled `per` times per span (the end points are repeated as the outer neighbours). */
export function smoothCurve(pts: readonly Pt[], per = 12): Pt[] {
  if (pts.length < 3) return pts.map((q) => ({ ...q }));
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...pts[pts.length - 1]! });
  return out;
}

/** The ellipse inscribed in the box with corners a and b, as a closed polygon. */
function ellipsePoly(a: Pt, b: Pt, n = 128): Pt[] {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return out;
}

/** The sampled path of a curve, pen or figure ruler; null for the other kinds or when it is too short to be a path. */
export function rulerPath(r: Ruler): RulerPath | null {
  if (r.kind === 'curve') return r.pts.length >= 2 ? buildPath(smoothCurve(r.pts), false) : null;
  if (r.kind === 'pen') return r.pts.length >= 2 ? buildPath(r.pts.map((q) => ({ ...q })), false) : null;
  if (r.kind === 'figure' && r.pts.length >= 2) {
    const [a, b] = r.pts as [Pt, Pt];
    if (r.shape === 'rect') return buildPath([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], true);
    return buildPath(ellipsePoly(a, b), true);
  }
  return null;
}

export interface PathHit {
  pt: Pt;
  d: number;
  /** Arc length along the path where `pt` lies. */
  s: number;
}

/**
 * The point of the path nearest to p. With `near`, only the part of the path within `window` of that arc position
 * is looked at (around the loop for a closed path), so a stroke does not jump to another branch where the path
 * crosses itself or comes back close to itself.
 */
export function nearestOnPath(path: RulerPath, p: Pt, near?: number, window = Infinity): PathHit {
  let best: PathHit = { pt: { ...path.pts[0]! }, d: Infinity, s: 0 };
  const n = path.closed ? path.pts.length : path.pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = path.pts[i]!;
    const b = path.pts[(i + 1) % path.pts.length]!;
    const len = path.cum[i + 1]! - path.cum[i]!;
    if (near !== undefined && window < Infinity) {
      let gap = Math.abs((path.cum[i]! + len / 2) - near);
      if (path.closed) gap = Math.min(gap, path.total - gap);
      if (gap > window + len / 2) continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = dist(p, q);
    if (d < best.d) best = { pt: q, d, s: path.cum[i]! + len * t };
  }
  return best;
}

// ---- Special families ----

const specialCount = (r: Ruler): number => {
  const shape = (r.shape ?? 'parallel') as SpecialShape;
  const n = r.count ?? DEFAULT_SPECIAL_COUNT[shape] ?? 10;
  return Math.max(1, Math.min(360, Math.round(n)));
};
const specialGap = (r: Ruler): number => (r.gap && r.gap > 0 ? r.gap : DEFAULT_SPECIAL_GAP);

/** The individual guides of a special ruler: infinite lines (a point and a unit direction) or circles (centre and radius). */
export type SpecialGuide = { line: { o: Pt; u: Pt } } | { circle: { c: Pt; r: number } };

export function specialGuides(r: Ruler): SpecialGuide[] {
  if (r.kind !== 'special' || r.pts.length < 2) return [];
  const [a, b] = r.pts as [Pt, Pt];
  const shape = (r.shape ?? 'parallel') as SpecialShape;
  const n = specialCount(r);
  const out: SpecialGuide[] = [];
  if (shape === 'concentric') {
    const gap = specialGap(r);
    for (let k = 1; k <= n; k++) out.push({ circle: { c: a, r: k * gap } });
    return out;
  }
  const len = dist(a, b);
  if (len === 0) return out;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  if (shape === 'radial') {
    const base = Math.atan2(u.y, u.x);
    // Lines through the centre (each is a ray and its opposite), every 360 / n degrees.
    for (let k = 0; k < n; k++) {
      const ang = base + (k * Math.PI * 2) / n;
      out.push({ line: { o: a, u: { x: Math.cos(ang), y: Math.sin(ang) } } });
    }
    return out;
  }
  const gap = specialGap(r);
  const nrm = { x: -u.y, y: u.x };
  for (let k = -n; k <= n; k++) out.push({ line: { o: { x: a.x + nrm.x * k * gap, y: a.y + nrm.y * k * gap }, u } });
  return out;
}

const distToGuide = (g: SpecialGuide, p: Pt): number => {
  if ('line' in g) {
    const { o, u } = g.line;
    return Math.abs((p.x - o.x) * u.y - (p.y - o.y) * u.x);
  }
  return Math.abs(dist(p, g.circle.c) - g.circle.r);
};

const followGuide = (g: SpecialGuide): ((p: Pt) => Pt) => {
  if ('line' in g) {
    const { o, u } = g.line;
    const b = { x: o.x + u.x, y: o.y + u.y };
    return (p) => projectOnLine(p, o, b);
  }
  const { c, r } = g.circle;
  return (p) => {
    const d = dist(p, c);
    return d === 0 ? { x: c.x + r, y: c.y } : { x: c.x + ((p.x - c.x) / d) * r, y: c.y + ((p.y - c.y) / d) * r };
  };
};

// ---- Following ----

/** How far p is from the ruler (for picking one with the pointer). Infinity for a ruler with nothing to measure. */
export function distanceToRuler(r: Ruler, p: Pt): number {
  switch (r.kind) {
    case 'line':
    case 'symmetry':
      return r.pts.length >= 2 ? dist(p, projectOnLine(p, r.pts[0]!, r.pts[1]!)) : Infinity;
    case 'perspective':
    case 'persp2':
    case 'persp3':
      return r.pts.reduce((m, q) => Math.min(m, dist(p, q)), Infinity);
    case 'special':
      return specialGuides(r).reduce((m, g) => Math.min(m, distToGuide(g, p)), Infinity);
    default: {
      const path = rulerPath(r);
      return path ? nearestOnPath(path, p).d : Infinity;
    }
  }
}

/**
 * If a stroke begins within `tol` of a line, curve, pen, figure or special guide, a function that keeps its points
 * on it; otherwise null. For a path the function remembers where along it the pen is and only looks nearby, so a
 * crossing does not make the stroke jump to the other branch.
 */
export function followGuides(rulers: readonly Ruler[], start: Pt, tol: number): ((p: Pt) => Pt) | null {
  let bestD = tol;
  let make: (() => (p: Pt) => Pt) | null = null;
  for (const r of rulers) {
    if (r.kind === 'line') {
      if (r.pts.length < 2) continue;
      const [a, b] = r.pts as [Pt, Pt];
      const d = dist(start, projectOnLine(start, a, b));
      if (d <= bestD) {
        bestD = d;
        make = () => (p) => projectOnLine(p, a, b);
      }
    } else if (r.kind === 'curve' || r.kind === 'pen' || r.kind === 'figure') {
      const path = rulerPath(r);
      if (!path) continue;
      const hit = nearestOnPath(path, start);
      if (hit.d <= bestD) {
        bestD = hit.d;
        make = () => {
          let at = hit.s;
          const window = Math.max(40, path.total * 0.2);
          return (p) => {
            const h = nearestOnPath(path, p, at, window);
            at = h.s;
            return h.pt;
          };
        };
      }
    } else if (r.kind === 'special') {
      for (const g of specialGuides(r)) {
        const d = distToGuide(g, start);
        if (d <= bestD) {
          bestD = d;
          make = () => followGuide(g);
        }
      }
    }
  }
  return make ? make() : null;
}

/** The directions a perspective ruler offers at `start`: towards a vanishing point, or a fixed direction (the vertical). */
type Heading = { towards: Pt } | { along: Pt };

function headings(rulers: readonly Ruler[]): Heading[] {
  const out: Heading[] = [];
  for (const r of rulers) {
    if (r.kind === 'perspective' && r.pts.length >= 1) out.push({ towards: r.pts[0]! });
    else if (r.kind === 'persp3') for (const v of r.pts.slice(0, 3)) out.push({ towards: v });
    else if (r.kind === 'persp2' && r.pts.length >= 2) {
      const [a, b] = r.pts as [Pt, Pt];
      out.push({ towards: a }, { towards: b });
      const hl = dist(a, b);
      // The vertical is perpendicular to the horizon through the two points.
      if (hl > 0) out.push({ along: { x: -(b.y - a.y) / hl, y: (b.x - a.x) / hl } });
    }
  }
  return out;
}

/**
 * Perspective: once the pen has moved `lock` pixels from where it came down, the stroke takes the ray through
 * the starting point that points to the vanishing point (or, with two points, the vertical) it is heading closest
 * to, and stays on it. With a single vanishing point the ray is fixed at once.
 * Returns null when there is no perspective ruler.
 */
export function followPerspective(rulers: readonly Ruler[], start: Pt, lock: number): ((p: Pt) => Pt) | null {
  const hs = headings(rulers);
  if (!hs.length) return null;
  const dirOf = (h: Heading): Pt => ('towards' in h ? { x: h.towards.x - start.x, y: h.towards.y - start.y } : h.along);
  let chosen: Pt | null = hs.length === 1 ? dirOf(hs[0]!) : null;
  return (p) => {
    if (!chosen) {
      if (dist(p, start) < lock) return p;
      // Compare the direction of travel with each candidate direction (either way along the ray).
      const mx = p.x - start.x;
      const my = p.y - start.y;
      const ml = Math.hypot(mx, my);
      let bestCos = -1;
      for (const h of hs) {
        const v = dirOf(h);
        const vl = Math.hypot(v.x, v.y);
        if (vl === 0) continue;
        const c = Math.abs((mx * v.x + my * v.y) / (ml * vl));
        if (c > bestCos) {
          bestCos = c;
          chosen = v;
        }
      }
      if (!chosen) return p;
    }
    if (Math.hypot(chosen.x, chosen.y) === 0) return p;
    return projectOnLine(p, start, { x: start.x + chosen.x, y: start.y + chosen.y });
  };
}

/** One mirror function per symmetry ruler. */
export function mirrors(rulers: readonly Ruler[]): ((p: Pt) => Pt)[] {
  return rulers
    .filter((r) => r.kind === 'symmetry' && r.pts.length >= 2)
    .map((r) => {
      const [a, b] = r.pts as [Pt, Pt];
      return (p: Pt) => mirrorAcross(p, a, b);
    });
}

const copyRulers = (rs: readonly Ruler[]): Ruler[] => rs.map((r) => ({ ...r, pts: r.pts.map((p) => ({ ...p })) }));

/** Run `change` on a document's rulers and return the history step for it (null when nothing changed). */
export function recordRulers(owner: RulerSet, label: string, change: () => void): Command | null {
  const before = copyRulers(owner.rulers);
  const nextBefore = owner.nextRulerId;
  change();
  const after = copyRulers(owner.rulers);
  const nextAfter = owner.nextRulerId;
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return {
    label,
    region: null,
    undo: () => {
      owner.rulers = copyRulers(before);
      owner.nextRulerId = nextBefore;
    },
    redo: () => {
      owner.rulers = copyRulers(after);
      owner.nextRulerId = nextAfter;
    },
  };
}

/** Thin a freehand drawn path: drop points closer than `minDist`, then Ramer–Douglas–Peucker with `tol`. */
export function simplifyPath(pts: readonly Pt[], minDist: number, tol: number): Pt[] {
  const thin: Pt[] = [];
  for (const q of pts) if (!thin.length || dist(q, thin[thin.length - 1]!) >= minDist) thin.push({ ...q });
  const last = pts[pts.length - 1];
  if (last && thin.length && (thin[thin.length - 1]!.x !== last.x || thin[thin.length - 1]!.y !== last.y)) thin.push({ ...last });
  if (thin.length < 3) return thin;
  const keep = new Array<boolean>(thin.length).fill(false);
  keep[0] = keep[thin.length - 1] = true;
  const stack: [number, number][] = [[0, thin.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = dist(thin[i]!, projectOnLine(thin[i]!, thin[lo]!, thin[hi]!));
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = true;
      stack.push([lo, at], [at, hi]);
    }
  }
  return thin.filter((_, i) => keep[i]);
}
