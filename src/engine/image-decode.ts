/**
 * Readers for the picture formats a browser cannot decode itself: Targa, TIFF, Netpbm, QOI and PCX. They produce straight (not
 * premultiplied) RGBA, like a canvas does. `sniffImage` tells formats apart by their bytes, not by the file name.
 */

export interface RawImage {
  width: number;
  height: number;
  /** Straight RGBA, row 0 at the top. */
  data: Uint8ClampedArray;
}

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'jxl' | 'bmp' | 'ico' | 'tiff' | 'tga' | 'pnm' | 'qoi' | 'pcx' | 'psd' | 'svg' | 'unknown';

/** More than this many pixels is refused before anything is allocated (4 bytes each). */
export const DECODE_PIXEL_LIMIT = 100_000_000;

/** How much of a file `sniffImage` needs to look at. */
export const SNIFF_BYTES = 2048;

const TGA_EXT = /\.(tga|icb|vda|vst|tpic)$/i;

const ascii = (b: Uint8Array, at: number, s: string): boolean => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

/** A Targa has no signature at its start, so its header has to be plausible *and* the name has to say so. */
function looksLikeTga(b: Uint8Array): boolean {
  if (b.length < 18) return false;
  const cmapType = b[1]!;
  const type = b[2]!;
  const depth = b[16]!;
  const w = b[12]! | (b[13]! << 8);
  const h = b[14]! | (b[15]! << 8);
  return cmapType <= 1 && [1, 2, 3, 9, 10, 11].includes(type) && [8, 15, 16, 24, 32].includes(depth) && w > 0 && h > 0;
}

const PCX_EXT = /\.pcx$/i;

/** A PCX has a weak signature (0x0A, a version, run-length coding), so its header has to be plausible *and* the name has to say so. */
function looksLikePcx(b: Uint8Array): boolean {
  if (b.length < 128 || b[0] !== 0x0a || b[2] !== 1) return false;
  const xmin = b[4]! | (b[5]! << 8);
  const ymin = b[6]! | (b[7]! << 8);
  const xmax = b[8]! | (b[9]! << 8);
  const ymax = b[10]! | (b[11]! << 8);
  return [0, 2, 3, 4, 5].includes(b[1]!) && [1, 2, 4, 8].includes(b[3]!) && xmax >= xmin && ymax >= ymin && b[65]! >= 1 && b[65]! <= 4;
}

/** The format of a file from its first bytes; `name` only breaks the tie for Targa and PCX, which have no real magic number. */
export function sniffImage(head: Uint8Array, name = ''): ImageFormat {
  if (head[0] === 0x89 && ascii(head, 1, 'PNG')) return 'png';
  if (ascii(head, 0, 'qoif')) return 'qoi';
  // Netpbm: P1..P7 followed by white space or a comment.
  if (head[0] === 0x50 && head[1]! >= 0x31 && head[1]! <= 0x37 && [0x0a, 0x0d, 0x20, 0x09, 0x23].includes(head[2]!)) return 'pnm';
  // JPEG XL: a bare codestream (FF 0A) or its ISO box container.
  if ((head[0] === 0xff && head[1] === 0x0a) || (head[0] === 0 && head[1] === 0 && head[2] === 0 && head[3] === 0x0c && ascii(head, 4, 'JXL '))) return 'jxl';
  if (PCX_EXT.test(name) && looksLikePcx(head)) return 'pcx';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (ascii(head, 0, 'GIF8')) return 'gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'webp';
  if (ascii(head, 4, 'ftyp') && (ascii(head, 8, 'avif') || ascii(head, 8, 'avis'))) return 'avif';
  if (ascii(head, 0, 'BM')) return 'bmp';
  // An icon directory starts 00 00 01|02 00 and then counts its images; a Targa with the same first bytes has no count there.
  if (head[0] === 0 && head[1] === 0 && (head[2] === 1 || head[2] === 2) && head[3] === 0 && (head[4]! | (head[5]! << 8)) > 0) return 'ico';
  if ((ascii(head, 0, 'II') && head[2] === 42 && head[3] === 0) || (ascii(head, 0, 'MM') && head[2] === 0 && head[3] === 42)) return 'tiff';
  if (ascii(head, 0, '8BPS')) return 'psd';
  // SVG is text: skip a byte-order mark, then an <svg> element has to show up near the top.
  const text = new TextDecoder('utf-8').decode(head.subarray(0, Math.min(head.length, SNIFF_BYTES)));
  if (/<svg[\s>]/i.test(text)) return 'svg';
  if (TGA_EXT.test(name) && looksLikeTga(head)) return 'tga';
  return 'unknown';
}

