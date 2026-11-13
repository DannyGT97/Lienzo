import { describe, expect, it } from 'vitest';
import { DECODE_PIXEL_LIMIT, decodePcx, decodePnm, decodeQoi, decodeTga, decodeTiff, sniffImage } from './image-decode';
import { encodeBmp, encodeTga, encodeTiff } from './image-formats';

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);

/** A 3×2 picture with distinct pixels, including a translucent one. */
const sample = (): Uint8ClampedArray => Uint8ClampedArray.from([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
  10, 20, 30, 128, 200, 100, 50, 255, 0, 0, 0, 0,
]);

describe('sniffImage', () => {
  it('recognises formats by their bytes, not their names', () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10))).toBe('png');
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBe('gif');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImage(new TextEncoder().encode('\0\0\0\x1cftypavif'))).toBe('avif');
    expect(sniffImage(encodeBmp(2, 2, new Uint8ClampedArray(16)), 'x.png')).toBe('bmp');
    expect(sniffImage(bytes(0, 0, 1, 0, 1, 0))).toBe('ico');
    expect(sniffImage(encodeTiff(1, 1, new Uint8ClampedArray(4)))).toBe('tiff');
    expect(sniffImage(bytes(0x4d, 0x4d, 0, 42))).toBe('tiff');
    expect(sniffImage(new TextEncoder().encode('8BPS\0\x01'))).toBe('psd');
  });

  it('finds SVG after a prolog and rejects other text', () => {
    expect(sniffImage(new TextEncoder().encode('﻿<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x"/>'))).toBe('svg');
    expect(sniffImage(new TextEncoder().encode('hello world'))).toBe('unknown');
  });

  it('accepts a Targa only when the header is plausible and the name agrees', () => {
    const tga = encodeTga(2, 2, new Uint8ClampedArray(16));
    expect(sniffImage(tga, 'pic.TGA')).toBe('tga');
    expect(sniffImage(tga, 'pic.dat')).toBe('unknown');
    expect(sniffImage(new Uint8Array(40), 'pic.tga')).toBe('unknown');
  });
});

describe('decodeTga', () => {
  it('round-trips the encoder output', () => {
    const img = decodeTga(encodeTga(3, 2, sample()));
    expect([img.width, img.height]).toEqual([3, 2]);
    expect(Array.from(img.data)).toEqual(Array.from(sample()));
  });

  it('flips a bottom-up file and ignores the alpha channel when it declares no alpha bits', () => {
    const f = new Uint8Array(18 + 2 * 4);
    f[2] = 2;
    f[12] = 1;
    f[14] = 2;
    f[16] = 32;
    f[17] = 0; // bottom-left origin, 0 alpha bits
    f.set([1, 2, 3, 0], 18); // bottom row (B G R x)
    f.set([4, 5, 6, 0], 22); // top row
    const img = decodeTga(f);
    expect(Array.from(img.data)).toEqual([6, 5, 4, 255, 3, 2, 1, 255]);
  });

  it('expands run-length coded colour', () => {
    const f = new Uint8Array(18 + 2 + 3 + 1 + 6);
    f[2] = 10;
    f[12] = 4;
    f[14] = 1;
    f[16] = 24;
    f[17] = 0x20;
    f.set([0x82, 9, 8, 7], 18); // run of 3 identical pixels
    f.set([0x00, 1, 2, 3], 22); // one raw pixel
    const img = decodeTga(f.subarray(0, 26));
    expect(Array.from(img.data)).toEqual([7, 8, 9, 255, 7, 8, 9, 255, 7, 8, 9, 255, 3, 2, 1, 255]);
  });

  it('reads a colour-mapped file', () => {
    const f = new Uint8Array(18 + 6 + 2);
    f[1] = 1;
    f[2] = 1;
    f[5] = 2; // two palette entries
    f[7] = 24;
    f[12] = 2;
    f[14] = 1;
    f[16] = 8;
    f[17] = 0x20;
    f.set([0, 0, 255, 255, 0, 0], 18); // red, blue as BGR
    f.set([1, 0], 24);
    expect(Array.from(decodeTga(f).data)).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
  });

  it('reads 16-bit pixels and grey', () => {
    const a = new Uint8Array(18 + 2);
    a[2] = 2;
    a[12] = 1;
    a[14] = 1;
    a[16] = 16;
    a[17] = 0x20;
    a.set([0x1f, 0x00], 18); // blue 31
    expect(Array.from(decodeTga(a).data)).toEqual([0, 0, 255, 255]);
    const g = new Uint8Array(18 + 1);
    g[2] = 3;
    g[12] = 1;
    g[14] = 1;
    g[16] = 8;
    g[17] = 0x20;
    g[18] = 77;
    expect(Array.from(decodeTga(g).data)).toEqual([77, 77, 77, 255]);
  });

  it('refuses truncated, unsupported and oversized files', () => {
    expect(() => decodeTga(encodeTga(4, 4, new Uint8ClampedArray(64)).subarray(0, 30))).toThrow(/incompleto/);
    const bad = encodeTga(1, 1, new Uint8ClampedArray(4));
    bad[16] = 12;
    expect(() => decodeTga(bad)).toThrow(/Profundidad/);
    const huge = encodeTga(1, 1, new Uint8ClampedArray(4));
    huge[12] = huge[13] = huge[14] = huge[15] = 0xff;
    expect(0xffff * 0xffff).toBeGreaterThan(DECODE_PIXEL_LIMIT);
    expect(() => decodeTga(huge)).toThrow(/demasiado grande/);
  });
});

