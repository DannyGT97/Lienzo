import { describe, expect, it } from 'vitest';
import { BLEND_MODES, blendColor } from './blend';
import { DEFAULT_ANTIALIAS, STAB_SPEED_HALF, Stroke, antialiasOf, defaultBrush, entryRampSamples, innerRadius, stabilizationAtSpeed } from './brush';
import { compositePixel, flatten, flattenRegion, sampleDocument, thumbnail } from './composite';
import { addLayer, activeLayer, createDocument, documentPixels, paintTarget } from './document';
import { History, applyLimits, limitsNotice, patchCommand } from './history';
import { bufPixel as px, fillLayer, inkCount, setPixel } from './test-utils';
import { TILE } from './tiles';

describe('blend modes', () => {
  it('keeps every mode within [0,1] for all corner inputs', () => {
    const vals = [0, 0.25, 0.5, 1] as const;
    for (const m of BLEND_MODES)
      for (const a of vals)
        for (const b of vals)
          for (const c of blendColor(m, [a, b, a], [b, a, b])) {
            expect(c).toBeGreaterThanOrEqual(-1e-9);
            expect(c).toBeLessThanOrEqual(1 + 1e-9);
          }
  });

  it('matches known reference values', () => {
    expect(blendColor('multiply', [0.5, 0.5, 0.5], [0.5, 1, 0])).toEqual([0.25, 0.5, 0]);
    expect(blendColor('screen', [0.5, 0.5, 0.5], [0.5, 1, 0])).toEqual([0.75, 1, 0.5]);
    expect(blendColor('difference', [0.8, 0.2, 0.5], [0.2, 0.8, 0.5])[0]).toBeCloseTo(0.6);
    expect(blendColor('linearBurn', [0.6, 0.6, 0.6], [0.6, 0.2, 0.6])[1]).toBeCloseTo(0);
    expect(blendColor('hardMix', [0.6, 0.4, 0.5], [0.4, 0.4, 0.4])).toEqual([1, 0, 0]);
  });

  it('dodge, burn and divide never divide by zero and use a small floor instead', () => {
    expect(blendColor('colorDodge', [0.5, 0, 0.5], [1, 1, 0])).toEqual([1, 0, 0.5]);
    expect(blendColor('colorBurn', [0.5, 1, 0.5], [0, 0, 1])).toEqual([0, 1, 0.5]);
    expect(blendColor('divide', [0.5, 0, 0.5], [0, 0, 1])[0]).toBe(1);
    expect(blendColor('divide', [0.5, 0, 0.5], [0, 0, 1])[1]).toBe(0);
    expect(blendColor('divide', [0.2, 0.2, 0.2], [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.2 / 0.501);
  });

  it('hard mix flips a little later on dark backdrops', () => {
    expect(blendColor('hardMix', [0.4, 0.5, 0.5], [0.6, 0.5, 0.5])[0]).toBe(0);
    expect(blendColor('hardMix', [0.4, 0.5, 0.5], [0.61, 0.5, 0.5])[0]).toBe(1);
    expect(blendColor('hardMix', [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])[0]).toBe(1);
  });

  it('add glow is unclamped until the alpha weighting, glow dodge weights the source by its alpha', () => {
    expect(blendColor('addGlow', [0.8, 0, 0], [0.7, 0, 0], 1, false)[0]).toBeCloseTo(1.5);
    expect(blendColor('addGlow', [0.8, 0, 0], [0.7, 0, 0])[0]).toBe(1);
    expect(blendColor('glowDodge', [0.3, 0.3, 0.3], [0.5, 0.5, 0.5], 0)[0]).toBeCloseTo(0.3);
    expect(blendColor('glowDodge', [0.3, 0.3, 0.3], [0.5, 0.5, 0.5], 1)[0]).toBeCloseTo(0.6);
  });

  it('compositing equals W3C over an opaque backdrop and differs only over a partly transparent one', () => {
    const out = [0, 0, 0, 0];
    compositePixel({ blend: 'multiply' }, [0.5, 0.5, 0.5], 1, [0.5, 1, 0], 0.5, out);
    // 0.5 * backdrop + 0.5 * (backdrop * source)
    expect(out[0]).toBeCloseTo(0.375);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(0.25);
    expect(out[3]).toBeCloseTo(1);
    compositePixel({ blend: 'multiply' }, [0.5, 0.5, 0.5], 0.5, [0.5, 0.5, 0.5], 0.5, out);
    expect(out[3]).toBeCloseTo(0.75);
    const w3c = ((1 - 0.5) * 0.5 * 0.5 + 0.5 * ((1 - 0.5) * 0.5 + 0.5 * 0.25)) / 0.75;
    expect(out[0]).not.toBeCloseTo(w3c, 3);
    expect(out[0]).toBeGreaterThan(0.25);
    expect(out[0]).toBeLessThan(0.5);
  });

  it('screen and the dodge family add alphas, the rest take the union', () => {
    const out = [0, 0, 0, 0];
    compositePixel({ blend: 'screen' }, [0.5, 0.5, 0.5], 0.5, [0.5, 0.5, 0.5], 0.4, out);
    expect(out[3]).toBeCloseTo(0.9);
    compositePixel({ blend: 'overlay' }, [0.5, 0.5, 0.5], 0.5, [0.5, 0.5, 0.5], 0.4, out);
    expect(out[3]).toBeCloseTo(0.7);
    compositePixel({ blend: 'multiply' }, [0.5, 0.5, 0.5], 0, [0.2, 0.3, 0.4], 0.4, out);
    expect(out.slice(0, 3)).toEqual([0.2, 0.3, 0.4]);
    expect(out[3]).toBeCloseTo(0.4);
  });

  it('luminosity of white source on any backdrop gives white', () => {
    const c = blendColor('luminosity', [0.2, 0.4, 0.6], [1, 1, 1]);
    for (const v of c) expect(v).toBeCloseTo(1);
  });
});

describe('compositing', () => {
  it('composites an opaque multiply layer', () => {
    const doc = createDocument(2, 1);
    const [bottom] = doc.layers;
    fillLayer(bottom!, [128, 128, 128, 255]);
    const top = addLayer(doc);
    top.blend = 'multiply';
    setPixel(top, 0, 0, [255, 0, 0, 255]);
    const out = flatten(doc);
    expect(px(out, 2, 0, 0)).toEqual([128, 0, 0, 255]);
    expect(px(out, 2, 1, 0)).toEqual([128, 128, 128, 255]);
  });

  it('respects layer opacity and visibility', () => {
    const doc = createDocument(1, 1);
    setPixel(doc.layers[0]!, 0, 0, [0, 0, 0, 255]);
    const top = addLayer(doc);
    setPixel(top, 0, 0, [255, 255, 255, 255]);
    top.opacity = 0.5;
    expect(px(flatten(doc), 1, 0, 0)).toEqual([128, 128, 128, 255]);
    top.visible = false;
    expect(px(flatten(doc), 1, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it('clips a layer to the base layer alpha', () => {
    const doc = createDocument(2, 1);
    setPixel(doc.layers[0]!, 0, 0, [0, 0, 255, 255]);
    const top = addLayer(doc);
    top.clip = true;
    fillLayer(top, [255, 0, 0, 255]);
    const out = flatten(doc);
    expect(px(out, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2, 1, 0)[3]).toBe(0);
  });

  it('a paper layer is a solid colour that costs no pixels', () => {
    const doc = createDocument(300, 10);
    doc.layers[0]!.kind = 'paper';
    doc.layers[0]!.paperColor = [250, 240, 230];
    const ink = addLayer(doc);
    setPixel(ink, 299, 9, [0, 0, 0, 255]);
    expect(doc.layers[0]!.surface.tileCount).toBe(0);
    const out = flatten(doc);
    expect(px(out, 300, 0, 0)).toEqual([250, 240, 230, 255]);
    expect(px(out, 300, 299, 9)).toEqual([0, 0, 0, 255]);
  });

  it('flattens a region that crosses tile borders the same as the whole page', () => {
    const doc = createDocument(600, 300);
    fillLayer(doc.layers[0]!, [200, 100, 50, 255]);
    const top = addLayer(doc);
    top.blend = 'multiply';
    top.opacity = 0.7;
    for (let i = 0; i < 40; i++) setPixel(top, 240 + i, 250 + (i % 20), [10 * i, 5 * i, 255 - i, 200]);
    const whole = flatten(doc);
    const r = { x: 230, y: 240, w: 60, h: 40 };
    const part = flattenRegion(doc, r);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) expect(px(part, r.w, x, y)).toEqual(px(whole, 600, r.x + x, r.y + y));
  });
});

describe('thumbnail', () => {
  it('sampleDocument agrees with the full composite, including paper, blending and clipping', () => {
    const doc = createDocument(40, 30);
    doc.layers[0]!.kind = 'paper';
    doc.layers[0]!.paperColor = [200, 180, 160];
    const a = addLayer(doc);
    a.blend = 'multiply';
    a.opacity = 0.7;
    fillLayer(a, [90, 120, 230, 200]);
    const b = addLayer(doc);
    b.clip = true;
    for (let i = 0; i < 40; i++) setPixel(b, i, i % 30, [255, 40, 10, 255]);
    const full = flatten(doc);
    for (const [x, y] of [[0, 0], [5, 5], [12, 12], [39, 29], [20, 3]] as const) {
      const s = sampleDocument(doc, x, y);
      const f = px(full, 40, x, y);
      for (let k = 0; k < 4; k++) expect(Math.abs(s[k]! - f[k]!)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a thin line visible and has the requested size', () => {
    const doc = createDocument(1000, 1000);
    doc.layers[0]!.kind = 'paper';
    const ink = addLayer(doc);
    for (let x = 0; x < 1000; x++) setPixel(ink, x, 500, [0, 0, 0, 255]); // one-pixel horizontal line
    const t = thumbnail(doc, 100, 100);
    expect(t.length).toBe(100 * 100 * 4);
    let darkest = 255;
    for (let x = 0; x < 100; x++) darkest = Math.min(darkest, t[(50 * 100 + x) * 4]!);
    expect(darkest).toBeLessThan(255); // the line leaves a visible trace
    expect(darkest).toBeGreaterThan(200); // ...proportional to its width: 1 px of 10 is about 10 % ink
    expect(t[(10 * 100 + 10) * 4]).toBe(255); // elsewhere it is paper
    expect(t[3]).toBe(255);
  });

  it('an empty page is transparent', () => {
    const doc = createDocument(50, 50);
    expect(thumbnail(doc, 10, 10).every((v) => v === 0)).toBe(true);
  });
});

describe('brush', () => {
  const brush = { ...defaultBrush, size: 8, hardness: 1, stabilization: 0, pressureSize: 0 };

  it('paints a dot and never exceeds the stroke opacity when overlapping', () => {
    const doc = createDocument(32, 32);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, opacity: 0.5, color: [255, 0, 0] });
    for (let i = 0; i < 10; i++) s.addPoint(16 + i * 0.2, 16);
    s.finish();
    const [r, , , a] = layer.surface.pixel(16, 16);
    expect(r).toBe(255);
    expect(a).toBeGreaterThanOrEqual(127);
    expect(a).toBeLessThanOrEqual(128);
  });

  describe('anti-aliasing', () => {
    /** The alpha of every pixel along the row through the middle of a round dab of diameter 10. */
    const rim = (antialias?: 0 | 1 | 2 | 3): number[] => {
      const doc = createDocument(32, 32);
      const layer = activeLayer(doc);
      const s = new Stroke(paintTarget(layer), { ...brush, size: 10, hardness: 1, antialias });
      s.addPoint(16, 16);
      s.finish();
      return Array.from({ length: 32 }, (_, x) => layer.surface.alphaAt(x, 16));
    };
    const partial = (row: number[]): number => row.filter((a) => a > 0 && a < 255).length;

    it('leaves no half-covered pixel at level 0 and widens the rim with each level', () => {
      expect(partial(rim(0))).toBe(0);
      const widths = [0, 1, 2, 3].map((l) => partial(rim(l as 0 | 1 | 2 | 3)));
      for (let i = 1; i < widths.length; i++) expect(widths[i], `level ${i}`).toBeGreaterThanOrEqual(widths[i - 1]!);
      expect(widths[3]).toBeGreaterThan(widths[0]!);
    });

    it('keeps the look the brush always had when unset (medium)', () => {
      expect(rim(undefined)).toEqual(rim(2));
      expect(partial(rim(2))).toBeGreaterThan(0);
    });

    it('never grows the shape beyond its radius', () => {
      for (const l of [0, 1, 2, 3] as const) {
        const row = rim(l);
        expect(row[10], `level ${l}`).toBe(0); // 16 - 5 - 1
        expect(row[22], `level ${l}`).toBe(0);
        expect(row[16], `level ${l}`).toBe(255);
      }
    });

    it('innerRadius keeps the hardness and the level rim, and treats a bad level as medium', () => {
      expect(innerRadius(10, 1, 0)).toBe(10);
      expect(innerRadius(10, 1, 2)).toBe(9);
      expect(innerRadius(10, 1, 3)).toBe(8);
      expect(innerRadius(10, 0.5, 3)).toBe(5);
      expect(innerRadius(1, 1, 3)).toBe(0);
      expect(innerRadius(10, 1, 9)).toBe(innerRadius(10, 1, undefined));
      expect(antialiasOf(1.5)).toBe(DEFAULT_ANTIALIAS);
    });
  });

  it('draws a continuous line between distant samples', () => {
    const doc = createDocument(64, 16);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, size: 4 });
    s.addPoint(4, 8);
    s.addPoint(60, 8);
    s.finish();
    for (let x = 4; x <= 60; x++) expect(layer.surface.alphaAt(x, 8)).toBe(255);
  });

  it('erases and supports undo/redo', () => {
    const doc = createDocument(16, 16);
    const layer = activeLayer(doc);
    fillLayer(layer, [255, 255, 255, 255]);
    const history = new History();
    const s = new Stroke(paintTarget(layer), { ...brush, erase: true });
    s.addPoint(8, 8);
    history.push(patchCommand(doc, s.finish()!));
    expect(layer.surface.alphaAt(8, 8)).toBe(0);
    history.undo();
    expect(layer.surface.pixel(8, 8)).toEqual([255, 255, 255, 255]);
    history.redo();
    expect(layer.surface.alphaAt(8, 8)).toBe(0);
  });

  it('rounds corners between sparse samples but keeps both ends exact and never overshoots', () => {
    const doc = createDocument(100, 100);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, size: 4, hardness: 1, pressureSize: 0 });
    // A right-angle corner at (20, 80) given as only three samples.
    s.addPoint(20, 20);
    s.addPoint(20, 80);
    s.addPoint(80, 80);
    s.finish();
    const inked = (x: number, y: number): boolean => layer.surface.alphaAt(x, y) > 128;
    expect(inked(20, 20)).toBe(true); // starts at the first sample
    expect(inked(80, 80)).toBe(true); // ends at the last sample
    expect(inked(20, 50)).toBe(true); // straight part is straight
    expect(inked(50, 80)).toBe(true);
    expect(inked(20, 80)).toBe(false); // the corner itself is cut by the curve
    expect(inked(25, 69)).toBe(true); // ...and the curve passes through (24.8, 69.2)
    // No overshoot: nothing is painted outside the samples' bounding box.
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        if (inked(x, y)) {
          expect(x).toBeGreaterThanOrEqual(19);
          expect(x).toBeLessThanOrEqual(81);
          expect(y).toBeGreaterThanOrEqual(19);
          expect(y).toBeLessThanOrEqual(81);
        }
  });

  it('cancel() restores the pixels the stroke touched and removes tiles it created', () => {
    const doc = createDocument(16, 16);
    const layer = activeLayer(doc);
    fillLayer(layer, [9, 9, 9, 255]);
    const s = new Stroke(paintTarget(layer), { ...brush, size: 6, color: [255, 0, 0] });
    s.addPoint(4, 4);
    s.addPoint(12, 12);
    expect(layer.surface.pixel(4, 4)[0]).toBe(255);
    expect(s.cancel()).not.toBeNull();
    expect(layer.surface.pixel(4, 4)).toEqual([9, 9, 9, 255]);
    expect(s.cancel()).toBeNull();

    const blank = createDocument(600, 600);
    const l2 = activeLayer(blank);
    const s2 = new Stroke(paintTarget(l2), { ...brush, size: 20 });
    s2.addPoint(300, 300);
    expect(l2.surface.tileCount).toBeGreaterThan(0);
    s2.cancel();
    expect(l2.surface.tileCount).toBe(0);
  });

  it('keeps alpha when the layer alpha is locked', () => {
    const doc = createDocument(8, 8);
    const layer = activeLayer(doc);
    layer.lockAlpha = true;
    const s = new Stroke(paintTarget(layer), { ...brush, color: [255, 0, 0] });
    s.addPoint(4, 4);
    s.finish();
    expect(layer.surface.alphaAt(4, 4)).toBe(0);
    expect(layer.surface.tileCount).toBe(0);
  });

  it('reduces diameter at low pressure', () => {
    const doc = createDocument(32, 32);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, size: 20, pressureSize: 1 });
    s.addPoint(16, 16, 0.2);
    s.finish();
    expect(layer.surface.alphaAt(16, 16)).toBe(255);
    expect(layer.surface.alphaAt(16 + 7, 16)).toBe(0);
  });
});

