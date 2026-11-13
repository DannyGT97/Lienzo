import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { History, patchCommand } from './history';
import { Selection } from './selection';
import { IDENTITY, about, apply, invert, mapRect, rotation, scaling, compose, transformLayerPixels, transformSelection, translation } from './transform';
import { fillLayer, setPixel } from './test-utils';

describe('affine maps', () => {
  it('composes and inverts', () => {
    const m = compose(compose(scaling(2, 3), rotation(Math.PI / 2)), translation(10, 20));
    const p = apply(m, 1, 1);
    const back = apply(invert(m)!, p.x, p.y);
    expect(back.x).toBeCloseTo(1);
    expect(back.y).toBeCloseTo(1);
    expect(invert({ ...IDENTITY, a: 0, d: 0 })).toBeNull();
  });

  it('about() keeps the pivot fixed and mapRect boxes the result', () => {
    const m = about(rotation(Math.PI / 2), 50, 50);
    const p = apply(m, 50, 50);
    expect([Math.round(p.x), Math.round(p.y)]).toEqual([50, 50]);
    const r = mapRect({ x: 40, y: 45, w: 20, h: 10 }, m);
    expect([Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]).toEqual([45, 40, 10, 20]);
  });
});

describe('transformLayerPixels', () => {
  const setup = () => {
    const doc = createDocument(100, 100, 300);
    const layer = addLayer(doc, 'l');
    setPixel(layer, 10, 10, [255, 0, 0, 255]);
    setPixel(layer, 11, 10, [0, 255, 0, 255]);
    setPixel(layer, 10, 11, [0, 0, 255, 255]);
    return { doc, layer };
  };

  it('flips horizontally exactly and undoes through the history', () => {
    const { doc, layer } = setup();
    const rect = { x: 10, y: 10, w: 2, h: 2 };
    const flip = about({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 11, 11);
    const { patch } = transformLayerPixels(layer.surface, layer.id, rect, null, flip);
    expect(patch).not.toBeNull();
    expect(layer.surface.pixel(11, 10)).toEqual([255, 0, 0, 255]);
    expect(layer.surface.pixel(10, 10)).toEqual([0, 255, 0, 255]);
    expect(layer.surface.pixel(11, 11)).toEqual([0, 0, 255, 255]);
    expect(layer.surface.alphaAt(10, 11)).toBe(0);
    const h = new History();
    h.push(patchCommand(doc, patch!, 'Voltear'));
    h.undo();
    expect(layer.surface.pixel(10, 10)).toEqual([255, 0, 0, 255]);
    expect(layer.surface.pixel(10, 11)).toEqual([0, 0, 255, 255]);
    expect(layer.surface.alphaAt(11, 11)).toBe(0);
  });

  it('rotates 90 degrees without losing or inventing pixels', () => {
    const { layer } = setup();
    const rect = { x: 10, y: 10, w: 2, h: 2 };
    transformLayerPixels(layer.surface, layer.id, rect, null, about(rotation(Math.PI / 2), 11, 11));
    // (x, y) -> (22 - y - ... ): the red pixel at the top left goes to the top right.
    expect(layer.surface.pixel(11, 10)).toEqual([255, 0, 0, 255]);
    expect(layer.surface.pixel(11, 11)).toEqual([0, 255, 0, 255]);
    expect(layer.surface.pixel(10, 10)).toEqual([0, 0, 255, 255]);
    let n = 0;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if (layer.surface.alphaAt(x, y)) n++;
    expect(n).toBe(3);
  });

  it('scales up with smooth edges and keeps colours unpremultiplied', () => {
    const doc = createDocument(100, 100, 300);
    const layer = addLayer(doc, 's');
    fillLayer(layer, [0, 0, 0, 0]);
    for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) setPixel(layer, x, y, [200, 100, 50, 255]);
    transformLayerPixels(layer.surface, layer.id, { x: 20, y: 20, w: 4, h: 4 }, null, about(scaling(2, 2), 20, 20));
    expect(layer.surface.pixel(25, 25)).toEqual([200, 100, 50, 255]);
    const edge = layer.surface.pixel(20, 25); // half a source pixel beyond the edge
    expect(edge[3]).toBeGreaterThan(0);
    expect(edge[3]).toBeLessThan(255);
    expect(edge.slice(0, 3)).toEqual([200, 100, 50]);
    expect(layer.surface.alphaAt(28, 25)).toBe(0);
  });

  it('moves only the selected part and leaves the rest', () => {
    const doc = createDocument(100, 100, 300);
    const layer = addLayer(doc, 'm');
    for (let x = 10; x < 30; x++) setPixel(layer, x, 10, [9, 9, 9, 255]);
    const sel = Selection.rect(100, 100, { x: 10, y: 5, w: 10, h: 10 });
    const { patch } = transformLayerPixels(layer.surface, layer.id, sel.bounds()!, sel, translation(0, 20));
    expect(patch).not.toBeNull();
    expect(layer.surface.alphaAt(15, 10)).toBe(0); // moved away
    expect(layer.surface.alphaAt(15, 30)).toBe(255); // arrived
    expect(layer.surface.alphaAt(25, 10)).toBe(255); // unselected part stays
    expect(layer.surface.alphaAt(25, 30)).toBe(0);
  });

  it('does nothing for an empty area', () => {
    const doc = createDocument(100, 100, 300);
    const layer = addLayer(doc, 'e');
    expect(transformLayerPixels(layer.surface, layer.id, { x: 0, y: 0, w: 50, h: 50 }, null, translation(5, 5)).patch).toBeNull();
  });
});

describe('transformSelection', () => {
  it('moves the mask with the pixels', () => {
    const sel = Selection.rect(100, 100, { x: 10, y: 10, w: 10, h: 10 });
    const moved = transformSelection(sel, sel.bounds()!, translation(30, 5));
    expect(moved.at(15, 15)).toBe(0);
    expect(moved.at(45, 20)).toBe(255);
    expect(moved.bounds()).toEqual({ x: 40, y: 15, w: 10, h: 10 });
  });
});
