/**
 * Where the pen is about to be, a moment ahead of the last sample, so the preview of a stroke does not trail the pen by the
 * delay between the pen and the screen (measured on a tablet: about 19 ms for the app to receive a sample and 17 ms more for the
 * next frame). Own design, chosen against a recorded pen on a tablet (scripts/device-tests/strokes): the speed and the
 * change of speed of the last samples carried forward, with the change damped and the reach kept to what the pen just did. Its
 * error a frame ahead was half of that of the points the browser predicts, and it does not overshoot them.
 */
export interface PenSample {
  /** Time in ms. */
  t: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Samples closer in time than this count as one (the down, move and up events can repeat a sample). */
const MIN_STEP_MS = 2;
/** The share of the change of speed that is carried forward: the pen rarely keeps accelerating. */
const ACCEL_SHARE = 0.5;
/** The guess goes no farther than this times what the pen travelled at its last speed. */
const REACH = 1.2;

/** The pen's position `ahead` ms after the last of `samples` (oldest first), or null when there are too few to tell. */
export function predictPoint(samples: readonly PenSample[], ahead: number): Point | null {
  const s: PenSample[] = [];
  for (let i = samples.length - 1; i >= 0 && s.length < 3; i--) {
    const p = samples[i]!;
    if (!s.length || s[s.length - 1]!.t - p.t >= MIN_STEP_MS) s.push(p);
  }
  if (s.length < 3) return null;
  const [p3, p2, p1] = s as [PenSample, PenSample, PenSample];
  const dt1 = p2.t - p1.t;
  const dt2 = p3.t - p2.t;
  const v1 = { x: (p2.x - p1.x) / dt1, y: (p2.y - p1.y) / dt1 };
  const v2 = { x: (p3.x - p2.x) / dt2, y: (p3.y - p2.y) / dt2 };
  const dtm = (dt1 + dt2) / 2;
  const ax = ((v2.x - v1.x) / dtm) * ACCEL_SHARE;
  const ay = ((v2.y - v1.y) / dtm) * ACCEL_SHARE;
  let dx = v2.x * ahead + 0.5 * ax * ahead * ahead;
  let dy = v2.y * ahead + 0.5 * ay * ahead * ahead;
  const reach = Math.hypot(v2.x, v2.y) * ahead * REACH;
  const d = Math.hypot(dx, dy);
  if (d > reach && d > 0) {
    dx = (dx / d) * reach;
    dy = (dy / d) * reach;
  }
  return { x: p3.x + dx, y: p3.y + dy };
}
