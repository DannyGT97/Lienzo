import { writePsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { BLEND_MODES } from './blend';
import { flatten } from './composite';
import { addLayer, createDocument } from './document';
import { exportFlatPsd, exportPsd, importPsd } from './psd';
import { createMask } from './mask-ops';
import { groupLayers } from './layer-tree';
import { Selection } from './selection';
import { bufPixel, fillLayer, setPixel } from './test-utils';

function sampleDoc() {
  const doc = createDocument(6, 4);
  doc.layers[0]!.name = 'Fondo';
  fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
  const a = addLayer(doc, 'Sombras');
  a.blend = 'multiply';
  a.opacity = 0.6;
  for (let i = 0; i < 6 * 4; i++) setPixel(a, i % 6, Math.floor(i / 6), [40, 60, 200, i % 3 === 0 ? 0 : 180]);
  const b = addLayer(doc, 'Recorte');
  b.clip = true;
  b.visible = false;
  b.lockAlpha = true;
  b.blend = 'overlay';
  setPixel(b, 4, 2, [255, 0, 0, 255]);
  return doc;
}

describe('PSD round trip', () => {
  it('preserves pixels, names, order, opacity, mode and flags', () => {
    const doc = sampleDoc();
    const { value, warnings } = exportPsd(doc);
    expect(warnings).toEqual([]);
    const back = importPsd(value).value;

    expect([back.width, back.height]).toEqual([6, 4]);
    expect(back.layers.map((l) => l.name)).toEqual(['Fondo', 'Sombras', 'Recorte']);
    doc.layers.forEach((orig, i) => {
      const got = back.layers[i]!;
      if (got.kind === 'paper') {
        // A page-wide opaque colour comes back as a paper layer, not as pixels.
        expect(got.paperColor).toEqual(orig.surface.pixel(0, 0).slice(0, 3));
        expect(got.surface.isEmpty).toBe(true);
        return;
      }
      expect(got.blend).toBe(orig.blend);
      expect(got.opacity).toBeCloseTo(orig.opacity, 2);
      expect(got.visible).toBe(orig.visible);
      expect(got.clip).toBe(orig.clip);
      expect(got.lockAlpha).toBe(orig.lockAlpha);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 6; x++) {
          const o = orig.surface.pixel(x, y);
          const g = got.surface.pixel(x, y);
          expect(g[3]).toBe(o[3]);
          // Fully transparent pixels carry no colour: compare colour only where alpha > 0.
          if (o[3] !== 0) expect(g).toEqual(o);
        }
      }
    });
    expect(Array.from(flatten(back))).toEqual(Array.from(flatten(doc)));
  });

  it('writes a PSB (version 2) that reads back the same as the PSD', () => {
    const doc = sampleDoc();
    const psd = new Uint8Array(exportPsd(doc).value);
    const psb = new Uint8Array(exportPsd(doc, { large: true }).value);
    expect(Array.from(psd.subarray(0, 6))).toEqual([0x38, 0x42, 0x50, 0x53, 0, 1]);
    expect(Array.from(psb.subarray(0, 6))).toEqual([0x38, 0x42, 0x50, 0x53, 0, 2]);
    const back = importPsd(psb.buffer.slice(psb.byteOffset, psb.byteOffset + psb.byteLength) as ArrayBuffer).value;
    expect(back.layers.map((l) => l.name)).toEqual(['Fondo', 'Sombras', 'Recorte']);
    expect(Array.from(flatten(back))).toEqual(Array.from(flatten(doc)));
  });

  it('keeps empty layers', () => {
    const doc = createDocument(4, 4);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    addLayer(doc, 'Vacía');
    const back = importPsd(exportPsd(doc).value).value;
    expect(back.layers.map((l) => l.name)).toEqual(['Layer 1', 'Vacía']);
    expect(back.layers[1]!.surface.isEmpty).toBe(true);
  });

  it('exports a paper layer as an opaque layer and reads it back as paper, costing no pixels', () => {
    const doc = createDocument(300, 300);
    doc.layers[0]!.kind = 'paper';
    doc.layers[0]!.paperColor = [10, 20, 30];
    const top = addLayer(doc, 'tinta');
    setPixel(top, 5, 5, [255, 0, 0, 255]);
    const back = importPsd(exportPsd(doc).value).value;
    expect(back.layers[0]!.kind).toBe('paper');
    expect(back.layers[0]!.paperColor).toEqual([10, 20, 30]);
    expect(back.layers[0]!.surface.tileCount).toBe(0);
    expect(back.layers[1]!.kind).toBe('raster');
    expect(Array.from(flatten(back))).toEqual(Array.from(flatten(doc)));
  });

  it('keeps a page-wide layer that is not one flat colour as pixels', () => {
    const doc = createDocument(300, 300);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    setPixel(doc.layers[0]!, 150, 150, [0, 0, 0, 255]);
    const back = importPsd(exportPsd(doc).value).value;
    expect(back.layers[0]!.kind).toBe('raster');
    expect(back.layers[0]!.surface.pixel(150, 150)).toEqual([0, 0, 0, 255]);
  });

  it('writes only the content rectangle of each layer', () => {
    const doc = createDocument(800, 800);
    const l = doc.layers[0]!;
    setPixel(l, 700, 650, [1, 2, 3, 255]);
    setPixel(l, 710, 660, [4, 5, 6, 255]);
    const back = importPsd(exportPsd(doc).value).value;
    expect(back.layers[0]!.surface.contentBounds()).toEqual({ x: 700, y: 650, w: 11, h: 11 });
    expect(back.layers[0]!.surface.pixel(710, 660)).toEqual([4, 5, 6, 255]);
  });

  it('round-trips every blend mode that has a PSD equivalent', () => {
    const approx = new Set(['glowDodge', 'addGlow']);
    for (const mode of BLEND_MODES) {
      const doc = createDocument(2, 2);
      doc.layers[0]!.blend = mode;
      fillLayer(doc.layers[0]!, [200, 200, 200, 200]);
      const { value, warnings } = exportPsd(doc);
      expect(warnings.length > 0).toBe(approx.has(mode));
      if (!approx.has(mode)) expect(importPsd(value).value.layers[0]!.blend).toBe(mode);
    }
  });
});

