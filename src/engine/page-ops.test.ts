import { describe, expect, it } from 'vitest';
import { addLayer, createDocument, type Document } from './document';
import { History } from './history';
import { createMask } from './mask-ops';
import { anchoredWindow, applyPageOp } from './page-ops';
import { Selection } from './selection';
import { setPixel } from './test-utils';
import { TiledSurface } from './tiles';

const W = 600;
const H = 300;

function sample(): { doc: Document; id: number } {
  const doc = createDocument(W, H, 300);
  const l = addLayer(doc, 'dibujo');
  setPixel(l, 0, 0, [255, 0, 0, 255]); // top left
  setPixel(l, W - 1, 0, [0, 255, 0, 255]); // top right
  setPixel(l, 299, 299, [0, 0, 255, 255]); // across the tile border, bottom of the page
  doc.guides = { v: [100], h: [50] };
  return { doc, id: l.id };
}
const layer = (doc: Document, id: number) => doc.layers.find((l) => l.id === id)!;

describe('page operations', () => {
  it('rotates a quarter turn clockwise and swaps the page size', () => {
    const { doc, id } = sample();
    const cmd = applyPageOp(doc, { kind: 'rotate', turns: 1 }, 'Girar')!;
    expect([doc.width, doc.height]).toEqual([H, W]);
    const s = layer(doc, id).surface;
    expect(s.pixel(H - 1, 0)).toEqual([255, 0, 0, 255]); // the top left goes to the top right
    expect(s.pixel(H - 1, W - 1)).toEqual([0, 255, 0, 255]); // the top right goes to the bottom right
    expect(s.pixel(0, 299)).toEqual([0, 0, 255, 255]);
    expect(doc.guides).toEqual({ v: [H - 50], h: [100] });
    cmd.undo();
    expect([doc.width, doc.height]).toEqual([W, H]);
    expect(layer(doc, id).surface.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(doc.guides).toEqual({ v: [100], h: [50] });
  });

  it('four quarter turns bring everything back', () => {
    const { doc, id } = sample();
    for (let i = 0; i < 4; i++) applyPageOp(doc, { kind: 'rotate', turns: 1 }, 'Girar');
    const s = layer(doc, id).surface;
    expect([doc.width, doc.height]).toEqual([W, H]);
    expect(s.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(s.pixel(W - 1, 0)).toEqual([0, 255, 0, 255]);
    expect(s.pixel(299, 299)).toEqual([0, 0, 255, 255]);
  });

  it('flips horizontally and vertically', () => {
    const { doc, id } = sample();
    applyPageOp(doc, { kind: 'flip', axis: 'h' }, 'Voltear');
    expect(layer(doc, id).surface.pixel(W - 1, 0)).toEqual([255, 0, 0, 255]);
    expect(layer(doc, id).surface.pixel(0, 0)).toEqual([0, 255, 0, 255]);
    expect(doc.guides.v).toEqual([W - 100]);
    applyPageOp(doc, { kind: 'flip', axis: 'v' }, 'Voltear');
    expect(layer(doc, id).surface.pixel(W - 1, H - 1)).toEqual([255, 0, 0, 255]);
    expect(doc.guides.h).toEqual([H - 50]);
  });

  it('crops: the new page starts at the crop corner and what is outside is gone', () => {
    const { doc, id } = sample();
    const h = new History();
    h.push(applyPageOp(doc, { kind: 'crop', rect: { x: 250, y: 100, w: 100, h: 200 } }, 'Recortar')!);
    expect([doc.width, doc.height]).toEqual([100, 200]);
    const s = layer(doc, id).surface;
    expect(s.pixel(49, 199)).toEqual([0, 0, 255, 255]);
    expect(s.tileCount).toBe(1);
    expect(doc.guides).toEqual({ v: [], h: [] }); // both guides were outside the crop
    h.undo();
    expect([doc.width, doc.height]).toEqual([W, H]);
    expect(layer(doc, id).surface.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    h.redo();
    expect(doc.width).toBe(100);
  });

  it('moves the rulers with the page', () => {
    const { doc } = sample();
    doc.rulers = [{ id: 1, kind: 'perspective', pts: [{ x: 100, y: 20 }] }];
    applyPageOp(doc, { kind: 'rotate', turns: 1 }, 'Girar');
    expect(doc.rulers[0]!.pts[0]).toEqual({ x: H - 20, y: 100 });
    applyPageOp(doc, { kind: 'crop', rect: { x: 10, y: 10, w: 100, h: 100 } }, 'Recortar');
    expect(doc.rulers[0]!.pts[0]).toEqual({ x: H - 20 - 10, y: 90 });
  });

  it('refuses crops that are empty or do nothing', () => {
    const { doc } = sample();
    expect(applyPageOp(doc, { kind: 'crop', rect: { x: 0, y: 0, w: W, h: H } }, 'x')).toBeNull();
    expect(applyPageOp(doc, { kind: 'crop', rect: { x: 700, y: 0, w: 10, h: 10 } }, 'x')).toBeNull();
  });

  it('computes the window of a new size around an anchor', () => {
    expect(anchoredWindow(600, 300, 800, 400, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 800, h: 400 });
    expect(anchoredWindow(600, 300, 800, 400, { x: 0.5, y: 0.5 })).toEqual({ x: -100, y: -50, w: 800, h: 400 });
    expect(anchoredWindow(600, 300, 800, 400, { x: 1, y: 1 })).toEqual({ x: -200, y: -100, w: 800, h: 400 });
    expect(anchoredWindow(600, 300, 500, 300, { x: 0.5, y: 0 })).toEqual({ x: 50, y: 0, w: 500, h: 300 });
  });

  it('grows the page with empty room, moves the content with the anchor and undoes', () => {
    const { doc, id } = sample();
    const h = new History();
    doc.rulers = [{ id: 1, kind: 'perspective', pts: [{ x: 100, y: 20 }] }];
    h.push(applyPageOp(doc, { kind: 'resize', rect: anchoredWindow(W, H, W + 200, H + 100, { x: 0.5, y: 0.5 }) }, 'Tamaño')!);
    expect([doc.width, doc.height]).toEqual([W + 200, H + 100]);
    const s = layer(doc, id).surface;
    expect(s.pixel(100, 50)).toEqual([255, 0, 0, 255]); // the top left moved by half of the growth
    expect(s.pixel(100 + W - 1, 50)).toEqual([0, 255, 0, 255]);
    expect(s.alphaAt(0, 0)).toBe(0); // the new room is empty
    expect(doc.guides).toEqual({ v: [200], h: [100] });
    expect(doc.rulers[0]!.pts[0]).toEqual({ x: 200, y: 70 });
    h.undo();
    expect([doc.width, doc.height]).toEqual([W, H]);
    expect(layer(doc, id).surface.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(doc.guides).toEqual({ v: [100], h: [50] });
    h.redo();
    expect(doc.width).toBe(W + 200);
  });

  it('shrinks around the anchor, keeping objects and strokes that still fit', () => {
    const { doc, id } = sample();
    const objects = addLayer(doc, 'objetos', undefined, 'balloons');
    objects.balloons = [{ id: 1, shape: 'rect', x: 400, y: 20, w: 100, h: 40, tail: null, text: 'a', fontSize: 20, fontFamily: 'sans-serif', vertical: false, border: 3 }];
    applyPageOp(doc, { kind: 'resize', rect: anchoredWindow(W, H, 400, 300, { x: 1, y: 0 }) }, 'Tamaño');
    expect([doc.width, doc.height]).toEqual([400, 300]);
    expect(layer(doc, id).surface.pixel(399, 0)).toEqual([0, 255, 0, 255]); // right edge kept
    expect(layer(doc, id).surface.alphaAt(0, 0)).toBe(0); // the top left was cut off
    expect(layer(doc, objects.id).balloons![0]!.x).toBe(200);
    expect(doc.guides).toEqual({ v: [], h: [50] }); // x = 100 is outside the new window
  });

  it('refuses a resize that changes nothing or is empty', () => {
    const { doc } = sample();
    expect(applyPageOp(doc, { kind: 'resize', rect: { x: 0, y: 0, w: W, h: H } }, 'x')).toBeNull();
    expect(applyPageOp(doc, { kind: 'resize', rect: { x: 0, y: 0, w: 0, h: H } }, 'x')).toBeNull();
  });

  it('a mask that shows everything keeps showing in the new room', () => {
    const { doc, id } = sample();
    createMask(doc, id, 'outside', Selection.rect(W, H, { x: 0, y: 0, w: 100, h: 50 }));
    applyPageOp(doc, { kind: 'resize', rect: anchoredWindow(W, H, W + 100, H, { x: 1, y: 0 }) }, 'Tamaño');
    const m = layer(doc, id).mask!;
    expect(m.surface.alphaAt(250, 100)).toBe(255);
    expect(m.surface.alphaAt(150, 10)).toBe(0); // the hidden rectangle moved by the 100 px of new room
  });

  it('keeps masks right (including the ones that show everything by default) and moves panels and balloons', () => {
    const { doc, id } = sample();
    createMask(doc, id, 'outside', Selection.rect(W, H, { x: 0, y: 0, w: 100, h: 50 })); // the rectangle is hidden, everything else shows
    const mask = layer(doc, id).mask!;
    expect(mask.base).toBe(255);
    const objects = addLayer(doc, 'objetos', undefined, 'balloons');
    objects.balloons = [{ id: 1, shape: 'rect', x: 10, y: 20, w: 100, h: 40, tail: { x: 30, y: 80 }, text: 'a', fontSize: 20, fontFamily: 'sans-serif', vertical: false, border: 3 }];
    applyPageOp(doc, { kind: 'rotate', turns: 1 }, 'Girar');
    const m = layer(doc, id).mask!;
    expect(m.base).toBe(255);
    expect(m.surface.alphaAt(5, 5)).toBe(255); // a pixel far from the (now moved) rectangle is still shown
    expect(m.surface.alphaAt(280, 50)).toBe(0); // the hidden rectangle moved with the page
    const b = layer(doc, objects.id).balloons![0]!;
    expect([b.x, b.y, b.w, b.h]).toEqual([H - 60, 10, 40, 100]);
    expect(b.tail).toEqual({ x: H - 80, y: 30 });
  });
});

describe('what a layer holds beyond the page', () => {
  it('moves with a window and comes back into view when the page grows over it', () => {
    const { doc, id } = sample();
    const l = layer(doc, id);
    const out = new TiledSurface(300, 300);
    out.writeRect({ x: 100, y: 10, w: 1, h: 1 }, new Uint8ClampedArray([9, 9, 9, 255]));
    l.overflow = { x: W, y: 0, surface: out }; // page point (700, 10)
    const cmd = applyPageOp(doc, { kind: 'resize', rect: { x: 0, y: 0, w: 800, h: H } }, 'Tamaño')!;
    const grown = layer(doc, id);
    expect(grown.surface.pixel(700, 10)).toEqual([9, 9, 9, 255]);
    expect(grown.overflow).toBeUndefined();
    cmd.undo();
    expect(layer(doc, id).overflow?.x).toBe(W);
    const crop = applyPageOp(doc, { kind: 'crop', rect: { x: 100, y: 0, w: 300, h: H } }, 'Recortar')!;
    expect(crop).not.toBeNull();
    const o = layer(doc, id).overflow!; // still beyond the narrower page, shifted with the window
    expect(o.surface.pixel(600 - o.x, 10 - o.y)).toEqual([9, 9, 9, 255]);
  });
});
