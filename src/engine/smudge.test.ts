import { describe, expect, it } from 'vitest';
import { defaultBrush } from './brush';
import { addLayer, createDocument, paintTarget } from './document';
import { History, patchCommand } from './history';
import { Selection } from './selection';
import { SmudgeStroke } from './smudge';
import { fillLayer, setPixel } from './test-utils';

const W = 600;
const H = 100;
const brush = { ...defaultBrush, size: 40, hardness: 1, opacity: 1, pressureSize: 0, stabilization: 0 };

/** Black on the left half, white on the right half. */
function halves() {
  const doc = createDocument(W, H, 300);
  const layer = addLayer(doc, 'l');
  fillLayer(layer, [255, 255, 255, 255]);
  for (let y = 0; y < H; y++) for (let x = 0; x < 300; x++) setPixel(layer, x, y, [0, 0, 0, 255]);
  return { doc, layer };
}

function drag(s: SmudgeStroke, from: [number, number], to: [number, number]): void {
  const n = 40;
  for (let i = 0; i <= n; i++) s.addPoint(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
}

describe('finger', () => {
  it('drags the colour across the edge it starts on', () => {
    const { doc, layer } = halves();
    const s = new SmudgeStroke(paintTarget(layer), { ...brush, opacity: 0.9 }, 'finger');
    drag(s, [270, 50], [400, 50]); // starts on the black side, ends deep in the white
    const patch = s.finish()!;
    expect(layer.surface.pixel(340, 50)[0]).toBeLessThan(120); // black was smeared into what was white
    expect(layer.surface.pixel(520, 50)[0]).toBe(255); // far away nothing changed
    expect(layer.surface.pixel(100, 50)[0]).toBe(0);
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.pixel(340, 50)[0]).toBe(255);
  });

  it('does not change anything with no strength, and a click alone only picks colour up', () => {
    const { layer } = halves();
    const s = new SmudgeStroke(paintTarget(layer), { ...brush, opacity: 0 }, 'finger');
    drag(s, [270, 50], [400, 50]);
    expect(layer.surface.pixel(340, 50)[0]).toBe(255);
    const click = new SmudgeStroke(paintTarget(layer), brush, 'finger');
    click.addPoint(280, 50);
    expect(layer.surface.pixel(280, 50)[0]).toBe(0);
  });
});

describe('blur', () => {
  it('softens an edge a little more with every pass, and only where the brush went', () => {
    const { layer } = halves();
    const once = new SmudgeStroke(paintTarget(layer), brush, 'blur');
    once.addPoint(300, 50);
    const v1 = layer.surface.pixel(300, 50)[0]; // the first white pixel, next to the edge
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(255);
    for (let i = 0; i < 10; i++) {
      const s = new SmudgeStroke(paintTarget(layer), brush, 'blur');
      s.addPoint(300, 50);
    }
    const mid = layer.surface.pixel(300, 50)[0];
    expect(mid).toBeGreaterThan(60);
    expect(mid).toBeLessThan(200);
    expect(layer.surface.pixel(100, 50)[0]).toBe(0);
    expect(layer.surface.pixel(500, 50)[0]).toBe(255);
  });

  it('keeps the transparent pixels transparent when the alpha is locked, and respects a selection', () => {
    const { layer } = halves();
    const sel = Selection.rect(W, H, { x: 0, y: 0, w: 300, h: H });
    const s = new SmudgeStroke(paintTarget(layer), brush, 'blur', sel);
    s.addPoint(300, 50);
    expect(layer.surface.pixel(300, 50)[0]).toBe(255); // outside the selection: untouched
    expect(layer.surface.pixel(299, 50)[0]).toBeGreaterThan(0); // inside: blurred
    const locked = addLayer(createDocument(W, H, 300), 'k');
    setPixel(locked, 10, 10, [0, 0, 0, 255]);
    const t = paintTarget(locked);
    t.lockAlpha = true;
    new SmudgeStroke(t, brush, 'blur').addPoint(10, 10);
    expect(locked.surface.alphaAt(11, 10)).toBe(0);
    expect(locked.surface.alphaAt(10, 10)).toBe(255);
  });

  it('cancel puts the layer back', () => {
    const { layer } = halves();
    const s = new SmudgeStroke(paintTarget(layer), brush, 'blur');
    s.addPoint(300, 50);
    expect(layer.surface.pixel(300, 50)[0]).toBeLessThan(255);
    expect(s.cancel()).not.toBeNull();
    expect(layer.surface.pixel(300, 50)[0]).toBe(255);
  });
});