describe('brush coverage', () => {
  // The stroke from A to B is a straight capsule, so every pixel's alpha is known in closed form.
  const expected = (px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number, hardness: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d >= r) return 0;
    const ri = Math.max(0, Math.min(r * hardness, r - 1));
    if (d <= ri) return 255;
    const u = (r - d) / (r - ri);
    return 255 * u * u * (3 - 2 * u);
  };

  const cases: [string, number, number, number, number, number, number][] = [
    ['diagonal', 40, 30, 410, 330, 25, 1],
    ['steep', 100, 20, 140, 380, 18, 0.6],
    ['short and fat', 200, 200, 214, 207, 60, 0.8],
    ['thin', 30, 300, 380, 120, 2, 1],
    ['horizontal', 20, 200, 480, 200, 40, 0.3],
  ];
  for (const [name, ax, ay, bx, by, r, h] of cases) {
    it(`matches the closed-form coverage of a ${name} capsule, pixel by pixel`, () => {
      const doc = createDocument(520, 420);
      const layer = activeLayer(doc);
      const s = new Stroke(paintTarget(layer), { ...defaultBrush, size: r * 2, hardness: h, stabilization: 0, pressureSize: 0 });
      s.addPoint(ax, ay);
      s.addPoint(bx, by);
      s.finish();
      let worst = 0;
      for (let y = 0; y < 420; y++)
        for (let x = 0; x < 520; x++)
          worst = Math.max(worst, Math.abs(layer.surface.alphaAt(x, y) - expected(x + 0.5, y + 0.5, ax, ay, bx, by, r, h)));
      expect(worst).toBeLessThanOrEqual(1);
    });
  }
});