function checkSize(w: number, h: number): void {
  if (!(w > 0 && h > 0)) throw new Error('La imagen no tiene tamaño.');
  if (w * h > DECODE_PIXEL_LIMIT) throw new Error(`La imagen es demasiado grande (${w} × ${h} px; el máximo son ${DECODE_PIXEL_LIMIT / 1e6} megapíxeles).`);
}

// ---- Targa ----------------------------------------------------------------------------------------
/** TGA types 1/9 colour-mapped, 2/10 true colour, 3/11 grey; 9, 10 and 11 are run-length coded. */
export function decodeTga(bytes: Uint8Array): RawImage {
  if (bytes.length < 18) throw new Error('El archivo TGA está incompleto.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLen = bytes[0]!;
  const cmapType = bytes[1]!;
  const type = bytes[2]!;
  const cmapFirst = v.getUint16(3, true);
  const cmapLen = v.getUint16(5, true);
  const cmapDepth = bytes[7]!;
  const width = v.getUint16(12, true);
  const height = v.getUint16(14, true);
  const depth = bytes[16]!;
  const desc = bytes[17]!;
  const rle = type >= 9;
  const kind = type & 7; // 1 mapped, 2 colour, 3 grey
  if (![1, 2, 3].includes(kind) || type > 11) throw new Error(`Tipo de TGA no admitido (${type}).`);
  if (![8, 15, 16, 24, 32].includes(depth)) throw new Error(`Profundidad de TGA no admitida (${depth} bits).`);
  checkSize(width, height);
  const bpp = Math.ceil(depth / 8);
  const alphaBits = desc & 15;

  let at = 18 + idLen;
  let palette: Uint8ClampedArray | null = null;
  if (kind === 1) {
    if (cmapType !== 1 || ![15, 16, 24, 32].includes(cmapDepth)) throw new Error('La paleta del TGA no es válida.');
    const eb = Math.ceil(cmapDepth / 8);
    if (at + cmapLen * eb > bytes.length) throw new Error('El archivo TGA está incompleto.');
    palette = new Uint8ClampedArray((cmapFirst + cmapLen) * 4);
    for (let i = 0; i < cmapLen; i++) writeTgaPixel(bytes, at + i * eb, cmapDepth, desc & 15 || (cmapDepth === 32 ? 8 : 0), palette, (cmapFirst + i) * 4);
    at += cmapLen * eb;
  }
  else if (cmapType === 1) {
    at += cmapLen * Math.ceil(cmapDepth / 8); // unused colour map
  }

  const count = width * height;
  if (rle && count > (bytes.length - at) * 128) throw new Error('El archivo TGA está incompleto.');
  if (!rle && at + count * bpp > bytes.length) throw new Error('El archivo TGA está incompleto.');
  // Pixels in file order; the origin flags are applied afterwards.
  const file = new Uint8ClampedArray(count * 4);
  const put = (src: number, dst: number): void => {
    if (palette) {
      const i = depth === 8 ? bytes[src]! : v.getUint16(src, true);
      if (i * 4 + 3 < palette.length) file.set(palette.subarray(i * 4, i * 4 + 4), dst * 4);
    }
    else if (kind === 3) {
      const g = bytes[src]!;
      file[dst * 4] = file[dst * 4 + 1] = file[dst * 4 + 2] = g;
      file[dst * 4 + 3] = depth === 16 ? bytes[src + 1]! : 255;
    }
    else {
      writeTgaPixel(bytes, src, depth, alphaBits, file, dst * 4);
    }
  };
  if (!rle) {
    for (let i = 0; i < count; i++) put(at + i * bpp, i);
  }
  else {
    let i = 0;
    while (i < count && at < bytes.length) {
      const head = bytes[at++]!;
      const n = Math.min((head & 127) + 1, count - i);
      if (head & 128) {
        if (at + bpp > bytes.length) break;
        for (let k = 0; k < n; k++) put(at, i + k);
        at += bpp;
      }
      else {
        if (at + n * bpp > bytes.length) break;
        for (let k = 0; k < n; k++) put(at + k * bpp, i + k);
        at += n * bpp;
      }
      i += n;
    }
    if (i < count) throw new Error('El archivo TGA está incompleto.');
  }

  const topFirst = (desc & 0x20) !== 0;
  const rightFirst = (desc & 0x10) !== 0;
  if (topFirst && !rightFirst) return { width, height, data: file };
  const data = new Uint8ClampedArray(count * 4);
  for (let y = 0; y < height; y++) {
    const sy = topFirst ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sx = rightFirst ? width - 1 - x : x;
      data.set(file.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** One 15/16/24/32-bit colour at `src`, written as RGBA at `dst`. A pixel has alpha only if the header says it has bits for it. */
function writeTgaPixel(b: Uint8Array, src: number, depth: number, alphaBits: number, out: Uint8ClampedArray, dst: number): void {
  if (depth === 24 || depth === 32) {
    out[dst] = b[src + 2]!;
    out[dst + 1] = b[src + 1]!;
    out[dst + 2] = b[src]!;
    out[dst + 3] = depth === 32 && alphaBits > 0 ? b[src + 3]! : 255;
    return;
  }
  const w = b[src]! | (b[src + 1]! << 8); // A1R5G5B5
  const c5 = (n: number): number => (n << 3) | (n >> 2);
  out[dst] = c5((w >> 10) & 31);
  out[dst + 1] = c5((w >> 5) & 31);
  out[dst + 2] = c5(w & 31);
  out[dst + 3] = alphaBits > 0 && !(w & 0x8000) ? 0 : 255;
}

// ---- TIFF -----------------------------------------------------------------------------------------
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

interface TiffTags {
  width: number;
  height: number;
  bits: number[];
  compression: number;
  photometric: number;
  offsets: number[];
  counts: number[];
  samples: number;
  rowsPerStrip: number;
  planar: number;
  predictor: number;
  colorMap: number[];
  extra: number[];
  format: number[];
  tiled: boolean;
}

function readTags(b: Uint8Array, v: DataView, le: boolean): TiffTags {
  const first = v.getUint32(4, le);
  if (first < 8 || first + 2 > b.length) throw new Error('El TIFF está dañado.');
  const n = v.getUint16(first, le);
  const t: TiffTags = {
    width: 0, height: 0, bits: [1], compression: 1, photometric: -1, offsets: [], counts: [], samples: 1,
    rowsPerStrip: 0xffffffff, planar: 1, predictor: 1, colorMap: [], extra: [], format: [1], tiled: false,
  };
  for (let i = 0; i < n; i++) {
    const e = first + 2 + i * 12;
    if (e + 12 > b.length) throw new Error('El TIFF está dañado.');
    const tag = v.getUint16(e, le);
    const type = v.getUint16(e + 2, le);
    const count = v.getUint32(e + 4, le);
    const size = TYPE_SIZE[type];
    if (!size) continue;
    const total = size * count;
    const base = total <= 4 ? e + 8 : v.getUint32(e + 8, le);
    if (base + total > b.length || count > 0x1000000) throw new Error('El TIFF está dañado.');
    const vals: number[] = [];
    for (let k = 0; k < count; k++) {
      const p = base + k * size;
      vals.push(size === 1 ? b[p]! : size === 2 ? v.getUint16(p, le) : size === 4 ? v.getUint32(p, le) : 0);
    }
    const one = vals[0] ?? 0;
    switch (tag) {
      case 256: t.width = one; break;
      case 257: t.height = one; break;
      case 258: t.bits = vals; break;
      case 259: t.compression = one; break;
      case 262: t.photometric = one; break;
      case 273: t.offsets = vals; break;
      case 277: t.samples = one; break;
      case 278: t.rowsPerStrip = one; break;
      case 279: t.counts = vals; break;
      case 284: t.planar = one; break;
      case 317: t.predictor = one; break;
      case 320: t.colorMap = vals; break;
      case 322: case 323: case 324: case 325: t.tiled = true; break;
      case 338: t.extra = vals; break;
      case 339: t.format = vals; break;
    }
  }
  return t;
}

/** Undo PackBits: a signed count byte, then a literal run (n+1 bytes) or one byte repeated (1-n times). */
function unPackBits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++]! << 24) >> 24;
    if (n >= 0) {
      const len = Math.min(n + 1, src.length - i, expected - o);
      out.set(src.subarray(i, i + len), o);
      i += n + 1;
      o += len;
    }
    else if (n !== -128) {
      const len = Math.min(1 - n, expected - o);
      out.fill(src[i++]!, o, o + len);
      o += len;
    }
  }
  return out;
}

