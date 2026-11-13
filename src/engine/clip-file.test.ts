import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { adler32, buildBlockSet, buildCsf, buildExta, deflateBlock, encodeBlock, parseBlockSet, parseCsf, parseExta } from './clip-csf';
import { clipOriginOf, decodeBlockPixels, encodeBlockPixels, importClip, looksLikeClip } from './clip-file';
import { exportClip, canWriteClip, type ClipWriteCodecs } from './clip-write';
import { flattenRegion } from './composite';
import { createDocument, newLayer, type Document } from './document';
import { groupLayers, moveLayerTo } from './layer-tree';
import { TILE, TILE_BYTES } from './tiles';
import { bufPixel } from './test-utils';

// A .clip in the layout of a real Clip Studio file: the SQLite database is made here
// with sql.js, the pixel blocks and the chunk framing with the same codec the writer uses. The layout itself was
// these tests prove the reader and writer follow it.

const SQL = await initSqlJs();

const be = (n: number): number[] => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const nameBytes = (s: string): number[] => [...be(s.length), ...[...s].flatMap((c) => [0, c.charCodeAt(0)])];
const u64 = (n: number): number[] => [0, 0, 0, 0, ...be(n)];

const tileOf = (r: number, g: number, b: number, a = 255): Uint8ClampedArray => {
  const t = new Uint8ClampedArray(TILE_BYTES);
  for (let i = 0; i < TILE * TILE; i++) t.set([r, g, b, a], i * 4);
  return t;
};

/** The "Parameter"/"BlockSize" parts of an Offscreen.Attribute blob that matter to the codec. */
const attribute = (w: number, h: number, columns: number, rows: number, sizes: readonly number[]): Uint8Array =>
  Uint8Array.from([...be(16), ...be(102), ...be(42), ...be(174), ...nameBytes('Parameter'), ...be(w), ...be(h), ...be(columns), ...be(rows), ...be(0), ...be(0), ...nameBytes('BlockSize'), ...be(12), ...be(sizes.length), ...be(4), ...sizes.flatMap(be)]);

async function blockSet(grid: number, filled: Record<number, Uint8ClampedArray>): Promise<{ data: Uint8Array; sizes: number[] }> {
  const blocks = [];
  for (let i = 0; i < grid; i++) {
    const made = encodeBlock(i, filled[i] ? await deflateBlock(encodeBlockPixels(filled[i]!)) : null);
    blocks.push({ record: made.record, checksum: made.checksum, status: 1 });
  }
  return { data: buildBlockSet(blocks), sizes: blocks.map((b) => b.record.length) };
}

const A = 'extrnlid' + 'A'.repeat(32);
const B = 'extrnlid' + 'B'.repeat(32);

interface Fixture {
  bytes: Uint8Array;
}