describe('history labels', () => {
  it('lists undo and redo steps in order', () => {
    const h = new History();
    const noop = { undo() {}, redo() {}, region: null };
    h.push({ ...noop, label: 'A' });
    h.push({ ...noop, label: 'B' });
    h.push({ ...noop });
    expect(h.undoLabels()).toEqual(['A', 'B', 'Cambio']);
    h.undo();
    h.undo();
    expect(h.undoLabels()).toEqual(['A']);
    expect(h.redoLabels()).toEqual(['B', 'Cambio']);
  });
});

describe('load shedding', () => {
  it('a stroke that skips intermediate samples still ends exactly at the last one', () => {
    const doc = createDocument(300, 100);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...defaultBrush, size: 8, hardness: 1, stabilization: 0, pressureSize: 0 });
    s.addPoint(20, 50);
    s.skipPoint(80, 50);
    s.skipPoint(150, 50);
    s.skipPoint(260, 50);
    s.finish();
    for (const x of [20, 60, 140, 200, 260]) expect(layer.surface.alphaAt(x, 50)).toBeGreaterThan(200);
    expect(layer.surface.alphaAt(280, 50)).toBe(0);
  });
});

describe('document pixel memory', () => {
  it('counts only the blocks that exist, in layers, masks and tone areas', () => {
    const doc = createDocument(600, 600);
    expect(documentPixels(doc)).toEqual({ tiles: 0, bytes: 0 });
    const layer = doc.layers[0]!;
    setPixel(layer, 0, 0, [1, 2, 3, 255]);
    setPixel(layer, 300, 300, [1, 2, 3, 255]);
    const block = TILE * TILE * 4;
    expect(layer.surface.pixelBytes).toBe(2 * block);
    expect(documentPixels(doc)).toEqual({ tiles: 2, bytes: 2 * block });
    const tone = addLayer(doc, 'tone', undefined, 'tone');
    setPixel({ ...tone, surface: tone.source! }, 0, 0, [0, 0, 0, 255]);
    expect(documentPixels(doc)).toEqual({ tiles: 3, bytes: 3 * block });
  });
});

