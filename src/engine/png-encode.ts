/**
 * A PNG writer that needs no canvas. The browser's `canvas.toBlob('image/png')` is scheduled for idle time, and a window that is
 * drawing all the time (a WebGL page) has none: on a tablet every picture waited about four seconds, which made folders of
 * previews and every layer of an exported OpenRaster or Clip Studio file crawl. Here the pixels are filtered (none), compressed
 * with the browser's own zlib stream and wrapped in the chunks of the format, which takes milliseconds.
 */

import { noTick, type Tick } from './cooperate';
import { deflateRaw } from './deflate-pool';
import { crc32Async } from './zip';

/** Adler-32 of `data` (the checksum a zlib stream ends with), a megabyte at a time with a turn for the window between. */
async function adler32(data: Uint8Array, tick: Tick): Promise<number> {
  let a = 1;
  let b = 0;
  for (let from = 0; from < data.length; from += 1 << 20) {
    const to = Math.min(data.length, from + (1 << 20));
    for (let i = from; i < to; ) {
      const end = Math.min(to, i + 5552); // the longest run before the sums can overflow 32 bits
      for (; i < end; i++) {
        a += data[i]!;
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
    await tick();
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * A zlib stream (what PNG wants): raw deflate on the workers of `deflate-pool` (the browser runs its own compression streams on the
 * thread that asks, which held the window for a third of a second on one merged page) between the zlib header and checksum.
 */
async function zlib(data: Uint8Array, tick: Tick): Promise<Uint8Array> {
  const packed = await deflateRaw(data);
  const out = new Uint8Array(2 + packed.length + 4);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(packed, 2);
  new DataView(out.buffer).setUint32(2 + packed.length, await adler32(data, tick));
  return out;
}

async function chunk(type: string, data: Uint8Array, tick: Tick): Promise<Uint8Array> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, await crc32Async(out.subarray(4, 8 + data.length), tick));
  return out;
}

/** A PNG file (8 bits per channel, straight alpha) of `width × height` RGBA pixels. */
export async function encodePng(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array, tick: Tick = noTick): Promise<Uint8Array> {
  const row = width * 4;
  return encodePngRows(width, height, async (from, to) => rgba.subarray(from * row, to * row), tick);
}

/** Rows of RGBA pixels, `from` up to (not including) `to`: where a PNG takes its picture from, a few rows at a time. */
export type RowSource = (from: number, to: number) => Promise<Uint8ClampedArray | Uint8Array>;

/**
 * `encodePng` for a picture that is made as it is read (the merged page): it never exists as a whole besides the rows of the file
 * itself, which for a big page is a hundred megabytes less in memory than merging first and writing after.
 */
export async function encodePngRows(width: number, height: number, rows: RowSource, tick: Tick = noTick, options: { sub?: boolean } = {}, step = 256): Promise<Uint8Array> {
  const row = width * 4;
  const raw = new Uint8Array((row + 1) * height);
  for (let from = 0; from < height; from += step) {
    const to = Math.min(height, from + step);
    const part = await rows(from, to);
    for (let y = from; y < to; y++) {
      const px = part.subarray((y - from) * row, (y - from + 1) * row);
      const at = y * (row + 1);
      if (!options.sub) {
        raw.set(px, at + 1); // filter byte 0 = none
        continue;
      }
      // Filter 1 (Sub): each byte minus the one a pixel to the left. Drawings compress far better than with no filter, as the browser's own encoder does.
      raw[at] = 1;
      for (let i = 0; i < 4 && i < row; i++) raw[at + 1 + i] = px[i]!;
      for (let i = 4; i < row; i++) raw[at + 1 + i] = (px[i]! - px[i - 4]!) & 255;
    }
    await tick();
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), await chunk('IHDR', header, tick), await chunk('IDAT', await zlib(raw, tick), tick), await chunk('IEND', new Uint8Array(0), tick)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
