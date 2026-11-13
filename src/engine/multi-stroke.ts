import type { PenStroke, Rect, StrokePatch, TilePatch } from './brush';
import type { Pt } from './geometry';
import { TILE_BYTES } from './tiles';

/**
 * Several pens that move together over one layer: the pen itself and its mirror images (symmetry rulers).
 * `maps[i]` turns the point the pen is at into the point the i-th stroke paints at. The strokes' patches are
 * merged into one, so the whole thing is a single undo step.
 */
export class MultiStroke implements PenStroke {
  constructor(
    private readonly strokes: PenStroke[],
    private readonly maps: ((p: Pt) => Pt)[],
  ) {}

  addPoint(x: number, y: number, pressure = 1): Rect | null {
    let dirty: Rect | null = null;
    this.strokes.forEach((s, i) => {
      const q = this.maps[i]!({ x, y });
      dirty = union(dirty, s.addPoint(q.x, q.y, pressure));
    });
    return dirty;
  }

  skipPoint(x: number, y: number, pressure = 1): void {
    this.strokes.forEach((s, i) => {
      const q = this.maps[i]!({ x, y });
      s.skipPoint(q.x, q.y, pressure);
    });
  }

  cancel(): Rect | null {
    let dirty: Rect | null = null;
    for (const s of [...this.strokes].reverse()) dirty = union(dirty, s.cancel());
    return dirty;
  }

  finish(): StrokePatch | null {
    const patches = this.strokes.map((s) => s.finish());
    const first = patches.find((p) => p);
    if (!first) return null;
    const tiles = new Map<string, TilePatch>();
    let rect: Rect = first.rect;
    for (const p of patches) {
      if (!p) continue;
      rect = union(rect, p.rect)!;
      for (const t of p.tiles) {
        const key = `${t.tx},${t.ty}`;
        const known = tiles.get(key);
        // The earliest "before" is what the layer held before any of the strokes; the last "after" is how it ends up.
        tiles.set(key, known ? { ...known, after: t.after } : t);
      }
    }
    let bytes = 0;
    for (const t of tiles.values()) bytes += (t.before ? TILE_BYTES : 0) + (t.after ? TILE_BYTES : 0);
    return { layerId: first.layerId, ...(first.onMask ? { onMask: true } : {}), rect, tiles: [...tiles.values()], bytes };
  }
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
