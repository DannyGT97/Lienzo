import { describe, expect, it } from 'vitest';
import { bodyOutline, createBalloon, hitBalloon, hitHandle, resizeBalloon, tailShapes, textArea } from './balloon';
import { area, contains, rectPoly, splitConvex } from './geometry';
import { addRectPanel, gridPanels, panelAt, splitPanels } from './panels';
import { fitText, wrapParagraph } from './text-layout';
import { TiledSurface } from './tiles';
import { cellSize, defaultTone, renderTone, toneCoverage } from './tone';

describe('geometry and panels', () => {
  it('splits a rectangle with a gutter and conserves area', () => {
    const r = rectPoly(0, 0, 100, 100);
    const parts = splitConvex(r, { x: 50, y: 0 }, { x: 50, y: 100 }, 10)!;
    expect(parts).toHaveLength(2);
    const [a, b] = parts.map(area) as [number, number];
    expect(a).toBeCloseTo(45 * 100);
    expect(b).toBeCloseTo(45 * 100);
  });

  it('supports diagonal splits and rejects lines that miss', () => {
    const r = rectPoly(0, 0, 100, 100);
    const diag = splitConvex(r, { x: 0, y: 0 }, { x: 100, y: 100 }, 0)!;
    expect(area(diag[0]) + area(diag[1])).toBeCloseTo(100 * 100);
    expect(splitConvex(r, { x: 200, y: 0 }, { x: 200, y: 100 }, 10)).toBeNull();
  });

  it('builds a page grid inside the margins', () => {
    const panels = gridPanels([], { w: 1000, h: 1400 }, 3, 2, 50, 20);
    expect(panels).toHaveLength(6);
    expect(new Set(panels.map((p) => p.id)).size).toBe(6);
    const first = panels[0]!.points;
    expect(first[0]).toEqual({ x: 50, y: 50 });
    // All panels stay inside the margin box and never overlap each other's centre.
    for (const p of panels) for (const q of p.points) {
      expect(q.x).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(q.x).toBeLessThanOrEqual(950 + 1e-9);
    }
    for (const p of panels) {
      const c = { x: (p.points[0]!.x + p.points[2]!.x) / 2, y: (p.points[0]!.y + p.points[2]!.y) / 2 };
      expect(panelAt(panels, c)!.id).toBe(p.id);
    }
  });

  it('splitPanels cuts only the panels the line crosses', () => {
    let panels = addRectPanel([], { x: 0, y: 0 }, { x: 100, y: 100 });
    panels = addRectPanel(panels, { x: 200, y: 0 }, { x: 300, y: 100 });
    const out = splitPanels(panels, { x: 50, y: -10 }, { x: 50, y: 110 }, 10);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((p) => p.id)).size).toBe(3);
    expect(splitPanels(panels, { x: 150, y: -10 }, { x: 150, y: 110 }, 10)).toBe(panels);
  });

  it('a short stroke only cuts the panel it passes through, even if its line would reach others', () => {
    let panels = addRectPanel([], { x: 0, y: 0 }, { x: 100, y: 100 });
    panels = addRectPanel(panels, { x: 120, y: 0 }, { x: 220, y: 100 });
    const out = splitPanels(panels, { x: -10, y: 50 }, { x: 60, y: 50 }, 10); // horizontal, ends inside panel 1
    expect(out).toHaveLength(3);
    expect(out.filter((p) => p.points.every((q) => q.x >= 120))).toHaveLength(1);
    const reaching = splitPanels(panels, { x: -10, y: 50 }, { x: 230, y: 50 }, 10); // spans both
    expect(reaching).toHaveLength(4);
  });
});

describe('halftone tone', () => {
  const cell = cellSize(350, 60);
  const mean = (shape: 'dot' | 'line' | 'cross', density: number, angle = 45): number => {
    let sum = 0;
    const n = 120;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sum += toneCoverage({ ...defaultTone, shape, density, angle }, cell, x, y);
    return sum / (n * n);
  };

  it('has the requested ink coverage for lines and crosses', () => {
    for (const d of [0.1, 0.3, 0.5, 0.8]) {
      expect(mean('line', d, 30)).toBeCloseTo(d, 1);
      expect(mean('cross', d, 0)).toBeCloseTo(d, 1);
    }
  });

  it('has the requested ink coverage for round dots below the knee', () => {
    for (const d of [0.1, 0.3, 0.5, 0.7]) expect(Math.abs(mean('dot', d) - d)).toBeLessThan(0.05);
  });

  it('is empty at 0, solid at 1 and monotonic in between', () => {
    expect(mean('dot', 0)).toBe(0);
    expect(mean('dot', 1)).toBe(1);
    expect(mean('dot', 0.2)).toBeLessThan(mean('dot', 0.4));
    expect(mean('dot', 0.4)).toBeLessThan(mean('dot', 0.9));
  });

  it('clips the screen to the painted area and keeps no tiles for unpainted ones', () => {
    const w = 600;
    const source = new TiledSurface(w, w);
    source.writeRect({ x: 0, y: 0, w: 20, h: 40 }, new Uint8ClampedArray(20 * 40 * 4).fill(255));
    const out = new TiledSurface(w, w);
    renderTone({ ...defaultTone, density: 1 }, 350, source, out, { x: 0, y: 0, w, h: w });
    expect(out.alphaAt(5, 5)).toBe(255);
    expect(out.alphaAt(30, 5)).toBe(0);
    expect(out.tileCount).toBe(1); // only the tile that holds the painted area has a screen
    // Erasing the mask and re-rendering removes the screen again.
    source.clear();
    renderTone({ ...defaultTone, density: 1 }, 350, source, out, { x: 0, y: 0, w, h: w });
    expect(out.tileCount).toBe(0);
  });
});

