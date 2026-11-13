import { describe, expect, it } from 'vitest';
import { addLayer, createDocument, type Layer } from './document';
import { copyLayers, duplicateLayer, pasteLayers } from './layer-ops';
import { dropEverything, layerReach, liftEverything, overflowBounds, overflowCommand, settle } from './overflow';
import { scaling, TileRecorder, translation } from './transform';
import { TiledSurface } from './tiles';
import { Warp } from './warp';
import { setPixel } from './test-utils';

const RED = [255, 0, 0, 255] as const;
const GREEN = [0, 255, 0, 255] as const;

/** A page of 100×80 with a layer holding a pixel inside it and one beyond its right and bottom edges. */
function bigSource() {
  const doc = createDocument(300, 240, 300);
  const layer = addLayer(doc, 'Grande');
  setPixel(layer, 10, 10, RED);
  setPixel(layer, 250, 200, GREEN);
  return { doc, layer };
}

describe('settle', () => {
  it('keeps what is inside the page on the page and the rest as overflow', () => {
    const src = new TiledSurface(300, 240);
    src.writeRect({ x: 10, y: 10, w: 1, h: 1 }, new Uint8ClampedArray(RED));
    src.writeRect({ x: 250, y: 200, w: 1, h: 1 }, new Uint8ClampedArray(GREEN));
    const { surface, overflow } = settle([{ surface: src, x: 0, y: 0 }], 100, 80);
    expect(surface.pixel(10, 10)).toEqual([255, 0, 0, 255]);
    expect(overflow).toBeDefined();
    expect(overflowBounds(overflow)).toEqual({ x: 250, y: 200, w: 1, h: 1 });
    expect(overflow!.surface.pixel(250 - overflow!.x, 200 - overflow!.y)).toEqual([0, 255, 0, 255]);
    // The part inside the page is not kept twice.
    expect(overflow!.surface.pixel(10 - overflow!.x, 10 - overflow!.y)[3]).toBe(0);
  });

  it('has no overflow when everything fits, and reaches negative places', () => {
    const src = new TiledSurface(50, 50);
    src.writeRect({ x: 5, y: 5, w: 1, h: 1 }, new Uint8ClampedArray(RED));
    expect(settle([{ surface: src, x: 0, y: 0 }], 100, 80).overflow).toBeUndefined();
    const left = settle([{ surface: src, x: -20, y: 0 }], 100, 80);
    expect(left.overflow).toMatchObject({ x: -15, y: 0 });
    expect(overflowBounds(left.overflow)).toEqual({ x: -15, y: 5, w: 1, h: 1 });
  });
});

describe('copying a layer that is bigger than the page', () => {
  it('pastes into a smaller page, keeping what falls outside in the layer', () => {
    const { doc, layer } = bigSource();
    const clip = copyLayers(doc, [layer.id])!;
    const small = createDocument(100, 80, 300);
    const [made] = pasteLayers(small, clip);
    expect(made!.surface.pixel(10, 10)).toEqual([255, 0, 0, 255]);
    expect(made!.surface.width).toBe(100);
    expect(overflowBounds(made!.overflow)).toEqual({ x: 250, y: 200, w: 1, h: 1 });
    expect(layerReach(made!)).toEqual({ x: 10, y: 10, w: 241, h: 191 });
  });

  it('carries the overflow through a copy to a bigger page, where it lands inside', () => {
    const { doc, layer } = bigSource();
    const small = createDocument(100, 80, 300);
    const [made] = pasteLayers(small, copyLayers(doc, [layer.id])!);
    const big = createDocument(400, 300, 300);
    const [back] = pasteLayers(big, copyLayers(small, [made!.id])!);
    expect(back!.overflow).toBeUndefined();
    expect(back!.surface.pixel(250, 200)).toEqual([0, 255, 0, 255]);
    expect(back!.surface.pixel(10, 10)).toEqual([255, 0, 0, 255]);
  });

  it('duplicates the overflow without sharing it', () => {
    const { doc, layer } = bigSource();
    const small = createDocument(100, 80, 300);
    const [made] = pasteLayers(small, copyLayers(doc, [layer.id])!);
    const copy = duplicateLayer(small, made!.id)!;
    expect(copy.overflow).toBeDefined();
    expect(copy.overflow).not.toBe(made!.overflow);
    expect(copy.overflow!.surface).not.toBe(made!.overflow!.surface);
    expect(overflowBounds(copy.overflow)).toEqual(overflowBounds(made!.overflow));
  });
});