describe('brush on tiles', () => {
  const brush = { ...defaultBrush, size: 30, hardness: 1, stabilization: 0, pressureSize: 0 };

  it('paints seamlessly across tile borders', () => {
    const doc = createDocument(600, 600);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), brush);
    // A diagonal through the exact corner shared by four tiles: (256, 256).
    s.addPoint(TILE - 100, TILE - 80);
    s.addPoint(TILE + 100, TILE + 80);
    s.finish();
    expect(layer.surface.tileCount).toBe(4);
    // The line is inked on both sides of the vertical and the horizontal border.
    for (let y = TILE - 70; y < TILE + 70; y += 7) {
      const x = Math.round(TILE - 100 + (y - (TILE - 80)) / 0.8);
      expect(layer.surface.alphaAt(x, y)).toBe(255);
    }
    // Where the stroke meets the vertical border (around y = 256) both sides are inked: no gap at the seam.
    for (let y = TILE - 10; y <= TILE + 10; y++) {
      expect(layer.surface.alphaAt(TILE - 1, y)).toBe(255);
      expect(layer.surface.alphaAt(TILE, y)).toBe(255);
    }
    // ...and the same at the horizontal border.
    for (let x = TILE - 10; x <= TILE + 10; x++) {
      expect(layer.surface.alphaAt(x, TILE - 1)).toBe(255);
      expect(layer.surface.alphaAt(x, TILE)).toBe(255);
    }
  });

  it('strokes on an A3 page at 600 dpi touch only the tiles they cross', () => {
    const doc = createDocument(7016, 9921, 600);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, size: 40 });
    s.addPoint(3000, 5000);
    s.addPoint(3600, 5100);
    const patch = s.finish()!;
    expect(layer.surface.tileCount).toBeLessThan(8);
    expect(patch.tiles.length).toBe(layer.surface.tileCount);
    expect(patch.bytes).toBeLessThan(8 * 256 * 1024 * 2);
    expect(inkCount(layer)).toBeGreaterThan(1000);
  });

  it('erasing everything removes the tiles again', () => {
    const doc = createDocument(300, 300);
    const layer = activeLayer(doc);
    const paint = new Stroke(paintTarget(layer), { ...brush, size: 60, color: [1, 2, 3] });
    paint.addPoint(150, 150);
    paint.finish();
    expect(layer.surface.tileCount).toBeGreaterThan(0);
    const erase = new Stroke(paintTarget(layer), { ...brush, size: 400, erase: true });
    erase.addPoint(150, 150);
    const patch = erase.finish()!;
    expect(layer.surface.tileCount).toBe(0);
    expect(patch.tiles.every((t) => t.after === null)).toBe(true);
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.pixel(150, 150)).toEqual([1, 2, 3, 255]);
  });

  it('undo of the first stroke on a blank layer removes the tiles it created', () => {
    const doc = createDocument(600, 600);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), brush);
    s.addPoint(400, 400);
    const h = new History();
    h.push(patchCommand(doc, s.finish()!));
    expect(layer.surface.tileCount).toBeGreaterThan(0);
    h.undo();
    expect(layer.surface.tileCount).toBe(0);
    h.redo();
    expect(layer.surface.alphaAt(400, 400)).toBe(255);
  });

  it('forgets the oldest steps when the history exceeds its memory budget', () => {
    const doc = createDocument(600, 600);
    const layer = activeLayer(doc);
    const h = new History(100, 3 * 256 * 1024); // room for about three snapshots
    for (let i = 0; i < 6; i++) {
      const s = new Stroke(paintTarget(layer), { ...brush, size: 10 });
      s.addPoint(20 + i * 80, 20);
      h.push(patchCommand(doc, s.finish()!));
    }
    let undone = 0;
    while (h.undo()) undone++;
    expect(undone).toBeGreaterThanOrEqual(1);
    expect(undone).toBeLessThan(6);
  });

  it('applies new limits at once, dropping the oldest steps but never the newest', () => {
    const h = new History(100);
    const step = (label: string, bytes = 0) => ({ undo() {}, redo() {}, region: null, bytes, label });
    for (let i = 0; i < 8; i++) h.push(step(`s${i}`, 10));
    h.setLimits(3, 1000);
    expect(h.undoLabels()).toEqual(['s5', 's6', 's7']);
    expect(h.memory).toBe(30);
    h.setLimits(100, 5); // over budget: only the newest stays
    expect(h.undoLabels()).toEqual(['s7']);
  });

  it('reports how many steps new limits forgot', () => {
    const h = new History(100);
    for (let i = 0; i < 8; i++) h.push({ undo() {}, redo() {}, region: null, bytes: 10, label: `s${i}` });
    expect(h.setLimits(100, 1000)).toBe(0); // raising limits forgets nothing
    expect(h.setLimits(3, 1000)).toBe(5);
    expect(h.setLimits(3, 1000)).toBe(0);
  });

  it('gives every open document its own history the new limits, counting a shared history once', () => {
    const step = (label: string) => ({ undo() {}, redo() {}, region: null, bytes: 10, label });
    const fill = (n: number): History => {
      const h = new History(100);
      for (let i = 0; i < n; i++) h.push(step(`s${i}`));
      return h;
    };
    const active = fill(8);
    const background = fill(6);
    const small = fill(2);
    const result = applyLimits([active, background, small, active], 4, 1000);
    expect(result).toEqual({ forgotten: 4 + 2, affected: 2 });
    expect(active.undoLabels()).toEqual(['s4', 's5', 's6', 's7']);
    expect(background.undoLabels()).toEqual(['s2', 's3', 's4', 's5']);
    expect(small.undoLabels()).toEqual(['s0', 's1']);
    // New steps respect the same limits afterwards.
    background.push(step('next'));
    expect(background.undoLabels()).toEqual(['s3', 's4', 's5', 'next']);
  });

  it('tells the user what lower limits cost, and nothing when nothing was lost', () => {
    expect(limitsNotice({ forgotten: 0, affected: 0 })).toBeNull();
    expect(limitsNotice({ forgotten: 1, affected: 1 })).toBe('Se olvidó 1 paso antiguo del historial de 1 documento por los nuevos límites; ya no se pueden deshacer.');
    expect(limitsNotice({ forgotten: 6, affected: 2 })).toContain('6 pasos antiguos del historial de 2 documentos');
  });
});

