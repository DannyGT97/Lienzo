import { describe, expect, it } from 'vitest';
import { averageBox, type Rgba } from './eyedropper';

const solid = (c: Rgba) => () => c;

describe('averageBox', () => {
  it('radius 0 is the single pixel', () => {
    expect(averageBox(solid([10, 20, 30, 255]), 3, 3, 0, 10, 10)).toEqual({ rgb: [10, 20, 30], alpha: 255 });
  });

  it('averages a box and weights the colour by alpha', () => {
    // Left column opaque red, the rest transparent black: the colour stays red, coverage drops.
    const read = (x: number): Rgba => (x === 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
    const s = averageBox(read, 3, 3, 1, 10, 10)!;
    expect(s.rgb).toEqual([255, 0, 0]);
    expect(s.alpha).toBeCloseTo(255 / 3);
  });

  it('mixes two opaque colours evenly', () => {
    const read = (x: number): Rgba => (x < 3 ? [200, 0, 0, 255] : [0, 0, 100, 255]);
    const s = averageBox(read, 3, 3, 1, 10, 10)!;
    expect(s.rgb[0]).toBeCloseTo(200 * (3 / 9) * 1 + 0 * (6 / 9)); // x = 2 is red, 3 and 4 blue
    expect(s.rgb[2]).toBeCloseTo(100 * (6 / 9));
  });

  it('returns null when nothing is painted', () => {
    expect(averageBox(solid([9, 9, 9, 0]), 3, 3, 2, 10, 10)).toBeNull();
  });

  it('counts pixels off the page as empty coverage', () => {
    const s = averageBox(solid([50, 60, 70, 255]), 0, 0, 1, 10, 10)!;
    expect(s.rgb).toEqual([50, 60, 70]);
    expect(s.alpha).toBeCloseTo((255 * 4) / 9);
  });
});
