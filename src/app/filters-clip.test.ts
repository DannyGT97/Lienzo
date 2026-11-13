import { describe, expect, it } from 'vitest';
import { defaultAdjust } from '../engine/adjust';
import { flatten } from '../engine/composite';
import { addLayer, createDocument } from '../engine/document';
import { Selection } from '../engine/selection';
import { FILTERS, applyPixelFilter, defaultValues } from '../engine/filters';
import { bufPixel, fillLayer } from '../engine/test-utils';
import { previewRect, PREVIEW_PIXELS } from './filters-ui';
import { resizeCursor } from './transform-ui';

const ctx = { main: [0, 0, 0] as const, sub: [255, 255, 255] as const };
const W = 400;
const H = 300;
/** The base shape: opaque, away from the page's middle and from its borders. */
const SHAPE = { x: 20, y: 30, w: 330, h: 230 };

/** Paper, a shape layer, and a layer above it clipped to the shape (the "recortar a capa inferior" setup). */
function clippedPage() {
  const doc = createDocument(W, H, 300);
  fillLayer(doc.layers[0]!, [255, 255, 255, 255]);
  const shape = addLayer(doc, 'shape');
  const data = new Uint8ClampedArray(SHAPE.w * SHAPE.h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([200, 40, 40, 255], i);
  shape.surface.writeRect(SHAPE, data);
  const paint = addLayer(doc, 'paint');
  fillLayer(paint, [60, 90, 160, 255]);
  paint.clip = true;
  return { doc, shape, paint };
}

const px = (data: Uint8ClampedArray, x: number, y: number): number[] => bufPixel(data, W, x, y);
/** Points over the whole page, the corners of the shape included. */
const GRID: [number, number][] = [];
for (let y = 0; y < H; y += 23) for (let x = 0; x < W; x += 29) GRID.push([x, y]);
GRID.push([SHAPE.x, SHAPE.y], [SHAPE.x + SHAPE.w - 1, SHAPE.y + SHAPE.h - 1], [SHAPE.x + SHAPE.w - 1, SHAPE.y], [SHAPE.x, SHAPE.y + SHAPE.h - 1]);
const inside = (x: number, y: number): boolean => x >= SHAPE.x && y >= SHAPE.y && x < SHAPE.x + SHAPE.w && y < SHAPE.y + SHAPE.h;

describe('tonal corrections on a layer clipped to the one below', () => {
  it('a filter over the whole layer shows everywhere the shape is, and nowhere else', () => {
    const { doc, paint } = clippedPage();
    const before = flatten(doc);
    const def = FILTERS.brightness!;
    if (def.kind !== 'pixel') throw new Error('brightness is a pixel filter');
    const values = { ...defaultValues(def), brightness: 40 };
    applyPixelFilter(paint.surface, paint.id, null, def, values, ctx);
    const after = flatten(doc);
    // What the filter does to the layer's colour, worked out on a lone pixel.
    const expected = [60, 90, 160, 255];
    def.make(values, ctx)(expected);
    expect(expected).not.toEqual([60, 90, 160, 255]);
    for (const [x, y] of GRID) {
      if (inside(x, y)) expect(px(after, x, y), `inside ${x},${y}`).toEqual(expected.map((v) => Math.round(v)));
      else expect(px(after, x, y), `outside ${x},${y}`).toEqual(px(before, x, y)); // the clip hides it
    }
  });

  it('filtering only a window leaves the rest of the shape as it was (why the preview must cover the whole view)', () => {
    const { doc, paint } = clippedPage();
    const def = FILTERS.brightness!;
    if (def.kind !== 'pixel') throw new Error('brightness is a pixel filter');
    const values = { ...defaultValues(def), brightness: 40 };
    const before = flatten(doc);
    const win = Selection.rect(W, H, { x: 150, y: 100, w: 100, h: 100 });
    applyPixelFilter(paint.surface, paint.id, win, def, values, ctx);
    const part = flatten(doc);
    expect(px(part, 200, 150)).not.toEqual(px(before, 200, 150));
    expect(px(part, SHAPE.x, SHAPE.y)).toEqual(px(before, SHAPE.x, SHAPE.y)); // outside the window: untouched
  });

  it('a clipped adjustment layer reaches every pixel of the layer below, masks aside', () => {
    const { doc } = clippedPage();
    const adj = addLayer(doc, 'adj', doc.layers.length, 'adjust');
    adj.adjust = { ...defaultAdjust('levels', ctx), values: { black: 0, white: 255, gamma: 220 } };
    adj.clip = true;
    const noAdj = clippedPage().doc;
    const a = flatten(doc);
    const b = flatten(noAdj);
    let changedInside = 0;
    for (const [x, y] of GRID) {
      if (inside(x, y)) {
        if (px(a, x, y).join() !== px(b, x, y).join()) changedInside++;
      } else expect(px(a, x, y)).toEqual(px(b, x, y));
    }
    expect(changedInside).toBeGreaterThan(0);
    // Every sampled pixel of the shape changed the same way: no part of it is left out.
    for (const [x, y] of GRID) if (inside(x, y)) expect(px(a, x, y), `${x},${y}`).not.toEqual(px(b, x, y));
  });
});

describe('the area a filter preview works on', () => {
  const big = { x: 100, y: 100, w: 2000, h: 1500 };
  it('is the whole layer for "all" or when the view is unknown', () => {
    expect(previewRect(big, 4000, 3000, 'all')).toEqual({ rect: null, partial: false });
    expect(previewRect(null, 4000, 3000, 'view')).toEqual({ rect: null, partial: false });
  });
  it('is everything on screen for "view", however large', () => {
    expect(previewRect(big, 4000, 3000, 'view')).toEqual({ rect: big, partial: false });
  });
  it('is everything when the view covers the page', () => {
    expect(previewRect({ x: -50, y: -50, w: 5000, h: 4000 }, 4000, 3000, 'view').rect).toBeNull();
    expect(previewRect({ x: 0, y: 0, w: 600, h: 500 }, 600, 500, 'window').rect).toBeNull(); // small page: nothing to cut
  });
  it('is a window around the middle only for a heavy "window" and says it is partial', () => {
    const { rect, partial } = previewRect(big, 4000, 3000, 'window');
    expect(partial).toBe(true);
    expect(rect!.w * rect!.h).toBeLessThanOrEqual(PREVIEW_PIXELS * 1.02);
    expect(rect!.x + rect!.w / 2).toBeCloseTo(big.x + big.w / 2, -1);
    expect(rect!.y + rect!.h / 2).toBeCloseTo(big.y + big.h / 2, -1);
    // A view within the budget is not cut.
    expect(previewRect({ x: 0, y: 0, w: 600, h: 500 }, 4000, 3000, 'window')).toEqual({ rect: { x: 0, y: 0, w: 600, h: 500 }, partial: false });
  });
});

describe('resize cursors', () => {
  it('follow the direction of the handle, turned with the box', () => {
    expect(resizeCursor(0)).toBe('ew-resize');
    expect(resizeCursor(Math.PI)).toBe('ew-resize');
    expect(resizeCursor(Math.PI / 4)).toBe('nwse-resize');
    expect(resizeCursor(Math.PI / 2)).toBe('ns-resize');
    expect(resizeCursor(-Math.PI / 4)).toBe('nesw-resize');
    expect(resizeCursor((-3 * Math.PI) / 4)).toBe('nwse-resize');
    expect(resizeCursor(Math.PI / 2 + 0.1)).toBe('ns-resize');
  });
});
