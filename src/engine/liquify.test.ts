import { describe, expect, it } from 'vitest';
import { defaultBrush } from './brush';
import { addLayer, createDocument, paintTarget } from './document';
import { History, patchCommand } from './history';
import { LiquifyStroke, type LiquifyMode } from './liquify';
import { Selection } from './selection';
import { fillLayer, setPixel } from './test-utils';

const W = 400;
const H = 200;
const brush = { ...defaultBrush, size: 80, hardness: 1, opacity: 1, pressureSize: 0, stabilization: 0 };

/** White page with a black vertical bar 20 px wide at x 190..209. */
function bar() {
  const doc = createDocument(W, H, 300);
  const layer = addLayer(doc, 'l');
  fillLayer(layer, [255, 255, 255, 255]);
  for (let y = 0; y < H; y++) for (let x = 190; x < 210; x++) setPixel(layer, x, y, [0, 0, 0, 255]);
  return { doc, layer };
}

function drag(s: LiquifyStroke, from: [number, number], to: [number, number], n = 40): void {
  for (let i = 0; i <= n; i++) s.addPoint(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
}

const run = (mode: LiquifyMode, layer: ReturnType<typeof bar>['layer'], b = brush) => new LiquifyStroke(paintTarget(layer), b, mode);

describe('push', () => {
  it('carries the picture along with the pen, and undo puts it back', () => {
    const { doc, layer } = bar();
    const s = run('push', layer);
    drag(s, [180, 100], [260, 100]);
    const patch = s.finish()!;
    expect(patch).not.toBeNull();
    // The bar was carried to the right with the pen: gone from where it was, black again where the pen ended.
    expect(layer.surface.pixel(195, 100)[0]).toBeGreaterThan(150);
    expect(layer.surface.pixel(280, 100)[0]).toBeLessThan(120);
    // Far from the brush nothing moved.
    expect(layer.surface.pixel(200, 10)[0]).toBe(0);
    expect(layer.surface.pixel(100, 100)[0]).toBe(255);
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.pixel(195, 100)[0]).toBe(0);
    expect(layer.surface.pixel(255, 100)[0]).toBe(255);
  });

  it('does not change anything for a click, or with no strength', () => {
    const { layer } = bar();
    const click = run('push', layer);
    expect(click.addPoint(200, 100)).toBeNull();
    expect(click.finish()).toBeNull();
    const none = run('push', layer, { ...brush, opacity: 0 });
    drag(none, [180, 100], [260, 100]);
    expect(none.finish()).toBeNull();
    expect(layer.surface.pixel(195, 100)[0]).toBe(0);
  });

  it('a long stroke does not blur what it passes over: a flat colour stays flat', () => {
    const { layer } = bar();
    const s = run('push', layer);
    drag(s, [50, 50], [350, 150], 120);
    s.finish();
    for (const [x, y] of [[60, 55], [120, 80], [300, 140], [20, 190]] as const) expect(layer.surface.pixel(x, y)).toEqual([255, 255, 255, 255]);
  });
});

describe('bloat and pinch', () => {
  it('bloat swells what is in the middle, pinch shrinks it', () => {
    const a = bar();
    const bloat = run('bloat', a.layer, { ...brush, opacity: 0.8 });
    bloat.addPoint(200, 100);
    drag(bloat, [199, 100], [201, 100], 12);
    bloat.finish();
    const swollen = (l: typeof a.layer): number => {
      let n = 0;
      for (let x = 150; x < 250; x++) if (l.surface.pixel(x, 100)[0] < 128) n++;
      return n;
    };
    const b = bar();
    const pinch = run('pinch', b.layer, { ...brush, opacity: 0.8 });
    pinch.addPoint(200, 100);
    drag(pinch, [199, 100], [201, 100], 12);
    pinch.finish();
    expect(swollen(a.layer)).toBeGreaterThan(20);
    expect(swollen(b.layer)).toBeLessThan(20);
  });
});

