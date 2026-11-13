import { describe, expect, it } from 'vitest';
import { pressureResponse } from './pressure-graph';

describe('pressureResponse', () => {
  it('passes through every point and is flat outside the first and last', () => {
    const f = pressureResponse([[0.1, 0.2], [0.5, 0.3], [0.9, 0.8]]);
    expect(f(0.1)).toBeCloseTo(0.2, 6);
    expect(f(0.5)).toBeCloseTo(0.3, 6);
    expect(f(0.9)).toBeCloseTo(0.8, 6);
    expect(f(0)).toBeCloseTo(0.2, 6);
    expect(f(1)).toBeCloseTo(0.8, 6);
  });

  it('never overshoots between points of a hard response', () => {
    const f = pressureResponse([[0, 0], [0.75, 0.25], [1, 1]]);
    let prev = 0;
    for (let i = 0; i <= 200; i++) {
      const y = f(i / 200);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
    expect(f(0.5)).toBeLessThan(0.25); // a light press stays light
  });

  it('keeps a plateau flat', () => {
    const f = pressureResponse([[0, 0], [0.14, 0.69], [0.75, 1], [1, 1]]);
    expect(f(0.9)).toBeCloseTo(1, 6);
    expect(f(0.3)).toBeGreaterThan(0.69);
  });

  it('a straight line stays straight', () => {
    const f = pressureResponse([[0, 0], [1, 1]]);
    for (const x of [0, 0.25, 0.6, 1]) expect(f(x)).toBeCloseTo(x, 9);
  });
});
