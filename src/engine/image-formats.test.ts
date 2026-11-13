import { describe, expect, it } from 'vitest';
import { encodeBmp, encodeTga, encodeTiff, flattenOverWhite } from './image-formats';

// 3 × 2 image: a red pixel, a half transparent blue one, a transparent one, then three more.
const rgba = new Uint8ClampedArray([
  255, 0, 0, 255, 0, 0, 255, 128, 9, 9, 9, 0,
  0, 255, 0, 255, 10, 20, 30, 255, 255, 255, 255, 255,
]);

describe('BMP', () => {
  it('writes a 24-bit file with bottom-up rows padded to four bytes, over white', () => {
    const f = encodeBmp(3, 2, rgba);
    const v = new DataView(f.buffer);
    expect([f[0], f[1]]).toEqual([0x42, 0x4d]);
    expect(v.getUint32(2, true)).toBe(f.length);
    expect(v.getInt32(18, true)).toBe(3);
    expect(v.getInt32(22, true)).toBe(2);
    expect(v.getUint16(28, true)).toBe(24);
    expect(f.length).toBe(54 + 12 * 2); // 9 bytes per row padded to 12
    // The bottom row of the picture comes first: its first pixel is green (B, G, R order in the file).
    expect(Array.from(f.subarray(54, 57))).toEqual([0, 255, 0]);
    // The top row starts after it: red, then the half transparent blue mixed with white, then pure white for the transparent one.
    expect(Array.from(f.subarray(66, 69))).toEqual([0, 0, 255]);
    expect(Array.from(f.subarray(69, 72))).toEqual([255, 127, 127]);
    expect(Array.from(f.subarray(72, 75))).toEqual([255, 255, 255]);
  });
});

describe('TGA', () => {
  it('writes 32-bit BGRA with the origin at the top left', () => {
    const f = encodeTga(3, 2, rgba);
    expect(f[2]).toBe(2);
    expect(new DataView(f.buffer).getUint16(12, true)).toBe(3);
    expect(new DataView(f.buffer).getUint16(14, true)).toBe(2);
    expect([f[16], f[17]]).toEqual([32, 0x28]);
    expect(Array.from(f.subarray(18, 22))).toEqual([0, 0, 255, 255]); // red as B, G, R, A
    expect(f.length).toBe(18 + 24);
  });
});

describe('TIFF', () => {
  it('has a header, ordered tags, and the pixels at the strip offset', () => {
    const f = encodeTiff(3, 2, rgba, 600);
    const v = new DataView(f.buffer);
    expect([f[0], f[1]]).toEqual([0x49, 0x49]);
    expect(v.getUint16(2, true)).toBe(42);
    const ifd = v.getUint32(4, true);
    const n = v.getUint16(ifd, true);
    expect(n).toBe(13);
    let last = 0;
    const tags = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const at = ifd + 2 + i * 12;
      const tag = v.getUint16(at, true);
      expect(tag).toBeGreaterThan(last);
      last = tag;
      tags.set(tag, v.getUint16(at + 2, true) === 3 && v.getUint32(at + 4, true) === 1 ? v.getUint16(at + 8, true) : v.getUint32(at + 8, true));
    }
    expect(tags.get(256)).toBe(3);
    expect(tags.get(257)).toBe(2);
    expect(tags.get(277)).toBe(4);
    const strip = tags.get(273)!;
    expect(Array.from(f.subarray(strip, strip + 4))).toEqual([255, 0, 0, 255]);
    expect(f.length).toBe(strip + 24);
    expect(tags.get(279)).toBe(24);
    // Resolution: 600 / 1.
    const res = tags.get(282)!;
    expect([v.getUint32(res, true), v.getUint32(res + 4, true)]).toEqual([600, 1]);
  });
});

describe('flattenOverWhite', () => {
  it('makes every pixel opaque, laying the transparent ones on white', () => {
    const out = flattenOverWhite(new Uint8ClampedArray(rgba));
    expect(Array.from(out.slice(0, 4))).toEqual([255, 0, 0, 255]); // opaque stays
    expect(Array.from(out.slice(4, 8))).toEqual([127, 127, 255, 255]); // half blue over white
    expect(Array.from(out.slice(8, 12))).toEqual([255, 255, 255, 255]); // transparent becomes paper
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
});