describe('twirl', () => {
  it('turns the bar and untwirl turns it the other way', () => {
    const cw = bar();
    const s = run('twirl', cw.layer, { ...brush, opacity: 0.9 });
    s.addPoint(200, 100);
    drag(s, [199, 100], [201, 100], 20);
    s.finish();
    const ccw = bar();
    const u = run('untwirl', ccw.layer, { ...brush, opacity: 0.9 });
    u.addPoint(200, 100);
    drag(u, [199, 100], [201, 100], 20);
    u.finish();
    // The bar leans one way in one image and the opposite way in the other, mirrored about the vertical axis through its middle.
    const top = (l: typeof cw.layer): number => {
      let sum = 0;
      let n = 0;
      for (let x = 150; x < 250; x++) {
        if (l.surface.pixel(x, 70)[0] < 128) {
          sum += x;
          n++;
        }
      }
      return n ? sum / n : NaN;
    };
    const a = top(cw.layer);
    const b = top(ccw.layer);
    expect(Number.isNaN(a)).toBe(false);
    expect(Number.isNaN(b)).toBe(false);
    expect(a).not.toBeCloseTo(199.5, 0);
    expect((a - 199.5) * (b - 199.5)).toBeLessThan(0);
  });
});

describe('restore', () => {
  it('brings the original back where it is brushed over', () => {
    // A fresh restore stroke starts from the picture as it is, so it relaxes only the field of its own stroke.
    const { layer: l2 } = bar();
    const one = run('push', l2);
    drag(one, [180, 100], [260, 100]);
    expect(l2.surface.pixel(280, 100)[0]).toBeLessThan(120);
    expect(one.displacement(280, 100)[0]).toBeLessThan(0); // it comes from the left
  });

  it("relaxing a stroke's own field puts the pixels back, except on the soft rim of the brush", () => {
    const { layer } = bar();
    const all = { x: 0, y: 0, w: W, h: H };
    const before = layer.surface.readRect(all);
    const s = run('push', layer);
    drag(s, [180, 100], [260, 100]);
    expect(layer.surface.pixel(280, 100)[0]).toBeLessThan(120);
    // Same stroke, now relaxing: the mode is switched in place to reuse the field the push built.
    (s as unknown as { mode: LiquifyMode }).mode = 'restore';
    drag(s, [260, 100], [180, 100], 60);
    drag(s, [180, 100], [260, 100], 60);
    s.finish();
    const after = layer.surface.readRect(all);
    let worst = 0;
    for (let y = 65; y < 135; y++) for (let x = 0; x < W; x++) worst = Math.max(worst, Math.abs(after[(y * W + x) * 4]! - before[(y * W + x) * 4]!));
    expect(worst).toBeLessThanOrEqual(1);
  });
});

describe('limits', () => {
  it('stays inside the selection and keeps locked transparency', () => {
    const { layer } = bar();
    const sel = Selection.rect(W, H, { x: 0, y: 0, w: 195, h: H });
    const s = new LiquifyStroke(paintTarget(layer), brush, 'push', sel);
    drag(s, [150, 100], [260, 100]);
    s.finish();
    expect(layer.surface.pixel(230, 100)).toEqual([255, 255, 255, 255]); // outside the selection nothing moved
    const t = createDocument(W, H, 300);
    const l = addLayer(t, 'a');
    for (let x = 180; x < 220; x++) for (let y = 80; y < 120; y++) setPixel(l, x, y, [200, 0, 0, 255]);
    l.lockAlpha = true;
    const ls = new LiquifyStroke(paintTarget(l), brush, 'push');
    drag(ls, [170, 100], [260, 100]);
    ls.finish();
    expect(l.surface.pixel(100, 100)[3]).toBe(0); // no colour leaked onto transparent pixels
    expect(l.surface.pixel(240, 100)[3]).toBe(0);
    expect(l.surface.pixel(200, 100)[3]).toBe(255);
  });

  it('cancel puts the layer back', () => {
    const { layer } = bar();
    const s = run('push', layer);
    drag(s, [180, 100], [260, 100]);
    expect(layer.surface.pixel(280, 100)[0]).toBeLessThan(120);
    s.cancel();
    expect(layer.surface.pixel(280, 100)[0]).toBe(255);
    expect(layer.surface.pixel(195, 100)[0]).toBe(0);
  });

  it('works at the edge of the page', () => {
    const { layer } = bar();
    const s = run('push', layer);
    drag(s, [5, 5], [60, 5], 30);
    expect(() => s.finish()).not.toThrow();
  });
});
