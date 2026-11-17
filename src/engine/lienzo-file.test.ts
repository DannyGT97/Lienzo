import { describe, expect, it } from 'vitest';
import { flatten } from './composite';
import { Stroke, defaultBrush } from './brush';
import { addLayer, createDocument, type Document } from './document';
import { TILE, TiledSurface } from './tiles';
import { addComp } from './layer-comps';
import { groupLayers } from './layer-tree';
import { createMask } from './mask-ops';
import { LIENZO_VERSION, isLienzo, loadLienzo, readLienzoPreview, saveLienzo } from './lienzo-file';
import { Selection } from './selection';
import { fillLayer, setPixel } from './test-utils';

const W = 600; // wider than a tile
const H = 300;

function sample(): Document {
  const doc = createDocument(W, H, 300);
  const a = doc.layers[0]!;
  a.name = 'Papel';
  a.kind = 'paper';
  a.paperColor = [250, 250, 245];
  const b = addLayer(doc, 'Dibujo');
  fillLayer(b, [10, 20, 30, 255]);
  setPixel(b, 300, 150, [200, 0, 0, 255]); // in another tile
  b.opacity = 0.8;
  b.blend = 'multiply';
  b.lockAlpha = true;
  b.locked = true;
  const c = addLayer(doc, 'Tono', undefined, 'tone');
  c.tone!.lpi = 55;
  setPixel({ surface: c.source! } as typeof c, 40, 40, [0, 0, 0, 255]);
  setPixel(c, 40, 40, [0, 0, 0, 255]);
  const d = addLayer(doc, 'Globos', undefined, 'balloons');
  d.balloons = [{ id: 1, shape: 'ellipse', x: 10, y: 10, w: 100, h: 60, tail: { x: 30, y: 90 }, text: 'Hola ñ', fontSize: 28, fontFamily: 'sans-serif', vertical: false, border: 4 }];
  const e = addLayer(doc, 'Con máscara');
  fillLayer(e, [0, 120, 0, 255]);
  createMask(doc, e.id, 'show', Selection.rect(W, H, { x: 100, y: 50, w: 200, h: 100 }));
  groupLayers(doc, [b.id, e.id], 'Carpeta');
  addComp(doc, 'Solo dibujo');
  doc.guides = { v: [120, 480], h: [75] };
  doc.rulers = [{ id: 4, kind: 'perspective', pts: [{ x: 300, y: -200 }] }];
  doc.nextRulerId = 5;
  return doc;
}

