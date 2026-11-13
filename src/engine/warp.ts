import { Selection } from './selection';
import type { Rect } from './tiles';
import type { Pt } from './geometry';
import { shadeInto, touchArea, type Lifted } from './transform';
import type { TiledSurface } from './tiles';

/** Corners in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** A 3×3 projective map, row by row. */
type Mat3 = [number, number, number, number, number, number, number, number, number];

export const rectQuad = (r: Rect): Quad => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

/** The projective map that sends the four points of `from` to the four of `to` (null if the corners are degenerate). */
export function homography(from: Quad, to: Quad): Mat3 | null {
  // Solve for h0..h7 with h8 = 1:  x' = (h0x + h1y + h2) / (h6x + h7y + 1),  y' = (h3x + h4y + h5) / (h6x + h7y + 1).
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let best = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[best]![col]!)) best = r;
    if (Math.abs(a[best]![col]!) < 1e-9) return null;
    [a[col], a[best]] = [a[best]!, a[col]!];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const k = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < 9; c++) a[r]![c]! -= k * a[col]![c]!;
    }
  }
  const h = a.map((row, i) => row[8]! / row[i]!);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function applyH(h: Mat3, x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

function inverseH(h: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = -(d * j - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * j - c * i) * k, (b * f - c * e) * k, B * k, (a * j - c * g) * k, -(a * f - c * d) * k, C * k, -(a * i - b * g) * k, (a * e - b * d) * k];
}

/** One piece of a warp: a rectangle of the source drawn into a four sided shape. */
export interface WarpCell {
  src: Rect;
  quad: Quad;
  /** Source -> page. */
  fwd: Mat3;
  /** Page -> source. */
  inv: Mat3;
}

/** Even-odd test for a point inside a four sided shape (half open, so a point on a shared edge belongs to one side only). */
function inQuad(q: Quad, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[j]!;
    const b = q[i]!;
    if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/**
 * A warp of a rectangle: either one four sided shape (distort, skew, perspective) or a grid of them (mesh).
 * Every destination pixel belongs to at most one cell, so shared edges are not drawn twice.
 */
export class Warp {
  private constructor(
    readonly source: Rect,
    readonly cells: WarpCell[],
  ) {}

  /** The whole rectangle sent to `quad`. */
  static quad(source: Rect, quad: Quad): Warp | null {
    const cell = makeCell(source, quad);
    return cell ? new Warp(source, [cell]) : null;
  }

  /** A grid of (cols + 1) × (rows + 1) control points, row by row; each square of the grid follows its four points. */
  static mesh(source: Rect, cols: number, rows: number, points: Pt[]): Warp | null {
    const cells: WarpCell[] = [];
    const at = (cx: number, cy: number): Pt => points[cy * (cols + 1) + cx]!;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const src = {
          x: source.x + (source.w * cx) / cols,
          y: source.y + (source.h * cy) / rows,
          w: source.w / cols,
          h: source.h / rows,
        };
        const cell = makeCell(src, [at(cx, cy), at(cx + 1, cy), at(cx + 1, cy + 1), at(cx, cy + 1)]);
        if (!cell) return null;
        cells.push(cell);
      }
    }
    return new Warp(source, cells);
  }

  /** The same warp with the source and the shape both moved by (dx, dy). */
  static shifted(w: Warp, dx: number, dy: number): Warp | null {
    const cells: WarpCell[] = [];
    for (const c of w.cells) {
      const cell = makeCell({ x: c.src.x + dx, y: c.src.y + dy, w: c.src.w, h: c.src.h }, c.quad.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad);
      if (!cell) return null;
      cells.push(cell);
    }
    return new Warp({ x: w.source.x + dx, y: w.source.y + dy, w: w.source.w, h: w.source.h }, cells);
  }

  /** The box that holds everything the warp draws. */
  bounds(): Rect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of this.cells) {
      for (const p of c.quad) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * Visit every destination pixel inside the page once, with the position in the source (page coordinates) that
   * lands on its centre. Returns the area visited (null when nothing falls inside the page).
   */
  forEach(width: number, height: number, visit: (x: number, y: number, sx: number, sy: number) => void): Rect | null {
    const b = this.bounds();
    const x0 = Math.max(0, Math.floor(b.x));
    const y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(width, Math.ceil(b.x + b.w));
    const y1 = Math.min(height, Math.ceil(b.y + b.h));
    if (x1 <= x0 || y1 <= y0) return null;
    const single = this.cells.length === 1;
    const done = single ? null : new Uint8Array((x1 - x0) * (y1 - y0));
    for (const c of this.cells) {
      const cx0 = Math.max(x0, Math.floor(Math.min(...c.quad.map((p) => p.x))));
      const cy0 = Math.max(y0, Math.floor(Math.min(...c.quad.map((p) => p.y))));
      const cx1 = Math.min(x1, Math.ceil(Math.max(...c.quad.map((p) => p.x))));
      const cy1 = Math.min(y1, Math.ceil(Math.max(...c.quad.map((p) => p.y))));
      for (let y = cy0; y < cy1; y++) {
        for (let x = cx0; x < cx1; x++) {
          if (!inQuad(c.quad, x + 0.5, y + 0.5)) continue;
          if (done) {
            const k = (y - y0) * (x1 - x0) + (x - x0);
            if (done[k]) continue;
            done[k] = 1;
          }
          const p = applyH(c.inv, x + 0.5, y + 0.5);
          visit(x, y, p.x, p.y);
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

function makeCell(src: Rect, quad: Quad): WarpCell | null {
  const fwd = homography(rectQuad(src), quad);
  const inv = fwd ? inverseH(fwd) : null;
  return fwd && inv ? { src, quad, fwd, inv } : null;
}

/** Control points of an undeformed grid over `r`, row by row. */
export function meshPoints(r: Rect, cols: number, rows: number): Pt[] {
  const out: Pt[] = [];
  for (let cy = 0; cy <= rows; cy++) for (let cx = 0; cx <= cols; cx++) out.push({ x: r.x + (r.w * cx) / cols, y: r.y + (r.h * cy) / rows });
  return out;
}

/** Draw lifted pixels through a warp, with the same filtering and blending as an ordinary transform. Returns the area written. */
export function dropWarp(surface: TiledSurface, src: Lifted, warp: Warp): Rect | null {
  const area = warp.forEach(surface.width, surface.height, (x, y, sx, sy) => shadeInto(surface, src, x, y, sx, sy));
  if (area) touchArea(surface, area);
  return area;
}

/** The selection after the same warp: its coverage is resampled through the warp. */
export function warpSelection(sel: Selection, from: Rect, warp: Warp): Selection {
  const out = new Selection(sel.width, sel.height);
  warp.forEach(sel.width, sel.height, (x, y, sx, sy) => {
    const px = Math.floor(sx);
    const py = Math.floor(sy);
    if (px < from.x || py < from.y || px >= from.x + from.w || py >= from.y + from.h) return;
    const v = sel.at(px, py);
    if (v) out.set(x, y, v);
  });
  return out;
}
