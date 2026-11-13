import { TILE } from './tiles';

/**
 * The container and block formats of Clip Studio's `.clip` files ("CSF"). Everything here is big-endian unless noted.
 *
 *   file    = "CSFCHUNK" u64 file-size u64 first-chunk-offset(24)  chunk*
 *   chunk   = tag(8) u64 payload-size payload
 *   Head    = u64 0x100, u64 offset of the SQLi chunk, u64 0x10, 16 bytes of identifier
 *   Exta    = u64 id-length, id ("extrnlid" + 32 hex digits), u64 data-length, data   (data: see block set)
 *   SQLi    = a complete SQLite database
 *   Foot    = nothing
 *
 *   block set = block record*  BlockStatus-table  BlockCheckSum-table
 *   block record = u32 total-length, name("BlockDataBeginChunk"), u32 index, u32 raw-size, u32 width, u32 height,
 *                  u32 has-data, [u32 length+4, u32 LITTLE-endian length, zlib stream], name("BlockDataEndChunk")
 *   table = name, u32 12, u32 count, u32 4, count × u32
 *   name = u32 length in characters, UTF-16BE text
 *   The checksum of a block is the Adler-32 of "u32 little-endian length + zlib stream" (0 for a block with no data).
 */

export const CSF_MAGIC = 'CSFCHUNK';
/** Decompressed size of one block: a 256×256 alpha plane followed by 256×256 four-byte pixels. */
export const BLOCK_RAW = TILE * TILE * 5;
const BEGIN = 'BlockDataBeginChunk';
const END = 'BlockDataEndChunk';
const MAX_BLOCKS = 1_000_000;

const ascii = (b: Uint8Array, at: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]!);
  return s;
};

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** u64 read as a number; throws when it cannot be a size inside `limit` bytes. */
function u64(dv: DataView, at: number, limit: number, what: string): number {
  if (at + 8 > dv.byteLength) throw new Error(`El archivo .clip está truncado (${what}).`);
  const hi = dv.getUint32(at);
  const lo = dv.getUint32(at + 4);
  const v = hi * 0x1_0000_0000 + lo;
  if (hi > 0x1fffff || v > limit) throw new Error(`El archivo .clip está dañado (${what} fuera de rango).`);
  return v;
}

function put64(dv: DataView, at: number, v: number): void {
  dv.setUint32(at, Math.floor(v / 0x1_0000_0000));
  dv.setUint32(at + 4, v >>> 0);
}

export function looksLikeClip(head: Uint8Array): boolean {
  return ascii(head, 0, 8) === CSF_MAGIC;
}

export interface CsfChunk {
  tag: string;
  /** Offset of the chunk (its tag) in the file. */
  start: number;
  payload: Uint8Array;
}

/** The chunks of a file, in order. Checks the framing but not the contents. */
export function parseCsf(bytes: Uint8Array): CsfChunk[] {
  if (!looksLikeClip(bytes)) throw new Error('No es un archivo .clip de Clip Studio.');
  const dv = view(bytes);
  let at = u64(dv, 16, bytes.length, 'posición del primer bloque');
  const chunks: CsfChunk[] = [];
  while (at + 16 <= bytes.length) {
    const tag = ascii(bytes, at, 8);
    if (!tag.startsWith('CHNK')) throw new Error('El archivo .clip está dañado (bloque desconocido).');
    const size = u64(dv, at + 8, bytes.length, `tamaño del bloque ${tag}`);
    if (at + 16 + size > bytes.length) throw new Error('El archivo .clip está truncado (un bloque llega más allá del final).');
    chunks.push({ tag, start: at, payload: bytes.subarray(at + 16, at + 16 + size) });
    at += 16 + size;
    if (tag === 'CHNKFoot') break;
  }
  return chunks;
}

/** A complete file from its chunks (the Head chunk's pointer to the database is set here). */
export function buildCsf(chunks: readonly { tag: string; payload: Uint8Array }[]): { bytes: Uint8Array; starts: number[] } {
  let total = 24;
  for (const c of chunks) total += 16 + c.payload.length;
  const out = new Uint8Array(total);
  const dv = view(out);
  out.set(new TextEncoder().encode(CSF_MAGIC), 0);
  put64(dv, 8, total);
  put64(dv, 16, 24);
  const starts: number[] = [];
  let at = 24;
  for (const c of chunks) {
    starts.push(at);
    out.set(new TextEncoder().encode(c.tag), at);
    put64(dv, at + 8, c.payload.length);
    out.set(c.payload, at + 16);
    at += 16 + c.payload.length;
  }
  return { bytes: out, starts };
}

/** The Head chunk with its pointer to the database chunk replaced. */
export function headWithDatabaseOffset(head: Uint8Array, offset: number): Uint8Array {
  if (head.length < 16) throw new Error('El archivo .clip tiene una cabecera que no se reconoce.');
  const out = head.slice();
  put64(view(out), 8, offset);
  return out;
}

