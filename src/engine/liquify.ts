import { innerRadius, type BrushSettings, type PenStroke, type StrokePatch } from './brush';
import type { PaintTarget } from './document';
import type { SelectionClip } from './selection';
import { TILE, assertWorkingBlocks, type Rect, type Tile } from './tiles';
import { TileRecorder } from './transform';

/**
 * Liquify: push the pixels under the brush around.
 *
 * Own design: nothing here claims to match any other program's liquify.
 *
 * - push:    the content under the brush moves along with the pen.
 * - bloat:   the content swells away from the centre of the brush.
 * - pinch:   the content is drawn in towards the centre.
 * - twirl / untwirl: the content turns clockwise / anticlockwise about the centre.
 * - restore: the displacement is relaxed back towards the original picture.
 *
 * The stroke keeps a displacement field (`D`: for each output pixel, where in the untouched picture its colour comes
 * from) instead of resampling the already-moved picture, so a long stroke does not blur what it passes over. Every
 * stamp updates the field inside the brush and repaints only those pixels from the untouched picture.
 */
export type LiquifyMode = 'push' | 'bloat' | 'pinch' | 'twirl' | 'untwirl' | 'restore';

/** How far one stamp moves things, per unit of strength (design constants, tuned by hand, not taken from CSP). */
const RATE = { bloat: 0.12, pinch: 0.12, twirl: 0.12 };
/** Fields are kept in square chunks so a small stroke on a huge page costs little. */
const CHUNK = 32;
/** A displacement this small counts as none (the pixel then gets its original colour back exactly). */
const EPS = 0.002;

export class LiquifyStroke implements PenStroke {
  private readonly rec: TileRecorder;
  private readonly field = new Map<number, Float32Array>(); // chunk -> CHUNK*CHUNK*2 (dx, dy)
  private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private rest = 0;