/** A small TIFF writer for the layouts `encodeTiff` does not produce. */
interface TiffSpec {
  width: number;
  height: number;
  bits: number;
  samples: number;
  photometric: number;
  compression?: number;
  predictor?: number;
  data: Uint8Array;
  colorMap?: number[];
  extra?: number;
  bigEndian?: boolean;
  rowsPerStrip?: number;
}

function makeTiff(s: TiffSpec): Uint8Array {
  const le = !s.bigEndian;
  const entries: [number, number, number, number | number[]][] = [
    [256, 4, 1, s.width], [257, 4, 1, s.height],
    [258, 3, s.samples, s.samples === 1 ? s.bits : Array.from({ length: s.samples }, () => s.bits)],
    [259, 3, 1, s.compression ?? 1], [262, 3, 1, s.photometric],
    [273, 4, 1, 0], [277, 3, 1, s.samples], [278, 4, 1, s.rowsPerStrip ?? s.height], [279, 4, 1, s.data.length],
  ];
  if (s.predictor) entries.push([317, 3, 1, s.predictor]);
  if (s.colorMap) entries.push([320, 3, s.colorMap.length, s.colorMap]);
  if (s.extra !== undefined) entries.push([338, 3, 1, s.extra]);
  entries.sort((a, b) => a[0] - b[0]);
  const ifd = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let spill = ifd + ifdSize;
  const spillAt: number[] = [];
  for (const e of entries) {
    const n = Array.isArray(e[3]) ? e[3].length : 1;
    const size = n * (e[1] === 3 ? 2 : 4);
    spillAt.push(size > 4 ? spill : -1);
    if (size > 4) spill += size;
  }
  const dataAt = spill;
  const out = new Uint8Array(dataAt + s.data.length);
  const v = new DataView(out.buffer);
  out[0] = out[1] = le ? 0x49 : 0x4d;
  v.setUint16(2, 42, le);
  v.setUint32(4, ifd, le);
  v.setUint16(ifd, entries.length, le);
  entries.forEach((e, i) => {
    const at = ifd + 2 + i * 12;
    const vals = Array.isArray(e[3]) ? e[3] : [e[3]];
    v.setUint16(at, e[0], le);
    v.setUint16(at + 2, e[1], le);
    v.setUint32(at + 4, vals.length, le);
    const put = (p: number, n: number): void => (e[1] === 3 ? v.setUint16(p, n, le) : v.setUint32(p, n, le));
    if (e[0] === 273) {
      v.setUint32(at + 8, dataAt, le);
      return;
    }
    if (spillAt[i]! >= 0) {
      v.setUint32(at + 8, spillAt[i]!, le);
      vals.forEach((n, k) => put(spillAt[i]! + k * (e[1] === 3 ? 2 : 4), n));
    }
    else {
      vals.forEach((n, k) => put(at + 8 + k * (e[1] === 3 ? 2 : 4), n));
    }
  });
  out.set(s.data, dataAt);
  return out;
}

