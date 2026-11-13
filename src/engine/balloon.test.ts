import { describe, expect, it } from 'vitest';
import { bodyOutline, createBalloon, hitBalloon, moveBalloon, pathBalloon, resizeBalloon, tailShapes, withDefaultTail, withShape, withTail } from './balloon';
import { contains } from './geometry';
import { applyPageOp } from './page-ops';
import { createDocument, addLayer } from './document';

const base = createBalloon(1, 'ellipse', { x: 100, y: 100 }, { x: 300, y: 200 });
const circle = [
  { x: 200, y: 100 },
  { x: 300, y: 200 },
  { x: 200, y: 300 },
  { x: 100, y: 200 },
];

describe('balloon shapes', () => {
  it('draws a different outline for each shape', () => {
    const outlines = (['ellipse', 'rounded', 'rough', 'rect'] as const).map((s) => JSON.stringify(bodyOutline(withShape(base, s))));
    expect(new Set(outlines).size).toBe(outlines.length);
  });

  it('wobbles the rough edge the same way every time', () => {
    const a = bodyOutline(withShape(base, 'rough'));
    expect(bodyOutline(withShape(base, 'rough'))).toEqual(a);
    const rounded = bodyOutline(withShape(base, 'rounded'));
    expect(a.length).toBeGreaterThan(rounded.length);
  });

  it('makes a curve through the clicked points', () => {
    const b = pathBalloon(5, circle)!;
    expect(b.shape).toBe('curve');
    expect([b.x, b.y, b.w, b.h]).toEqual([100, 100, 200, 200]);
    const poly = bodyOutline(b);
    for (const p of circle) expect(poly.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)).toBe(true);
    expect(contains(poly, { x: 200, y: 200 })).toBe(true);
  });

  it('refuses a curve with too few points or too small', () => {
    expect(pathBalloon(1, circle.slice(0, 2))).toBeNull();
    expect(pathBalloon(1, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }])).toBeNull();
  });

  it('keeps points only for the curve shape', () => {
    const curve = withShape(base, 'curve');
    expect(curve.pts).toHaveLength(8);
    expect(withShape(curve, 'curve').pts).toBe(curve.pts);
    expect(withShape(curve, 'rect').pts).toBeUndefined();
    const own = pathBalloon(2, circle)!;
    expect(withShape(own, 'curve').pts).toEqual(circle);
  });

  it('moves and resizes the points with the balloon', () => {
    const b = pathBalloon(2, circle)!;
    const m = moveBalloon({ ...b, tail: { x: 150, y: 400 } }, 10, -20);
    expect(m.pts![0]).toEqual({ x: 210, y: 80 });
    expect(m.tail).toEqual({ x: 160, y: 380 });
    const r = resizeBalloon(b, 'se', { x: 500, y: 300 });
    expect(r.pts![1]).toEqual({ x: 500, y: 200 }); // right-most point follows the new right edge
    expect(r.pts![0]).toEqual({ x: 300, y: 100 });
  });
});

describe('balloon tails', () => {
  it('a speech tail is one spike and a thought tail a chain of bubbles that shrink', () => {
    const tip = { x: 180, y: 360 };
    expect(tailShapes(withTail(base, tip, 'speech'))).toHaveLength(1);
    const bubbles = tailShapes(withTail(base, tip, 'thought'));
    expect(bubbles).toHaveLength(3);
    const size = (p: { x: number; y: number }[]): number => Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
    expect(size(bubbles[0]!)).toBeGreaterThan(size(bubbles[1]!));
    expect(size(bubbles[1]!)).toBeGreaterThan(size(bubbles[2]!));
    // The chain goes from the body towards the tip, away from the body.
    const y = (p: { y: number }[]): number => p.reduce((s, q) => s + q.y, 0) / p.length;
    expect(y(bubbles[0]!)).toBeLessThan(y(bubbles[2]!));
  });

  it('a tip inside the body is no tail, and the style is remembered', () => {
    expect(withTail(base, { x: 200, y: 150 }, 'speech').tail).toBeNull();
    expect(withTail(base, { x: 180, y: 360 }, 'thought').tailStyle).toBe('thought');
    expect('tailStyle' in withTail(withTail(base, { x: 180, y: 360 }, 'thought'), { x: 180, y: 360 }, 'speech')).toBe(false);
  });

  it('every bubble of a thought tail answers a click', () => {
    const b = withTail(base, { x: 180, y: 360 }, 'thought');
    const last = tailShapes(b)[2]!;
    const c = { x: last.reduce((s, q) => s + q.x, 0) / last.length, y: last.reduce((s, q) => s + q.y, 0) / last.length };
    expect(hitBalloon([b], c)).toBe(b);
  });
});

describe('a tail that belongs to every shape', () => {
  it('a new balloon of any shape comes with a tail that sticks out of its body', () => {
    for (const shape of ['ellipse', 'rounded', 'rough', 'rect', 'shout', 'cloud'] as const) {
      const b = withDefaultTail(createBalloon(1, shape, { x: 100, y: 100 }, { x: 300, y: 200 }));
      expect(b.tail, shape).not.toBeNull();
      expect(tailShapes(b).length, shape).toBeGreaterThan(0);
    }
    const curve = withDefaultTail(pathBalloon(1, circle)!);
    expect(tailShapes(curve)).toHaveLength(1);
  });

  it('clouds think and the rest speak, unless told otherwise; free text gets no tail', () => {
    expect(withDefaultTail(withShape(base, 'cloud')).tailStyle).toBe('thought');
    expect(withDefaultTail(base).tailStyle).toBeUndefined();
    expect(withDefaultTail(base, 'thought').tailStyle).toBe('thought');
    expect(withDefaultTail(withShape(base, 'none')).tail).toBeNull();
  });

  it('keeps its place in the balloon when the balloon is resized', () => {
    const b = withDefaultTail(base); // tip at 35 % across, 135 % down
    const r = resizeBalloon(b, 'se', { x: 500, y: 300 });
    expect(r.tail!.x).toBeCloseTo(100 + 0.35 * 400);
    expect(r.tail!.y).toBeCloseTo(100 + 1.35 * 200);
    // Pulling the tail itself still places the tip exactly where the pointer is.
    expect(resizeBalloon(b, 'tail', { x: 7, y: 9 }).tail).toEqual({ x: 7, y: 9 });
  });
});

describe('balloons on a page operation', () => {
  it('maps the points of a curve with the page', () => {
    const doc = createDocument(400, 400);
    const layer = addLayer(doc, 'Globos', doc.layers.length, 'balloons');
    layer.balloons = [{ ...pathBalloon(1, circle)!, tail: { x: 150, y: 350 } }];
    const cmd = applyPageOp(doc, { kind: 'flip', axis: 'h' }, 'test')!;
    expect(cmd).not.toBeNull();
    const b = doc.layers.find((l) => l.kind === 'balloons')!.balloons![0]!;
    expect(b.pts![0]).toEqual({ x: 200, y: 100 });
    expect(b.pts![1]).toEqual({ x: 100, y: 200 });
    expect(b.tail).toEqual({ x: 250, y: 350 });
    expect(b.x).toBe(100);
  });
});