describe('stabilization by speed', () => {
  const lag = (s: number) => s / (1 - s);

  it('is the setting itself at rest, and never above it', () => {
    expect(stabilizationAtSpeed(0.6, 0)).toBeCloseTo(0.6);
    expect(stabilizationAtSpeed(0, 50)).toBe(0);
    expect(stabilizationAtSpeed(0.6, Number.NaN)).toBeCloseTo(0.6);
    for (const v of [1, 5, 20, 200]) expect(stabilizationAtSpeed(0.6, v)).toBeLessThan(0.6);
  });

  it('eases off steadily as the pen speeds up, halving the lag at STAB_SPEED_HALF', () => {
    expect(lag(stabilizationAtSpeed(0.8, STAB_SPEED_HALF))).toBeCloseTo(lag(0.8) / 2);
    expect(stabilizationAtSpeed(0.8, 30)).toBeLessThan(stabilizationAtSpeed(0.8, 10));
    expect(stabilizationAtSpeed(0.8, 10)).toBeLessThan(stabilizationAtSpeed(0.8, 2));
  });

  const base = { ...defaultBrush, size: 10, hardness: 1, stabilization: 0.8, pressureSize: 0 };

  /** Pixels the path's end trails the last pen sample, before the pen is lifted. */
  const trailing = (step: number, bySpeed: boolean): number => {
    const doc = createDocument(900, 16);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...base, stabilizationBySpeed: bySpeed });
    let x = 10;
    for (let i = 0; i < 30; i++, x += step) s.addPoint(x, 8);
    x -= step;
    let reach = 0;
    for (let px = 0; px < 900; px++) if (layer.surface.alphaAt(px, 8) > 0) reach = px;
    // The paint reaches one brush radius past the path's end.
    return x - (reach - base.size / 2);
  };

  it('leaves the pen as it was when the option is off', () => {
    expect(trailing(20, false)).toBeGreaterThan(trailing(20, true));
    const doc = createDocument(200, 16);
    const a = activeLayer(doc);
    const off = new Stroke(paintTarget(a), { ...base, stabilizationBySpeed: false });
    const doc2 = createDocument(200, 16);
    const b = activeLayer(doc2);
    const unset = new Stroke(paintTarget(b), base);
    for (let x = 10; x < 150; x += 7) {
      off.addPoint(x, 8);
      unset.addPoint(x, 8);
    }
    off.finish();
    unset.finish();
    for (let x = 0; x < 200; x++) expect(a.surface.alphaAt(x, 8)).toBe(b.surface.alphaAt(x, 8));
  });

  it('lags much less on a quick stroke than with the plain setting, and nearly as much on a slow one', () => {
    expect(trailing(20, true)).toBeLessThan(trailing(20, false) * 0.5);
    expect(trailing(1, true)).toBeGreaterThan(trailing(1, false) * 0.6);
  });

  it('closes the stroke on the last real sample when the pen is lifted', () => {
    const doc = createDocument(200, 16);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...base, stabilizationBySpeed: true });
    let x = 10;
    for (let i = 0; i < 12; i++, x += 3) s.addPoint(x, 8);
    x -= 3;
    s.finish();
    expect(layer.surface.alphaAt(x, 8)).toBeGreaterThan(200);
  });
});