describe('balloons', () => {
  const b = { ...createBalloon(1, 'ellipse', { x: 100, y: 100 }, { x: 300, y: 200 }) };

  it('outlines every shape as a closed polygon around the box', () => {
    for (const shape of ['ellipse', 'rounded', 'rough', 'rect', 'curve', 'shout', 'cloud'] as const) {
      const poly = bodyOutline({ ...b, shape });
      expect(poly.length).toBeGreaterThanOrEqual(4);
      expect(contains(poly, { x: 200, y: 150 })).toBe(true);
      expect(contains(poly, { x: 50, y: 50 })).toBe(false);
    }
    expect(bodyOutline({ ...b, shape: 'none' })).toEqual([]);
  });

  it('builds a tail towards the tip, buried in the body', () => {
    expect(tailShapes(b)).toEqual([]);
    expect(tailShapes({ ...b, tail: { x: 200, y: 150 } })).toEqual([]); // tip inside the body
    const tail = tailShapes({ ...b, tail: { x: 180, y: 320 } })[0]!;
    expect(tail).toContainEqual({ x: 180, y: 320 });
    expect(contains(bodyOutline(b), tail[0]!)).toBe(true); // base is inside
  });

  it('hit-tests the body, the tail and the handles', () => {
    const withTail = { ...b, tail: { x: 180, y: 320 } };
    expect(hitBalloon([b], { x: 150, y: 120 })).toBe(b);
    expect(hitBalloon([b], { x: 20, y: 20 })).toBeNull();
    expect(hitBalloon([withTail], { x: 185, y: 285 })).toBe(withTail);
    expect(hitBalloon([withTail], { x: 230, y: 285 })).toBeNull();
    expect(hitHandle(withTail, { x: 183, y: 318 }, 8)).toBe('tail');
    expect(hitHandle(withTail, { x: 101, y: 101 }, 8)).toBe('nw');
    expect(hitHandle(withTail, { x: 200, y: 150 }, 8)).toBeNull();
  });

  it('resizes from a corner without inverting', () => {
    const r = resizeBalloon(b, 'se', { x: 400, y: 260 });
    expect([r.x, r.y, r.w, r.h]).toEqual([100, 100, 300, 160]);
    const tiny = resizeBalloon(b, 'se', { x: 0, y: 0 });
    expect(tiny.w).toBeGreaterThan(0);
    expect(tiny.h).toBeGreaterThan(0);
    const t = textArea(b);
    expect(t.w).toBeLessThan(b.w);
  });
});

describe('text layout', () => {
  const mono = (size: number) => (s: string) => s.length * size * 0.5;

  it('wraps on word boundaries and splits over-long words', () => {
    expect(wrapParagraph('hello brave new world', 12 * 0.5 * 11, mono(12))).toEqual(['hello brave', 'new world']);
    const long = wrapParagraph('supercalifragilistic', 5 * 6, (s) => s.length * 5);
    expect(long.every((l) => l.length <= 6)).toBe(true);
    expect(long.join('')).toBe('supercalifragilistic');
  });

  it('breaks CJK per character', () => {
    const lines = wrapParagraph('こんにちは世界です', 30, (s) => [...s].length * 10);
    expect(lines.join('')).toBe('こんにちは世界です');
    expect(lines.every((l) => [...l].length <= 3)).toBe(true);
  });

  it('centres lines and shrinks the font until the text fits', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const big = fitText(text, { areaW: 120, areaH: 60, fontSize: 40, vertical: false, measureAt: mono });
    expect(big.fits).toBe(true);
    expect(big.fontSize).toBeLessThan(40);
    expect(big.items.every((i) => i.cx === 60)).toBe(true);
    const ys = big.items.map((i) => i.cy);
    expect(ys[0]).toBeGreaterThan(0);
    expect(ys[ys.length - 1]).toBeLessThan(60);
  });

  it('reports overflow at the minimum size', () => {
    const r = fitText('x '.repeat(300), { areaW: 40, areaH: 20, fontSize: 20, vertical: false, measureAt: mono }, 10);
    expect(r.fits).toBe(false);
    expect(r.fontSize).toBe(10);
  });

  it('lays vertical text in columns from right to left', () => {
    const r = fitText('あいう\nえお', { areaW: 100, areaH: 100, fontSize: 20, vertical: true, measureAt: mono });
    expect(r.fits).toBe(true);
    const first = r.items.find((i) => i.text === 'あ')!;
    const second = r.items.find((i) => i.text === 'え')!;
    expect(first.cx).toBeGreaterThan(second.cx);
    const col = r.items.filter((i) => i.cx === first.cx).map((i) => i.text);
    expect(col).toEqual(['あ', 'い', 'う']);
  });
});
