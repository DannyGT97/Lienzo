import { innerRadius, type BrushSettings, type PenStroke, type StrokePatch } from './brush';
import type { PaintTarget } from './document';
import type { SelectionClip } from './selection';
import { TILE, type Rect } from './tiles';
import { TileRecorder } from './transform';

/**
 * Copy stamp. Paints with the picture found `offset` away from the pen: the source point is fixed with a click and every
 * stroke after that copies from the same distance (the "aligned" way of working; own design, nothing about Clip Studio's
 * behaviour is known beyond the sub tool's name).
 *
 * Source and destination are both read from the layer as it was when the stroke began, and each pixel keeps the strongest
 * coverage the stroke gave it. So a stroke can overlap itself or copy from a nearby spot of the same layer without feeding
 * on its own output, and soft overlapping stamps do not pile up towards full opacity.
 * `settings.opacity` is the strength; size, hardness and the pressure options work as for the pen.
 */
export class CloneStroke implements PenStroke {
  private readonly rec: TileRecorder;
  private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private rest = 0;
  private readonly cover = new Map<number, number>();
  private readonly dx: number;
  private readonly dy: number;

  constructor(
    private readonly target: PaintTarget,
    readonly settings: BrushSettings,
    offset: { x: number; y: number },
    private readonly clip?: SelectionClip,
  ) {
    this.rec = new TileRecorder(target.surface, target.id);
    this.dx = Math.round(offset.x);
    this.dy = Math.round(offset.y);
  }

  private radius(pressure: number): number {
    const f = 1 - this.settings.pressureSize * (1 - pressure);
    return Math.max(1, (this.settings.size * f) / 2);
  }

  addPoint(x: number, y: number, pressure = 1): Rect | null {
    const r = this.radius(pressure);
    const step = Math.max(1, r * 0.25);
    const from = this.last;
    if (!from) {
      this.last = { x, y };
      return this.stamp(x, y, r);
    }
    const dist = Math.hypot(x - from.x, y - from.y);
    let dirty: Rect | null = null;
    let pos = step - this.rest;
    while (pos <= dist) {
      const t = dist > 0 ? pos / dist : 0;
      dirty = union(dirty, this.stamp(from.x + (x - from.x) * t, from.y + (y - from.y) * t, r));
      pos += step;
    }
    this.rest = dist - (pos - step);
    this.last = { x, y };
    return dirty;
  }

  skipPoint(): void {}

  cancel(): Rect | null {
    this.rec.restore();
    const b = this.bounds;
    this.bounds = null;
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null;
  }

  finish(): StrokePatch | null {
    const b = this.bounds;
    if (!b) return null;
    return this.rec.patch({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
  }

  /** The layer's pixel at (x, y) as it was before the stroke: straight RGBA, transparent outside the page. */
  private original(x: number, y: number, out: number[]): void {
    const s = this.target.surface;
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return;
    }
    const tile = this.rec.original(Math.floor(x / TILE), Math.floor(y / TILE));
    if (!tile) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return;
    }
    const o = ((y % TILE) * TILE + (x % TILE)) * 4;
    out[0] = tile[o]!;
    out[1] = tile[o + 1]!;
    out[2] = tile[o + 2]!;
    out[3] = tile[o + 3]!;
  }

  private stamp(cx: number, cy: number, r: number): Rect | null {
    const surface = this.target.surface;
    const x0 = Math.max(0, Math.floor(cx - r) - 1);
    const y0 = Math.max(0, Math.floor(cy - r) - 1);
    const x1 = Math.min(surface.width, Math.ceil(cx + r) + 1);
    const y1 = Math.min(surface.height, Math.ceil(cy + r) + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.rec.watch(region);
    const data = surface.readRect(region);
    const strength = this.settings.opacity;
    const lock = this.target.lockAlpha;
    const src = [0, 0, 0, 0];
    const dst = [0, 0, 0, 0];
    let touched = false;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= r) continue;
        const ri = innerRadius(r, this.settings.hardness, this.settings.antialias);
        let cov = (d <= ri ? 1 : smooth((r - d) / (r - ri))) * strength;
        if (this.clip) {
          const sc = this.clip.tile(Math.floor(x / TILE), Math.floor(y / TILE));
          if (sc === 0) continue;
          if (sc !== 255) cov *= sc[(y % TILE) * TILE + (x % TILE)]! / 255;
        }
        const key = y * surface.width + x;
        const prev = this.cover.get(key) ?? 0;
        if (cov <= prev) continue;
        this.cover.set(key, cov);
        this.original(x + this.dx, y + this.dy, src);
        this.original(x, y, dst);
        const sa = (src[3]! / 255) * cov; // how much of the source goes over the destination
        const da = dst[3]! / 255;
        const oa = lock ? da : sa + da * (1 - sa);
        const i = ((y - y0) * region.w + (x - x0)) * 4;
        if (oa <= 0) {
          data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        } else if (lock) {
          // Locked transparency: only the colour of pixels that already exist changes.
          for (let c = 0; c < 3; c++) data[i + c] = dst[c]! + (src[c]! - dst[c]!) * sa;
          data[i + 3] = dst[3]!;
        } else {
          for (let c = 0; c < 3; c++) data[i + c] = (src[c]! * sa + dst[c]! * da * (1 - sa)) / oa;
          data[i + 3] = oa * 255;
        }
        touched = true;
      }
    }
    if (!touched) return null;
    surface.writeRect(region, data);
    const bb = this.bounds;
    this.bounds = bb ? { x0: Math.min(bb.x0, x0), y0: Math.min(bb.y0, y0), x1: Math.max(bb.x1, x1), y1: Math.max(bb.y1, y1) } : { x0, y0, x1, y1 };
    return region;
  }
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