describe('brush flow', () => {
  const brush = { ...defaultBrush, size: 10, hardness: 1, stabilization: 0, pressureSize: 0, spacing: 0.1 };
  const alphaAfter = (settings: Partial<typeof brush> & { flow?: number }, xs: number[]): number => {
    const doc = createDocument(64, 16);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, ...settings });
    for (const x of xs) s.addPoint(x, 8);
    s.finish();
    return layer.surface.alphaAt(32, 8);
  };

  it('leaves strokes alone at full flow', () => {
    const line = [10, 50];
    expect(alphaAfter({ flow: 1 }, line)).toBe(alphaAfter({}, line));
  });

  const there = (x0: number, x1: number, step: number): number[] => {
    const xs: number[] = [];
    for (let x = x0; step > 0 ? x <= x1 : x >= x1; x += step) xs.push(x);
    return xs;
  };

  it('lays only part of the opacity in one pass, and never past the ceiling', () => {
    const slow = { flow: 0.2, opacity: 0.8, spacing: 0.5 };
    const once = alphaAfter(slow, there(10, 50, 4));
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThan(0.8 * 255);
    const pass = [...there(10, 50, 4), ...there(50, 10, -4)];
    const many = alphaAfter(slow, [...pass, ...pass, ...pass, ...pass, ...pass, ...pass, ...pass, ...pass]);
    expect(many).toBeGreaterThan(once);
    expect(many).toBeLessThanOrEqual(Math.ceil(0.8 * 255));
  });

  it('gives the same line however densely the pen is sampled', () => {
    const profile = (step: number): number[] => {
      const doc = createDocument(96, 16);
      const layer = activeLayer(doc);
      const s = new Stroke(paintTarget(layer), { ...brush, flow: 0.2, spacing: 0.25 });
      for (const x of there(10, 86, step)) s.addPoint(x, 8);
      s.finish();
      const out: number[] = [];
      for (let x = 25; x <= 70; x++) out.push(layer.surface.alphaAt(x, 8));
      return out;
    };
    const sparse = profile(7);
    const dense = profile(1);
    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    expect(Math.abs(mean(sparse) - mean(dense))).toBeLessThan(8);
  });

  it('undoes like any other stroke', () => {
    const doc = createDocument(32, 16);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...brush, flow: 0.5 });
    s.addPoint(8, 8);
    s.addPoint(24, 8);
    const patch = s.finish();
    expect(patch).not.toBeNull();
    expect(inkCount(layer)).toBeGreaterThan(0);
  });
});

