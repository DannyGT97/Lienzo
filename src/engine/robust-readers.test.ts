/**
 * Every reader of a file format is fed damaged copies of a good file (cut short, bytes changed, sizes set to extremes). Whatever
 * is wrong with a file, the reader must answer with an Error that has words for the person, quickly, and never anything else
 * (a string, or the engine's own "Offset is outside the bounds of the DataView"). Nothing here is random: the same copies each run.
 */
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { decodePcx, decodePnm, decodeQoi, decodeTga, decodeTiff } from './image-decode';
import { encodeTga, encodeTiff } from './image-formats';
import { loadLienzo, saveLienzo } from './lienzo-file';
import { exportOra, importOra, readOraPreview, type OraCodecs } from './ora-file';
import { exportPsd, importPsd, readPsdPreview } from './psd';
import { SqliteDb } from './sqlite-read';
import { fillLayer, setPixel } from './test-utils';
import { readZip, writeZip } from './zip';

const codecs: OraCodecs = {
  async encodePng(w, h, rgba) {
    const out = new Uint8Array(8 + rgba.length);
    new DataView(out.buffer).setUint32(0, w);
    new DataView(out.buffer).setUint32(4, h);
    out.set(rgba, 8);
    return out;
  },
  async decodePng(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(0), height: dv.getUint32(4), data: new Uint8ClampedArray(bytes.slice(8)) };
  },
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Damaged copies of `seed`: cut short, a few bytes changed, four bytes set to 0 or 255, and changes in the header. */
function damaged(seed: Uint8Array, n: number): Uint8Array[] {
  const r = rng(12345);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    let b = seed.slice();
    const kind = i % 4;
    if (kind === 0) b = seed.slice(0, Math.floor(r() * seed.length));
    else if (kind === 1) for (let k = 0; k < 1 + Math.floor(r() * 8); k++) b[Math.floor(r() * b.length)] = Math.floor(r() * 256);
    else if (kind === 2) {
      const at = Math.floor(r() * Math.max(1, b.length - 4));
      const v = r() < 0.5 ? 0xff : 0;
      for (let k = 0; k < 4; k++) b[at + k] = v;
    } else for (let k = 0; k < 3; k++) b[Math.floor(r() * Math.min(128, b.length))] = Math.floor(r() * 256);
    out.push(b);
  }
  return out;
}

async function expectOnlyCleanErrors(name: string, seed: Uint8Array, read: (bytes: Uint8Array) => unknown, n = 400): Promise<void> {
  const notErrors: string[] = [];
  const engineErrors = new Set<string>();
  let slowest = 0;
  for (const bytes of damaged(seed, n)) {
    const t0 = performance.now();
    try {
      await read(bytes);
    } catch (err) {
      if (!(err instanceof Error)) notErrors.push(String(err).slice(0, 60));
      else if (/^(TypeError|RangeError|ReferenceError|SyntaxError)$/.test(err.constructor.name)) engineErrors.add(`${err.constructor.name}: ${err.message}`);
    }
    slowest = Math.max(slowest, performance.now() - t0);
  }
  expect(notErrors, `${name}: thrown values that are not Errors`).toEqual([]);
  expect([...engineErrors], `${name}: the engine's own errors reach the person`).toEqual([]);
  expect(slowest, `${name}: a damaged file took too long`).toBeLessThan(2000);
}

const rgba = (w: number, h: number): Uint8ClampedArray => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i++) a[i] = (i * 37) & 255;
  return a;
};

describe('readers of damaged files', () => {
  it('.lienzo', async () => {
    const doc = createDocument(300, 200, 300);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    setPixel(addLayer(doc, 'Tinta'), 5, 5, [1, 2, 3, 255]);
    const seed = new Uint8Array(await (await saveLienzo(doc)).arrayBuffer());
    await expectOnlyCleanErrors('lienzo', seed, (b) => loadLienzo(new Blob([b])));
  }, 60000);

  it('PSD', async () => {
    const doc = createDocument(40, 30);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    setPixel(addLayer(doc, 'X'), 3, 3, [9, 9, 9, 255]);
    const seed = new Uint8Array((await exportPsd(doc)).value as ArrayBuffer);
    await expectOnlyCleanErrors('psd import', seed, (b) => importPsd(b.slice().buffer));
    await expectOnlyCleanErrors('psd preview', seed, (b) => readPsdPreview(b.slice().buffer), 200);
  }, 60000);

  it('OpenRaster and ZIP', async () => {
    const doc = createDocument(20, 10, 300);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    setPixel(addLayer(doc, 'X'), 3, 3, [9, 9, 9, 255]);
    const seed = (await exportOra(doc, codecs)).value as Uint8Array;
    await expectOnlyCleanErrors('ora import', seed, (b) => importOra(b, codecs));
    await expectOnlyCleanErrors('ora preview', seed, (b) => readOraPreview(b), 200);
    const zip = writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello hello hello hello') }, { name: 'b/c.bin', data: new Uint8Array(500).fill(7) }]);
    await expectOnlyCleanErrors('zip', zip, (b) => readZip(b));
  }, 60000);

  it('picture formats', async () => {
    await expectOnlyCleanErrors('tga', encodeTga(8, 6, rgba(8, 6)), (b) => decodeTga(b));
    await expectOnlyCleanErrors('tiff', encodeTiff(8, 6, rgba(8, 6)), (b) => decodeTiff(b));
    await expectOnlyCleanErrors('pnm', new TextEncoder().encode('P6\n4 2\n255\nabcdefghijklmnopqrstuvwx'), (b) => decodePnm(b));
    const qoi = new Uint8Array([0x71, 0x6f, 0x69, 0x66, 0, 0, 0, 2, 0, 0, 0, 2, 4, 0, 0xff, 1, 2, 3, 4, 0xc1, 0, 0, 0, 0, 0, 0, 0, 1]);
    await expectOnlyCleanErrors('qoi', qoi, (b) => decodeQoi(b));
    const pcx = new Uint8Array(128 + 64);
    pcx.set([10, 5, 1, 8, 0, 0, 0, 0, 3, 0, 1, 0]);
    pcx[65] = 3;
    pcx[66] = 4;
    pcx.set([0xc3, 5, 0xc3, 6, 0xc3, 7, 0xc3, 8], 128);
    await expectOnlyCleanErrors('pcx', pcx, (b) => decodePcx(b));
  }, 60000);

  it('SQLite (inside .clip files)', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE t (a INTEGER, b TEXT, c BLOB); INSERT INTO t VALUES (1, 'hola', x'0102'), (2, 'x', NULL);");
    await expectOnlyCleanErrors('sqlite', db.export(), (b) => {
      const d = new SqliteDb(b);
      d.tables();
      return d.rows('t');
    });
  }, 60000);
});
