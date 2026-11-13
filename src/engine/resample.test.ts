import { describe, expect, it } from 'vitest';
import { applyResolution } from './canvas-props';
import { addLayer, createDocument, type Document } from './document';
import { createMask } from './mask-ops';
import { applyPageOp } from './page-ops';
import { resampleSurface, type ResampleMethod } from './resample';
import { fillLayer, setPixel } from './test-utils';
import { TiledSurface } from './tiles';

function solid(w: number, h: number, rgba: [number, number, number, number]): TiledSurface {
  const s = new TiledSurface(w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  s.writeRect({ x: 0, y: 0, w, h }, data);
  return s;
}

describe('resampling', () => {
  it('leaves the picture alone at the same size, whatever the method', () => {
    const s = solid(40, 30, [10, 20, 30, 255]);
    s.writeRect({ x: 5, y: 5, w: 1, h: 1 }, new Uint8ClampedArray([200, 100, 50, 255]));
    for (const m of ['average', 'bicubic', 'bilinear', 'nearest'] as ResampleMethod[]) {
      const r = resampleSurface(s, 40, 30, m);
      expect(r.pixel(5, 5)).toEqual([200, 100, 50, 255]);
      expect(r.pixel(6, 5)).toEqual([10, 20, 30, 255]);
    }
  });

  it('averages the old area when shrinking', () => {
    const s = new TiledSurface(4, 4);
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) data.set((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 4 + x) * 4);
    s.writeRect({ x: 0, y: 0, w: 4, h: 4 }, data);
    const r = resampleSurface(s, 2, 2, 'average');
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const p = r.pixel(x, y);
      expect(p[0]).toBeGreaterThanOrEqual(127);
      expect(p[0]).toBeLessThanOrEqual(128);
      expect(p[3]).toBe(255);
    }
  });

  it('keeps a flat colour flat when enlarging, and nearest copies the pixels', () => {
    const flat = resampleSurface(solid(10, 10, [40, 90, 160, 255]), 37, 23, 'bicubic');
    expect(flat.pixel(0, 0)).toEqual([40, 90, 160, 255]);
    expect(flat.pixel(36, 22)).toEqual([40, 90, 160, 255]);
    const s = new TiledSurface(2, 1);
    s.writeRect({ x: 0, y: 0, w: 2, h: 1 }, new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]));
    const n = resampleSurface(s, 4, 1, 'nearest');
    expect(n.pixel(1, 0)).toEqual([255, 0, 0, 255]);
    expect(n.pixel(2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('does not tint the edges with the colour of clear pixels', () => {
    const s = new TiledSurface(4, 1);
    s.writeRect({ x: 0, y: 0, w: 4, h: 1 }, new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0]));
    const r = resampleSurface(s, 2, 1, 'average');
    expect(r.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(r.pixel(1, 0)[3]).toBe(0);
  });

  it('only keeps tiles that have something in them', () => {
    const s = new TiledSurface(1000, 1000);
    s.writeRect({ x: 11, y: 11, w: 1, h: 1 }, new Uint8ClampedArray([1, 2, 3, 255]));
    const r = resampleSurface(s, 500, 500, 'nearest');
    expect([...r.entries()].length).toBe(1);
    expect(resampleSurface(new TiledSurface(300, 300), 100, 100, 'average').entries().next().done).toBe(true);
  });

  it('a mask that shows everything keeps showing at the new size', () => {
    const s = new TiledSurface(300, 300);
    const r = resampleSurface(s, 600, 450, 'bilinear', { base: 255 });
    expect([...r.entries()].length).toBe(0);
  });
});

describe('changing the resolution of the image', () => {
  const now = (doc: Document, id: number) => doc.layers.find((x) => x.id === id)!;
  function sample() {
    const doc = createDocument(400, 200, 300);
    const l = addLayer(doc, 'dibujo');
    fillLayer(l, [200, 0, 0, 255]);
    doc.guides = { v: [100], h: [50] };
    return { doc, l };
  }

  it('scales layers and guides together and undoes as one step', () => {
    const { doc, l } = sample();
    const cmd = applyPageOp(doc, { kind: 'scale', width: 200, height: 100, method: 'average' }, 'Escalar')!;
    expect(cmd.pageChange).toBe(true);
    expect([doc.width, doc.height]).toEqual([200, 100]);
    expect(now(doc, l.id).surface.width).toBe(200);
    expect(now(doc, l.id).surface.pixel(199, 99)).toEqual([200, 0, 0, 255]);
    expect(doc.guides).toEqual({ v: [50], h: [25] });
    cmd.undo();
    expect([doc.width, doc.height]).toEqual([400, 200]);
    expect(now(doc, l.id).surface.width).toBe(400);
    expect(doc.guides).toEqual({ v: [100], h: [50] });
    cmd.redo();
    expect(now(doc, l.id).surface.width).toBe(200);
  });

  it('scales masks as masks', () => {
    const { doc, l } = sample();
    createMask(doc, l.id, 'show');
    applyPageOp(doc, { kind: 'scale', width: 800, height: 400, method: 'bicubic' }, 'Escalar');
    const mask = doc.layers.find((x) => x.id === l.id)!.mask!;
    expect(mask.base).toBe(255);
    expect(mask.surface.width).toBe(800);
  });

  it('applies size and resolution as one step; resolution alone does not touch the pixels', () => {
    const { doc, l } = sample();
    const cmd = applyResolution(doc, { size: { width: 800, height: 400, method: 'bilinear' }, dpi: 600 }, 'Resolución')!;
    expect([doc.width, doc.height, doc.dpi]).toEqual([800, 400, 600]);
    cmd.undo();
    expect([doc.width, doc.height, doc.dpi]).toEqual([400, 200, 300]);
    const only = applyResolution(doc, { dpi: 72 }, 'Resolución')!;
    expect([doc.width, doc.height, doc.dpi]).toEqual([400, 200, 72]);
    expect(now(doc, l.id).surface.pixel(10, 10)).toEqual([200, 0, 0, 255]);
    only.undo();
    expect(doc.dpi).toBe(300);
  });

  it('does nothing when nothing changes', () => {
    const { doc } = sample();
    expect(applyResolution(doc, { dpi: 300 }, 'x')).toBeNull();
    expect(applyResolution(doc, { size: { width: 400, height: 200, method: 'average' }, dpi: 300 }, 'x')).toBeNull();
  });

  it('keeps single pixels where they go', () => {
    const { doc, l } = sample();
    now(doc, l.id).surface.writeRect({ x: 0, y: 0, w: 400, h: 200 }, new Uint8ClampedArray(400 * 200 * 4));
    setPixel(l, 399, 199, [0, 0, 255, 255]);
    applyPageOp(doc, { kind: 'scale', width: 800, height: 400, method: 'nearest' }, 'Escalar');
    expect(now(doc, l.id).surface.pixel(799, 399)).toEqual([0, 0, 255, 255]);
    expect(now(doc, l.id).surface.pixel(0, 0)[3]).toBe(0);
  });
});