/** TIFF's LZW: codes are 9 to 12 bits, most significant bit first, and the width grows one code early. */
function unLzw(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = first[i] = i;
    length[i] = 1;
  }
  let bits = 0;
  let have = 0;
  let pos = 0;
  let next = 258;
  let width = 9;
  let prev = -1;
  let o = 0;
  const emit = (code: number): boolean => {
    const len = length[code]!;
    if (o + len > expected) return false;
    let c = code;
    for (let i = len - 1; i >= 0; i--) {
      out[o + i] = suffix[c]!;
      c = prefix[c]!;
    }
    o += len;
    return true;
  };
  for (;;) {
    while (have < width && pos < src.length) {
      bits = ((bits << 8) | src[pos++]!) & 0xffffff;
      have += 8;
    }
    if (have < width) break;
    const code = (bits >> (have - width)) & ((1 << width) - 1);
    have -= width;
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    if (prev === -1) {
      if (code > 255 || !emit(code)) break;
      prev = code;
      continue;
    }
    if (code > next || next >= 4096) break; // corrupt stream
    if (code < next) {
      prefix[next] = prev;
      suffix[next] = first[code]!;
    }
    else {
      prefix[next] = prev;
      suffix[next] = first[prev]!;
    }
    length[next] = length[prev]! + 1;
    first[next] = first[prev]!;
    next++;
    if (!emit(code)) break;
    prev = code;
    if (next >= (1 << width) - 1 && width < 12) width++;
  }
  return out;
}