export interface ExternalData {
  id: string;
  data: Uint8Array;
}

export function parseExta(payload: Uint8Array): ExternalData {
  const dv = view(payload);
  const idLen = u64(dv, 0, payload.length, 'identificador de datos externos');
  const dataLen = u64(dv, 8 + idLen, payload.length, 'tamaño de datos externos');
  if (16 + idLen + dataLen > payload.length) throw new Error('El archivo .clip está dañado (datos externos fuera de su bloque).');
  return { id: ascii(payload, 8, idLen), data: payload.subarray(16 + idLen, 16 + idLen + dataLen) };
}

export function buildExta(id: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + id.length + data.length);
  const dv = view(out);
  put64(dv, 0, id.length);
  out.set(new TextEncoder().encode(id), 8);
  put64(dv, 8 + id.length, data.length);
  out.set(data, 16 + id.length);
  return out;
}

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(data.length, i + 5552);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** One block of a layer: where it is in the grid, and its compressed pixels (null = an empty block). */
export interface BlockRecord {
  index: number;
  /** The whole record as stored, so an unchanged block can be written back byte for byte. */
  record: Uint8Array;
  /** The zlib stream, without the length prefix. */
  zlib: Uint8Array | null;
  checksum: number;
  status: number;
}

const nameBytes = (s: string): Uint8Array => {
  const out = new Uint8Array(4 + s.length * 2);
  view(out).setUint32(0, s.length);
  for (let i = 0; i < s.length; i++) view(out).setUint16(4 + i * 2, s.charCodeAt(i));
  return out;
};

const BEGIN_NAME = nameBytes(BEGIN);
const END_NAME = nameBytes(END);

function readName(b: Uint8Array, at: number): { name: string; end: number } | null {
  if (at + 4 > b.length) return null;
  const n = view(b).getUint32(at);
  if (n === 0 || n > 64 || at + 4 + n * 2 > b.length) return null;
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(view(b).getUint16(at + 4 + i * 2));
  return { name: s, end: at + 4 + n * 2 };
}

/** Build the record of one block. `zlib` is the compressed stream of its pixels, or null for an empty block. */
export function encodeBlock(index: number, zlib: Uint8Array | null): { record: Uint8Array; checksum: number } {
  const size = 4 + BEGIN_NAME.length + 20 + (zlib ? 8 + zlib.length : 0) + END_NAME.length;
  const out = new Uint8Array(size);
  const dv = view(out);
  let at = 0;
  dv.setUint32(at, size);
  at += 4;
  out.set(BEGIN_NAME, at);
  at += BEGIN_NAME.length;
  dv.setUint32(at, index);
  dv.setUint32(at + 4, BLOCK_RAW);
  dv.setUint32(at + 8, TILE);
  dv.setUint32(at + 12, TILE);
  dv.setUint32(at + 16, zlib ? 1 : 0);
  at += 20;
  let checksum = 0;
  if (zlib) {
    dv.setUint32(at, zlib.length + 4);
    dv.setUint32(at + 4, zlib.length, true);
    out.set(zlib, at + 8);
    checksum = adler32(out.subarray(at + 4, at + 8 + zlib.length));
    at += 8 + zlib.length;
  }
  out.set(END_NAME, at);
  return { record: out, checksum };
}

/** Split a set of external block data into its records, in file order, with the status and checksum tables applied. */
export function parseBlockSet(data: Uint8Array): BlockRecord[] {
  const dv = view(data);
  const blocks: BlockRecord[] = [];
  const tables = new Map<string, number[]>();
  for (let at = 0; at < data.length; ) {
    if (at + 8 > data.length) throw new Error('Los datos de píxeles del archivo .clip están truncados.');
    const first = dv.getUint32(at);
    if (first > 64) {
      // A block record: its total length first.
      const total = first;
      const begin = readName(data, at + 4);
      if (!begin || begin.name !== BEGIN || at + total > data.length) throw new Error('Los datos de píxeles del archivo .clip están dañados (bloque).');
      let p = begin.end;
      if (p + 20 > at + total) throw new Error('Los datos de píxeles del archivo .clip están dañados (bloque corto).');
      const index = dv.getUint32(p);
      const hasData = dv.getUint32(p + 16);
      p += 20;
      let zlib: Uint8Array | null = null;
      let checksum = 0;
      if (hasData) {
        if (p + 8 > at + total) throw new Error('Los datos de píxeles del archivo .clip están dañados (bloque sin datos).');
        const framed = dv.getUint32(p);
        const length = dv.getUint32(p + 4, true);
        if (framed !== length + 4 || p + 8 + length > at + total) throw new Error('Los datos de píxeles del archivo .clip están dañados (longitud de bloque).');
        zlib = data.subarray(p + 8, p + 8 + length);
        checksum = adler32(data.subarray(p + 4, p + 8 + length));
        p += 8 + length;
      }
      const end = readName(data, p);
      if (!end || end.name !== END || end.end !== at + total) throw new Error('Los datos de píxeles del archivo .clip están dañados (fin de bloque).');
      if (blocks.length >= MAX_BLOCKS) throw new Error('El archivo .clip declara demasiados bloques.');
      blocks.push({ index, record: data.subarray(at, at + total), zlib, checksum, status: 1 });
      at += total;
    } else {
      const head = readName(data, at);
      if (!head || head.end + 12 > data.length) throw new Error('Los datos de píxeles del archivo .clip están dañados (tabla).');
      const count = dv.getUint32(head.end + 4);
      const width = dv.getUint32(head.end + 8);
      if (width !== 4 || head.end + 12 + count * 4 > data.length) throw new Error('Los datos de píxeles del archivo .clip están dañados (tabla de bloques).');
      const values: number[] = [];
      for (let i = 0; i < count; i++) values.push(dv.getUint32(head.end + 12 + i * 4));
      tables.set(head.name, values);
      at = head.end + 12 + count * 4;
    }
  }
  const status = tables.get('BlockStatus');
  const sums = tables.get('BlockCheckSum');
  blocks.forEach((b, i) => {
    if (status && status[i] !== undefined) b.status = status[i]!;
    // The stored checksum is what the program wrote; ours is what the bytes say. They agree in every file seen.
    if (sums && sums[i] !== undefined && b.zlib) b.checksum = sums[i]!;
  });
  return blocks;
}

