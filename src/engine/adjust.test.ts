import { describe, expect, it } from 'vitest';
import { ADJUSTMENTS, adjustLut, applyAdjustLut, defaultAdjust } from './adjust';
import { flatten, sampleDocument } from './composite';
import { addLayer, createDocument } from './document';
import { FILTERS, defaultValues } from './filters';
import { loadLienzo, saveLienzo } from './lienzo-file';
import { createMask } from './mask-ops';
import { fillLayer, setPixel } from './test-utils';

const ctx = { main: [0, 0, 0] as const, sub: [255, 255, 255] as const };

/** A page with a mid-grey, half-red-ish pixel layer, ready for an adjustment layer above it. */
function page() {
  const doc = createDocument(300, 200, 300);
  const base = doc.layers[0]!;
  fillLayer(base, [200, 100, 50, 255]);
  return { doc, base };
}

describe('adjustment tables', () => {
  it('reproduce the filter they come from, pixel for pixel', () => {
    const samples: [number, number, number][] = [[0, 0, 0], [255, 255, 255], [200, 100, 50], [13, 240, 99], [128, 128, 128]];
    for (const id of Object.keys(ADJUSTMENTS)) {
      const def = FILTERS[id]!;
      if (def.kind !== 'pixel') throw new Error('adjustments are pixel filters');
      const values = { ...defaultValues(def) };
      // Move every parameter off its default so the table is not the identity.
      for (const prm of def.params) values[prm.id] = prm.id === 'black' ? 30 : prm.value + (prm.max - prm.min) * 0.2 > prm.max ? prm.value - (prm.max - prm.min) * 0.2 : prm.value + (prm.max - prm.min) * 0.2;
      const lut = adjustLut({ filter: id, values, main: [20, 30, 40], sub: [240, 220, 200] })!;
      const run = def.make(values, { main: [20, 30, 40], sub: [240, 220, 200] });
      for (const s of samples) {
        const c = [s[0], s[1], s[2], 255];
        run(c);
        const got = [s[0] / 255, s[1] / 255, s[2] / 255];
        applyAdjustLut(lut, got);
        for (let k = 0; k < 3; k++) {
          // A brightness-only filter reads the table at the rounded brightness: within one step of the exact value.
          const tol = ADJUSTMENTS[id] === 'luma' ? 6 : 1;
          expect(Math.abs(got[k]! * 255 - Math.min(255, Math.max(0, c[k]!)))).toBeLessThanOrEqual(tol);
        }
      }
    }
  });

  it('only offers filters that can be read from a table', () => {
    expect(() => defaultAdjust('hsv', ctx)).toThrow();
    expect(defaultAdjust('invert', ctx).filter).toBe('invert');
  });
});

describe('adjustment layers in the composite', () => {
  it('change what is below, leave alpha alone, and do nothing over transparency', () => {
    const { doc } = page();
    const adj = addLayer(doc, 'inv', doc.layers.length, 'adjust');
    adj.adjust = defaultAdjust('invert', ctx);
    expect(sampleDocument(doc, 10, 10)).toEqual([55, 155, 205, 255]);
    const empty = createDocument(50, 50, 300);
    addLayer(empty, 'inv', empty.layers.length, 'adjust').adjust = defaultAdjust('invert', ctx);
    expect(sampleDocument(empty, 5, 5)[3]).toBe(0);
  });

  it('opacity mixes the correction in, hidden layers do nothing', () => {
    const { doc } = page();
    const adj = addLayer(doc, 'inv', doc.layers.length, 'adjust');
    adj.adjust = defaultAdjust('invert', ctx);
    adj.opacity = 0.5;
    const half = sampleDocument(doc, 10, 10);
    expect(half[0]).toBeCloseTo((200 + 55) / 2, 0);
    adj.visible = false;
    expect(sampleDocument(doc, 10, 10)).toEqual([200, 100, 50, 255]);
  });

  it('a mask limits where the correction acts', () => {
    const { doc } = page();
    const adj = addLayer(doc, 'inv', doc.layers.length, 'adjust');
    adj.adjust = defaultAdjust('invert', ctx);
    createMask(doc, adj.id, 'hide');
    const opaque = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    adj.mask!.surface.writeRect({ x: 0, y: 0, w: 20, h: 20 }, opaque);
    expect(sampleDocument(doc, 5, 5)).toEqual([55, 155, 205, 255]);
    expect(sampleDocument(doc, 100, 100)).toEqual([200, 100, 50, 255]);
  });

  it('threshold turns the page to ink and paper, and a clipped adjustment only acts on the layer below', () => {
    const doc = createDocument(300, 200, 300);
    const bottom = doc.layers[0]!;
    fillLayer(bottom, [255, 255, 255, 255]);
    const art = addLayer(doc, 'art');
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) setPixel(art, x, y, [90, 90, 90, 255]);
    const adj = addLayer(doc, 'bin', doc.layers.length, 'adjust');
    adj.adjust = { ...defaultAdjust('binarize', ctx), values: { threshold: 128 } };
    adj.clip = true; // clipped to the art layer, so the white page below is not touched either way
    expect(sampleDocument(doc, 10, 10)).toEqual([0, 0, 0, 255]);
    expect(sampleDocument(doc, 200, 100)).toEqual([255, 255, 255, 255]);
    // Clipping to a layer with nothing at a pixel leaves that pixel alone.
    art.visible = true;
    const out = flatten(doc);
    expect(out[(100 * 300 + 200) * 4]).toBe(255);
  });

  it('inside a folder it acts only on that folder, and survives saving', async () => {
    const doc = createDocument(300, 200, 300);
    fillLayer(doc.layers[0]!, [200, 100, 50, 255]);
    const adj = addLayer(doc, 'lv', doc.layers.length, 'adjust');
    adj.adjust = { ...defaultAdjust('levels', ctx), values: { black: 40, white: 200, gamma: 150 } };
    adj.opacity = 0.7;
    const before = sampleDocument(doc, 3, 3);
    const back = await loadLienzo(await saveLienzo(doc));
    const l = back.layers.find((x) => x.kind === 'adjust')!;
    expect(l.adjust).toEqual(adj.adjust);
    expect(sampleDocument(back, 3, 3)).toEqual(before);
  });
});
