import { describe, expect, it } from 'vitest';
import { flatten, sampleDocument } from './composite';
import { addLayer, createDocument, type Document, type Layer } from './document';
import { canMergeDown } from './layer-ops';
import { groupLayers } from './layer-tree';
import { createMask } from './mask-ops';
import { Selection } from './selection';
import { bufPixel, fillLayer } from './test-utils';

const W = 16;
const H = 16;
const RED = [255, 0, 0, 255] as const;
const GREEN = [0, 255, 0, 255] as const;
const BLUE = [0, 0, 255, 255] as const;
const NONE = [0, 0, 0, 0];

/** A page whose bottom layer is transparent, with an opaque 4x4 square on `base` at (4,4). */
function scene(): { doc: Document; base: Layer } {
  const doc = createDocument(W, H, 300);
  const base = doc.layers[0]!;
  base.surface.writeRect({ x: 4, y: 4, w: 4, h: 4 }, Uint8ClampedArray.from({ length: 64 }, (_, i) => (i % 4 === 0 ? 40 : i % 4 === 3 ? 255 : 40)));
  return { doc, base };
}

const clipped = (doc: Document, name: string, color: readonly [number, number, number, number]): Layer => {
  const l = addLayer(doc, name);
  fillLayer(l, color);
  l.clip = true;
  return l;
};
const at = (doc: Document, x: number, y: number, o = {}): number[] => bufPixel(flatten(doc, o), W, x, y);