describe('brush pressure to flow', () => {
  const base = { ...defaultBrush, size: 10, hardness: 1, stabilization: 0, pressureSize: 0, spacing: 0.1, opacity: 1 };
  const alphaAt = (settings: Partial<typeof base> & { pressureFlow?: number }, pressure: number): number => {
    const doc = createDocument(64, 16);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...base, ...settings });
    for (let x = 10; x <= 50; x += 4) s.addPoint(x, 8, pressure);
    s.finish();
    return layer.surface.alphaAt(32, 8);
  };

  it('does nothing when unset or zero', () => {
    expect(alphaAt({ pressureFlow: 0 }, 0.2)).toBe(alphaAt({}, 0.2));
  });

  it('lays less at a light touch than at full pressure', () => {
    const light = alphaAt({ pressureFlow: 0.8 }, 0.2);
    const full = alphaAt({ pressureFlow: 0.8 }, 1);
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(full);
  });

  it('reaches the ceiling at full pressure even though it stamps', () => {
    expect(alphaAt({ pressureFlow: 0.8 }, 1)).toBeGreaterThan(0.95 * 255);
  });

  it('multiplies with the flow setting', () => {
    const plain = alphaAt({ flow: 0.5, pressureFlow: 0.5 }, 0.2);
    const flowOnly = alphaAt({ flow: 0.5 }, 0.2);
    expect(plain).toBeLessThan(flowOnly);
  });
});

