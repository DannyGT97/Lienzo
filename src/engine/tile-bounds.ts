/** The smallest box (pixels of the tile, `x1`/`y1` exclusive) holding every pixel that is not fully transparent. */
export interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where the visible pixels of a `size`×`size` straight-alpha RGBA tile are, or null when it is entirely transparent. The GL
 * compositor uses it to shade only that part of the tile: a transparent pixel changes nothing, so leaving it out is exact.
 */
export function alphaBounds(tile: ArrayLike<number>, size: number): TileBounds | null {
  let y0 = -1;
  let y1 = 0;
  let x0 = size;
  let x1 = 0;
  for (let y = 0; y < size; y++) {
    const row = y * size * 4;
    let first = -1;
    for (let x = 0; x < size; x++) {
      if (tile[row + x * 4 + 3] !== 0) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    let last = first;
    for (let x = size - 1; x > first; x--) {
      if (tile[row + x * 4 + 3] !== 0) {
        last = x;
        break;
      }
    }
    if (y0 < 0) y0 = y;
    y1 = y + 1;
    if (first < x0) x0 = first;
    if (last + 1 > x1) x1 = last + 1;
  }
  return y0 < 0 ? null : { x0, y0, x1, y1 };
}
