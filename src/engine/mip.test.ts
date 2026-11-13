import { describe, expect, it } from 'vitest';
import { halve, mipChain } from './mip';

const solid = (size: number, rgba: [number, number, number, number]): Uint8Array => {
  const a = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) a.set(rgba, i * 4);
  return a;
};

describe('mip levels', () => {
  it('keeps a flat colour flat', () => {
    const out = halve(solid(4, [200, 30, 10, 255]), 4);
    expect(out).toHaveLength(2 * 2 * 4);
    expect([...out.slice(0, 4)]).toEqual([200, 30, 10, 255]);
  });

  it('does not let the colour of transparent pixels tint the line next to them', () => {
    // 2×2 block: one opaque red pixel and three transparent ones that happen to hold green.
    const src = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0]);
    const out = halve(src, 2);
    expect([...out]).toEqual([255, 0, 0, 64]); // still pure red, a quarter covered
  });

  it('weights colours by how opaque each pixel is', () => {
    const src = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 85, 0, 0, 0, 0, 0, 0, 0, 0]);
    const out = halve(src, 2);
    expect(out[3]).toBe(85); // (255 + 85) / 4
    expect(out[0]).toBe(191); // red is 3/4 of the weight
    expect(out[2]).toBe(64);
  });

  it('a fully transparent block stays transparent', () => {
    const out = halve(solid(2, [9, 9, 9, 0]), 2);
    expect(out[3]).toBe(0);
  });

  it('gives exactly the plain alpha-weighted average, rounded, whatever the pixels', () => {
    // The formula as first written, kept here as the reference the fast version must match.
    const reference = (src: ArrayLike<number>, size: number): number[] => {
      const half = size >> 1;
      const out: number[] = [];
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
          const i = [(2 * y * size + 2 * x) * 4, (2 * y * size + 2 * x + 1) * 4, ((2 * y + 1) * size + 2 * x) * 4, ((2 * y + 1) * size + 2 * x + 1) * 4];
          const a = i.map((k) => src[k + 3]!);
          const sum = a[0]! + a[1]! + a[2]! + a[3]!;
          for (let c = 0; c < 3; c++) {
            out.push(sum === 0 ? (i.reduce((n, k) => n + src[k + c]!, 0) + 2) >> 2 : Math.round(i.reduce((n, k, j) => n + src[k + c]! * a[j]!, 0) / sum));
          }
          out.push(sum === 0 ? 0 : (sum + 2) >> 2);
        }
      }
      return out;
    };
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let round = 0; round < 40; round++) {
      const src = new Uint8ClampedArray(32 * 32 * 4);
      // Mix of clear, opaque and partly see-through pixels so every path is taken.
      for (let p = 0; p < 32 * 32; p++) {
        const kind = rnd();
        src[p * 4] = rnd() * 256;
        src[p * 4 + 1] = rnd() * 256;
        src[p * 4 + 2] = rnd() * 256;
        src[p * 4 + 3] = kind < 0.3 ? 0 : kind < 0.6 ? 255 : rnd() * 256;
      }
      expect([...halve(src, 32)]).toEqual(reference(src, 32));
    }
  });

  it('builds a chain down to the requested number of levels', () => {
    const chain = mipChain(solid(16, [1, 2, 3, 255]), 16, 4);
    expect(chain.map((c) => c.length / 4)).toEqual([64, 16, 4]);
    expect(mipChain(solid(2, [1, 2, 3, 255]), 2, 9).map((c) => c.length / 4)).toEqual([1]);
  });
});