  constructor(
    private readonly target: PaintTarget,
    readonly settings: BrushSettings,
    private readonly mode: LiquifyMode,
    private readonly clip?: SelectionClip,
  ) {
    assertWorkingBlocks(target.surface);
    this.rec = new TileRecorder(target.surface, target.id);
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
      // A click alone moves nothing in push mode; the other modes act on the spot.
      return this.mode === 'push' ? null : this.stamp(x, y, r, 0, 0);
    }
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist === 0) return null;
    const ux = (x - from.x) / dist;
    const uy = (y - from.y) / dist;
    let dirty: Rect | null = null;
    let pos = step - this.rest;
    while (pos <= dist) {
      const t = pos / dist;
      dirty = union(dirty, this.stamp(from.x + (x - from.x) * t, from.y + (y - from.y) * t, r, ux * step, uy * step));
      pos += step;
    }
    this.rest = dist - (pos - step);
    this.last = { x, y };
    return dirty;
  }

  skipPoint(): void {
    // Nothing to remember: the next stamp measures its movement from the last one it made.
  }

  cancel(): Rect | null {
    this.rec.restore();
    const b = this.bounds;
    this.bounds = null;
    this.field.clear();
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null;
  }

  finish(): StrokePatch | null {
    const b = this.bounds;
    if (!b) return null;
    return this.rec.patch({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
  }

  /** The displacement stored for a pixel (0, 0 where the stroke has not been). */
  displacement(x: number, y: number): [number, number] {
    const c = this.field.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
    if (!c) return [0, 0];
    const i = ((y % CHUNK) * CHUNK + (x % CHUNK)) * 2;
    return [c[i]!, c[i + 1]!];
  }

  /** The field at a point between pixel centres (bilinear), for the content that moves onto a pixel. */
  private sampleField(px: number, py: number): [number, number] {
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let dx = 0;
    let dy = 0;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
        if (w === 0) continue;
        const [ax, ay] = this.displacement(x0 + i, y0 + j);
        dx += ax * w;
        dy += ay * w;
      }
    }
    return [dx, dy];
  }

  private setField(x: number, y: number, dx: number, dy: number): void {
    const key = chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    let c = this.field.get(key);
    if (!c) {
      if (dx === 0 && dy === 0) return;
      c = new Float32Array(CHUNK * CHUNK * 2);
      this.field.set(key, c);
    }
    const i = ((y % CHUNK) * CHUNK + (x % CHUNK)) * 2;
    c[i] = dx;
    c[i + 1] = dy;
  }

  /** The untouched picture at (x, y): premultiplied RGBA 0..1 written into `out`; transparent outside the page. */
  private original(x: number, y: number, out: Float32Array, o: number): void {
    const s = this.target.surface;
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      return;
    }
    const t: Tile | undefined = this.rec.original(Math.floor(x / TILE), Math.floor(y / TILE));
    if (!t) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      return;
    }
    const i = ((y % TILE) * TILE + (x % TILE)) * 4;
    const a = t[i + 3]! / 255;
    out[o] = (t[i]! / 255) * a;
    out[o + 1] = (t[i + 1]! / 255) * a;
    out[o + 2] = (t[i + 2]! / 255) * a;
    out[o + 3] = a;
  }

  /** The untouched picture at a point between pixel centres, bilinear on premultiplied colour. */
  private sampleOriginal(px: number, py: number, out: Float32Array): void {
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    out[0] = out[1] = out[2] = out[3] = 0;
    const tmp = this.tmp;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
        if (w === 0) continue;
        this.original(x0 + i, y0 + j, tmp, 0);
        out[0] = out[0]! + tmp[0]! * w;
        out[1] = out[1]! + tmp[1]! * w;
        out[2] = out[2]! + tmp[2]! * w;
        out[3] = out[3]! + tmp[3]! * w;
      }
    }
  }

  private readonly tmp = new Float32Array(4);

  /** One stamp of the brush at (cx, cy); (mx, my) is how far the pen moved since the previous stamp. */
  private stamp(cx: number, cy: number, r: number, mx: number, my: number): Rect | null {
    const surface = this.target.surface;
    const x0 = Math.max(0, Math.floor(cx - r) - 1);
    const y0 = Math.max(0, Math.floor(cy - r) - 1);
    const x1 = Math.min(surface.width, Math.ceil(cx + r) + 1);
    const y1 = Math.min(surface.height, Math.ceil(cy + r) + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const w = x1 - x0;
    const h = y1 - y0;
    const region = { x: x0, y: y0, w, h };
    const strength = this.settings.opacity;
    const ri = innerRadius(r, this.settings.hardness, this.settings.antialias);

    // Phase 1: the new field for the pixels the brush reaches, computed from the old one.
    const next = new Float32Array(w * h * 2);
    const hit = new Uint8Array(w * h);
    let any = false;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d >= r) continue;
        let f = (d <= ri ? 1 : smooth((r - d) / (r - ri))) * strength;
        if (this.clip) {
          const sc = this.clip.tile(Math.floor(x / TILE), Math.floor(y / TILE));
          if (sc === 0) continue;
          if (sc !== 255) f *= sc[(y % TILE) * TILE + (x % TILE)]! / 255;
        }
        if (f <= 0) continue;
        const i = (y - y0) * w + (x - x0);
        if (this.mode === 'restore') {
          const [ox, oy] = this.displacement(x, y);
          next[i * 2] = ox * (1 - f);
          next[i * 2 + 1] = oy * (1 - f);
        } else {
          // v: how far the content that is at this pixel moves during this stamp.
          let vx = 0;
          let vy = 0;
          if (this.mode === 'push') {
            vx = mx * f;
            vy = my * f;
          } else if (this.mode === 'bloat') {
            vx = dx * RATE.bloat * f;
            vy = dy * RATE.bloat * f;
          } else if (this.mode === 'pinch') {
            vx = -dx * RATE.pinch * f;
            vy = -dy * RATE.pinch * f;
          } else {
            const th = (this.mode === 'twirl' ? 1 : -1) * RATE.twirl * f;
            const c = Math.cos(th);
            const s = Math.sin(th);
            vx = dx * c - dy * s - dx;
            vy = dx * s + dy * c - dy;
          }
          if (vx === 0 && vy === 0) continue;
          const [ox, oy] = this.sampleField(x + 0.5 - vx, y + 0.5 - vy);
          next[i * 2] = ox - vx;
          next[i * 2 + 1] = oy - vy;
        }
        hit[i] = 1;
        any = true;
      }
    }
    if (!any) return null;

    // Phase 2: store the field and repaint those pixels from the untouched picture.
    this.rec.watch(region);
    const cur = surface.readRect(region);
    const data = new Uint8ClampedArray(cur);
    const lock = this.target.lockAlpha;
    const px = new Float32Array(4);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y - y0) * w + (x - x0);
        if (!hit[i]) continue;
        const dx = next[i * 2]!;
        const dy = next[i * 2 + 1]!;
        this.setField(x, y, Math.abs(dx) < EPS ? 0 : dx, Math.abs(dy) < EPS ? 0 : dy);
        if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) this.original(x, y, px, 0);
        else this.sampleOriginal(x + 0.5 + dx, y + 0.5 + dy, px);
        const a = px[3]!;
        const o = i * 4;
        if (a > 0) {
          for (let c = 0; c < 3; c++) data[o + c] = Math.min(255, (px[c]! / a) * 255);
        } else if (!lock) {
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
        if (!lock) data[o + 3] = a * 255; // with the transparency locked only the colour moves
      }
    }
    surface.writeRect(region, data);
    const bb = this.bounds;
    this.bounds = bb ? { x0: Math.min(bb.x0, x0), y0: Math.min(bb.y0, y0), x1: Math.max(bb.x1, x1), y1: Math.max(bb.y1, y1) } : { x0, y0, x1, y1 };
    return region;
  }
}

const chunkKey = (cx: number, cy: number): number => (cy + 0x8000) * 0x10000 + (cx + 0x8000);
const smooth = (t: number): number => t * t * (3 - 2 * t);

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