describe('liftEverything / dropEverything', () => {
  function pasted() {
    const { doc, layer } = bigSource();
    const small = createDocument(100, 80, 300);
    const [made] = pasteLayers(small, copyLayers(doc, [layer.id])!);
    return { small, layer: made! };
  }

  it('lifts the page and the overflow as one picture', () => {
    const { layer } = pasted();
    const rec = new TileRecorder(layer.surface, layer.id);
    const lifted = liftEverything(layer, rec)!;
    expect(lifted.rect).toEqual({ x: 10, y: 10, w: 241, h: 191 });
    const at = (x: number, y: number): number[] => Array.from(lifted.pixels.subarray(((y - 10) * 241 + (x - 10)) * 4, ((y - 10) * 241 + (x - 10)) * 4 + 4));
    expect(at(10, 10)).toEqual([255, 0, 0, 255]);
    expect(at(250, 200)).toEqual([0, 255, 0, 255]);
    expect(layer.surface.pixel(10, 10)[3]).toBe(0); // taken out of the page
  });

  it('scaling it down brings the part that was outside into the page', () => {
    const { doc, layer: big } = bigSource();
    for (let y = 200; y < 220; y++) for (let x = 250; x < 270; x++) setPixel(big, x, y, GREEN);
    const small = createDocument(100, 80, 300);
    const [layer] = pasteLayers(small, copyLayers(doc, [big.id])!) as [Layer];
    const rec = new TileRecorder(layer.surface, layer.id);
    const lifted = liftEverything(layer, rec)!;
    const before = layer.overflow;
    expect(before).toBeDefined();
    const m = scaling(0.3, 0.3);
    const { overflow } = dropEverything(layer, rec, lifted, { m });
    expect(overflow).toBeUndefined();
    expect(layer.overflow).toBeUndefined();
    // The green block (250.., 200..) is now near (75.., 60..), inside the 100×80 page.
    let found = false;
    for (let y = 55; y < 70; y++) for (let x = 70; x < 85; x++) if (layer.surface.pixel(x, y)[1] > 100) found = true;
    expect(found).toBe(true);
    // The undo/redo step swaps the overflow back and forth.
    const step = overflowCommand(layer, before, layer.overflow, 'x')!;
    step.undo();
    expect(layer.overflow).toBe(before);
    step.redo();
    expect(layer.overflow).toBeUndefined();
  });

  it('moving it back keeps what still sticks out', () => {
    const { layer } = pasted();
    const rec = new TileRecorder(layer.surface, layer.id);
    const lifted = liftEverything(layer, rec)!;
    const { overflow } = dropEverything(layer, rec, lifted, { m: translation(-5, -5) });
    expect(layer.surface.pixel(5, 5)).toEqual([255, 0, 0, 255]);
    expect(overflowBounds(overflow)).toEqual({ x: 245, y: 195, w: 1, h: 1 });
  });

  it('keeps content moved off the page on its left/top (negative places) and drops what is far away', () => {
    const doc = createDocument(100, 80, 300);
    const layer = addLayer(doc, 'L');
    setPixel(layer, 5, 5, RED);
    const rec = new TileRecorder(layer.surface, layer.id);
    const lifted = liftEverything(layer, rec)!;
    const near = dropEverything(layer, rec, lifted, { m: translation(-30, -20) });
    expect(overflowBounds(near.overflow)).toEqual({ x: -25, y: -15, w: 1, h: 1 });
    const rec2 = new TileRecorder(layer.surface, layer.id);
    const again = liftEverything(layer, rec2)!;
    expect(again.rect).toEqual({ x: -25, y: -15, w: 1, h: 1 });
    // Further than a page away from the edge is let go.
    const far = dropEverything(layer, rec2, again, { m: translation(-500, 0) });
    expect(far.overflow).toBeUndefined();
  });

  it('drops through a warp as well', () => {
    const { layer } = pasted();
    const rec = new TileRecorder(layer.surface, layer.id);
    const lifted = liftEverything(layer, rec)!;
    const r = lifted.rect;
    const warp = Warp.quad(r, [
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 70 },
      { x: 0, y: 70 },
    ])!;
    const { overflow } = dropEverything(layer, rec, lifted, { warp });
    expect(overflow).toBeUndefined();
    let ink = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 100; x++) if (layer.surface.pixel(x, y)[3] > 0) ink++;
    expect(ink).toBeGreaterThan(0);
  });
});