async function inflate(src: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este sistema no puede descomprimir TIFF con Deflate.');
  const stream = new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const got = new Uint8Array(await new Response(stream).arrayBuffer());
  if (got.length >= expected) return got.subarray(0, expected);
  const out = new Uint8Array(expected);
  out.set(got);
  return out;
}

/**
 * Baseline TIFF plus what scanners and editors commonly write: grey, palette, RGB(A) and CMYK at 1, 2, 4, 8 or 16 bits,
 * chunky layout, in strips, uncompressed or PackBits / LZW / Deflate (with horizontal prediction). The first image only.
 */
export async function decodeTiff(bytes: Uint8Array): Promise<RawImage> {
  if (bytes.length < 8) throw new Error('El archivo TIFF está incompleto.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[0] === 0x49;
  const t = readTags(bytes, v, le);
  checkSize(t.width, t.height);
  if (t.tiled) throw new Error('Los TIFF con teselas no están admitidos todavía.');
  if (t.planar !== 1) throw new Error('Los TIFF con canales separados no están admitidos todavía.');
  if (t.format.some((f) => f !== 1)) throw new Error('Los TIFF con valores decimales o con signo no están admitidos.');
  const bps = t.bits[0]!;
  if (!t.bits.every((x) => x === bps) || ![1, 2, 4, 8, 16].includes(bps)) throw new Error(`Profundidad de TIFF no admitida (${t.bits.join('+')} bits).`);
  const spp = t.samples;
  const ph = t.photometric;
  const base = ph === 2 ? 3 : ph === 5 ? 4 : ph === 0 || ph === 1 || ph === 3 ? 1 : 0;
  if (!base || spp < base) throw new Error(`Interpretación de color de TIFF no admitida (${ph}).`);
  if (ph === 3 && t.colorMap.length < 3 * (1 << bps)) throw new Error('La paleta del TIFF no es válida.');
  if (ph !== 1 && ph !== 0 && ph !== 3 && bps < 8) throw new Error('Los TIFF en color de menos de 8 bits no están admitidos.');
  if (t.predictor === 2 ? bps < 8 : t.predictor !== 1) throw new Error('Predicción de TIFF no admitida.');
  const rowBytes = Math.ceil((t.width * spp * bps) / 8);
  const rps = Math.min(t.rowsPerStrip || t.height, t.height);
  const strips = Math.ceil(t.height / rps);
  if (t.offsets.length < strips || t.counts.length < strips) throw new Error('Faltan datos en el TIFF.');
  if (rowBytes * t.height > DECODE_PIXEL_LIMIT * 8) throw new Error('El TIFF es demasiado grande.');

  const raw = new Uint8Array(rowBytes * t.height);
  for (let s = 0; s < strips; s++) {
    const rows = Math.min(rps, t.height - s * rps);
    const want = rows * rowBytes;
    const off = t.offsets[s]!;
    const src = bytes.subarray(off, Math.min(bytes.length, off + t.counts[s]!));
    let strip: Uint8Array;
    switch (t.compression) {
      case 1: strip = src; break;
      case 32773: strip = unPackBits(src, want); break;
      case 5: strip = unLzw(src, want); break;
      case 8: case 32946: strip = await inflate(src, want); break;
      default: throw new Error(`Compresión de TIFF no admitida (${t.compression}).`);
    }
    if (t.predictor === 2) predictRows(strip, rows, t.width, spp, bps, le);
    raw.set(strip.subarray(0, want), s * rps * rowBytes);
  }

  const out = new Uint8ClampedArray(t.width * t.height * 4);
  const rv = new DataView(raw.buffer);
  const max = (1 << bps) - 1;
  const sample = (row: number, i: number): number => {
    if (bps === 8) return raw[row + i]!;
    if (bps === 16) return rv.getUint16(row + i * 2, le);
    const bit = i * bps;
    return (raw[row + (bit >> 3)]! >> (8 - bps - (bit & 7))) & max;
  };
  const to8 = (n: number): number => (bps === 8 ? n : bps === 16 ? n >> 8 : Math.round((n * 255) / max));
  const alphaKind = spp > base ? (t.extra[0] ?? 0) : 0; // 1 associated, 2 unassociated
  for (let y = 0; y < t.height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < t.width; x++) {
      const i = x * spp;
      const o = (y * t.width + x) * 4;
      if (ph === 2) {
        out[o] = to8(sample(row, i));
        out[o + 1] = to8(sample(row, i + 1));
        out[o + 2] = to8(sample(row, i + 2));
      }
      else if (ph === 5) {
        const k = 255 - to8(sample(row, i + 3));
        out[o] = ((255 - to8(sample(row, i))) * k) / 255;
        out[o + 1] = ((255 - to8(sample(row, i + 1))) * k) / 255;
        out[o + 2] = ((255 - to8(sample(row, i + 2))) * k) / 255;
      }
      else if (ph === 3) {
        const idx = sample(row, i);
        const n = 1 << bps;
        out[o] = t.colorMap[idx]! >> 8;
        out[o + 1] = t.colorMap[n + idx]! >> 8;
        out[o + 2] = t.colorMap[2 * n + idx]! >> 8;
      }
      else {
        const g = to8(sample(row, i));
        out[o] = out[o + 1] = out[o + 2] = ph === 0 ? 255 - g : g;
      }
      const a = alphaKind ? to8(sample(row, i + base)) : 255;
      if (alphaKind === 1 && a > 0 && a < 255) {
        for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, (out[o + c]! * 255) / a);
      }
      out[o + 3] = a;
    }
  }
  return { width: t.width, height: t.height, data: out };
}

