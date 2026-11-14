import { describe, expect, it } from 'vitest';
import { predictPoint } from './predict';

const line = (n: number, speed: number, dt = 16.67) => Array.from({ length: n }, (_, i) => ({ t: i * dt, x: i * dt * speed, y: 50 }));

describe('predictPoint', () => {
  it('needs three distinct samples', () => {
    expect(predictPoint([], 16)).toBeNull();
    expect(predictPoint(line(2, 1), 16)).toBeNull();
    expect(predictPoint([{ t: 0, x: 0, y: 0 }, { t: 0.5, x: 1, y: 0 }, { t: 1, x: 2, y: 0 }], 16)).toBeNull(); // all within one step
  });

  it('carries a steady straight movement forward exactly', () => {
    const s = line(6, 0.5);
    const p = predictPoint(s, 20)!;
    expect(p.x).toBeCloseTo(s[5]!.x + 0.5 * 20, 6);
    expect(p.y).toBeCloseTo(50, 9);
  });

  it('stays where the pen is when it is still', () => {
    const s = line(5, 0);
    expect(predictPoint(s, 30)).toEqual({ x: 0, y: 50 });
  });

  it('never goes farther than a little more than the pen travelled at its last speed', () => {
    // a violent acceleration at the end
    const s = [{ t: 0, x: 0, y: 0 }, { t: 16, x: 1, y: 0 }, { t: 32, x: 12, y: 0 }];
    const p = predictPoint(s, 16)!;
    const lastSpeed = 11 / 16;
    expect(p.x - 12).toBeLessThanOrEqual(lastSpeed * 16 * 1.2 + 1e-9);
  });

  it('is not thrown by repeated samples (down, move and up of the same instant)', () => {
    const s = [...line(4, 0.4), { t: 3 * 16.67, x: 3 * 16.67 * 0.4, y: 50 }];
    const p = predictPoint(s, 16.67)!;
    expect(p.x).toBeCloseTo(3 * 16.67 * 0.4 + 16.67 * 0.4, 5);
  });

  it('follows a curve better than a straight guess does', () => {
    // a circle of radius 100 at 0.4 px/ms
    const w = 0.4 / 100;
    const at = (t: number) => ({ t, x: 100 * Math.cos(w * t), y: 100 * Math.sin(w * t) });
    const s = [0, 16.67, 33.3, 50].map(at);
    const truth = at(50 + 33);
    const guess = predictPoint(s, 33)!;
    const straight = { x: s[3]!.x + ((s[3]!.x - s[2]!.x) / 16.7) * 33, y: s[3]!.y + ((s[3]!.y - s[2]!.y) / 16.7) * 33 };
    expect(Math.hypot(guess.x - truth.x, guess.y - truth.y)).toBeLessThan(Math.hypot(straight.x - truth.x, straight.y - truth.y));
  });
});
