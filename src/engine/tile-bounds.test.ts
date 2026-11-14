import { describe, expect, it } from 'vitest';
import { alphaBounds } from './tile-bounds';

const tile = (size: number, painted: [number, number][]): Uint8ClampedArray => {
  const t = new Uint8ClampedArray(size * size * 4);
  for (const [x, y] of painted) t[(y * size + x) * 4 + 3] = 1;
  return t;
};

describe('alphaBounds', () => {
  it('is null for a transparent tile', () => {
    expect(alphaBounds(tile(16, []), 16)).toBeNull();
  });

  it('is the box of the visible pixels, end exclusive', () => {
    expect(alphaBounds(tile(16, [[3, 5]]), 16)).toEqual({ x0: 3, y0: 5, x1: 4, y1: 6 });
    expect(alphaBounds(tile(16, [[3, 5], [10, 2], [7, 13]]), 16)).toEqual({ x0: 3, y0: 2, x1: 11, y1: 14 });
  });

  it('reaches the edges of the tile', () => {
    expect(alphaBounds(tile(16, [[0, 0], [15, 15]]), 16)).toEqual({ x0: 0, y0: 0, x1: 16, y1: 16 });
  });

  it('ignores colour: only alpha counts', () => {
    const t = new Uint8ClampedArray(16 * 16 * 4);
    t[(4 * 16 + 4) * 4] = 255; // red with no alpha
    expect(alphaBounds(t, 16)).toBeNull();
  });
});