/** The data of an external block set from its records (index order is the order given). */
export function buildBlockSet(blocks: readonly { record: Uint8Array; checksum: number; status: number }[]): Uint8Array {
  const table = (name: string, values: number[]): Uint8Array => {
    const n = nameBytes(name);
    const out = new Uint8Array(n.length + 12 + values.length * 4);
    const dv = view(out);
    out.set(n, 0);
    dv.setUint32(n.length, 12);
    dv.setUint32(n.length + 4, values.length);
    dv.setUint32(n.length + 8, 4);
    values.forEach((v, i) => dv.setUint32(n.length + 12 + i * 4, v >>> 0));
    return out;
  };
  const parts = [...blocks.map((b) => b.record), table('BlockStatus', blocks.map((b) => b.status)), table('BlockCheckSum', blocks.map((b) => b.checksum))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The `Attribute` blob of an Offscreen row: its geometry and the byte length of each block record ("BlockSize").
 * Only those two things are read or written; every other byte is kept.
 */
export interface OffscreenAttribute {
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Offset of the first BlockSize value and how many there are. */
  sizesAt: number;
  sizesCount: number;
}

export function parseAttribute(blob: Uint8Array): OffscreenAttribute | null {
  const dv = view(blob);
  const param = readName(blob, 16);
  if (!param || param.name !== 'Parameter' || param.end + 16 > blob.length) return null;
  const width = dv.getUint32(param.end);
  const height = dv.getUint32(param.end + 4);
  const columns = dv.getUint32(param.end + 8);
  const rows = dv.getUint32(param.end + 12);
  // The BlockSize table: its name, then u32 12, u32 count, u32 4, count × u32.
  const needle = BLOCK_SIZE_NAME;
  for (let at = param.end + 16; at + needle.length + 12 <= blob.length; at++) {
    let same = true;
    for (let i = 0; i < needle.length && same; i++) same = blob[at + i] === needle[i];
    if (!same) continue;
    const count = dv.getUint32(at + needle.length + 4);
    const sizesAt = at + needle.length + 12;
    if (dv.getUint32(at + needle.length) !== 12 || dv.getUint32(at + needle.length + 8) !== 4 || sizesAt + count * 4 > blob.length) return null;
    return { width, height, columns, rows, sizesAt, sizesCount: count };
  }
  return null;
}

const BLOCK_SIZE_NAME = nameBytes('BlockSize');

/** A copy of the blob with the record length of every block replaced. */
export function withBlockSizes(blob: Uint8Array, attr: OffscreenAttribute, sizes: readonly number[]): Uint8Array {
  if (sizes.length !== attr.sizesCount) throw new Error('La cantidad de bloques no coincide con la del archivo original.');
  const out = blob.slice();
  const dv = view(out);
  sizes.forEach((s, i) => dv.setUint32(attr.sizesAt + i * 4, s));
  return out;
}

/** Decompress the zlib stream of a block; the result must be exactly one block of pixels. */
export async function inflateBlock(zlib: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const out = new Uint8Array(BLOCK_RAW);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > BLOCK_RAW) {
      await reader.cancel();
      throw new Error('Un bloque se expande más de lo esperado.');
    }
    out.set(value, n);
    n += value.length;
  }
  if (n !== BLOCK_RAW) throw new Error('Un bloque se expande menos de lo esperado.');
  return out;
}

export async function deflateBlock(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
