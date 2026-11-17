import { describe, expect, it } from 'vitest';
import { Stroke, defaultBrush } from './brush';
import { activeLayer, createDocument, paintTarget } from './document';
import { inkCount } from './test-utils';
import { correctPath, correctionOf, correctionSigma, resamplePath, type CorrectionPoint } from './stroke-correct';

/** A deterministic pseudo-random wobble in -1…1. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}

const line = (n: number, wobble: number, seed = 3): CorrectionPoint[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ x: i * 4, y: r() * wobble, p: 1 }));
};
const rms = (pts: readonly CorrectionPoint[], f: (q: CorrectionPoint) => number): number => Math.sqrt(pts.reduce((a, q) => a + f(q) ** 2, 0) / pts.length);

describe('resamplePath', () => {
  it('walks the path at an even distance and ends on its last point', () => {
    const out = resamplePath([{ x: 0, y: 0, p: 0 }, { x: 10, y: 0, p: 1 }, { x: 10, y: 10, p: 1 }], 2);
    expect(out[0]).toEqual({ x: 0, y: 0, p: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 10, p: 1 });
    for (let i = 1; i < out.length - 1; i++) expect(Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.y - out[i - 1]!.y)).toBeCloseTo(2, 6);
  });
});

describe('correctPath', () => {
  it('does nothing with no spread or too few points', () => {
    const pts = line(40, 2);
    expect(correctPath(pts, 0, 2.5)).toEqual(pts);
    expect(correctPath(pts.slice(0, 2), 10, 2.5)).toEqual(pts.slice(0, 2));
  });

  it('flattens a wobbly line towards a straight one and keeps both ends', () => {
    const pts = line(120, 3);
    const out = correctPath(pts, 12, 2.5);
    expect(out[0]).toEqual({ x: 0, y: pts[0]!.y, p: 1 });
    const end = out[out.length - 1]!;
    expect(end.x).toBeCloseTo(pts[pts.length - 1]!.x, 6);
    expect(end.y).toBeCloseTo(pts[pts.length - 1]!.y, 6);
    // Away from the ends the wobble is a fraction of what it was.
    const mid = (a: readonly CorrectionPoint[]): CorrectionPoint[] => a.slice(Math.floor(a.length * 0.2), Math.floor(a.length * 0.8));
    expect(rms(mid(out), (q) => q.y)).toBeLessThan(rms(mid(pts), (q) => q.y) * 0.5);
  });

  it('a stronger level smooths more', () => {
    const pts = line(160, 3);
    const rough = (sigma: number): number => rms(correctPath(pts, sigma, 2.5).slice(30, 130), (q) => q.y);
    expect(rough(20)).toBeLessThan(rough(10));
    expect(rough(10)).toBeLessThan(rough(5));
  });

  it('keeps a straight line exactly straight', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 5, y: i * 2, p: 0.5 }));
    for (const q of correctPath(pts, 20, 2.5)) expect(q.y).toBeCloseTo(q.x * 0.4, 6);
  });

  it('keeps the bend of a curve (a quarter circle moves by a pixel at most)', () => {
    const R = 200;
    const pts = Array.from({ length: 80 }, (_, i) => {
      const a = ((i / 79) * Math.PI) / 2;
      return { x: R * Math.cos(a), y: R * Math.sin(a), p: 1 };
    });
    for (const q of correctPath(pts, 10, 2.5)) expect(Math.abs(Math.hypot(q.x, q.y) - R)).toBeLessThan(1);
  });

  it('keeps a sharp corner sharp', () => {
    const pts: CorrectionPoint[] = [];
    for (let i = 0; i <= 60; i++) pts.push({ x: i * 3, y: 0, p: 1 });
    for (let i = 1; i <= 60; i++) pts.push({ x: 180, y: i * 3, p: 1 });
    const out = correctPath(pts, 12, 2.5);
    const nearCorner = out.reduce((best, q) => Math.min(best, Math.hypot(q.x - 180, q.y)), Infinity);
    expect(nearCorner).toBeLessThan(1.5);
  });

  it('a short stroke keeps its shape (the spread is capped by its length)', () => {
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 2) * 4, p: 1 }));
    const out = correctPath(pts, 20, 2.5);
    expect(Math.max(...out.map((q) => Math.abs(q.y)))).toBeGreaterThan(1);
  });
});

describe('correction levels', () => {
  it('reads a level, falling back to medium', () => {
    expect(correctionOf(0)).toBe(0);
    expect(correctionOf(3)).toBe(3);
    expect(correctionOf(undefined)).toBe(2);
    expect(correctionOf(7)).toBe(2);
  });
  it('is a length on screen: it shrinks when zoomed in', () => {
    expect(correctionSigma(0)).toBe(0);
    expect(correctionSigma(undefined)).toBe(0);
    expect(correctionSigma(2, 2)).toBeCloseTo(correctionSigma(2, 1) / 2);
    expect(correctionSigma(3)).toBeGreaterThan(correctionSigma(1));
  });
});

describe('Stroke with correction', () => {
  /** A hand-drawn horizontal line at y = 40 that wobbles by a few pixels. */
  const draw = (correction: 0 | 1 | 2 | 3 | undefined, taperOut = 0) => {
    const doc = createDocument(240, 80);
    const layer = activeLayer(doc);
    const s = new Stroke(paintTarget(layer), { ...defaultBrush, size: 3, hardness: 1, stabilization: 0, pressureSize: 0, color: [0, 0, 0], correction, taperOut });
    const r = rng(11);
    for (let i = 0; i <= 100; i++) s.addPoint(20 + i * 2, 40 + r() * 3);
    const patch = s.finish();
    return { layer, patch, doc };
  };
  /** How far the ink strays from the line y = 40, on average over the middle of the stroke. */
  const stray = (layer: ReturnType<typeof draw>['layer']): number => {
    let sum = 0;
    let n = 0;
    for (let x = 60; x < 180; x++)
      for (let y = 0; y < 80; y++) {
        const a = layer.surface.alphaAt(x, y);
        if (a) {
          sum += Math.abs(y - 40) * a;
          n += a;
        }
      }
    return sum / n;
  };

  it('is off when not asked for', () => {
    const a = draw(undefined);
    const b = draw(0);
    expect(stray(a.layer)).toBeCloseTo(stray(b.layer), 9);
  });

  it('paints a cleaner line, and a stronger level a cleaner one', () => {
    const none = stray(draw(0).layer);
    const weak = stray(draw(1).layer);
    const strong = stray(draw(3).layer);
    expect(weak).toBeLessThan(none);
    expect(strong).toBeLessThan(weak);
  });

  it('keeps the ends where the pen was lifted and put down', () => {
    const { layer } = draw(3);
    expect(layer.surface.alphaAt(20, 40) + layer.surface.alphaAt(20, 41) + layer.surface.alphaAt(20, 39)).toBeGreaterThan(0);
    expect(layer.surface.alphaAt(220, 40) + layer.surface.alphaAt(220, 41) + layer.surface.alphaAt(220, 39)).toBeGreaterThan(0);
  });

  it('undoes in one step, and works together with the thinning out of the end', () => {
    const { layer, patch, doc } = draw(2, 30);
    expect(patch).not.toBeNull();
    for (const t of patch!.tiles) layer.surface.put(t.tx, t.ty, t.before ?? undefined);
    expect(inkCount(layer)).toBe(0);
    expect(doc.layers.length).toBeGreaterThan(0);
  });
});
