/** Writers for the plain image formats a browser canvas cannot make: BMP, TGA and TIFF (all uncompressed). */

/** Straight RGBA over white, as 8-bit RGB: what formats without transparency get. */
function overWhite(rgba: Uint8ClampedArray | Uint8Array, i: number): [number, number, number] {
  const a = rgba[i + 3]! / 255;
  return [Math.round(rgba[i]! * a + 255 * (1 - a)), Math.round(rgba[i + 1]! * a + 255 * (1 - a)), Math.round(rgba[i + 2]! * a + 255 * (1 - a))];
}

/**
 * Straight RGBA made opaque by laying it on white, in place (and returned): the paper formats without transparency get,
 * JPEG's included. PNG, WebP, Targa and TIFF keep the alpha instead.
 */
export function flattenOverWhite(rgba: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = overWhite(rgba, i);
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return rgba;
}

/** 24-bit BMP, bottom row first, transparency flattened onto white. */
export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowBytes * height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42; // "BM"
  out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true); // where the pixels start
  v.setUint32(14, 40, true); // size of this header
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowBytes * height, true);
  v.setInt32(38, 3780, true); // 96 dpi
  v.setInt32(42, 3780, true);
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = overWhite(rgba, (y * width + x) * 4);
      out[o++] = b;
      out[o++] = g;
      out[o++] = r;
    }
  }
  return out;
}

/** Uncompressed 32-bit Targa with alpha, top row first. */
export function encodeTga(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(18 + width * height * 4);
  const v = new DataView(out.buffer);
  out[2] = 2; // true colour, no compression
  v.setUint16(12, width, true);
  v.setUint16(14, height, true);
  out[16] = 32;
  out[17] = 0x28; // 8 alpha bits, origin at the top left
  let o = 18;
  for (let i = 0; i < width * height * 4; i += 4) {
    out[o++] = rgba[i + 2]!;
    out[o++] = rgba[i + 1]!;
    out[o++] = rgba[i]!;
    out[o++] = rgba[i + 3]!;
  }
  return out;
}

/** Uncompressed baseline TIFF, RGBA with unassociated alpha, little endian, one strip. */
export function encodeTiff(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array, dpi = 300): Uint8Array {
  const entries = 13;
  const ifdSize = 2 + entries * 12 + 4;
  const extra = 8 /* bits per sample */ + 16 /* two rationals */;
  const dataStart = 8 + ifdSize + extra;
  const out = new Uint8Array(dataStart + width * height * 4);
  const v = new DataView(out.buffer);
  out[0] = 0x49; // "II"
  out[1] = 0x49;
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  let at = 8;
  v.setUint16(at, entries, true);
  at += 2;
  const bitsAt = 8 + ifdSize;
  const resAt = bitsAt + 8;
  const entry = (tag: number, type: number, count: number, value: number): void => {
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, value, true);
    at += 12;
  };
  // Tags must be in increasing order.
  entry(256, 4, 1, width);
  entry(257, 4, 1, height);
  entry(258, 3, 4, bitsAt);
  entry(259, 3, 1, 1); // no compression
  entry(262, 3, 1, 2); // RGB
  entry(273, 4, 1, dataStart); // strip offset
  entry(277, 3, 1, 4); // samples per pixel
  entry(278, 4, 1, height); // rows per strip
  entry(279, 4, 1, width * height * 4); // strip byte count
  entry(282, 5, 1, resAt);
  entry(283, 5, 1, resAt + 8);
  entry(296, 3, 1, 2); // resolution in inches
  entry(338, 3, 1, 2); // extra sample: unassociated alpha
  v.setUint32(at, 0, true);
  for (let i = 0; i < 4; i++) v.setUint16(bitsAt + i * 2, 8, true);
  v.setUint32(resAt, dpi, true);
  v.setUint32(resAt + 4, 1, true);
  v.setUint32(resAt + 8, dpi, true);
  v.setUint32(resAt + 12, 1, true);
  out.set(rgba.subarray(0, width * height * 4), dataStart);
  return out;
}
