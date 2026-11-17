/**
 * A PNG writer that needs no canvas. The browser's `canvas.toBlob('image/png')` is scheduled for idle time, and a window that is
 * drawing all the time (a WebGL page) has none: on a tablet every picture waited about four seconds, which made folders of
 * previews and every layer of an exported OpenRaster or Clip Studio file crawl. Here the pixels are filtered (none), compressed
 * with the browser's own zlib stream and wrapped in the chunks of the format, which takes milliseconds.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(part: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < part.length; i++) c = CRC[(c ^ part[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate'); // the zlib wrapper, as PNG wants it
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A PNG file (8 bits per channel, straight alpha) of `width × height` RGBA pixels. */
export async function encodePng(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Promise<Uint8Array> {
  const row = width * 4;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1); // filter byte 0 = none
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
