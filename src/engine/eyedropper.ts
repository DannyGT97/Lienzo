/**
 * Eyedropper sampling: the colour
 * is the average over a (2n+1)×(2n+1) box centred on the pointer, with every pixel weighted by its own
 * alpha so a transparent neighbour does not darken the result. Pixels off the page count as empty.
 */

export type Rgba = readonly [number, number, number, number];

export interface AveragedSample {
  /** Straight (non-premultiplied) colour, 0..255. */
  rgb: [number, number, number];
  /** Mean coverage of the box, 0..255. */
  alpha: number;
}

/**
 * Average the box of half-size `radius` around (x, y). Returns null when nothing in it is painted,
 * which the caller treats as "keep the current colour". `radius` 0 is the single pixel.
 */
export function averageBox(
  read: (x: number, y: number) => Rgba,
  x: number,
  y: number,
  radius: number,
  width: number,
  height: number,
): AveragedSample | null {
  const n = Math.max(0, Math.floor(radius));
  let count = 0;
  let sumA = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let yy = y - n; yy <= y + n; yy++) {
    for (let xx = x - n; xx <= x + n; xx++) {
      count++;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const [r, g, b, a] = read(xx, yy);
      sumA += a;
      sumR += r * a;
      sumG += g * a;
      sumB += b * a;
    }
  }
  if (sumA <= 0) return null;
  return { rgb: [sumR / sumA, sumG / sumA, sumB / sumA], alpha: sumA / count };
}