describe('stroke entry ramp', () => {
  const base = { ...defaultBrush, size: 12, hardness: 1, stabilization: 0, pressureSize: 1, opacity: 1 };
  const widthAt = (entryRamp: number | undefined, x: number): number => {
    const doc = createDocument(80, 24);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...base, entryRamp });
    for (let i = 0; i <= 60; i += 3) s.addPoint(10 + i, 12, 1);
    s.finish();
    let n = 0;
    for (let y = 0; y < 24; y++) if (layer.surface.alphaAt(x, y) > 127) n++;
    return n;
  };

  it('does nothing when off', () => {
    expect(widthAt(0, 11)).toBe(widthAt(undefined, 11));
  });

  it('opens thinner than the rest of the stroke', () => {
    expect(widthAt(5, 11)).toBeLessThan(widthAt(5, 50));
    expect(widthAt(5, 11)).toBeLessThan(widthAt(0, 11));
  });

  it('is the same once past the ramp', () => {
    expect(widthAt(5, 55)).toBe(widthAt(0, 55));
  });

  it('still paints a single tap', () => {
    const doc = createDocument(40, 40);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...base, entryRamp: 5 });
    s.addPoint(20, 20, 1);
    s.finish();
    expect(layer.surface.alphaAt(20, 20)).toBeGreaterThan(0);
  });

  it('scales its length with the stabilization, between 3 and 5 samples', () => {
    expect(entryRampSamples(0)).toBe(3);
    expect(entryRampSamples(1)).toBe(5);
    expect(entryRampSamples(0.5)).toBeGreaterThanOrEqual(3);
  });
});