describe('the .lienzo file', () => {
  it('round trips a document with everything in it', async () => {
    const doc = sample();
    const blob = await saveLienzo(doc);
    expect(await isLienzo(blob)).toBe(true);
    const back = await loadLienzo(blob);

    expect(back.width).toBe(W);
    expect(back.height).toBe(H);
    expect(back.dpi).toBe(300);
    expect(back.layers.map((l) => [l.id, l.name, l.kind, l.parent])).toEqual(doc.layers.map((l) => [l.id, l.name, l.kind, l.parent]));
    expect(back.activeId).toBe(doc.activeId);
    expect(back.nextId).toBe(doc.nextId);

    const b = back.layers.find((l) => l.name === 'Dibujo')!;
    expect([b.opacity, b.blend, b.lockAlpha, b.locked]).toEqual([0.8, 'multiply', true, true]);
    expect(b.surface.pixel(300, 150)).toEqual([200, 0, 0, 255]);
    expect(b.surface.pixel(5, 5)).toEqual([10, 20, 30, 255]);

    expect(back.layers.find((l) => l.kind === 'paper')!.paperColor).toEqual([250, 250, 245]);
    const tone = back.layers.find((l) => l.kind === 'tone')!;
    expect(tone.tone!.lpi).toBe(55);
    expect(tone.source!.alphaAt(40, 40)).toBe(255);
    expect(back.layers.find((l) => l.kind === 'balloons')!.balloons![0]!.text).toBe('Hola ñ');

    const masked = back.layers.find((l) => l.name === 'Con máscara')!;
    expect(masked.mask).toBeDefined();
    expect(masked.mask!.enabled).toBe(true);
    expect(masked.mask!.surface.alphaAt(150, 100)).toBe(doc.layers.find((l) => l.name === 'Con máscara')!.mask!.surface.alphaAt(150, 100));

    expect(back.comps.map((c) => c.name)).toEqual(['Solo dibujo']);
    expect(back.nextCompId).toBe(doc.nextCompId);
    expect(back.guides).toEqual({ v: [120, 480], h: [75] });
    expect(back.rulers).toEqual(doc.rulers);
    expect(back.nextRulerId).toBe(5);
  });

  it('gives the same picture after loading', async () => {
    const doc = sample();
    const back = await loadLienzo(await saveLienzo(doc));
    const a = flatten(doc);
    const b = flatten(back);
    expect(b.length).toBe(a.length);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    expect(worst).toBe(0);
  });

  it('keeps the file small for a sparse page', async () => {
    const doc = createDocument(4000, 4000, 300);
    setPixel(doc.layers[0]!, 10, 10, [1, 2, 3, 255]);
    const blob = await saveLienzo(doc);
    expect(blob.size).toBeLessThan(5000); // one tile of mostly zeros plus the metadata
    const back = await loadLienzo(blob);
    expect(back.layers[0]!.surface.tileCount).toBe(1);
  });

  it('a document with the default blocks is still written as version 1', async () => {
    const blob = await saveLienzo(sample());
    expect(new Uint8Array(await blob.slice(7, 8).arrayBuffer())[0]).toBe(1);
  });

  describe('surfaces cut into other block sizes', () => {
    const rect = { x: 90, y: 40, w: 420, h: 130 };
    function odd(): Document {
      const doc = createDocument(W, H, 300);
      const l = addLayer(doc, 'Bloques de 100');
      l.surface = new TiledSurface(W, H, 100);
      const data = new Uint8ClampedArray(rect.w * rect.h * 4);
      for (let i = 0; i < rect.w * rect.h; i++) data.set([i % 251, 3, (i >> 7) % 251, 1 + (i % 254)], i * 4);
      l.surface.writeRect(rect, data);
      l.mask = { surface: new TiledSurface(W, H, 64), base: 255, enabled: true };
      l.mask.surface.writeRect({ x: 10, y: 10, w: 200, h: 90 }, new Uint8ClampedArray(200 * 90 * 4).fill(128));
      return doc;
    }

    it('keeps the pixels and cuts them into working blocks on load', async () => {
      const doc = odd();
      const blob = await saveLienzo(doc);
      expect(new Uint8Array(await blob.slice(7, 8).arrayBuffer())[0]).toBe(2);
      const back = await loadLienzo(blob);
      const before = doc.layers.find((l) => l.name === 'Bloques de 100')!;
      const after = back.layers.find((l) => l.name === 'Bloques de 100')!;
      expect(before.surface.blockSize).toBe(100);
      expect(after.surface.blockSize).toBe(TILE);
      expect(after.mask!.surface.blockSize).toBe(TILE);
      const all = { x: 0, y: 0, w: W, h: H };
      expect(Array.from(after.surface.readRect(all))).toEqual(Array.from(before.surface.readRect(all)));
      expect(Array.from(after.mask!.surface.readRect(all))).toEqual(Array.from(before.mask!.surface.readRect(all)));
      expect(after.surface.contentBounds()).toEqual(before.surface.contentBounds());
    });

    it('loaded surfaces can be painted on', async () => {
      const back = await loadLienzo(await saveLienzo(odd()));
      const l = back.layers.find((x) => x.name === 'Bloques de 100')!;
      expect(() => new Stroke({ id: l.id, surface: l.surface, lockAlpha: false }, defaultBrush)).not.toThrow();
    });

    it('rejects a block size that is not valid, or a tile that does not match it', async () => {
      const blob = await saveLienzo(odd());
      const text = async (b: Blob): Promise<{ head: Uint8Array; meta: Record<string, unknown>; rest: Blob }> => {
        const head = new Uint8Array(await b.slice(0, 12).arrayBuffer());
        const len = new DataView(head.buffer).getUint32(8, true);
        const meta = JSON.parse(await b.slice(12, 12 + len).text()) as Record<string, unknown>;
        return { head, meta, rest: b.slice(12 + len) };
      };
      const rebuild = (parts: { head: Uint8Array; meta: unknown; rest: Blob }): Blob => {
        const json = new TextEncoder().encode(JSON.stringify(parts.meta));
        const head = parts.head.slice();
        new DataView(head.buffer).setUint32(8, json.length, true);
        return new Blob([head, json, parts.rest]);
      };
      const p = await text(blob);
      const layers = p.meta.layers as { name: string; blocks?: { surface?: number } }[];
      const rec = layers.find((l) => l.name === 'Bloques de 100')!;
      for (const bad of [0, -5, 7.5, 'x', 1e9]) {
        rec.blocks!.surface = bad as number;
        await expect(loadLienzo(rebuild(p))).rejects.toThrow('incompleto o dañado');
      }
      rec.blocks!.surface = 128; // valid size, but the stored tiles are 100×100
      await expect(loadLienzo(rebuild(p))).rejects.toThrow('incompleto o dañado');
    });

    it('a version 1 file ignores a block size, since it always means 256', async () => {
      const blob = await saveLienzo(sample());
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const len = new DataView(head.buffer).getUint32(8, true);
      const meta = JSON.parse(await blob.slice(12, 12 + len).text()) as { layers: { blocks?: unknown }[] };
      meta.layers[0]!.blocks = { surface: 100 };
      const json = new TextEncoder().encode(JSON.stringify(meta));
      new DataView(head.buffer).setUint32(8, json.length, true);
      const back = await loadLienzo(new Blob([head, json, blob.slice(12 + len)]));
      expect(back.layers[0]!.surface.blockSize).toBe(TILE);
    });
  });

  it('refuses things that are not documents or are damaged', async () => {
    await expect(loadLienzo(new Blob(['PK\u0003\u0004 not ours, long enough to have a header']))).rejects.toThrow('no es un documento');
    const good = await saveLienzo(sample());
    expect(await isLienzo(good)).toBe(true);
    const cut = good.slice(0, good.size - 100);
    await expect(loadLienzo(cut)).rejects.toThrow('incompleto o dañado');
    const head = new Uint8Array(await good.slice(0, 12).arrayBuffer());
    head[7] = LIENZO_VERSION + 1;
    await expect(loadLienzo(new Blob([head, good.slice(12)]))).rejects.toThrow('versión más nueva');
  });
});

