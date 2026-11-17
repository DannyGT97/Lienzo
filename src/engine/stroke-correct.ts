/**
 * Stroke correction: when the pen is lifted the whole path of the stroke is smoothed in one go and painted again.
 * Own design. Unlike the live stabilization, which can only look back (it trails the pen), this looks both ways along the
 * path, so it removes the wobbles of a hand (in a long curve, in a line meant to be straight) without moving the stroke
 * or making the pen feel heavy: the start and the end stay where they were, a straight run stays straight and a curve keeps its bend.
 * Sharp corners are kept: the path is split at them and each piece is smoothed on its own.
 */

export interface CorrectionPoint {
  x: number;
  y: number;
  p: number;
}

/** The levels of the setting: none, weak, medium, strong. */
export type Correction = 0 | 1 | 2 | 3;
export const DEFAULT_CORRECTION: Correction = 2;

/** Spread of the smoothing along the path, in screen pixels, per level (the page length is this over the zoom). */
const SIGMA_SCREEN: readonly number[] = [0, 5, 10, 20];

export function correctionOf(value: number | undefined): Correction {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : DEFAULT_CORRECTION;
}

/** The spread, in page pixels, of a level at a view scale (screen pixels per page pixel). No level at all means no correction. */
export function correctionSigma(level: number | undefined, scale = 1): number {
  if (level === undefined) return 0;
  const s = SIGMA_SCREEN[correctionOf(level)]!;
  return scale > 0 && Number.isFinite(scale) ? s / scale : s;
}

/** A turn sharper than this (degrees, between the way in and the way out) is a corner and is not rounded off. */
const CORNER_DEG = 50;
/** The smoothing never spreads over more than this share of a piece's length, so a short stroke keeps its shape. */
const MAX_SHARE = 1 / 5;

/** The path walked at an even distance `step` apart, ending exactly on its last point. */
export function resamplePath(points: readonly CorrectionPoint[], step: number): CorrectionPoint[] {
  const out: CorrectionPoint[] = [];
  if (!points.length) return out;
  let prev = points[0]!;
  out.push({ ...prev });
  let owed = step; // distance still to walk before the next sample
  for (let i = 1; i < points.length; i++) {
    const cur = points[i]!;
    const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (d === 0) continue;
    let at = 0;
    while (d - at >= owed) {
      at += owed;
      const t = at / d;
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t, p: prev.p + (cur.p - prev.p) * t });
      owed = step;
    }
    owed -= d - at;
    prev = cur;
  }
  const last = points[points.length - 1]!;
  const end = out[out.length - 1]!;
  if (Math.hypot(last.x - end.x, last.y - end.y) > step * 0.25 || out.length === 1) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

/** Indices of the sharp corners of an evenly spaced path (a turn over `reach` samples either side). */
function corners(pts: readonly CorrectionPoint[], reach: number): number[] {
  const found: number[] = [];
  const cosLimit = Math.cos((CORNER_DEG * Math.PI) / 180);
  let best = -1;
  let bestCos = 2;
  for (let i = reach; i < pts.length - reach; i++) {
    const a = pts[i - reach]!;
    const b = pts[i]!;
    const c = pts[i + reach]!;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const cos = n > 0 ? (ux * vx + uy * vy) / n : 1;
    if (cos < cosLimit) {
      if (cos < bestCos) {
        best = i;
        bestCos = cos;
      }
    } else if (best >= 0) {
      found.push(best);
      best = -1;
      bestCos = 2;
    }
  }
  if (best >= 0) found.push(best);
  return found;
}

/** One piece (a run of evenly spaced points) smoothed with a gaussian; its ends stay put (the path is mirrored through them). */
function smoothPiece(pts: readonly CorrectionPoint[], sigmaSamples: number): CorrectionPoint[] {
  const n = pts.length;
  const radius = Math.min(n - 1, Math.ceil(sigmaSamples * 3));
  if (!(sigmaSamples > 0.3) || radius < 1) return pts.map((q) => ({ ...q }));
  const weights: number[] = [];
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples));
    weights.push(w);
    total += w;
  }
  const first = pts[0]!;
  const last = pts[n - 1]!;
  const at = (i: number): CorrectionPoint => {
    if (i < 0) {
      const q = pts[Math.min(n - 1, -i)]!;
      return { x: 2 * first.x - q.x, y: 2 * first.y - q.y, p: 2 * first.p - q.p };
    }
    if (i > n - 1) {
      const q = pts[Math.max(0, 2 * (n - 1) - i)]!;
      return { x: 2 * last.x - q.x, y: 2 * last.y - q.y, p: 2 * last.p - q.p };
    }
    return pts[i]!;
  };
  const out: CorrectionPoint[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let p = 0;
    for (let k = -radius; k <= radius; k++) {
      const q = at(i + k);
      const w = weights[k + radius]!;
      x += q.x * w;
      y += q.y * w;
      p += q.p * w;
    }
    out.push({ x: x / total, y: y / total, p: Math.min(1, Math.max(0, p / total)) });
  }
  out[0] = { ...first };
  out[n - 1] = { ...last };
  return out;
}

/**
 * The path smoothed over about `sigma` page pixels (see `correctionSigma`), as points `step` pixels apart. With nothing to
 * correct (no spread, or a path too short to tell a wobble from the stroke) the path comes back as it was.
 */
export function correctPath(points: readonly CorrectionPoint[], sigma: number, step: number): CorrectionPoint[] {
  if (points.length < 3 || !(sigma > 0) || !(step > 0)) return points.map((q) => ({ ...q }));
  const path = resamplePath(points, step);
  if (path.length < 4) return points.map((q) => ({ ...q }));
  const length = (path.length - 1) * step;
  const spread = Math.min(sigma, length * MAX_SHARE);
  if (spread < step * 0.75) return path;
  const sigmaSamples = spread / step;
  const cuts = corners(path, Math.max(2, Math.round(sigmaSamples)));
  const out: CorrectionPoint[] = [];
  let from = 0;
  for (const cut of [...cuts, path.length - 1]) {
    const piece = smoothPiece(path.slice(from, cut + 1), Math.min(sigmaSamples, (cut - from) * MAX_SHARE));
    out.push(...(from === 0 ? piece : piece.slice(1)));
    from = cut;
  }
  return out;
}
