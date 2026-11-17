/**
 * Pen smoothing: each sample the brush paints is the pen's position pulled towards by a share of the way from the last smoothed one,
 * so a stroke trails the pen by a few samples and the hand's tremor and the digitiser's noise are averaged out.
 *
 * `stabilization` (0 … 0.95) is the share left behind each sample at a 60 Hz sample rate (`k = 1 - stabilization` is what moves).
 * With sample times the same smoothing is spread by time instead: a pen that reports 240 times a second (or a frame that comes
 * late and brings several samples at once) leaves the same trail in time as one that reports 60 times a second.
 */

/** Screen pixels per pen sample at which the speed-dependent stabilization has eased off to half its lag. */
export const STAB_SPEED_HALF = 14;

/**
 * The stabilization to use at a pen speed (screen pixels travelled per sample). Own design: the setting is the ceiling, reached by a slow hand, and the lag it leaves,
 * `s / (1 - s)` steps, shrinks as `1 / (1 + speed / STAB_SPEED_HALF)`, so a quick stroke follows the pen
 * closely and a careful one stays steady. A speed of 0 leaves the setting as it is.
 */
export function stabilizationAtSpeed(stabilization: number, speed: number, half = STAB_SPEED_HALF): number {
  const s = Math.min(0.95, Math.max(0, stabilization));
  if (!(speed > 0) || !Number.isFinite(speed)) return s;
  const lag = s / (1 - s) / (1 + speed / half);
  return lag / (1 + lag);
}

/** The sample interval the `stabilization` setting is defined at. */
export const STAB_SAMPLE_MS = 1000 / 60;
/** An interval outside this range is a gap or a clock hiccup, not how fast the pen is going. */
const MIN_DT_MS = 1;
const MAX_DT_MS = 100;

export interface StabilizerSettings {
  stabilization: number;
  /** View scale (screen pixels per page pixel) when the stroke starts, to measure the pen's speed on screen (1 when absent). */
  scale?: number;
  /** Ease the lag off as the pen speeds up (see `stabilizationAtSpeed`). */
  bySpeed?: boolean;
  /** Screen pixels per sample at which the speed-dependent lag has halved (`STAB_SPEED_HALF` when absent). */
  speedHalf?: number;
}

export interface Sample {
  x: number;
  y: number;
  p: number;
}

export class Stabilizer {
  private smoothed: Sample | null = null;
  private prev: { x: number; y: number; t: number | undefined } | null = null;
  /** Pen speed in screen pixels per sample interval, itself smoothed (only kept when the lag depends on speed). */
  private speed = 0;

  constructor(private readonly s: StabilizerSettings) {}

  /** The pen's last position, smoothed (null before the first sample). */
  get current(): Sample | null {
    return this.smoothed;
  }

  /** Take a pen sample (`t`: its time in ms, when known) and return the smoothed position to paint. */
  next(x: number, y: number, p: number, t?: number): Sample {
    const prev = this.prev;
    this.prev = { x, y, t };
    // How many sample intervals this step covers: 1 without times, so the filter is per sample as it always was.
    const steps = prev && t !== undefined && prev.t !== undefined ? Math.min(MAX_DT_MS, Math.max(MIN_DT_MS, t - prev.t)) / STAB_SAMPLE_MS : 1;
    let stab = Math.min(0.95, Math.max(0, this.s.stabilization));
    if (this.s.bySpeed) {
      // Raw samples jitter, so the speed is itself smoothed; it is measured on screen, per sample interval.
      const scale = this.s.scale && Number.isFinite(this.s.scale) ? this.s.scale : 1;
      const step = prev ? (Math.hypot(x - prev.x, y - prev.y) * scale) / steps : 0;
      this.speed += (step - this.speed) * (1 - Math.pow(0.5, steps));
      stab = stabilizationAtSpeed(stab, this.speed, this.s.speedHalf);
    }
    // The share that moves over `steps` intervals: what stays behind, `stab` per interval, compounds.
    const k = 1 - Math.pow(stab, steps);
    const s = this.smoothed;
    this.smoothed = s ? { x: s.x + (x - s.x) * k, y: s.y + (y - s.y) * k, p: s.p + (p - s.p) * k } : { x, y, p };
    return this.smoothed;
  }
}