describe('PSD import', () => {
  it('places offset layers, keeps groups as folders and reports unsupported content', () => {
    const px = (w: number, h: number, rgba: number[]) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Array.from({ length: w * h }, () => rgba).flat()),
    });
    const buf = writePsd({
      width: 8,
      height: 8,
      children: [
        { name: 'offset', left: 3, top: 2, imageData: px(2, 2, [255, 0, 0, 255]) },
        {
          name: 'grupo',
          opacity: 0.5,
          children: [{ name: 'dentro', opacity: 0.5, imageData: px(8, 8, [0, 255, 0, 255]), blendMode: 'dissolve' }],
        },
      ],
    });
    const { value: doc, warnings } = importPsd(buf);
    expect(doc.layers.map((l) => l.name)).toEqual(['offset', 'dentro', 'grupo']);
    const off = doc.layers[0]!;
    expect(off.surface.pixel(3, 2)).toEqual([255, 0, 0, 255]);
    expect(off.surface.alphaAt(2, 2)).toBe(0);
    expect(doc.layers[1]!.opacity).toBeCloseTo(0.5, 2);
    expect(doc.layers[2]!.kind).toBe('folder');
    expect(doc.layers[2]!.opacity).toBeCloseTo(0.5, 2);
    expect(doc.layers[1]!.parent).toBe(doc.layers[2]!.id);
    expect(warnings.some((w) => w.includes('dissolve'))).toBe(true);
  });

  it('falls back to the composite image for a PSD without layers', () => {
    const data = new Uint8ClampedArray(Array.from({ length: 4 }, () => [77, 120, 200, 255]).flat());
    const buf = writePsd({ width: 2, height: 2, imageData: { width: 2, height: 2, data } });
    const { value: doc } = importPsd(buf);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]!.surface.pixel(0, 0)).toEqual([77, 120, 200, 255]);
  });

  it('keeps folders (pass through or not) and layer masks through export and import', () => {
    const doc = createDocument(300, 100);
    fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
    const a = addLayer(doc, 'a');
    fillLayer(a, [0, 0, 0, 255]);
    const b = addLayer(doc, 'b');
    setPixel(b, 5, 5, [255, 0, 0, 255]);
    const f = groupLayers(doc, [a.id, b.id], 'Carpeta')!;
    f.through = false;
    f.opacity = 0.8;
    f.open = false;
    createMask(doc, a.id, 'selection', Selection.rect(300, 100, { x: 0, y: 0, w: 100, h: 100 }));
    const { value, warnings } = exportPsd(doc);
    expect(warnings).toEqual([]);
    const back = importPsd(value).value;
    expect(back.layers.map((l) => l.name)).toEqual(['Layer 1', 'a', 'b', 'Carpeta']);
    const folder = back.layers[3]!;
    expect(folder.kind).toBe('folder');
    expect(folder.through).toBe(false);
    expect(folder.opacity).toBeCloseTo(0.8, 2);
    expect(folder.open).toBe(false);
    expect(back.layers[1]!.parent).toBe(folder.id);
    const mask = back.layers[1]!.mask!;
    expect(mask.enabled).toBe(true);
    expect(mask.base).toBe(0);
    expect(Array.from(flatten(back)).join()).toBe(Array.from(flatten(doc)).join());
    expect(bufPixel(flatten(back), 300, 200, 50)).toEqual([255, 255, 255, 255]);
    const through = groupLayers(doc, [f.id], 'Otra')!;
    expect(through.through).toBe(true);
    expect(importPsd(exportPsd(doc).value).value.layers.at(-1)!.through).toBe(true);
  });
});

describe('flat PSD export', () => {
  it('holds one layer with the merged page, not the layers of the document', () => {
    const doc = sampleDoc();
    const layered = importPsd(exportPsd(doc).value).value;
    expect(layered.layers.length).toBe(3);

    const { value, warnings } = exportFlatPsd(doc);
    expect(warnings).toEqual([]);
    const back = importPsd(value).value;
    expect([back.width, back.height]).toEqual([6, 4]);
    expect(back.layers).toHaveLength(1);
    expect(back.layers[0]!.name).toBe('Imagen combinada');
    expect(back.layers[0]!.blend).toBe('normal');
    expect(back.layers[0]!.opacity).toBe(1);

    // that one layer is the finished page: what flattening the document gives
    expect(Array.from(flatten(back))).toEqual(Array.from(flatten(doc, { output: true })));
  });

  it('leaves out hidden layers like any output, and keeps transparency where nothing is drawn', () => {
    const doc = createDocument(4, 2);
    doc.layers[0]!.visible = false; // the only layer is hidden: nothing to show
    const back = importPsd(exportFlatPsd(doc).value).value;
    expect(back.layers).toHaveLength(1);
    expect(Array.from(flatten(back)).every((v) => v === 0)).toBe(true);
  });

  it('writes a PSB with one layer when asked for the large format', () => {
    const doc = sampleDoc();
    const bytes = new Uint8Array(exportFlatPsd(doc, { large: true }).value);
    expect(bytes[4]).toBe(0);
    expect(bytes[5]).toBe(2); // version 2 = PSB
    const back = importPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).value;
    expect(back.layers).toHaveLength(1);
  });
});
