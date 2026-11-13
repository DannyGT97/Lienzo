/**
 * Smaller copies of a tile for drawing the page zoomed out (mip levels). Tiles hold straight (not premultiplied) RGBA, so a
 * plain average would drag the colour of transparent pixels into the edge of a line; each level is averaged weighted by alpha
 * instead, which is what averaging premultiplied pixels and un-premultiplying gives. Own design.
 *
 * This runs on the main thread for every tile a stroke touches while the page is zoomed out, so it is written for speed:
 * no per-channel loops, no division per channel, and the two common cases (a block that is entirely opaque or entirely
 * clear) take a short path. The result is the same as the plain weighted average, rounded to the nearest value.
 */

/** Half-size copy of a `size`×`size` straight-RGBA image (`size` even): 2×2 blocks averaged, colours weighted by alpha. */
export function halve(src: ArrayLike<number>, size: number): Uint8Array {
  const half = size >> 1;
  const out = new Uint8Array(half * half * 4);
  const row = size * 4;
  let o = 0;
  for (let y = 0; y < half; y++) {
    let i0 = y * 2 * row;
    for (let x = 0; x < half; x++, i0 += 8, o += 4) {
      const i1 = i0 + 4;
      const i2 = i0 + row;
      const i3 = i2 + 4;
      const a0 = src[i0 + 3]!;
      const a1 = src[i1 + 3]!;
      const a2 = src[i2 + 3]!;
      const a3 = src[i3 + 3]!;
      const sum = a0 + a1 + a2 + a3;
      if (sum === 0 || sum === 1020) {
        // Nothing visible (keep a plain average so the colour does not flicker if a filter ever reads it) or fully opaque
        // (all weights are equal): a plain average either way.
        out[o] = (src[i0]! + src[i1]! + src[i2]! + src[i3]! + 2) >> 2;
        out[o + 1] = (src[i0 + 1]! + src[i1 + 1]! + src[i2 + 1]! + src[i3 + 1]! + 2) >> 2;
        out[o + 2] = (src[i0 + 2]! + src[i1 + 2]! + src[i2 + 2]! + src[i3 + 2]! + 2) >> 2;
        out[o + 3] = sum === 0 ? 0 : 255;
        continue;
      }
      // round(n / sum) = floor((2n + sum) / (2·sum)), with one reciprocal for the three channels. The multiplication by the
      // reciprocal can land a hair under a whole number that the division reaches exactly, hence the tiny nudge (the true
      // quotient is never closer than 1/2040 to the next whole number, so it cannot tip a value that is not exact).
      const inv = 1 / (2 * sum);
      const nudge = 0.000001;
      out[o] = ((2 * (src[i0]! * a0 + src[i1]! * a1 + src[i2]! * a2 + src[i3]! * a3) + sum) * inv + nudge) | 0;
      out[o + 1] = ((2 * (src[i0 + 1]! * a0 + src[i1 + 1]! * a1 + src[i2 + 1]! * a2 + src[i3 + 1]! * a3) + sum) * inv + nudge) | 0;
      out[o + 2] = ((2 * (src[i0 + 2]! * a0 + src[i1 + 2]! * a1 + src[i2 + 2]! * a2 + src[i3 + 2]! * a3) + sum) * inv + nudge) | 0;
      out[o + 3] = (sum + 2) >> 2;
    }
  }
  return out;
}

/** The levels below the first one: `levels - 1` images, each half the size of the one before. */
export function mipChain(src: ArrayLike<number>, size: number, levels: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let cur: ArrayLike<number> = src;
  let s = size;
  for (let l = 1; l < levels && s > 1; l++) {
    const next = halve(cur, s);
    out.push(next);
    cur = next;
    s >>= 1;
  }
  return out;
}
