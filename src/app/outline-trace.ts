/**
 * Turns a grid of mask samples into closed contour lines (marching squares), so the outline of a selection can be
 * drawn as a thin dashed line like the preview of the shape being dragged, not as a staircase of coloured cells.
 * Pure: it knows nothing about the canvas or the page.
 */

export type GridPt = readonly [number, number];

/**
 * Closed outlines of the area where `values >= threshold`. `values` is `w * h` samples, row by row; the outer ring of
 * samples must be below the threshold (the caller pads), so every outline closes. Points are in grid units, with the
 * crossing between two samples placed where the value passes the threshold.
 */
export function traceContours(values: ArrayLike<number>, w: number, h: number, threshold = 128): GridPt[][] {
  const edgeCount = w * h;
  /** Horizontal edge (sample i,j to i+1,j) and vertical edge (sample i,j to i,j+1) get distinct numbers. */
  const hEdge = (i: number, j: number): number => j * w + i;
  const vEdge = (i: number, j: number): number => edgeCount + j * w + i;
  const where = new Map<number, GridPt>();
  const along = (p: number, q: number): number => {
    const span = q - p;
    return span === 0 ? 0.5 : Math.min(1, Math.max(0, (threshold - p) / span));
  };
  const segA: number[] = [];
  const segB: number[] = [];
  const touching = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const s = segA.length;
    segA.push(a);
    segB.push(b);
    for (const e of [a, b]) {
      const list = touching.get(e);
      if (list) list.push(s);
      else touching.set(e, [s]);
    }
  };

  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = values[j * w + i]!; // top left
      const b = values[j * w + i + 1]!; // top right
      const c = values[(j + 1) * w + i + 1]!; // bottom right
      const d = values[(j + 1) * w + i]!; // bottom left
      const code = (a >= threshold ? 8 : 0) | (b >= threshold ? 4 : 0) | (c >= threshold ? 2 : 0) | (d >= threshold ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = hEdge(i, j);
      const bottom = hEdge(i, j + 1);
      const left = vEdge(i, j);
      const right = vEdge(i + 1, j);
      if (!where.has(top) && (a >= threshold) !== (b >= threshold)) where.set(top, [i + along(a, b), j]);
      if (!where.has(bottom) && (d >= threshold) !== (c >= threshold)) where.set(bottom, [i + along(d, c), j + 1]);
      if (!where.has(left) && (a >= threshold) !== (d >= threshold)) where.set(left, [i, j + along(a, d)]);
      if (!where.has(right) && (b >= threshold) !== (c >= threshold)) where.set(right, [i + 1, j + along(b, c)]);
      switch (code) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(top, left);
          break;
        default: {
          // The two diagonal cases: the centre decides whether the inside corners are joined.
          const joined = (a + b + c + d) / 4 >= threshold;
          if (joined === (code === 5)) {
            link(top, left);
            link(bottom, right);
          } else {
            link(top, right);
            link(left, bottom);
          }
        }
      }
    }
  }

  const used = new Uint8Array(segA.length);
  const loops: GridPt[][] = [];
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segA[s]!;
    const pts: GridPt[] = [where.get(start)!];
    let at = segB[s]!;
    for (;;) {
      pts.push(where.get(at)!);
      if (at === start) break;
      const next = touching.get(at)?.find((x) => !used[x]);
      if (next === undefined) break;
      used[next] = 1;
      at = segA[next] === at ? segB[next]! : segA[next]!;
    }
    loops.push(pts);
  }
  return loops;
}