describe('clipping chains', () => {
  it('every consecutive clipped layer is limited by the one unclipped layer below the chain', () => {
    const { doc } = scene();
    clipped(doc, 'a', RED);
    clipped(doc, 'b', GREEN);
    const c = clipped(doc, 'c', BLUE);
    c.opacity = 0.5;
    expect(at(doc, 5, 5)[3]).toBe(255);
    expect(at(doc, 0, 0)).toEqual(NONE);
    expect(at(doc, 8, 5)).toEqual(NONE); // one pixel past the square
    expect(at(doc, 5, 8)).toEqual(NONE);
    expect(sampleDocument(doc, 12, 12)[3]).toBe(0);
  });

  it('a hidden clipped layer in the middle does not break the chain', () => {
    const { doc } = scene();
    const a = clipped(doc, 'a', RED);
    a.visible = false;
    clipped(doc, 'b', GREEN);
    expect(at(doc, 5, 5)).toEqual([0, 255, 0, 255]);
    expect(at(doc, 1, 1)).toEqual(NONE);
  });

  it('a hidden base hides the layers clipped to it', () => {
    const { doc, base } = scene();
    clipped(doc, 'a', RED);
    clipped(doc, 'b', GREEN);
    base.visible = false;
    expect(at(doc, 5, 5)).toEqual(NONE);
    base.visible = true;
    expect(at(doc, 5, 5)[3]).toBe(255);
  });

  it('an empty base shows nothing of its clipped layers, and painting the base reveals them', () => {
    const doc = createDocument(W, H, 300);
    clipped(doc, 'a', RED);
    expect(at(doc, 5, 5)).toEqual(NONE);
    doc.layers[0]!.surface.writeRect({ x: 5, y: 5, w: 1, h: 1 }, new Uint8ClampedArray([9, 9, 9, 255]));
    expect(at(doc, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(at(doc, 6, 5)).toEqual(NONE);
  });

  it('a masked base limits the whole chain by what its mask lets through', () => {
    const { doc, base } = scene();
    clipped(doc, 'a', RED);
    clipped(doc, 'b', GREEN);
    createMask(doc, base.id, 'selection', Selection.rect(W, H, { x: 0, y: 0, w: 6, h: H }));
    expect(at(doc, 5, 5)[3]).toBe(255);
    expect(at(doc, 6, 5)).toEqual(NONE);
  });

  it('layers that are not clipped keep showing outside the base', () => {
    const { doc } = scene();
    clipped(doc, 'a', RED);
    const free = addLayer(doc, 'free');
    fillLayer(free, BLUE);
    expect(at(doc, 0, 0)).toEqual([0, 0, 255, 255]);
  });

  it('a new unclipped layer starts a new chain', () => {
    const { doc } = scene();
    clipped(doc, 'a', RED);
    const second = addLayer(doc, 'second base');
    second.surface.writeRect({ x: 10, y: 10, w: 2, h: 2 }, new Uint8ClampedArray(16).fill(255));
    clipped(doc, 'b', GREEN);
    expect(at(doc, 5, 5)).toEqual([255, 0, 0, 255]); // b is not over the first square
    expect(at(doc, 10, 10)).toEqual([0, 255, 0, 255]);
    expect(at(doc, 11, 11)).toEqual([0, 255, 0, 255]);
    expect(at(doc, 9, 9)).toEqual(NONE);
  });

  it('inside a folder the chain keeps to the layers of that folder', () => {
    const { doc, base } = scene();
    const a = clipped(doc, 'a', RED);
    const b = clipped(doc, 'b', GREEN);
    groupLayers(doc, [base.id, a.id, b.id], 'F');
    expect(at(doc, 5, 5)).toEqual([0, 255, 0, 255]);
    expect(at(doc, 1, 1)).toEqual(NONE);
  });

  it('a clipped layer first in its folder has no base and shows nothing', () => {
    const { doc } = scene();
    const a = clipped(doc, 'a', RED);
    groupLayers(doc, [a.id], 'F');
    expect(at(doc, 5, 5)).toEqual([40, 40, 40, 255]); // only the base: the red layer has nothing to be clipped to
  });

  it('to limit a layer to the shape of another clipped layer, both go in a clipped folder', () => {
    const { doc } = scene();
    const shadow = addLayer(doc, 'shadow'); // unclipped inside the folder: it is the base of the detail
    shadow.surface.writeRect({ x: 4, y: 4, w: 2, h: 4 }, new Uint8ClampedArray(32).fill(255));
    const detail = addLayer(doc, 'detail');
    fillLayer(detail, BLUE);
    detail.clip = true;
    const folder = groupLayers(doc, [shadow.id, detail.id], 'details')!;
    folder.clip = true; // the folder itself is limited by the base below it
    folder.through = false;
    expect(at(doc, 4, 5)).toEqual([0, 0, 255, 255]); // detail, inside the shadow
    expect(at(doc, 6, 5)).toEqual([40, 40, 40, 255]); // base only: beyond the shadow
    expect(at(doc, 0, 0)).toEqual(NONE);
  });

  it('a draft base left out of the output takes its clipped layers with it', () => {
    const doc = createDocument(W, H, 300);
    fillLayer(doc.layers[0]!, [200, 200, 200, 255]); // an opaque layer under the draft: the red must not clip to it instead
    const draft = addLayer(doc, 'draft');
    draft.surface.writeRect({ x: 4, y: 4, w: 4, h: 4 }, new Uint8ClampedArray(64).fill(255));
    draft.role = 'draft';
    clipped(doc, 'a', RED);
    expect(at(doc, 5, 5)).toEqual([255, 0, 0, 255]); // shown while working
    expect(at(doc, 5, 5, { output: true })).toEqual([200, 200, 200, 255]);
    expect(at(doc, 12, 12, { output: true })).toEqual([200, 200, 200, 255]);
  });

  it('only the reference layers: a clipped layer whose base is not a reference is left out too', () => {
    const doc = createDocument(W, H, 300);
    const under = doc.layers[0]!;
    under.role = 'reference';
    fillLayer(under, [200, 200, 200, 255]);
    const base = addLayer(doc, 'base');
    base.surface.writeRect({ x: 4, y: 4, w: 4, h: 4 }, new Uint8ClampedArray(64).fill(255));
    const c = clipped(doc, 'c', RED);
    c.role = 'reference';
    expect(at(doc, 5, 5, { only: 'reference' })).toEqual([200, 200, 200, 255]);
  });

  it('merging down is refused when the layer below is itself clipped', () => {
    const { doc } = scene();
    const a = clipped(doc, 'a', RED);
    const b = clipped(doc, 'b', GREEN);
    expect(canMergeDown(doc, b.id)).toBe(false);
    expect(canMergeDown(doc, a.id)).toBe(true);
  });
});
