import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, encodePngRows } from './png-encode';

/** Reads back what the writer made, with the format's own rules: signature, chunk checksums, header, filtered rows. */
function decode(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  const types: string[] = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    // The checksum of a chunk is the CRC-32 of its type and data.
    let c = 0xffffffff;
    for (const b of png.subarray(at + 4, at + 8 + len)) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    expect(view.getUint32(at + 8 + len)).toBe((c ^ 0xffffffff) >>> 0);
    types.push(type);
    if (type === 'IHDR') {
      width = new DataView(body.buffer, body.byteOffset).getUint32(0);
      height = new DataView(body.buffer, body.byteOffset).getUint32(4);
      expect([body[8], body[9], body[10], body[11], body[12]]).toEqual([8, 6, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  expect(types[0]).toBe('IHDR');
  expect(types[types.length - 1]).toBe('IEND');
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

describe('encodePng', () => {
  it('writes a file that reads back to the same pixels', async () => {
    const w = 5;
    const h = 3;
    const px = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 37 + 11) & 255);
    const back = decode(await encodePng(w, h, px));
    expect([back.width, back.height]).toEqual([w, h]);
    expect(Array.from(back.rgba)).toEqual(Array.from(px));
  });

  it('keeps transparency as it is (straight alpha) and handles a big flat picture', async () => {
    const w = 400;
    const h = 300;
    const px = new Uint8ClampedArray(w * h * 4);
    px.set([10, 200, 30, 0], 0);
    px.set([255, 0, 0, 128], 4 * (w + 1));
    const png = await encodePng(w, h, px);
    expect(png.length).toBeLessThan(w * h); // a flat picture compresses well
    const back = decode(png);
    expect(Array.from(back.rgba.subarray(0, 4))).toEqual([10, 200, 30, 0]);
    expect(Array.from(back.rgba.subarray(4 * (w + 1), 4 * (w + 1) + 4))).toEqual([255, 0, 0, 128]);
  });

  it('writes the Sub filter from rows made on demand, and reads back to the same pixels', async () => {
    const w = 37;
    const h = 600; // more than one step of rows
    const px = new Uint8ClampedArray(w * h * 4).map((_, i) => ((i * 53) ^ (i >> 5)) & 255);
    const asked: Array<[number, number]> = [];
    const png = await encodePngRows(w, h, async (from, to) => (asked.push([from, to]), px.subarray(from * w * 4, to * w * 4)), undefined, { sub: true });
    expect(asked).toEqual([[0, 256], [256, 512], [512, 600]]);
    // Read back by hand: undo the filter of every row.
    const idat: Uint8Array[] = [];
    for (let at = 8; at < png.length; ) {
      const len = new DataView(png.buffer, png.byteOffset).getUint32(at);
      if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
      at += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      expect(raw[y * (row + 1)]).toBe(1);
      for (let i = 0; i < row; i++) {
        const left = i >= 4 ? px[y * row + i - 4]! : 0;
        expect((raw[y * (row + 1) + 1 + i]! + left) & 255).toBe(px[y * row + i]);
      }
    }
  });
});
