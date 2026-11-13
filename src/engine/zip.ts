/**
 * A small ZIP reader and writer, enough for OpenRaster: whole files only, no encryption, no ZIP64, no multi-disk.
 * Entries are written "stored" (PNG data is already compressed); the reader also understands "deflate" entries,
 * which it expands with the platform's `DecompressionStream`.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** More than this many bytes in one entry is refused (also the bound on what an entry may expand to). */
export const ZIP_ENTRY_LIMIT = 1_500_000_000;
const MAX_ENTRIES = 65_000;

const utf8 = new TextEncoder();

/** Pack entries into a ZIP. The first entry is written first, which OpenRaster needs for its `mimetype`. */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error('Demasiados archivos para un ZIP.');
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8.encode(e.name);
    const crc = crc32(e.data);
    if (e.data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('El archivo ZIP sería demasiado grande (más de 4 GB).');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    parts.push(local, e.data);
    offset += local.length + e.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected || total > ZIP_ENTRY_LIMIT) {
      await reader.cancel();
      throw new Error('Un archivo del ZIP se expande más de lo que declara.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Read the named entries of a ZIP. A damaged or unsupported archive throws an `Error` with a readable message. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('No es un archivo ZIP válido.');
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('Los ZIP de más de 4 GB no se admiten.');
  const out: ZipEntry[] = [];
  const dec = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || dv.getUint32(at, true) !== 0x02014b50) throw new Error('El directorio del ZIP está dañado.');
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const csize = dv.getUint32(at + 20, true);
    const usize = dv.getUint32(at + 24, true);
    const nlen = dv.getUint16(at + 28, true);
    const elen = dv.getUint16(at + 30, true);
    const clen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    if (at + 46 + nlen > bytes.length) throw new Error('El directorio del ZIP está dañado.');
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nlen));
    at += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('El ZIP está cifrado.');
    if (usize > ZIP_ENTRY_LIMIT) throw new Error(`«${name}» es demasiado grande.`);
    if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) throw new Error('El ZIP está dañado (cabecera de archivo).');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    if (start + csize > bytes.length) throw new Error('El ZIP está truncado.');
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw, usize);
    else throw new Error(`El ZIP usa un método de compresión no admitido (${method}).`);
    if (data.length !== usize) throw new Error(`«${name}» no tiene el tamaño esperado.`);
    if (crc32(data) !== crc) throw new Error(`«${name}» está dañado (la suma de comprobación no coincide).`);
    out.push({ name, data });
  }
  return out;
}
