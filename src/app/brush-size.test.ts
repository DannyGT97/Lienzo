import { describe, expect, it } from 'vitest';
import { MAX_SIZE, MIN_SIZE, SIZE_PRESETS, SLIDER_STEPS, clampOpacityPct, clampSizeFine, formatOpacity, formatSize, posToSize, sizeToPos, stepSize } from './brush-size';

describe('brush size scale', () => {
  it('covers the whole range and stays monotonic', () => {
    expect(posToSize(0)).toBe(MIN_SIZE);
    expect(posToSize(SLIDER_STEPS)).toBe(MAX_SIZE);
    let prev = 0;
    for (let p = 0; p <= SLIDER_STEPS; p += 10) {
      const s = posToSize(p);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('is logarithmic: the same slider travel multiplies the size by the same factor', () => {
    const a = posToSize(300);
    const b = posToSize(500);
    const c = posToSize(700);
    expect(Math.abs(b / a - c / b)).toBeLessThan(0.15);
    // A thick brush is reachable in the upper part of the slider, not only at the very end.
    expect(posToSize(800)).toBeGreaterThan(200);
    expect(posToSize(500)).toBeLessThan(60);
  });

  it('round-trips through the slider position', () => {
    for (const s of [1, 3, 12, 48, 120, 400, 1000, 2000]) {
      const back = posToSize(sizeToPos(s));
      expect(Math.abs(back - s) / s).toBeLessThan(0.01 + 1 / s);
    }
  });

  it('steps through presets in both directions and stops at the ends', () => {
    expect(stepSize(10, 1)).toBe(12);
    expect(stepSize(10, -1)).toBe(8);
    expect(stepSize(11, 1)).toBe(12);
    expect(stepSize(11, -1)).toBe(10);
    expect(stepSize(MAX_SIZE, 1)).toBe(MAX_SIZE);
    expect(stepSize(MIN_SIZE, -1)).toBe(MIN_SIZE);
    expect([...SIZE_PRESETS]).toEqual([...SIZE_PRESETS].sort((a, b) => a - b));
  });
});

describe('fine steps of the quick popup', () => {
  it('moves a size by a tenth without float noise', () => {
    expect(clampSizeFine(12 + 0.1)).toBe(12.1);
    expect(clampSizeFine(0.1 + 0.2 + 12)).toBe(12.3);
    expect(clampSizeFine(0)).toBe(MIN_SIZE);
    expect(clampSizeFine(99999)).toBe(MAX_SIZE);
  });

  it('shows 12.0 px for fine brushes and whole pixels for big ones', () => {
    expect(formatSize(12)).toBe('12.0');
    expect(formatSize(12.5)).toBe('12.5');
    expect(formatSize(250)).toBe('250');
  });

  it('keeps opacity between 0.1 and 100 percent', () => {
    expect(clampOpacityPct(100.1)).toBe(100);
    expect(clampOpacityPct(0)).toBe(0.1);
    expect(clampOpacityPct(99.9 + 0.1)).toBe(100);
    expect(formatOpacity(100)).toBe('100');
    expect(formatOpacity(99.9)).toBe('99.9');
  });
});
