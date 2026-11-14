// Pen position predictors compared by analyze.ts: each takes the recent history (oldest first) and says where the pen will be
// `h` ms after the last sample. They only look at the raw samples, so they can run on any pen and on a recording.
import { predictPoint } from '../../../src/engine/predict';

export interface Pt {
  x: number;
  y: number;
}
export interface Hist {
  t: number;
  x: number;
  y: number;
}

/** Constant velocity from the last two samples, as is. */
function constantVelocity(hist: Hist[], h: number): Pt {
  const a = hist[hist.length - 2]!;
  const b = hist[hist.length - 1]!;
  const dt = Math.max(1, b.t - a.t);
  return { x: b.x + ((b.x - a.x) / dt) * h, y: b.y + ((b.y - a.y) / dt) * h };
}

/** Velocity and acceleration from the last four samples, with the acceleration damped and the reach kept to what the pen just did. */
function dampedAcceleration(hist: Hist[], h: number): Pt {
  const n = hist.length;
  const p3 = hist[n - 1]!;
  const p2 = hist[n - 2]!;
  const p1 = hist[n - 3]!;
  const dt1 = Math.max(1, p2.t - p1.t);
  const dt2 = Math.max(1, p3.t - p2.t);
  const v1 = { x: (p2.x - p1.x) / dt1, y: (p2.y - p1.y) / dt1 };
  const v2 = { x: (p3.x - p2.x) / dt2, y: (p3.y - p2.y) / dt2 };
  const dtm = (dt1 + dt2) / 2;
  const a = { x: ((v2.x - v1.x) / dtm) * 0.5, y: ((v2.y - v1.y) / dtm) * 0.5 };
  const x = p3.x + v2.x * h + 0.5 * a.x * h * h;
  const y = p3.y + v2.y * h + 0.5 * a.y * h * h;
  // Never farther than the pen travelled in the last step, scaled to the horizon.
  const reach = Math.hypot(v2.x, v2.y) * h * 1.2;
  const dx = x - p3.x;
  const dy = y - p3.y;
  const d = Math.hypot(dx, dy);
  return d > reach && d > 0 ? { x: p3.x + (dx / d) * reach, y: p3.y + (dy / d) * reach } : { x, y };
}

/** A smoothed velocity (several samples) so the noise of one pair does not throw the guess, and the guess shortened for sharp turns. */
function smoothedVelocity(hist: Hist[], h: number): Pt {
  const n = hist.length;
  const last = hist[n - 1]!;
  let vx = 0;
  let vy = 0;
  let wsum = 0;
  for (let i = n - 1; i > 0 && i > n - 5; i--) {
    const a = hist[i - 1]!;
    const b = hist[i]!;
    const dt = Math.max(1, b.t - a.t);
    const w = Math.pow(0.6, n - 1 - i);
    vx += ((b.x - a.x) / dt) * w;
    vy += ((b.y - a.y) / dt) * w;
    wsum += w;
  }
  vx /= wsum;
  vy /= wsum;
  // Turning sharply: the older direction and the newest disagree, so trust the extrapolation less.
  const a = hist[n - 2]!;
  const b = hist[n - 3]!;
  const nx = last.x - a.x;
  const ny = last.y - a.y;
  const ox = a.x - b.x;
  const oy = a.y - b.y;
  const nl = Math.hypot(nx, ny);
  const ol = Math.hypot(ox, oy);
  const cos = nl > 0 && ol > 0 ? (nx * ox + ny * oy) / (nl * ol) : 1;
  const trust = Math.max(0, Math.min(1, (cos + 0.2) / 1.2));
  return { x: last.x + vx * h * trust, y: last.y + vy * h * trust };
}

export const predictors: Record<string, (hist: Hist[], h: number) => Pt> = {
  'velocidad constante': constantVelocity,
  'aceleración amortiguada': dampedAcceleration,
  'la del motor (predict.ts)': (hist, h) => predictPoint(hist, h) ?? { x: hist[hist.length - 1]!.x, y: hist[hist.length - 1]!.y },
  'velocidad suavizada': smoothedVelocity,
};
