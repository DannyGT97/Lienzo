import { describe, expect, it } from 'vitest';
import { defaultBrush } from './brush';
import { addLayer, createDocument } from './document';
import { loadLienzo, saveLienzo } from './lienzo-file';
import { duplicateLayer, rasterizeLayer } from './layer-ops';
import {
  adjustWidthNear,
  cloneStrokes,
  controlIndexes,
  correctPoints,
  distanceToStroke,
  eraseTouching,
  pinch,
  rasterizeVector,
  reshape,
  scaleBrush,
  simplifyPoints,
  smoothPoints,
  strokesAt,
  vectorBrush,
  type VectorPoint,
  type VectorStroke,
} from './vector';

const brush = vectorBrush({ ...defaultBrush, size: 10, hardness: 1, pressureSize: 0, stabilization: 0.5 });

const line = (x0: number, y0: number, x1: number, y1: number, n = 40, p = 1): VectorPoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, p }));

const stroke = (id: number, points: VectorPoint[], size = 10): VectorStroke => ({ id, points, brush: { ...brush, size } });

function vectorLayer(strokes: VectorStroke[]) {
  const doc = createDocument(300, 200, 300);
  const layer = addLayer(doc, 'v', doc.layers.length, 'vector');
  layer.vector = strokes;
  return { doc, layer };
}

describe('vector layer drawing', () => {
  it('draws the strokes into the layer, and drawing again after an edit leaves no ghost of the old line', () => {
    const { layer } = vectorLayer([stroke(1, line(20, 50, 200, 50))]);
    rasterizeVector(layer);
    expect(layer.surface.pixel(100, 50)[3]).toBe(255);
    expect(layer.surface.pixel(100, 120)[3]).toBe(0);
    layer.vector = [stroke(1, line(20, 120, 200, 120))];
    rasterizeVector(layer);
    expect(layer.surface.pixel(100, 50)[3]).toBe(0);
    expect(layer.surface.pixel(100, 120)[3]).toBe(255);
  });

  it('keeps the brush colour and ignores erase mode and stabilization stored by accident', () => {
    const b = vectorBrush({ ...defaultBrush, color: [200, 10, 30], erase: true, stabilization: 0.9, entryRamp: 5 });
    expect(b.erase).toBe(false);
    expect(b.stabilization).toBe(0);
    expect(b.entryRamp).toBeUndefined();
    const { layer } = vectorLayer([{ id: 1, points: line(20, 50, 80, 50), brush: { ...b, size: 8, hardness: 1 } }]);
    rasterizeVector(layer);
    expect(layer.surface.pixel(50, 50).slice(0, 3)).toEqual([200, 10, 30]);
  });
});

describe('line correction', () => {
  it('thins a straight line to its two ends and keeps a corner', () => {
    expect(simplifyPoints(line(0, 0, 100, 0, 50), 1)).toHaveLength(2);
    const corner = [...line(0, 0, 50, 0, 25), ...line(50, 0, 50, 50, 25).slice(1)];
    const out = simplifyPoints(corner, 1);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ x: 50, y: 0 });
  });

  it('keeps a point where the pressure changes, even on a straight line', () => {
    const pts = line(0, 0, 100, 0, 20).map((q, i) => ({ ...q, p: i < 10 ? 0.2 : 1 }));
    expect(simplifyPoints(pts, 1).length).toBeGreaterThan(2);
  });

  it('smoothing rounds a corner without moving the ends', () => {
    const corner = [{ x: 0, y: 0, p: 1 }, { x: 50, y: 0, p: 1 }, { x: 50, y: 50, p: 1 }];
    const out = smoothPoints(corner, 2);
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[out.length - 1]).toMatchObject({ x: 50, y: 50 });
    expect(out.every((q) => !(q.x === 50 && q.y === 0))).toBe(true);
  });

  it('removes the jitter of a hand-drawn line and leaves fewer points; strength 0 only removes repeats', () => {
    const rough = line(0, 50, 200, 50, 200).map((q, i) => ({ ...q, y: 50 + (i % 2 ? 1.5 : -1.5) }));
    const none = correctPoints(rough, 0, 10);
    expect(none.length).toBe(rough.length);
    const fixed = correctPoints(rough, 0.6, 10);
    expect(fixed.length).toBeLessThan(rough.length / 5);
    expect(Math.max(...fixed.slice(1, -1).map((q) => Math.abs(q.y - 50)))).toBeLessThan(1);
    const held = correctPoints([{ x: 5, y: 5, p: 0.4 }, { x: 5, y: 5, p: 0.9 }, { x: 5.2, y: 5, p: 0.5 }, { x: 40, y: 5, p: 1 }], 0, 10);
    expect(held).toHaveLength(2);
    expect(held[0]!.p).toBeCloseTo(0.9);
  });
});

