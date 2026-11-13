import { describe, expect, it } from 'vitest';
import { traceContours } from './outline-trace';

/** A `w`×`h` grid of samples with a ring of zeros around it, set to 255 where `on(x, y)`. */
function grid(w: number, h: number, on: (x: number, y: number) => boolean): { values: Uint8Array; gw: number; gh: number } {
  const gw = w + 2;
  const gh = h + 2;
  const values = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) values[(y + 1) * gw + x + 1] = 255;
  return { values, gw, gh };
}

describe('traceContours', () => {
  it('finds nothing in an empty grid', () => {
    const e = grid(6, 6, () => false);
    expect(traceContours(e.values, e.gw, e.gh)).toEqual([]);
  });

  it('closes one outline around one blob', () => {
    const g = grid(8, 8, (x, y) => x >= 2 && x < 6 && y >= 2 && y < 6);
    const loops = traceContours(g.values, g.gw, g.gh);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    expect(loop[0]).toEqual(loop[loop.length - 1]); // closed
    // Every point lies between an inside sample and an outside one: on the boundary of the 4x4 block.
    for (const [x, y] of loop) {
      expect(x).toBeGreaterThanOrEqual(2.5 - 1e-9);
      expect(x).toBeLessThanOrEqual(6.5 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(2.5 - 1e-9);
      expect(y).toBeLessThanOrEqual(6.5 + 1e-9);
    }
  });

  it('gives a ring two outlines (outer and hole) and two blobs two', () => {
    const ring = grid(12, 12, (x, y) => Math.max(Math.abs(x - 5.5), Math.abs(y - 5.5)) <= 4 && Math.max(Math.abs(x - 5.5), Math.abs(y - 5.5)) >= 2);
    expect(traceContours(ring.values, ring.gw, ring.gh)).toHaveLength(2);
    const two = grid(12, 6, (x, y) => y >= 2 && y < 4 && (x < 3 || x >= 8));
    expect(traceContours(two.values, two.gw, two.gh)).toHaveLength(2);
  });

  it('places the crossing where a soft edge passes the threshold', () => {
    // Three samples across: 0, 64, 192, 255 ... the 128 level lies between 64 and 192, halfway.
    const w = 6;
    const h = 5;
    const v = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      v[y * w + 2] = 64;
      v[y * w + 3] = 192;
    }
    const loops = traceContours(v, w, h);
    expect(loops).toHaveLength(1);
    const xs = loops[0]!.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(2.5, 5);
  });

  it('keeps two diagonal blobs apart in a saddle', () => {
    // Two diagonal corners of every 2x2 cell are set: they must not merge into one outline.
    const g = grid(2, 2, (x, y) => x === y);
    const loops = traceContours(g.values, g.gw, g.gh);
    expect(loops.length).toBeGreaterThanOrEqual(2);
  });
});