/** The encoder half of TIFF's LZW, enough to produce a stream for the decoder to read. */
function lzwEncode(src: Uint8Array): Uint8Array {
  const bits: number[] = [];
  let width = 9;
  const emit = (code: number): void => {
    for (let i = width - 1; i >= 0; i--) bits.push((code >> i) & 1);
  };
  let table = new Map<string, number>();
  let next = 258;
  emit(256);
  let cur = '';
  for (const b of src) {
    const ext = cur + String.fromCharCode(b);
    if (ext.length === 1 || table.has(ext)) {
      cur = ext;
      continue;
    }
    emit(cur.length === 1 ? cur.charCodeAt(0) : table.get(cur)!);
    table.set(ext, next++);
    if (next === (1 << width) - 1 && width < 12) width++;
    if (next >= 4093) {
      emit(256);
      table = new Map();
      next = 258;
      width = 9;
    }
    cur = String.fromCharCode(b);
  }
  if (cur) emit(cur.length === 1 ? cur.charCodeAt(0) : table.get(cur)!);
  emit(257);
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => {
    if (bit) out[i >> 3]! |= 0x80 >> (i & 7);
  });
  return out;
}

describe('decodeTiff', () => {
  it('round-trips the encoder output', async () => {
    const img = await decodeTiff(encodeTiff(3, 2, sample()));
    expect([img.width, img.height]).toEqual([3, 2]);
    expect(Array.from(img.data)).toEqual(Array.from(sample()));
  });

  it('reads big-endian RGB without alpha', async () => {
    const img = await decodeTiff(makeTiff({ width: 2, height: 1, bits: 8, samples: 3, photometric: 2, bigEndian: true, data: bytes(1, 2, 3, 4, 5, 6) }));
    expect(Array.from(img.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('un-premultiplies associated alpha', async () => {
    const img = await decodeTiff(makeTiff({ width: 1, height: 1, bits: 8, samples: 4, photometric: 2, extra: 1, data: bytes(50, 25, 0, 100) }));
    expect(Array.from(img.data)).toEqual([128, 64, 0, 100]);
  });

  it('reads white-is-zero grey at 1 bit', async () => {
    const img = await decodeTiff(makeTiff({ width: 3, height: 1, bits: 1, samples: 1, photometric: 0, data: bytes(0b10100000) }));
    expect(Array.from(img.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('maps palette indexes through the 16-bit colour map', async () => {
    const map = [0, 0xffff, ...Array(2).fill(0), 0xffff, 0, ...Array(2).fill(0), 0, 0xffff, ...Array(2).fill(0)];
    // 4 entries per channel at 2 bits: red = [0, ffff, 0, 0], green = [0, 0, ffff, 0], blue = [0, 0, 0, ffff]
    const img = await decodeTiff(makeTiff({
      width: 4, height: 1, bits: 2, samples: 1, photometric: 3, data: bytes(0b00011011),
      colorMap: [0, 0xffff, 0, 0, 0, 0, 0xffff, 0, 0, 0, 0, 0xffff],
    }));
    expect(map.length).toBe(12);
    expect(Array.from(img.data)).toEqual([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it('reads CMYK', async () => {
    const img = await decodeTiff(makeTiff({ width: 2, height: 1, bits: 8, samples: 4, photometric: 5, data: bytes(0, 0, 0, 0, 255, 0, 0, 0) }));
    expect(Array.from(img.data)).toEqual([255, 255, 255, 255, 0, 255, 255, 255]);
  });

  it('keeps the high byte of 16-bit samples', async () => {
    const d = new Uint8Array(6);
    new DataView(d.buffer).setUint16(0, 0xff80, true);
    const img = await decodeTiff(makeTiff({ width: 1, height: 1, bits: 16, samples: 3, photometric: 2, data: d }));
    expect(Array.from(img.data)).toEqual([255, 0, 0, 255]);
  });

  it('decodes PackBits', async () => {
    // run of three 7s, then a literal 1 2 3, per sample row of 6 grey bytes
    const packed = bytes(0xfe, 7, 0x02, 1, 2, 3);
    const img = await decodeTiff(makeTiff({ width: 6, height: 1, bits: 8, samples: 1, photometric: 1, compression: 32773, data: packed }));
    expect(Array.from(img.data).filter((_, i) => i % 4 === 0)).toEqual([7, 7, 7, 1, 2, 3]);
  });

  it('decodes LZW, with horizontal prediction, across several strips', async () => {
    const w = 40;
    const h = 30;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7 + (i >> 5)) & 255;
    const strips: Uint8Array[] = [];
    const rps = 12;
    for (let y = 0; y < h; y += rps) {
      const rows = Math.min(rps, h - y);
      const part = rgb.slice(y * w * 3, (y + rows) * w * 3);
      for (let r = 0; r < rows; r++) {
        for (let i = w * 3 - 1; i >= 3; i--) part[r * w * 3 + i] = (part[r * w * 3 + i]! - part[r * w * 3 + i - 3]!) & 255;
      }
      strips.push(lzwEncode(part));
    }
    // makeTiff writes one strip; build the multi-strip variant by pointing the tables at each piece.
    const joined = new Uint8Array(strips.reduce((n, s) => n + s.length, 0));
    let at = 0;
    for (const s of strips) {
      joined.set(s, at);
      at += s.length;
    }
    const base = makeTiff({ width: w, height: h, bits: 8, samples: 3, photometric: 2, compression: 5, predictor: 2, rowsPerStrip: rps, data: joined });
    const v = new DataView(base.buffer);
    const dataAt = base.length - joined.length;
    // Rewrite tags 273 and 279 as arrays stored right after the data.
    const extended = new Uint8Array(base.length + strips.length * 8);
    extended.set(base);
    const ev = new DataView(extended.buffer);
    const ifd = v.getUint32(4, true);
    const n = v.getUint16(ifd, true);
    const tableAt = base.length;
    let off = dataAt;
    strips.forEach((s, i) => {
      ev.setUint32(tableAt + i * 4, off, true);
      ev.setUint32(tableAt + strips.length * 4 + i * 4, s.length, true);
      off += s.length;
    });
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = v.getUint16(e, true);
      if (tag === 273 || tag === 279) {
        ev.setUint32(e + 4, strips.length, true);
        ev.setUint32(e + 8, tableAt + (tag === 273 ? 0 : strips.length * 4), true);
      }
    }
    const img = await decodeTiff(extended);
    const got = Array.from(img.data).filter((_, i) => i % 4 !== 3);
    expect(got).toEqual(Array.from(rgb));
  });

  it('refuses what it cannot read instead of guessing', async () => {
    await expect(decodeTiff(bytes(0x49, 0x49, 42, 0))).rejects.toThrow(/incompleto/);
    const jpeg = makeTiff({ width: 1, height: 1, bits: 8, samples: 3, photometric: 2, compression: 7, data: bytes(1, 2, 3) });
    await expect(decodeTiff(jpeg)).rejects.toThrow(/Compresión/);
    const f32 = makeTiff({ width: 1, height: 1, bits: 32, samples: 1, photometric: 1, data: bytes(0, 0, 0, 0) });
    await expect(decodeTiff(f32)).rejects.toThrow(/Profundidad/);
  });
});

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('sniffImage (more formats)', () => {
  it('tells Netpbm, QOI, JPEG XL and PCX apart', () => {
    expect(sniffImage(text('P6\n1 1\n255\n'))).toBe('pnm');
    expect(sniffImage(text('P7\nWIDTH 1'))).toBe('pnm');
    expect(sniffImage(text('P8\n'))).toBe('unknown');
    expect(sniffImage(text('Plain text'))).toBe('unknown');
    expect(sniffImage(text('qoif\0\0\0\x01'))).toBe('qoi');
    expect(sniffImage(bytes(0xff, 0x0a, 0))).toBe('jxl');
    expect(sniffImage(join(bytes(0, 0, 0, 0x0c), text('JXL \r\n\x87\n')))).toBe('jxl');
    const pcx = new Uint8Array(128);
    pcx.set([0x0a, 5, 1, 8, 0, 0, 0, 0, 1, 0, 0, 0], 0);
    pcx[65] = 3;
    expect(sniffImage(pcx, 'a.pcx')).toBe('pcx');
    expect(sniffImage(pcx, 'a.dat')).toBe('unknown');
  });
});

describe('decodePnm', () => {
  it('reads plain and binary colour, with comments', () => {
    const plain = decodePnm(text('P3\n# a comment\n2 1\n255\n255 0 0  0 255 0\n'));
    expect(Array.from(plain.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    const bin = decodePnm(join(text('P6 2 1 255\n'), bytes(1, 2, 3, 4, 5, 6)));
    expect(Array.from(bin.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('scales other depths to 8 bits', () => {
    const grey = decodePnm(join(text('P5\n2 1\n15\n'), bytes(0, 15)));
    expect(Array.from(grey.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    const wide = decodePnm(join(text('P5\n1 1\n65535\n'), bytes(0x80, 0x00)));
    expect(wide.data[0]).toBe(128);
  });

  it('reads bitmaps, where 1 is black', () => {
    const plain = decodePnm(text('P1\n3 1\n1 0 1\n'));
    expect(Array.from(plain.data).filter((_, i) => i % 4 === 0)).toEqual([0, 255, 0]);
    const bin = decodePnm(join(text('P4\n3 1\n'), bytes(0b10100000)));
    expect(Array.from(bin.data).filter((_, i) => i % 4 === 0)).toEqual([0, 255, 0]);
  });

  it('reads PAM with alpha', () => {
    const img = decodePnm(join(text('P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n'), bytes(9, 8, 7, 6)));
    expect(Array.from(img.data)).toEqual([9, 8, 7, 6]);
  });

  it('refuses a broken file', () => {
    expect(() => decodePnm(join(text('P6\n2 2\n255\n'), bytes(1, 2, 3)))).toThrow(/incompleto/);
    expect(() => decodePnm(text('P3\n2 x\n'))).toThrow(/encabezado/);
    expect(() => decodePnm(text('P6\n100000 100000\n255\n'))).toThrow(/demasiado grande/);
  });
});

describe('decodeQoi', () => {
  const qoi = (w: number, h: number, ...ops: number[]): Uint8Array => {
    const head = new Uint8Array(14);
    head.set(text('qoif'), 0);
    new DataView(head.buffer).setUint32(4, w);
    new DataView(head.buffer).setUint32(8, h);
    head[12] = 4;
    return join(head, bytes(...ops), bytes(0, 0, 0, 0, 0, 0, 0, 1));
  };

  it('reads RGB, RGBA, run and index ops', () => {
    // red; the same again (run of 1); translucent (10,20,30,128); red again from the index (slot 50).
    const img = decodeQoi(qoi(2, 2, 0xfe, 255, 0, 0, 0xc0, 0xff, 10, 20, 30, 128, 0x32));
    expect(Array.from(img.data)).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 10, 20, 30, 128, 255, 0, 0, 255]);
  });

  it('reads delta and luma ops', () => {
    // From (0,0,0,255): delta (+1, 0, -1), then luma dg=+2 with dr-dg=+1 and db-dg=-1.
    const img = decodeQoi(qoi(2, 1, 0x40 | (3 << 4) | (2 << 2) | 1, 0x80 | (32 + 2), (9 << 4) | 7));
    expect(Array.from(img.data)).toEqual([1, 0, 255, 255, 4, 2, 0, 255]);
  });

  it('refuses a truncated or odd file', () => {
    expect(() => decodeQoi(qoi(4, 4, 0xfe, 1, 2, 3))).toThrow(/incompleto/);
    const bad = qoi(1, 1, 0xfe, 1, 2, 3);
    bad[12] = 2;
    expect(() => decodeQoi(bad)).toThrow(/canales/);
  });
});

describe('decodePcx', () => {
  const header = (w: number, h: number, bpp: number, planes: number, stride: number): Uint8Array => {
    const f = new Uint8Array(128);
    f.set([0x0a, 5, 1, bpp], 0);
    f[8] = (w - 1) & 255;
    f[9] = (w - 1) >> 8;
    f[10] = (h - 1) & 255;
    f[11] = (h - 1) >> 8;
    f[65] = planes;
    f[66] = stride & 255;
    f[67] = stride >> 8;
    return f;
  };

  it('reads 24-bit colour in planes', () => {
    // R: 255 0, G: 0 255, B: 0 0 - the 255s need the run escape.
    const img = decodePcx(join(header(2, 1, 8, 3, 2), bytes(0xc1, 255, 0, 0, 0xc1, 255, 0, 0)));
    expect(Array.from(img.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('reads a 256-colour palette at the end', () => {
    const pal = new Uint8Array(768);
    pal.set([1, 2, 3, 4, 5, 6], 0);
    const img = decodePcx(join(header(2, 1, 8, 1, 2), bytes(0, 1), bytes(0x0c), pal));
    expect(Array.from(img.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('reads monochrome as black and white', () => {
    const img = decodePcx(join(header(3, 1, 1, 1, 2), bytes(0b01000000, 0)));
    expect(Array.from(img.data).filter((_, i) => i % 4 === 0)).toEqual([0, 255, 0]);
  });

  it('refuses a truncated file', () => {
    expect(() => decodePcx(join(header(2, 2, 8, 3, 2), bytes(1, 2)))).toThrow(/incompleto/);
  });
});