/** Undo horizontal differencing: every sample is stored as the difference from the same channel of the pixel to its left. */
function predictRows(strip: Uint8Array, rows: number, width: number, spp: number, bps: number, le: boolean): void {
  const rowBytes = (width * spp * bps) / 8;
  const v = new DataView(strip.buffer, strip.byteOffset, strip.byteLength);
  for (let r = 0; r < rows; r++) {
    const row = r * rowBytes;
    if (bps === 8) {
      for (let i = spp; i < width * spp; i++) strip[row + i] = (strip[row + i]! + strip[row + i - spp]!) & 255;
    }
    else {
      for (let i = spp; i < width * spp; i++) {
        const p = row + i * 2;
        v.setUint16(p, (v.getUint16(p, le) + v.getUint16(p - spp * 2, le)) & 0xffff, le);
      }
    }
  }
}

// ---- Netpbm (PBM, PGM, PPM, PAM) ------------------------------------------------------------------
/** P1/P4 bitmap, P2/P5 grey, P3/P6 colour (plain text or binary) and P7 (PAM, with or without alpha); 1 to 16 bits per sample. */
export function decodePnm(bytes: Uint8Array): RawImage {
  if (bytes.length < 3 || bytes[0] !== 0x50) throw new Error('El archivo PNM está incompleto.');
  const kind = bytes[1]! - 0x30;
  if (kind < 1 || kind > 7) throw new Error('El archivo PNM no es válido.');
  let at = 2;
  const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;
  /** The next white-space separated word, skipping # comments to the end of the line. */
  const word = (): string => {
    for (;;) {
      while (at < bytes.length && isSpace(bytes[at]!)) at++;
      if (bytes[at] !== 0x23) break;
      while (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) at++;
    }
    const from = at;
    while (at < bytes.length && !isSpace(bytes[at]!)) at++;
    return new TextDecoder('latin1').decode(bytes.subarray(from, at));
  };
  const int = (s: string): number => {
    if (!/^\d+$/.test(s)) throw new Error('El encabezado del PNM no es válido.');
    return Number(s);
  };

  let width = 0;
  let height = 0;
  let maxval = 1;
  let depth = kind === 3 || kind === 6 ? 3 : 1;
  if (kind === 7) {
    maxval = 0;
    depth = 0;
    for (;;) {
      const key = word();
      if (key === 'ENDHDR') break;
      if (!key) throw new Error('El encabezado del PAM está incompleto.');
      if (key === 'TUPLTYPE') {
        word();
        continue;
      }
      const val = int(word());
      if (key === 'WIDTH') width = val;
      else if (key === 'HEIGHT') height = val;
      else if (key === 'DEPTH') depth = val;
      else if (key === 'MAXVAL') maxval = val;
    }
    at++; // the single new line after ENDHDR
  }
  else {
    width = int(word());
    height = int(word());
    if (kind !== 1 && kind !== 4) maxval = int(word());
    if (kind >= 4) at++; // one white-space byte before binary data
  }
  checkSize(width, height);
  if (maxval < 1 || maxval > 65535) throw new Error('El valor máximo del PNM no es válido.');
  if (kind === 7 && (depth < 1 || depth > 4)) throw new Error('El PAM tiene un número de canales no admitido.');
  const wide = maxval > 255;
  const out = new Uint8ClampedArray(width * height * 4);
  const incomplete = (): Error => new Error('El archivo PNM está incompleto.');

  // The next sample of the pixel being read, 0..maxval.
  let next: () => number;
  if (kind === 1) {
    next = () => {
      while (at < bytes.length && isSpace(bytes[at]!)) at++;
      const c = bytes[at++];
      if (c !== 0x30 && c !== 0x31) throw incomplete();
      return c === 0x31 ? 1 : 0; // 1 is black
    };
  }
  else if (kind === 2 || kind === 3) {
    next = () => {
      const w = word();
      if (!w) throw incomplete();
      return Math.min(maxval, int(w));
    };
  }
  else if (kind === 4) {
    const rowBytes = Math.ceil(width / 8);
    if (at + rowBytes * height > bytes.length) throw incomplete();
    let n = 0;
    next = () => {
      const x = n % width;
      const y = (n - x) / width;
      n++;
      return (bytes[at + y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
    };
  }
  else {
    if (at + width * height * depth * (wide ? 2 : 1) > bytes.length) throw incomplete();
    next = () => {
      if (!wide) return bytes[at++]!;
      const val = (bytes[at]! << 8) | bytes[at + 1]!;
      at += 2;
      return val;
    };
  }
  const to8 = (val: number): number => (maxval === 255 ? val : Math.round((val * 255) / maxval));
  const bitmap = kind === 1 || kind === 4;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (bitmap) {
      out[o] = out[o + 1] = out[o + 2] = next() ? 0 : 255;
      out[o + 3] = 255;
      continue;
    }
    const c = Array.from({ length: depth }, () => to8(next()));
    if (depth >= 3) {
      out[o] = c[0]!;
      out[o + 1] = c[1]!;
      out[o + 2] = c[2]!;
      out[o + 3] = depth === 4 ? c[3]! : 255;
    }
    else {
      out[o] = out[o + 1] = out[o + 2] = c[0]!;
      out[o + 3] = depth === 2 ? c[1]! : 255;
    }
  }
  return { width, height, data: out };
}

// ---- QOI ------------------------------------------------------------------------------------------
/** "Quite OK Image": a 14-byte header, then a stream of small ops (index, delta, luma, run, plain RGB / RGBA). */
export function decodeQoi(bytes: Uint8Array): RawImage {
  if (bytes.length < 14 + 8 || !ascii(bytes, 0, 'qoif')) throw new Error('El archivo QOI está incompleto.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = v.getUint32(4);
  const height = v.getUint32(8);
  const channels = bytes[12]!;
  if (channels !== 3 && channels !== 4) throw new Error(`Número de canales de QOI no válido (${channels}).`);
  checkSize(width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  const seen = new Uint8Array(64 * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;
  let p = 14;
  let run = 0;
  const end = bytes.length - 8;
  for (let o = 0; o < out.length; o += 4) {
    if (run > 0) {
      run--;
    }
    else {
      if (p >= end) throw new Error('El archivo QOI está incompleto.');
      const t = bytes[p++]!;
      if (t === 0xfe) {
        r = bytes[p]!;
        g = bytes[p + 1]!;
        b = bytes[p + 2]!;
        p += 3;
      }
      else if (t === 0xff) {
        r = bytes[p]!;
        g = bytes[p + 1]!;
        b = bytes[p + 2]!;
        a = bytes[p + 3]!;
        p += 4;
      }
      else if ((t & 0xc0) === 0x00) {
        const i = (t & 63) * 4;
        r = seen[i]!;
        g = seen[i + 1]!;
        b = seen[i + 2]!;
        a = seen[i + 3]!;
      }
      else if ((t & 0xc0) === 0x40) {
        r = (r + ((t >> 4) & 3) - 2) & 255;
        g = (g + ((t >> 2) & 3) - 2) & 255;
        b = (b + (t & 3) - 2) & 255;
      }
      else if ((t & 0xc0) === 0x80) {
        const d = bytes[p++]!;
        const dg = (t & 63) - 32;
        r = (r + dg - 8 + ((d >> 4) & 15)) & 255;
        g = (g + dg) & 255;
        b = (b + dg - 8 + (d & 15)) & 255;
      }
      else {
        run = t & 63;
      }
      const h = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4;
      seen[h] = r;
      seen[h + 1] = g;
      seen[h + 2] = b;
      seen[h + 3] = a;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return { width, height, data: out };
}

// ---- PCX ------------------------------------------------------------------------------------------
/** ZSoft PCX: run-length coded scanlines of 1 to 4 planes at 1, 2, 4 or 8 bits (grey, palette or 24-bit colour). */
export function decodePcx(bytes: Uint8Array): RawImage {
  if (bytes.length < 128) throw new Error('El archivo PCX está incompleto.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bpp = bytes[3]!;
  const width = v.getUint16(8, true) - v.getUint16(4, true) + 1;
  const height = v.getUint16(10, true) - v.getUint16(6, true) + 1;
  const planes = bytes[65]!;
  const stride = v.getUint16(66, true); // bytes per plane per line
  if (![1, 2, 4, 8].includes(bpp) || planes < 1 || planes > 4) throw new Error('Formato de PCX no admitido.');
  checkSize(width, height);
  if (stride * 8 < width * bpp) throw new Error('El PCX no es válido.');
  const lineLen = stride * planes;

  // 256-colour palette: 0x0C and 768 bytes at the very end.
  let palette256: Uint8Array | null = null;
  if (bpp === 8 && planes === 1 && bytes.length >= 129 + 768 && bytes[bytes.length - 769] === 0x0c) palette256 = bytes.subarray(bytes.length - 768);

  const out = new Uint8ClampedArray(width * height * 4);
  const line = new Uint8Array(lineLen);
  let at = 128;
  for (let y = 0; y < height; y++) {
    let n = 0;
    while (n < lineLen) {
      if (at >= bytes.length) throw new Error('El archivo PCX está incompleto.');
      let c = bytes[at++]!;
      let rep = 1;
      if ((c & 0xc0) === 0xc0) {
        rep = c & 0x3f;
        if (at >= bytes.length) throw new Error('El archivo PCX está incompleto.');
        c = bytes[at++]!;
      }
      for (let k = 0; k < rep && n < lineLen; k++) line[n++] = c;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o + 3] = 255;
      if (bpp === 8 && planes >= 3) {
        out[o] = line[x]!;
        out[o + 1] = line[stride + x]!;
        out[o + 2] = line[2 * stride + x]!;
        if (planes === 4) out[o + 3] = line[3 * stride + x]!;
        continue;
      }
      // Palette index: the bits of every plane side by side.
      let idx = 0;
      for (let p = 0; p < planes; p++) {
        const bit = x * bpp;
        const byte = line[p * stride + (bit >> 3)]!;
        idx |= ((byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)) << (p * bpp);
      }
      let rgb: [number, number, number];
      if (palette256) rgb = [palette256[idx * 3]!, palette256[idx * 3 + 1]!, palette256[idx * 3 + 2]!];
      else if (bpp === 8) rgb = [idx, idx, idx]; // no palette: grey
      else if (bpp === 1 && planes === 1 && bytes.subarray(16, 22).every((q) => q === 0)) rgb = [idx * 255, idx * 255, idx * 255]; // monochrome
      else {
        const k = 16 + (idx & 15) * 3; // the 16-colour palette in the header
        rgb = [bytes[k]!, bytes[k + 1]!, bytes[k + 2]!];
      }
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
    }
  }
  return { width, height, data: out };
}