describe('what a layer holds beyond the page', () => {
  it('survives a save and a load', async () => {
    const doc = createDocument(100, 80, 300);
    const layer = doc.layers[0]!;
    const out = new TiledSurface(400, 300);
    out.writeRect({ x: 250, y: 200, w: 1, h: 1 }, new Uint8ClampedArray([0, 255, 0, 255]));
    layer.overflow = { x: -20, y: -10, surface: out };
    setPixel(layer, 5, 5, [255, 0, 0, 255]);
    const back = await loadLienzo(await saveLienzo(doc));
    const l = back.layers[0]!;
    expect(l.surface.pixel(5, 5)).toEqual([255, 0, 0, 255]);
    expect(l.overflow).toMatchObject({ x: -20, y: -10 });
    expect(l.overflow!.surface.pixel(250, 200)).toEqual([0, 255, 0, 255]);
  });
});

describe('the picture kept inside a file', () => {
  const png = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) & 255); // bigger than one chunk of the base64 writer

  it('is read from the first bytes only, and the document still loads', async () => {
    const blob = await saveLienzo(sample(), { preview: async () => png });
    const asked: [number, number][] = [];
    const got = await readLienzoPreview(async (a, b) => {
      asked.push([a, b]);
      return blob.slice(a, b);
    });
    expect(got).toEqual(png);
    expect(asked.length).toBe(2); // the header, then the description: never the pixels
    expect(Math.max(...asked.map(([, b]) => b))).toBeLessThan(blob.size);
    const back = await loadLienzo(blob);
    expect(back.layers.length).toBe(sample().layers.length);
  });

  it('is absent when the file was saved without one, and for what is not a document', async () => {
    const plain = await saveLienzo(sample());
    expect(await readLienzoPreview(async (a, b) => plain.slice(a, b))).toBeNull();
    const failing = await saveLienzo(sample(), { preview: async () => Promise.reject(new Error('sin lienzo')) });
    expect(await readLienzoPreview(async (a, b) => failing.slice(a, b))).toBeNull();
    const other = new Blob([new Uint8Array(40)]);
    expect(await readLienzoPreview(async (a, b) => other.slice(a, b))).toBeNull();
  });
});
