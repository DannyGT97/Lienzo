import { describe, expect, it } from 'vitest';
import { distanceToRuler, followGuides, followPerspective, nearestOnPath, rulerPath, simplifyPath, smoothCurve, specialGuides, type Ruler } from './rulers';

describe('curve, pen and figure rulers', () => {
  const curve: Ruler = { id: 1, kind: 'curve', pts: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }] };

  it('a smooth curve passes through its points', () => {
    const s = smoothCurve(curve.pts);
    expect(s[0]).toEqual({ x: 0, y: 0 });
    expect(s[s.length - 1]).toEqual({ x: 100, y: 0 });
    expect(s.some((q) => Math.hypot(q.x - 50, q.y - 40) < 1e-9)).toBe(true);
    expect(smoothCurve([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toHaveLength(2);
  });

  it('a stroke that starts on the curve is kept on it; one that starts away is free', () => {
    const path = rulerPath(curve)!;
    const start = nearestOnPath(path, { x: 10, y: 10 }).pt;
    const follow = followGuides([curve], start, 8)!;
    let q = follow(start);
    for (let x = 12; x <= 50; x += 6) q = follow({ x, y: 70 }); // the pen drifts far below the arch while moving along it
    expect(q.x).toBeCloseTo(50, 0);
    expect(q.y).toBeCloseTo(40, 0);
    expect(followGuides([curve], { x: 50, y: 100 }, 8)).toBeNull();
  });

  it('a pen ruler follows the corners of its polyline', () => {
    const pen: Ruler = { id: 2, kind: 'pen', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    const follow = followGuides([pen], { x: 10, y: 1 }, 5)!;
    expect(follow({ x: 60, y: 20 })).toEqual({ x: 60, y: 0 });
    const turned = follow({ x: 130, y: 60 }); // beyond the corner it carries on down the second leg
    expect(turned.x).toBeCloseTo(100, 6);
    expect(turned.y).toBeCloseTo(60, 6);
  });

  it('on a figure the stroke does not jump across to the other side', () => {
    const circle: Ruler = { id: 3, kind: 'figure', shape: 'ellipse', pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    const follow = followGuides([circle], { x: 100, y: 50 }, 6)!;
    const a = follow({ x: 99, y: 70 });
    const b = follow({ x: 80, y: 90 });
    expect(Math.hypot(a.x - 50, a.y - 50)).toBeCloseTo(50, 0);
    expect(Math.hypot(b.x - 50, b.y - 50)).toBeCloseTo(50, 0);
    expect(b.x).toBeGreaterThan(50); // still the right half
  });

  it('a pen path that comes back close to itself does not make the stroke jump branches', () => {
    // A hairpin: out along y = 0, back along y = 6.
    const hairpin: Ruler = { id: 7, kind: 'pen', pts: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 6 }, { x: 0, y: 6 }] };
    const follow = followGuides([hairpin], { x: 10, y: 0 }, 4)!;
    follow({ x: 200, y: 1 });
    expect(follow({ x: 300, y: 5 }).y).toBe(0); // 5 is nearer the return leg, but the pen is still on the way out
  });

  it('a rectangle figure is closed and its sides are followed', () => {
    const rect: Ruler = { id: 4, kind: 'figure', shape: 'rect', pts: [{ x: 10, y: 10 }, { x: 110, y: 60 }] };
    const path = rulerPath(rect)!;
    expect(path.closed).toBe(true);
    expect(path.total).toBeCloseTo(300, 6);
    const follow = followGuides([rect], { x: 60, y: 11 }, 4)!;
    expect(follow({ x: 80, y: 30 })).toEqual({ x: 80, y: 10 });
  });

  it('measures how far a ruler is from a point', () => {
    expect(distanceToRuler(curve, { x: 50, y: 40 })).toBeCloseTo(0, 6);
    expect(distanceToRuler({ id: 5, kind: 'persp2', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, { x: 90, y: 4 })).toBeCloseTo(Math.hypot(10, 4), 6);
    expect(distanceToRuler({ id: 6, kind: 'curve', pts: [{ x: 0, y: 0 }] }, { x: 1, y: 1 })).toBe(Infinity);
  });

  it('simplifies a freehand path to its corners', () => {
    const pts = [];
    for (let x = 0; x <= 100; x += 2) pts.push({ x, y: 0.2 * Math.sin(x) });
    for (let y = 2; y <= 100; y += 2) pts.push({ x: 100, y });
    const s = simplifyPath(pts, 3, 1);
    expect(s.length).toBeLessThanOrEqual(4);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

describe('special rulers', () => {
  it('parallel lines: a stroke snaps to the nearest line of the family', () => {
    const r: Ruler = { id: 1, kind: 'special', shape: 'parallel', gap: 20, count: 5, pts: [{ x: 0, y: 100 }, { x: 100, y: 100 }] };
    const follow = followGuides([r], { x: 30, y: 142 }, 5)!; // 2 lines below the base is y = 140
    expect(follow({ x: 60, y: 160 })).toEqual({ x: 60, y: 140 });
    expect(followGuides([r], { x: 30, y: 150 }, 5)).toBeNull(); // between two lines
    expect(followGuides([r], { x: 30, y: 250 }, 5)).toBeNull(); // beyond the last line
    expect(specialGuides(r)).toHaveLength(11);
  });

  it('radial lines: a stroke follows the ray nearest to where it starts', () => {
    const r: Ruler = { id: 2, kind: 'special', shape: 'radial', count: 4, pts: [{ x: 100, y: 100 }, { x: 200, y: 100 }] };
    const follow = followGuides([r], { x: 150, y: 102 }, 5)!;
    expect(follow({ x: 170, y: 130 }).y).toBeCloseTo(100, 6);
    expect(followGuides([r], { x: 150, y: 150 }, 5)).toBeNull(); // 4 rays are 0, 90, 180, 270 degrees: the diagonal is not one
    const down = followGuides([r], { x: 102, y: 160 }, 5)!;
    expect(down({ x: 90, y: 200 }).x).toBeCloseTo(100, 6);
  });

  it('concentric circles: a stroke goes round the ring it started on', () => {
    const r: Ruler = { id: 3, kind: 'special', shape: 'concentric', gap: 30, count: 4, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
    const follow = followGuides([r], { x: 61, y: 0 }, 5)!; // radius 60 ring
    const p = follow({ x: 100, y: 100 });
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(60, 6);
    expect(followGuides([r], { x: 45, y: 0 }, 5)).toBeNull(); // between rings
    expect(followGuides([r], { x: 200, y: 0 }, 5)).toBeNull(); // outside the last ring
    expect(follow({ x: 0, y: 0 })).toEqual({ x: 60, y: 0 }); // the centre itself does not blow up
  });

  it('an empty or degenerate family gives no guides', () => {
    expect(specialGuides({ id: 4, kind: 'special', shape: 'parallel', pts: [{ x: 5, y: 5 }, { x: 5, y: 5 }] })).toEqual([]);
    expect(specialGuides({ id: 5, kind: 'special', shape: 'parallel', pts: [{ x: 5, y: 5 }] })).toEqual([]);
  });
});

describe('two and three point perspective', () => {
  const two: Ruler = { id: 1, kind: 'persp2', pts: [{ x: -200, y: 0 }, { x: 300, y: 0 }] };

  it('with two points the pen picks a vanishing point or the vertical, by where it heads', () => {
    const start = { x: 50, y: 100 };
    const toLeft = followPerspective([two], start, 6)!;
    expect(toLeft({ x: 49, y: 100 })).toEqual({ x: 49, y: 100 }); // under the lock distance: free
    const l = toLeft({ x: 10, y: 99 });
    // The ray from (50,100) to (-200,0) has slope 0.4.
    expect(l.y).toBeCloseTo(100 + (l.x - 50) * 0.4, 6);
    const up = followPerspective([two], start, 6)!;
    const v = up({ x: 53, y: 40 });
    expect(v.x).toBeCloseTo(50, 6); // vertical
    expect(v.y).toBeCloseTo(40, 6);
    const right = followPerspective([two], start, 6)!;
    const rr = right({ x: 150, y: 80 });
    expect(rr.y).toBeCloseTo(100 + (rr.x - 50) * (-100 / 250), 6);
  });

  it('the vertical is perpendicular to a tilted horizon', () => {
    const tilted: Ruler = { id: 2, kind: 'persp2', pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    const f = followPerspective([tilted], { x: 500, y: 0 }, 5)!;
    const q = f({ x: 480, y: 25 }); // travelling along (-1, 1), perpendicular to the horizon (1, 1)
    expect(q.x + q.y).toBeCloseTo(500, 6);
  });

  it('with three points all three rays are offered', () => {
    const three: Ruler = { id: 3, kind: 'persp3', pts: [{ x: -300, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 600 }] };
    const start = { x: 0, y: 200 };
    const f = followPerspective([three], start, 5)!;
    const q = f({ x: 2, y: 260 }); // heading to the third point, straight down
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(260, 6);
    const g = followPerspective([three], start, 5)!;
    const w = g({ x: -60, y: 190 }); // heading to the first point
    expect(w.y).toBeCloseTo(200 + w.x * (-200 / -300), 6);
  });

  it('no perspective ruler gives null', () => {
    expect(followPerspective([], { x: 0, y: 0 }, 5)).toBeNull();
    expect(followPerspective([{ id: 9, kind: 'line', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { x: 0, y: 0 }, 5)).toBeNull();
  });
});
