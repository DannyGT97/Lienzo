import { describe, expect, it } from 'vitest';
import { defaultBrush } from './brush';
import { CloneStroke } from './clone';
import { addLayer, createDocument, paintTarget } from './document';
import { History, patchCommand } from './history';
import { Selection } from './selection';
import { fillLayer, setPixel } from './test-utils';

const brush = { ...defaultBrush, size: 30, hardness: 1, opacity: 1, pressureSize: 0, stabilization: 0 };

/** White page with a red square at 40..79 × 40..79. */
function page() {
  const doc = createDocument(300, 200, 300);
  const layer = addLayer(doc, 'l');
  fillLayer(layer, [255, 255, 255, 255]);
  for (let y = 40; y < 80; y++) for (let x = 40; x < 80; x++) setPixel(layer, x, y, [255, 0, 0, 255]);
  return { doc, layer };
}

function drag(s: CloneStroke, from: [number, number], to: [number, number], n = 30): void {
  for (let i = 0; i <= n; i++) s.addPoint(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
}

describe('copy stamp', () => {
  it('copies the picture from the source offset, and undo removes it', () => {
    const { doc, layer } = page();
    // Source point (60, 60), first stroke at (200, 100): the offset is (-140, -40).
    const s = new CloneStroke(paintTarget(layer), brush, { x: 60 - 200, y: 60 - 100 });
    drag(s, [200, 100], [200, 100], 1);
    const patch = s.finish()!;
    expect(layer.surface.pixel(200, 100)).toEqual([255, 0, 0, 255]);
    expect(layer.surface.pixel(260, 100)).toEqual([255, 255, 255, 255]);
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.pixel(200, 100)).toEqual([255, 255, 255, 255]);
  });

  it('copies transparency too: a source with nothing in it leaves the destination as it is', () => {
    const doc = createDocument(300, 200, 300);
    const layer = addLayer(doc, 'l');
    setPixel(layer, 200, 100, [0, 0, 255, 255]);
    const s = new CloneStroke(paintTarget(layer), brush, { x: -150, y: 0 }); // the source is empty
    s.addPoint(200, 100);
    expect(layer.surface.pixel(200, 100)).toEqual([0, 0, 255, 255]);
  });

  it('copying from the same layer does not feed on its own output', () => {
    const { layer } = page();
    // Offset (-30, 0): the pen at x copies x - 30. Reading live pixels would drag the red along the whole line.
    const s = new CloneStroke(paintTarget(layer), { ...brush, size: 10 }, { x: -30, y: 0 });
    drag(s, [90, 60], [200, 60], 110);
    s.finish();
    expect(layer.surface.pixel(100, 60)).toEqual([255, 0, 0, 255]); // 100 - 30 = 70 is inside the square
    expect(layer.surface.pixel(130, 60)).toEqual([255, 255, 255, 255]); // 130 - 30 = 100 was painted red by this very stroke, but the copy reads the original
  });

  it('partial strength blends with what was there and does not pile up under overlapping stamps', () => {
    const { layer } = page();
    const s = new CloneStroke(paintTarget(layer), { ...brush, opacity: 0.5, size: 40 }, { x: 60 - 200, y: 60 - 100 });
    drag(s, [190, 100], [210, 100], 60);
    s.finish();
    const px = layer.surface.pixel(200, 100);
    expect(px[0]).toBe(255);
    expect(px[1]).toBeGreaterThan(110);
    expect(px[1]).toBeLessThan(145); // halfway between white and red, not saturated by the repeated stamps
  });

  it('stays inside the selection and keeps locked transparency', () => {
    const { layer } = page();
    const sel = Selection.rect(300, 200, { x: 0, y: 0, w: 200, h: 200 });
    const s = new CloneStroke(paintTarget(layer), brush, { x: 60 - 200, y: 60 - 100 }, sel);
    drag(s, [190, 100], [215, 100], 20);
    s.finish();
    expect(layer.surface.pixel(195, 100)).toEqual([255, 0, 0, 255]);
    expect(layer.surface.pixel(212, 100)).toEqual([255, 255, 255, 255]);
    const doc = createDocument(300, 200, 300);
    const l = addLayer(doc, 'a');
    for (let y = 40; y < 80; y++) for (let x = 40; x < 80; x++) setPixel(l, x, y, [255, 0, 0, 255]);
    l.lockAlpha = true;
    const ls = new CloneStroke(paintTarget(l), brush, { x: -20, y: 0 });
    drag(ls, [90, 60], [100, 60], 10);
    ls.finish();
    expect(l.surface.pixel(95, 60)[3]).toBe(0); // nothing painted where the layer had no pixels
  });

  it('cancel puts the layer back and the edge of the page is safe', () => {
    const { layer } = page();
    const s = new CloneStroke(paintTarget(layer), brush, { x: 60 - 200, y: 60 - 100 });
    drag(s, [200, 100], [210, 100], 10);
    s.cancel();
    expect(layer.surface.pixel(205, 100)).toEqual([255, 255, 255, 255]);
    const e = new CloneStroke(paintTarget(layer), brush, { x: 100, y: 100 });
    drag(e, [-5, -5], [10, 10], 10);
    expect(() => e.finish()).not.toThrow();
  });
});