/** Canvas 300×260 (a 2×2 block grid): paper, "Capa 1" (red block 0), and the folder "Grupo" holding "Dentro" (green block 3). */
async function fixture(tweak?: (db: InstanceType<typeof SQL.Database>) => void, setA?: Uint8Array, setB?: Uint8Array): Promise<Fixture> {
  const db = new SQL.Database();
  db.run(`CREATE TABLE Canvas(MainId INTEGER PRIMARY KEY, CanvasWidth REAL, CanvasHeight REAL, CanvasResolution REAL, CanvasRootFolder INTEGER, CanvasCurrentLayer INTEGER);
    CREATE TABLE Layer(MainId INTEGER PRIMARY KEY, LayerName TEXT, LayerType INTEGER, LayerFolder INTEGER, LayerOpacity INTEGER, LayerVisibility INTEGER, LayerClip INTEGER, LayerComposite INTEGER,
      LayerFirstChildIndex INTEGER, LayerNextIndex INTEGER, LayerRenderMipmap INTEGER, LayerLayerMaskMipmap INTEGER, LayerFolderThrough INTEGER, DrawColorEnable INTEGER, DrawColorMainRed INTEGER, DrawColorMainGreen INTEGER, DrawColorMainBlue INTEGER);
    CREATE TABLE Mipmap(MainId INTEGER PRIMARY KEY, BaseMipmapInfo INTEGER);
    CREATE TABLE MipmapInfo(MainId INTEGER PRIMARY KEY, ThisScale REAL, NextIndex INTEGER, Offscreen INTEGER);
    CREATE TABLE Offscreen(MainId INTEGER PRIMARY KEY, Attribute BLOB, BlockData TEXT);
    CREATE TABLE ExternalChunk(ExternalID TEXT, Offset INTEGER);
    CREATE TABLE CanvasPreview(MainId INTEGER PRIMARY KEY, ImageWidth INTEGER, ImageHeight INTEGER, ImageData BLOB);`);
  db.run('INSERT INTO Canvas VALUES(1, 300, 260, 350, 1, 3)');
  //                        id name        type  fold opac vis clip comp first next  mip mask thr  en    r           g           b
  const layer = db.prepare('INSERT INTO Layer VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  layer.run([1, 'Raíz', 256, 1, 256, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  layer.run([2, 'Papel', 1584, 0, 256, 1, 0, 0, 0, 3, 0, 0, 0, 1, 0xffffffff, 0xffffffff, 0xffffffff]);
  layer.run([3, 'Capa 1', 1, 0, 256, 1, 0, 0, 0, 4, 1, 0, 0, 0, 0, 0, 0]);
  layer.run([4, 'Grupo', 1, 1, 128, 1, 0, 30, 5, 0, 0, 0, 1, 0, 0, 0, 0]);
  layer.run([5, 'Dentro', 1, 0, 256, 3, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0]);
  layer.free();
  const a = setA ? { data: setA, sizes: parseBlockSet(setA).map((b) => b.record.length) } : await blockSet(4, { 0: tileOf(255, 0, 0) });
  const b = setB ? { data: setB, sizes: parseBlockSet(setB).map((x) => x.record.length) } : await blockSet(4, { 3: tileOf(0, 255, 0) });
  for (const [n, id, set] of [[1, A, a], [2, B, b]] as const) {
    db.run('INSERT INTO Mipmap VALUES(?, ?)', [n, n]);
    db.run('INSERT INTO MipmapInfo VALUES(?, 100, 0, ?)', [n, n]);
    db.run('INSERT INTO Offscreen VALUES(?, ?, ?)', [n, attribute(300, 260, 2, 2, set.sizes), id]);
    db.run('INSERT INTO ExternalChunk VALUES(?, 0)', [id]);
  }
  db.run('INSERT INTO CanvasPreview VALUES(1, 300, 260, ?)', [Uint8Array.from([0x89, 0x50, 0x4e, 0x47])]);
  tweak?.(db);
  const dbBytes = db.export();
  db.close();
  const parts = [
    { tag: 'CHNKHead', payload: Uint8Array.from([...u64(0x100), ...u64(0), ...u64(0x10), ...new Array(16).fill(9)]) },
    { tag: 'CHNKExta', payload: buildExta(A, a.data) },
    { tag: 'CHNKExta', payload: buildExta(B, b.data) },
    { tag: 'CHNKSQLi', payload: dbBytes },
    { tag: 'CHNKFoot', payload: new Uint8Array(0) },
  ];
  // Offsets are only known once the chunks are laid out; they do not change the layout (same size either way).
  const starts = buildCsf(parts).starts;
  const fixed = new SQL.Database(dbBytes);
  fixed.run('UPDATE ExternalChunk SET Offset = ? WHERE ExternalID = ?', [starts[1]!, A]);
  fixed.run('UPDATE ExternalChunk SET Offset = ? WHERE ExternalID = ?', [starts[2]!, B]);
  parts[3]!.payload = fixed.export();
  fixed.close();
  const probe = buildCsf(parts);
  parts[0]!.payload = Uint8Array.from([...u64(0x100), ...u64(probe.starts[3]!), ...u64(0x10), ...new Array(16).fill(9)]);
  return { bytes: buildCsf(parts).bytes };
}

const codecs: ClipWriteCodecs & { pngs: number[][] } = {
  pngs: [],
  async encodePng(w, h) {
    this.pngs.push([w, h]);
    return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  },
  loadSql: async () => SQL,
};

/** The bytes a block's checksum covers: the little-endian length and the zlib stream, which end 38 bytes (the end marker) before the record's end. */
const lengthPrefixed = (record: Uint8Array, zlibLength: number): Uint8Array => record.subarray(record.length - 38 - zlibLength - 4, record.length - 38);

const px = (l: { surface: { readRect(r: { x: number; y: number; w: number; h: number }): Uint8ClampedArray } }, x: number, y: number): number[] => bufPixel(l.surface.readRect({ x, y, w: 1, h: 1 }), 1, 0, 0);

describe('block codec', () => {
  it('writes an empty block the way Clip Studio does and checksums the length-prefixed stream', async () => {
    const empty = encodeBlock(7, null);
    expect(empty.record.length).toBe(104);
    expect(empty.checksum).toBe(0);
    const z = await deflateBlock(encodeBlockPixels(tileOf(1, 2, 3)));
    const full = encodeBlock(0, z);
    const lenPrefixed = lengthPrefixed(full.record, z.length);
    expect(lenPrefixed.length).toBe(z.length + 4);
    expect(full.checksum).toBe(adler32(lenPrefixed));
    const [b] = parseBlockSet(buildBlockSet([{ ...full, status: 1 }]));
    expect(b!.checksum).toBe(full.checksum);
    expect(Array.from(b!.zlib!)).toEqual(Array.from(z));
  });

  it('keeps colour only where there is alpha', () => {
    const t = tileOf(10, 20, 30, 0);
    t.set([10, 20, 30, 255], 0);
    const back = decodeBlockPixels(encodeBlockPixels(t));
    expect(Array.from(back.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(back.subarray(4, 8))).toEqual([0, 0, 0, 0]);
  });
});

describe('importClip', () => {
  it('reads the layer tree (bottom child first), properties and pixels', async () => {
    const { bytes } = await fixture();
    expect(looksLikeClip(bytes)).toBe(true);
    const { value: doc, warnings } = await importClip(bytes);
    expect([doc.width, doc.height, doc.dpi]).toEqual([300, 260, 350]);
    // Members come right below their folder: bottom to top.
    expect(doc.layers.map((l) => l.name)).toEqual(['Papel', 'Capa 1', 'Dentro', 'Grupo']);
    const [papel, capa, dentro, grupo] = doc.layers;
    expect(papel!.kind).toBe('paper');
    expect(papel!.paperColor).toEqual([255, 255, 255]);
    expect(grupo!.kind).toBe('folder');
    expect(grupo!.opacity).toBe(0.5);
    expect(dentro!.parent).toBe(grupo!.id);
    expect(dentro!.visible).toBe(true);
    expect(capa!.parent).toBeNull();
    expect(px(capa!, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(px(capa!, 260, 5)[3]).toBe(0);
    // Block 3 of a 2×2 grid is the bottom-right one.
    expect(px(dentro!, 270, 258)).toEqual([0, 255, 0, 255]);
    expect(px(dentro!, 5, 5)[3]).toBe(0);
    expect(warnings).toEqual([]);
    expect(flattenRegion(doc, { x: 0, y: 0, w: 1, h: 1 }, { output: true }).slice(0, 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
  });

  it('warns about blend modes it cannot verify instead of guessing', async () => {
    const { bytes } = await fixture((db) => db.run('UPDATE Layer SET LayerComposite = 5 WHERE MainId = 3'));
    const { warnings } = await importClip(bytes);
    expect(warnings.some((w) => /Modos de mezcla/.test(w) && w.includes('5'))).toBe(true);
  });

  it('says which layers it could not fill instead of failing', async () => {
    const { bytes } = await fixture((db) => db.run('UPDATE Layer SET LayerRenderMipmap = 0 WHERE MainId = 3'));
    const { value, warnings } = await importClip(bytes);
    expect(value.layers.map((l) => l.name)).toContain('Capa 1');
    expect(warnings.some((w) => w.includes('"Capa 1"') && w.includes('píxeles'))).toBe(true);
    expect(clipOriginOf(value)!.layers.get(value.layers[1]!.id)!.editable).toBe(false);
  });

  it('keeps going when one block cannot be decompressed, and does not rewrite that layer', async () => {
    const good = await blockSet(4, { 0: tileOf(255, 0, 0) });
    const bad = good.data.slice();
    bad[130] = bad[130]! ^ 0xff; // inside the compressed data of block 0
    const { bytes } = await fixture(undefined, bad);
    const { value, warnings } = await importClip(bytes);
    expect(value.layers.length).toBe(4);
    expect(warnings.some((w) => /descomprimir/.test(w))).toBe(true);
    const capa = value.layers[1]!;
    expect(clipOriginOf(value)!.layers.get(capa.id)!.editable).toBe(false);
  });

  it('rejects files that are not .clip or are cut short', async () => {
    await expect(importClip(Uint8Array.from([...'NOTACLIPFILE_NOTACLIPFILE_NOT'].map((c) => c.charCodeAt(0))))).rejects.toThrow(/\.clip/);
    const { bytes } = await fixture();
    await expect(importClip(bytes.subarray(0, bytes.length - 3000))).rejects.toThrow();
  });
});

describe('exportClip', () => {
  const sqlOf = (bytes: Uint8Array): InstanceType<typeof SQL.Database> => new SQL.Database(parseCsf(bytes).find((c) => c.tag === 'CHNKSQLi')!.payload);

  it('writes an unchanged document back with every pixel block identical', async () => {
    const { bytes } = await fixture();
    const { value: doc } = await importClip(bytes);
    const out = await exportClip(doc, codecs);
    expect(out.warnings).toEqual([]);
    const a = parseCsf(bytes);
    const b = parseCsf(out.value);
    expect(b.map((c) => c.tag)).toEqual(a.map((c) => c.tag));
    a.forEach((c, i) => {
      if (c.tag === 'CHNKExta') expect(Array.from(b[i]!.payload)).toEqual(Array.from(c.payload));
    });
    expect(out.value.length).toBe(bytes.length);
  });

  it('writes edited pixels and properties so they read back, with a consistent container', async () => {
    const { bytes } = await fixture();
    const { value: doc } = await importClip(bytes);
    const capa = doc.layers[1]!;
    const dentro = doc.layers[2]!;
    capa.name = 'Capa editada';
    capa.opacity = 0.75;
    capa.clip = true;
    dentro.visible = false;
    // Paint blue into block 1 (empty), recolour block 0 and erase nothing else.
    capa.surface.writeRect({ x: 260, y: 10, w: 20, h: 20 }, new Uint8ClampedArray(20 * 20 * 4).fill(0).map((_, i) => (i % 4 === 2 || i % 4 === 3 ? 255 : 0)));
    capa.surface.writeRect({ x: 0, y: 0, w: 4, h: 4 }, new Uint8ClampedArray(4 * 4 * 4).map((_, i) => [10, 200, 30, 128][i % 4]!));
    const before = codecs.pngs.length;
    const out = await exportClip(doc, codecs);
    expect(codecs.pngs.length).toBe(before + 1);
    expect(codecs.pngs[before]).toEqual([300, 260]);

    // Container: sizes, offsets and the Head pointer all agree with where the chunks actually are.
    const view = new DataView(out.value.buffer, out.value.byteOffset, out.value.byteLength);
    expect(Number(view.getBigUint64(8))).toBe(out.value.length);
    const chunks = parseCsf(out.value);
    const sqlChunk = chunks.find((c) => c.tag === 'CHNKSQLi')!;
    const head = chunks.find((c) => c.tag === 'CHNKHead')!.payload;
    expect(Number(new DataView(head.buffer, head.byteOffset, head.byteLength).getBigUint64(8))).toBe(sqlChunk.start);
    const db = sqlOf(out.value);
    expect(db.exec('PRAGMA integrity_check')[0]!.values[0]![0]).toBe('ok');
    for (const [id, offset] of db.exec('SELECT ExternalID, Offset FROM ExternalChunk')[0]!.values) {
      const at = chunks.find((c) => c.tag === 'CHNKExta' && parseExta(c.payload).id === id)!;
      expect(offset).toBe(at.start);
    }
    // Block records: sizes in the Offscreen attribute, checksums in the table.
    for (const c of chunks.filter((x) => x.tag === 'CHNKExta')) {
      const e = parseExta(c.payload);
      const blocks = parseBlockSet(e.data);
      const attr = db.exec('SELECT Attribute FROM Offscreen WHERE BlockData = ?', [e.id])[0]!.values[0]![0] as Uint8Array;
      const sizes = blocks.map((b) => b.record.length);
      const tail = attr.subarray(attr.length - sizes.length * 4);
      expect(Array.from(tail)).toEqual(sizes.flatMap(be));
      for (const b of blocks) expect(b.checksum).toBe(b.zlib ? adler32(lengthPrefixed(b.record, b.zlib.length)) : 0);
    }
    expect(db.exec('SELECT LayerName, LayerOpacity, LayerClip FROM Layer WHERE MainId = 3')[0]!.values[0]).toEqual(['Capa editada', 192, 1]);
    expect(db.exec('SELECT LayerVisibility FROM Layer WHERE MainId = 5')[0]!.values[0]![0]).toBe(2);
    expect(Array.from(db.exec('SELECT ImageData FROM CanvasPreview')[0]!.values[0]![0] as Uint8Array)).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    // And it reads back as the edited document.
    const { value: back, warnings } = await importClip(out.value);
    expect(warnings).toEqual([]);
    const [, c2, d2] = back.layers;
    expect(c2!.name).toBe('Capa editada');
    expect(c2!.opacity).toBe(0.75);
    expect(c2!.clip).toBe(true);
    expect(d2!.visible).toBe(false);
    expect(px(c2!, 265, 15)).toEqual([0, 0, 255, 255]);
    expect(px(c2!, 1, 1)).toEqual([10, 200, 30, 128]);
    expect(px(c2!, 100, 100)).toEqual([255, 0, 0, 255]);
    expect(px(d2!, 270, 258)).toEqual([0, 255, 0, 255]);
    // Untouched layers keep their original block bytes.
    const original = parseCsf(bytes).filter((c) => c.tag === 'CHNKExta').map((c) => parseExta(c.payload)).find((e) => e.id === B)!;
    const written = chunks.filter((c) => c.tag === 'CHNKExta').map((c) => parseExta(c.payload)).find((e) => e.id === B)!;
    expect(Array.from(written.data)).toEqual(Array.from(original.data));
  });

  it('turns a block erased in Lienzo into an empty block', async () => {
    const { bytes } = await fixture();
    const { value: doc } = await importClip(bytes);
    doc.layers[1]!.surface.writeRect({ x: 0, y: 0, w: 256, h: 256 }, new Uint8ClampedArray(256 * 256 * 4));
    const out = await exportClip(doc, codecs);
    const e = parseCsf(out.value).filter((c) => c.tag === 'CHNKExta').map((c) => parseExta(c.payload)).find((x) => x.id === A)!;
    const blocks = parseBlockSet(e.data);
    expect(blocks.every((b) => b.zlib === null && b.record.length === 104)).toBe(true);
    expect((await importClip(out.value)).value.layers[1]!.surface.isEmpty).toBe(true);
  });

  it('refuses what it cannot write back faithfully instead of producing a damaged file', async () => {
    const { bytes } = await fixture();
    const plain = createDocument(64, 64);
    expect(canWriteClip(plain)).toBe(false);
    await expect(exportClip(plain, codecs)).rejects.toThrow(/no se abrió desde un archivo \.clip/);

    const resized = (await importClip(bytes)).value;
    resized.width = 310;
    await expect(exportClip(resized, codecs)).rejects.toThrow(/tamaño del lienzo/);

    const paper = (await importClip(bytes)).value;
    paper.layers.push(newLayer(paper, 'Otro papel', 'paper'));
    await expect(exportClip(paper, codecs)).rejects.toThrow(/papel/);
  });

  describe('when layers were added, deleted, moved or converted', () => {
    const names = (doc: Document): string[] => doc.layers.map((l) => l.name);
    const extas = (bytes: Uint8Array): Map<string, number> => new Map(parseCsf(bytes).filter((c) => c.tag === 'CHNKExta').map((c) => [parseExta(c.payload).id, c.start]));
    const consistent = (bytes: Uint8Array): void => {
      const db = sqlOf(bytes);
      expect(db.exec('PRAGMA integrity_check')[0]!.values[0]![0]).toBe('ok');
      const chunks = extas(bytes);
      const rows = db.exec('SELECT ExternalID, Offset FROM ExternalChunk')[0]?.values ?? [];
      expect(rows.length).toBe(chunks.size);
      for (const [id, offset] of rows) expect(chunks.get(String(id))).toBe(offset);
    };

    it('adds layers with pixels and empty ones, as copies of rows the file already has', async () => {
      const { bytes } = await fixture();
      const { value: doc } = await importClip(bytes);
      const pintada = newLayer(doc, 'Pintada');
      pintada.surface.writeRect({ x: 270, y: 10, w: 8, h: 8 }, new Uint8ClampedArray(8 * 8 * 4).map((_, i) => [1, 2, 250, 255][i % 4]!));
      pintada.opacity = 0.5;
      doc.layers.push(pintada);
      const vacia = newLayer(doc, 'Vacía');
      vacia.visible = false;
      doc.layers.push(vacia);
      const out = await exportClip(doc, codecs);
      expect(out.warnings).toEqual([]);
      consistent(out.value);

      const db = sqlOf(out.value);
      expect(db.exec("SELECT MainId, LayerOpacity, LayerVisibility FROM Layer WHERE LayerName IN ('Pintada', 'Vacía') ORDER BY MainId")[0]!.values).toEqual([[6, 128, 1], [7, 256, 0]]);
      // The tree: root -> Papel -> Capa 1 -> Grupo(Dentro) -> Pintada -> Vacía, linked bottom to top.
      expect(db.exec('SELECT MainId, LayerFirstChildIndex, LayerNextIndex FROM Layer ORDER BY MainId')[0]!.values).toEqual([[1, 2, 0], [2, 0, 3], [3, 0, 4], [4, 5, 6], [5, 0, 0], [6, 0, 7], [7, 0, 0]]);
      // Pixels went into a new chunk; the empty layer has none (like an empty layer of the original).
      expect(extas(out.value).size).toBe(3);

      const { value: back, warnings } = await importClip(out.value);
      expect(warnings).toEqual([]);
      expect(names(back)).toEqual(['Papel', 'Capa 1', 'Dentro', 'Grupo', 'Pintada', 'Vacía']);
      const [, , , , p2, v2] = back.layers;
      expect(p2!.opacity).toBe(0.5);
      expect(px(p2!, 272, 12)).toEqual([1, 2, 250, 255]);
      expect(v2!.visible).toBe(false);
      expect(v2!.surface.isEmpty).toBe(true);
      // The originals are untouched.
      expect(px(back.layers[1]!, 5, 5)).toEqual([255, 0, 0, 255]);
      expect(px(back.layers[2]!, 270, 258)).toEqual([0, 255, 0, 255]);
      // The copied layers can be edited and saved again.
      p2!.surface.writeRect({ x: 0, y: 0, w: 2, h: 2 }, new Uint8ClampedArray(16).fill(255));
      const again = await exportClip(back, codecs);
      consistent(again.value);
      expect(px((await importClip(again.value)).value.layers[4]!, 1, 1)).toEqual([255, 255, 255, 255]);
    });

    it('deletes layers with their rows and data, folders and their members included', async () => {
      const { bytes } = await fixture();
      const { value: doc } = await importClip(bytes);
      doc.layers = doc.layers.filter((l) => l.name === 'Papel');
      doc.activeId = doc.layers[0]!.id;
      const out = await exportClip(doc, codecs);
      consistent(out.value);
      const db = sqlOf(out.value);
      expect(db.exec('SELECT MainId, LayerFirstChildIndex, LayerNextIndex FROM Layer ORDER BY MainId')[0]!.values).toEqual([[1, 2, 0], [2, 0, 0]]);
      expect(db.exec('SELECT COUNT(*) FROM Offscreen')[0]!.values[0]![0]).toBe(0);
      expect(db.exec('SELECT COUNT(*) FROM Mipmap')[0]!.values[0]![0]).toBe(0);
      expect(extas(out.value).size).toBe(0);
      expect(names((await importClip(out.value)).value)).toEqual(['Papel']);
    });

    it('moves layers: reordering and taking one out of its folder', async () => {
      const { bytes } = await fixture();
      const { value: doc } = await importClip(bytes);
      const dentro = doc.layers.find((l) => l.name === 'Dentro')!;
      const capa = doc.layers.find((l) => l.name === 'Capa 1')!;
      moveLayerTo(doc, dentro.id, null, 0);
      moveLayerTo(doc, capa.id, doc.layers.find((l) => l.name === 'Grupo')!.id, 0);
      const out = await exportClip(doc, codecs);
      expect(out.warnings).toEqual([]);
      consistent(out.value);
      const { value: back } = await importClip(out.value);
      expect(back.layers.map((l) => `${l.name}<${back.layers.find((p) => p.id === l.parent)?.name ?? ''}`)).toEqual(['Dentro<', 'Papel<', 'Capa 1<Grupo', 'Grupo<']);
      expect(px(back.layers[0]!, 270, 258)).toEqual([0, 255, 0, 255]);
      expect(px(back.layers[2]!, 5, 5)).toEqual([255, 0, 0, 255]);
    });

    it('adds a folder and gathers layers in it', async () => {
      const { bytes } = await fixture();
      const { value: doc } = await importClip(bytes);
      groupLayers(doc, [doc.layers.find((l) => l.name === 'Capa 1')!.id], 'Nuevo grupo');
      const out = await exportClip(doc, codecs);
      expect(out.warnings).toEqual([]);
      consistent(out.value);
      const { value: back } = await importClip(out.value);
      expect(back.layers.map((l) => `${l.name}<${back.layers.find((p) => p.id === l.parent)?.name ?? ''}`)).toEqual(['Papel<', 'Capa 1<Nuevo grupo', 'Nuevo grupo<', 'Dentro<Grupo', 'Grupo<']);
      expect(back.layers.find((l) => l.name === 'Nuevo grupo')!.kind).toBe('folder');
      expect(px(back.layers[1]!, 5, 5)).toEqual([255, 0, 0, 255]);
    });

    it('turns a layer into another kind by replacing its rows', async () => {
      const { bytes } = await fixture();
      const { value: doc } = await importClip(bytes);
      const capa = doc.layers.find((l) => l.name === 'Capa 1')!;
      capa.kind = 'folder';
      const out = await exportClip(doc, codecs);
      consistent(out.value);
      const db = sqlOf(out.value);
      expect(db.exec("SELECT LayerFolder FROM Layer WHERE LayerName = 'Capa 1'")[0]!.values[0]![0]).toBe(1);
      expect(extas(out.value).size).toBe(1);
      expect((await importClip(out.value)).value.layers.find((l) => l.name === 'Capa 1')!.kind).toBe('folder');
    });

    it('allocates new ids from the file counters and tags copies with their layer when the tables have LayerId', async () => {
      const { bytes } = await fixture((db) => {
        db.run('CREATE TABLE ElemScheme(TableName TEXT, MaxIndex INTEGER)');
        for (const [t, n] of [['Layer', 10], ['Mipmap', 15], ['MipmapInfo', 20], ['Offscreen', 30]] as const) db.run('INSERT INTO ElemScheme VALUES(?, ?)', [t, n]);
        for (const t of ['Mipmap', 'MipmapInfo', 'Offscreen']) {
          db.run(`ALTER TABLE ${t} ADD COLUMN LayerId INTEGER`);
          db.run(`UPDATE ${t} SET LayerId = ${t === 'Offscreen' ? 'MainId' : 'MainId'} + 2`);
        }
      });
      const { value: doc } = await importClip(bytes);
      doc.layers.push(newLayer(doc, 'Nueva'));
      const out = await exportClip(doc, codecs);
      consistent(out.value);
      const db = sqlOf(out.value);
      expect(db.exec("SELECT MainId, LayerRenderMipmap FROM Layer WHERE LayerName = 'Nueva'")[0]!.values[0]).toEqual([11, 16]);
      expect(db.exec('SELECT MainId, LayerId FROM Mipmap WHERE MainId > 2')[0]!.values).toEqual([[16, 11]]);
      expect(db.exec('SELECT MainId, LayerId FROM Offscreen WHERE MainId > 2')[0]!.values).toEqual([[31, 11]]);
      expect(db.exec('SELECT TableName, MaxIndex FROM ElemScheme ORDER BY TableName')[0]!.values).toEqual([['Layer', 11], ['Mipmap', 16], ['MipmapInfo', 21], ['Offscreen', 31]]);
    });

    it('keeps the ids of deleted layers out of reuse and removes their LayerId-tagged rows', async () => {
      const { bytes } = await fixture((db) => {
        db.run('CREATE TABLE ElemScheme(TableName TEXT, MaxIndex INTEGER)');
        db.run("INSERT INTO ElemScheme VALUES('Layer', 5)");
        db.run('ALTER TABLE Offscreen ADD COLUMN LayerId INTEGER');
        db.run('UPDATE Offscreen SET LayerId = MainId + 2');
        db.run('CREATE TABLE LayerExtra(MainId INTEGER PRIMARY KEY, LayerId INTEGER)');
        db.run('INSERT INTO LayerExtra VALUES(1, 3)');
      });
      const { value: doc } = await importClip(bytes);
      doc.layers = doc.layers.filter((l) => l.name !== 'Capa 1');
      doc.layers.push(newLayer(doc, 'Otra'));
      const out = await exportClip(doc, codecs);
      consistent(out.value);
      const db = sqlOf(out.value);
      expect(db.exec('SELECT COUNT(*) FROM LayerExtra')[0]!.values[0]![0]).toBe(0);
      // Capa 1 was layer 3 and is gone; the new layer is 6, never 3.
      expect(db.exec("SELECT MainId FROM Layer WHERE LayerName = 'Otra'")[0]!.values[0]![0]).toBe(6);
      expect(db.exec('SELECT MaxIndex FROM ElemScheme')[0]!.values[0]![0]).toBe(6);
    });

    it('saves what was painted on a layer that was empty in the file', async () => {
      const EMPTY = 'extrnlid' + 'E'.repeat(32);
      const { bytes } = await fixture((db) => {
        db.run('INSERT INTO Layer VALUES(6, ?, 1, 0, 256, 1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0)', ['Vacía']);
        db.run('UPDATE Layer SET LayerNextIndex = 6 WHERE MainId = 4');
        db.run('INSERT INTO Mipmap VALUES(3, 3)');
        db.run('INSERT INTO MipmapInfo VALUES(3, 100, 0, 3)');
        db.run('INSERT INTO Offscreen VALUES(3, ?, ?)', [attribute(300, 260, 2, 2, [104, 104, 104, 104]), EMPTY]);
      });
      const { value: doc } = await importClip(bytes);
      const vacia = doc.layers.find((l) => l.name === 'Vacía')!;
      expect(clipOriginOf(doc)!.layers.get(vacia.id)!.editable).toBe(true);
      // Nothing painted: nothing to add.
      const same = await exportClip(doc, codecs);
      expect(extas(same.value).size).toBe(2);
      vacia.surface.writeRect({ x: 270, y: 270 - 20, w: 4, h: 4 }, new Uint8ClampedArray(64).map((_, i) => [9, 8, 7, 255][i % 4]!));
      const out = await exportClip(doc, codecs);
      expect(out.warnings).toEqual([]);
      consistent(out.value);
      expect(extas(out.value).has(EMPTY)).toBe(true);
      expect(px((await importClip(out.value)).value.layers.find((l) => l.name === 'Vacía')!, 271, 251)).toEqual([9, 8, 7, 255]);
    });

    it('stops with a clear message when the file has no layer to copy from', async () => {
      const { bytes } = await fixture((db) => db.run('UPDATE Layer SET LayerRenderMipmap = 0 WHERE MainId IN (3, 5)'));
      const { value: doc } = await importClip(bytes);
      doc.layers.push(newLayer(doc, 'Nueva'));
      await expect(exportClip(doc, codecs)).rejects.toThrow(/modelo/);
    });
  });

  it('says that a blend mode set in Lienzo is not saved', async () => {
    const { bytes } = await fixture();
    const { value: doc } = await importClip(bytes);
    doc.layers[1]!.blend = 'multiply';
    const out = await exportClip(doc, codecs);
    expect(out.warnings.some((w) => /modo de mezcla/.test(w))).toBe(true);
    expect(sqlOf(out.value).exec('SELECT LayerComposite FROM Layer WHERE MainId = 3')[0]!.values[0]![0]).toBe(0);
  });
});