describe('editing points', () => {
  it('dragging a control point bends the line between its neighbours and leaves the rest alone', () => {
    const pts = line(0, 100, 200, 100, 40);
    const controls = [0, 10, 20, 30, 40];
    const out = reshape(pts, controls, 2, 0, -30);
    expect(out[20]).toMatchObject({ x: 100, y: 70 });
    expect(out[15]!.y).toBeLessThan(100);
    expect(out[15]!.y).toBeGreaterThan(70);
    expect(out[10]!.y).toBe(100);
    expect(out[30]!.y).toBe(100);
    expect(out[3]!.y).toBe(100);
    expect(pts[20]!.y).toBe(100); // the input is not changed
  });

  it('pinch and width also work on a line simplified to its two ends, adding points only near the pen', () => {
    const two = [{ x: 0, y: 0, p: 0.5 }, { x: 300, y: 0, p: 0.5 }];
    const pinched = pinch(two, 150, 10, 30, 1);
    expect(pinched.length).toBeGreaterThan(2);
    expect(pinched.length).toBeLessThan(40);
    expect(Math.max(...pinched.map((q) => q.y))).toBeGreaterThan(3);
    expect(pinched[0]).toMatchObject({ x: 0, y: 0 });
    expect(pinched[pinched.length - 1]).toMatchObject({ x: 300, y: 0 });
    expect(pinch(two, 150, 100, 30, 1)).toHaveLength(2); // pen too far: nothing added
    expect(Math.max(...adjustWidthNear(two, 150, 0, 30, 2).map((q) => q.p))).toBeCloseTo(1);
    const full = [{ x: 0, y: 0, p: 1 }, { x: 300, y: 0, p: 1 }];
    expect(adjustWidthNear(full, 150, 0, 30, 2)).toEqual(full); // already at full pressure: unchanged, no extra points
  });

  it('finds control points that cover the line within a tolerance', () => {
    const corner = [...line(0, 0, 50, 0, 25), ...line(50, 0, 50, 50, 25).slice(1)];
    expect(controlIndexes(corner, 1)).toEqual([0, 25, 50]);
  });

  it('pinch pulls nearby points in and adjust width changes only nearby pressure', () => {
    const pts = line(0, 0, 100, 0, 20, 0.5);
    const pinched = pinch(pts, 50, 10, 30, 1);
    expect(pinched[10]!.y).toBeGreaterThan(5);
    expect(pinched[0]!.y).toBe(0);
    const wide = adjustWidthNear(pts, 50, 0, 20, 2);
    expect(wide[10]!.p).toBeCloseTo(1);
    expect(wide[0]!.p).toBe(0.5);
    expect(adjustWidthNear(pts, 50, 0, 20, 0.0001)[10]!.p).toBe(0.02);
    expect(scaleBrush(stroke(1, pts, 10), 0.01).brush.size).toBe(1);
  });
});

describe('hit testing and erasing by touch', () => {
  const a = stroke(1, line(20, 50, 200, 50), 10);
  const b = stroke(2, line(20, 120, 200, 120), 10);

  it('knows how far a point is from the ink', () => {
    expect(distanceToStroke(a, 100, 50)).toBe(0);
    expect(distanceToStroke(a, 100, 55)).toBe(0); // on the edge of a 10 px line
    expect(distanceToStroke(a, 100, 70)).toBeCloseTo(15, 0);
  });

  it('finds the line under the pen, topmost first', () => {
    const crossing = stroke(3, line(100, 20, 100, 150), 10);
    expect(strokesAt([a, b, crossing], 100, 50, 2).map((s) => s.id)).toEqual([3, 1]);
    expect(strokesAt([a, b], 100, 85, 2)).toEqual([]);
  });

  it('erasing by touch drops exactly the lines the circle reaches', () => {
    const { kept, removed } = eraseTouching([a, b], 100, 60, 8);
    expect(removed.map((s) => s.id)).toEqual([1]);
    expect(kept.map((s) => s.id)).toEqual([2]);
  });
});

describe('vector layers in documents', () => {
  it('survive saving and loading with their lines, and a duplicate edits independently', async () => {
    const { doc, layer } = vectorLayer([stroke(1, line(20, 50, 200, 50))]);
    rasterizeVector(layer);
    const back = await loadLienzo(await saveLienzo(doc));
    const l = back.layers.find((x) => x.kind === 'vector')!;
    expect(l.vector).toEqual(layer.vector);
    expect(l.surface.pixel(100, 50)[3]).toBe(255);
    const copy = duplicateLayer(doc, layer.id)!;
    copy.vector![0]!.points[0]!.x = 999;
    expect(layer.vector![0]!.points[0]!.x).toBe(20);
  });

  it('rasterizing keeps the picture and gives up the lines; undo brings them back', () => {
    const { layer } = vectorLayer([stroke(1, line(20, 50, 200, 50))]);
    rasterizeVector(layer);
    const cmd = rasterizeLayer(layer)!;
    expect(layer.kind).toBe('raster');
    expect(layer.vector).toBeUndefined();
    expect(layer.surface.pixel(100, 50)[3]).toBe(255);
    cmd.undo();
    expect(layer.kind).toBe('vector');
    expect(layer.vector).toHaveLength(1);
  });

  it('cloneStrokes gives independent copies', () => {
    const s = [stroke(1, line(0, 0, 10, 0, 5))];
    const c = cloneStrokes(s);
    c[0]!.points[0]!.x = 50;
    c[0]!.brush.size = 99;
    expect(s[0]!.points[0]!.x).toBe(0);
    expect(s[0]!.brush.size).toBe(10);
  });
});
