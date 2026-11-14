import { describe, expect, it } from 'vitest';
import { STAB_SAMPLE_MS, Stabilizer, type Sample } from './stabilizer';

/** A pen going straight at `speed` px/s, reported at `hz`; returns the smoothed positions with their times. */
function run(stabilization: number, hz: number, speed: number, seconds: number, extra: { zoom?: number; bySpeed?: boolean } = {}): { t: number; s: Sample; x: number }[] {
  const st = new Stabilizer({ stabilization, ...extra });
  const out: { t: number; s: Sample; x: number }[] = [];
  const dt = 1000 / hz;
  for (let t = 0; t <= seconds * 1000; t += dt) {
    const x = (speed * t) / 1000;
    out.push({ t, x, s: st.next(x, 0, 1, t) });
  }
  return out;
}

/** How far the smoothed point trails the pen at the end of a steady straight stroke, in ms of pen travel. */
const lagMs = (r: { x: number; s: Sample }[], speed: number): number => ((r[r.length - 1]!.x - r[r.length - 1]!.s.x) / speed) * 1000;

describe('Stabilizer', () => {
  it('follows the pen exactly with no stabilization', () => {
    const r = run(0, 60, 500, 0.5);
    for (const p of r) expect(p.s.x).toBeCloseTo(p.x, 9);
  });

  it('without times it is the per-sample smoothing it always was', () => {
    const st = new Stabilizer({ stabilization: 0.6 });
    const a = st.next(10, 0, 1);
    expect(a).toEqual({ x: 10, y: 0, p: 1 });
    const b = st.next(20, 0, 0.5);
    expect(b.x).toBeCloseTo(10 + 10 * 0.4);
    expect(b.p).toBeCloseTo(1 + (0.5 - 1) * 0.4);
  });

  it('at the setting\'s own sample rate the time version moves the same share', () => {
    const timed = new Stabilizer({ stabilization: 0.6 });
    const plain = new Stabilizer({ stabilization: 0.6 });
    timed.next(0, 0, 1, 1000);
    plain.next(0, 0, 1);
    const a = timed.next(30, 0, 1, 1000 + STAB_SAMPLE_MS);
    const b = plain.next(30, 0, 1);
    expect(a.x).toBeCloseTo(b.x, 9);
  });

  it('trails the pen by the same time at any sample rate', () => {
    const lag60 = lagMs(run(0.7, 60, 800, 2), 800);
    const lag120 = lagMs(run(0.7, 120, 800, 2), 800);
    const lag240 = lagMs(run(0.7, 240, 800, 2), 800);
    expect(lag120).toBeCloseTo(lag60, -1); // within ~5 ms of each other
    expect(Math.abs(lag240 - lag60)).toBeLessThan(6);
    // The old per-sample smoothing left a fraction of that at 240 Hz.
    const plain = new Stabilizer({ stabilization: 0.7 });
    let last = 0;
    let x = 0;
    for (let i = 0; i <= 480; i++) {
      x = (800 * i) / 240;
      last = plain.next(x, 0, 1).x;
    }
    expect(((x - last) / 800) * 1000).toBeLessThan(lag60 / 2);
  });

  it('ignores a clock hiccup: a huge or backwards time step is clamped', () => {
    const st = new Stabilizer({ stabilization: 0.5 });
    st.next(0, 0, 1, 5000);
    const back = st.next(10, 0, 1, 4000); // backwards: counts as the shortest step
    expect(back.x).toBeGreaterThan(0);
    expect(back.x).toBeLessThan(10);
    const gap = st.next(110, 0, 1, 9000); // a long pause: counts as the longest step, which is nearly all the way
    expect(gap.x).toBeGreaterThan(100);
  });

  it('eases off with speed, and the same way at any sample rate', () => {
    const slow = lagMs(run(0.8, 60, 60, 2, { bySpeed: true }), 60);
    const fast = lagMs(run(0.8, 60, 1500, 2, { bySpeed: true }), 1500);
    expect(fast).toBeLessThan(slow);
    const fast240 = lagMs(run(0.8, 240, 1500, 2, { bySpeed: true }), 1500);
    expect(Math.abs(fast240 - fast)).toBeLessThan(fast * 0.35);
  });
});
