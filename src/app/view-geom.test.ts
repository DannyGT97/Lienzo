import { describe, expect, it } from 'vitest';
import { docMatrix, docToScreen, isTurned, planeSize, screenDeltaToPlane, screenToDoc, visibleOutline, type ViewState } from './view-geom';

const S = { w: 800, h: 500 };
const view = (rot: ViewState['rot'], flip: boolean): ViewState => ({ x: 30, y: 20, scale: 0.5, rot, flip });

describe('view geometry', () => {
  it('goes there and back for every orientation', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      for (const flip of [false, true]) {
        const v = view(rot, flip);
        for (const [x, y] of [[0, 0], [100, 40], [333, 777]] as const) {
          const s = docToScreen(v, S, x, y);
          const d = screenToDoc(v, S, s.x, s.y);
          expect(d.x).toBeCloseTo(x, 6);
          expect(d.y).toBeCloseTo(y, 6);
        }
      }
    }
  });

  it('a quarter turn clockwise puts the top of the page on the right of the screen', () => {
    // Plane is 500 x 800 (swapped); the page origin sits at plane (30, 20).
    const v = view(1, false);
    expect(planeSize(v, S)).toEqual({ w: 500, h: 800 });
    const top = docToScreen(v, S, 0, 0); // plane (30, 20) -> x = ch - 20 = 780, y = 30
    expect([top.x, top.y]).toEqual([780, 30]);
    const right = docToScreen(v, S, 100, 0); // moving along the page's x goes down the screen
    expect(right.x).toBe(780);
    expect(right.y).toBe(80);
  });

  it('mirroring swaps left and right and keeps the vertical', () => {
    const v = view(0, true);
    const a = docToScreen(v, S, 0, 0);
    const b = docToScreen(v, S, 100, 0);
    expect(b.x).toBeLessThan(a.x);
    expect(b.y).toBe(a.y);
    expect(isTurned(v)).toBe(true);
    expect(isTurned(view(0, false))).toBe(false);
  });

  it('the matrix agrees with the point map, and a drag follows the turn', () => {
    const v = view(3, true);
    const [a, b, c, d, e, f] = docMatrix(v, S);
    const p = docToScreen(v, S, 120, 45);
    expect(a * 120 + c * 45 + e).toBeCloseTo(p.x, 6);
    expect(b * 120 + d * 45 + f).toBeCloseTo(p.y, 6);
    // Dragging right on the screen moves along the plane's y (rotation 3): sign depends on the flip.
    const delta = screenDeltaToPlane(view(3, false), S, 10, 0);
    expect(Math.abs(delta.x) + Math.abs(delta.y)).toBe(10);
    expect(delta.x).toBe(0);
  });

  it('the visible outline covers the stage', () => {
    const o = visibleOutline(view(0, false), S);
    expect(o[0]).toEqual({ x: -60, y: -40 });
    expect(o[2]).toEqual({ x: 1540, y: 960 });
  });
  describe('free turn', () => {
    const tilted = (rot: ViewState['rot'], flip: boolean, tilt: number): ViewState => ({ ...view(rot, flip), tilt });

    it('goes there and back for any angle, quarter turn and mirror', () => {
      for (const rot of [0, 1, 2, 3] as const) {
        for (const flip of [false, true]) {
          const v = tilted(rot, flip, 0.37);
          for (const [x, y] of [[0, 0], [100, 40], [333, 777]] as const) {
            const s = docToScreen(v, S, x, y);
            const d = screenToDoc(v, S, s.x, s.y);
            expect(d.x).toBeCloseTo(x, 6);
            expect(d.y).toBeCloseTo(y, 6);
          }
        }
      }
    });

    it('turns about the middle of the stage, clockwise', () => {
      const v: ViewState = { x: 0, y: 0, scale: 1, rot: 0, flip: false, tilt: Math.PI / 2 };
      const ps = planeSize(v, S);
      // The plane's own middle stays on the stage's middle.
      const mid = docToScreen(v, S, ps.w / 2, ps.h / 2);
      expect(mid.x).toBeCloseTo(S.w / 2, 6);
      expect(mid.y).toBeCloseTo(S.h / 2, 6);
      // A point to the right of the middle ends up below it.
      const right = docToScreen(v, S, ps.w / 2 + 10, ps.h / 2);
      expect(right.x).toBeCloseTo(S.w / 2, 6);
      expect(right.y).toBeCloseTo(S.h / 2 + 10, 6);
    });

    it('needs a plane as long as the stage diagonal, and counts as turned', () => {
      expect(planeSize(tilted(0, false, 0.2), S)).toEqual({ w: 944, h: 944 });
      expect(planeSize({ rot: 1, tilt: undefined }, S)).toEqual({ w: 500, h: 800 });
      expect(isTurned(tilted(0, false, 0.2))).toBe(true);
      expect(isTurned(view(0, false))).toBe(false);
    });

    it('a quarter of tilt turns the page axes like a quarter turn does', () => {
      const a = tilted(0, false, Math.PI / 2);
      const b = view(1, false);
      // Moving along the page's x goes down the screen in both.
      const da = docToScreen(a, S, 100, 0);
      const oa = docToScreen(a, S, 0, 0);
      const db = docToScreen(b, S, 100, 0);
      const ob = docToScreen(b, S, 0, 0);
      expect(da.x - oa.x).toBeCloseTo(db.x - ob.x, 6);
      expect(da.y - oa.y).toBeCloseTo(db.y - ob.y, 6);
    });
  });
});
