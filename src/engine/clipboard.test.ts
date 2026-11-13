import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { copyPixels, pasteClip } from './clipboard';
import { Selection } from './selection';
import { setPixel } from './test-utils';

describe('copy and paste of pixels', () => {
  const setup = () => {
    const doc = createDocument(600, 100, 300);
    const layer = addLayer(doc, 'l');
    setPixel(layer, 280, 20, [255, 0, 0, 255]); // either side of a tile border
    setPixel(layer, 300, 30, [0, 255, 0, 255]);
    return { doc, layer };
  };

  it('copies the visible part of a layer when nothing is selected', () => {
    const { layer } = setup();
    const clip = copyPixels(layer.surface, null)!;
    expect(clip.rect).toEqual({ x: 280, y: 20, w: 21, h: 11 });
    expect(Array.from(clip.pixels.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('keeps only what is selected, with partial coverage as partial alpha', () => {
    const { layer } = setup();
    const sel = Selection.rect(600, 100, { x: 275, y: 15, w: 10.5, h: 10 });
    const clip = copyPixels(layer.surface, sel)!;
    expect(clip.rect).toEqual({ x: 280, y: 20, w: 1, h: 1 });
    expect(copyPixels(layer.surface, Selection.rect(600, 100, { x: 0, y: 60, w: 50, h: 20 }))).toBeNull();
  });

  it('pastes at the same place or moved, and drops what falls off the page', () => {
    const { doc, layer } = setup();
    const clip = copyPixels(layer.surface, null)!;
    const fresh = addLayer(doc, 'p');
    expect(pasteClip(fresh.surface, clip, 0, 0)).toEqual({ x: 280, y: 20, w: 21, h: 11 });
    expect(fresh.surface.pixel(300, 30)).toEqual([0, 255, 0, 255]);
    const moved = addLayer(doc, 'q');
    pasteClip(moved.surface, clip, 100, 40);
    expect(moved.surface.pixel(380, 60)).toEqual([255, 0, 0, 255]);
    expect(moved.surface.alphaAt(280, 20)).toBe(0);
    const off = addLayer(doc, 'r');
    expect(pasteClip(off.surface, clip, 310, 0)).toEqual({ x: 590, y: 20, w: 10, h: 11 }); // the part past the page edge is dropped
    expect(pasteClip(off.surface, clip, 400, 0)).toBeNull();
    expect(pasteClip(off.surface, clip, 1000, 0)).toBeNull();
  });
});
