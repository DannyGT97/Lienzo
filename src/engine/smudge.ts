import { innerRadius, type BrushSettings, type PenStroke, type StrokePatch } from './brush';
import type { PaintTarget } from './document';
import type { SelectionClip } from './selection';
import { TILE, type Rect } from './tiles';
import { TileRecorder } from './transform';

export type SmudgeMode = 'blur' | 'finger';

/**
 * The blending tools. "Finger" drags the colours that are under the brush along with it; "blur" softens what is
 * under it a little more with every pass. Both work on the layer's own pixels, stamp by stamp along the path.
 * `settings.opacity` is the strength; size, hardness and the pressure options work as for the pen.
 */
export class SmudgeStroke implements PenStroke {
  private readonly rec: TileRecorder;
  private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private lastInput: { x: number; y: number; p: number } | null = null;
  /** What the finger carries: premultiplied RGBA of the square around the brush at the last stamp (finger mode). */
  private carry: Float32Array | null = null;
  private carrySize = 0;
  private rest = 0; // path length since the last stamp

  constructor(
    private readonly target: PaintTarget,
    readonly settings: BrushSettings,
    private readonly mode: SmudgeMode,
    private readonly clip?: SelectionClip,
  ) {
    this.rec = new TileRecorder(target.surface, target.id);
  }

  private radius(pressure: number): number {
    const f = 1 - this.settings.pressureSize * (1 - pressure);
    return Math.max(1, (this.settings.size * f) / 2);
  }

  addPoint(x: number, y: number, pressure = 1): Rect | null {
    this.lastInput = { x, y, p: pressure };
    const r = this.radius(pressure);
    const step = Math.max(1, r * 0.25);
    const from = this.last;
    if (!from) {
      this.last = { x, y };
      return this.stamp(x, y, r);
    }
    const dist = Math.hypot(x - from.x, y - from.y);
    let dirty: Rect | null = null;
    let pos = step - this.rest; // where along this segment the next stamp goes
    while (pos <= dist) {
      const t = dist > 0 ? pos / dist : 0;
      dirty = union(dirty, this.stamp(from.x + (x - from.x) * t, from.y + (y - from.y) * t, r));
      pos += step;
    }
    this.rest = dist - (pos - step);
    this.last = { x, y };
    return dirty;
  }

  skipPoint(x: number, y: number, pressure = 1): void {
    this.lastInput = { x, y, p: pressure };
  }

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

  /** One stamp of the brush centred at (cx, cy). */
  private stamp(cx: number, cy: number, r: number): Rect | null {
    const surface = this.target.surface;
    const x0 = Math.max(0, Math.floor(cx - r) - 1);
    const y0 = Math.max(0, Math.floor(cy - r) - 1);
    const x1 = Math.min(surface.width, Math.ceil(cx + r) + 1);
    const y1 = Math.min(surface.height, Math.ceil(cy + r) + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const w = x1 - x0;
    const h = y1 - y0;
    const region = { x: x0, y: y0, w, h };
    this.rec.watch(region);
    const src = surface.readRect(region);
    const cur = new Float32Array(w * h * 4); // premultiplied 0..1
    for (let i = 0; i < w * h; i++) {
      const a = src[i * 4 + 3]! / 255;
      cur[i * 4] = (src[i * 4]! / 255) * a;
      cur[i * 4 + 1] = (src[i * 4 + 1]! / 255) * a;
      cur[i * 4 + 2] = (src[i * 4 + 2]! / 255) * a;
      cur[i * 4 + 3] = a;
    }
    const strength = this.settings.opacity;
    const out = cur.slice();
    // The square around the stamp that the carried colours are kept for (a fixed size, so shifts line up).
    const size = Math.ceil(r) * 2 + 3;
    const half = size / 2;
    let blurred: Float32Array | null = null;
    if (this.mode === 'blur') {
      blurred = new Float32Array(cur.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum0 = 0;
          let sum1 = 0;
          let sum2 = 0;
          let sum3 = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const sx = x + dx;
              const sy = y + dy;
              if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
              const j = (sy * w + sx) * 4;
              sum0 += cur[j]!;
              sum1 += cur[j + 1]!;
              sum2 += cur[j + 2]!;
              sum3 += cur[j + 3]!;
              n++;
            }
          }
          const o = (y * w + x) * 4;
          blurred[o] = sum0 / n;
          blurred[o + 1] = sum1 / n;
          blurred[o + 2] = sum2 / n;
          blurred[o + 3] = sum3 / n;
        }
      }
    }
    const carry = this.carry;
    const newCarry = this.mode === 'finger' ? new Float32Array(size * size * 4) : null;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        const i = ((y - y0) * w + (x - x0)) * 4;
        const ci = (Math.floor(dy + half) * size + Math.floor(dx + half)) * 4;
        const inCarry = Math.abs(dx) < half - 0.5 && Math.abs(dy) < half - 0.5;
        if (newCarry && inCarry) for (let c = 0; c < 4; c++) newCarry[ci + c] = cur[i + c]!;
        if (d >= r) continue;
        const ri = innerRadius(r, this.settings.hardness, this.settings.antialias);
        let cov = (d <= ri ? 1 : smooth((r - d) / (r - ri))) * strength;
        if (this.clip) {
          const sc = this.clip.tile(Math.floor(x / TILE), Math.floor(y / TILE));
          if (sc === 0) continue;
          if (sc !== 255) cov *= sc[(y % TILE) * TILE + (x % TILE)]! / 255;
        }
        if (cov <= 0) continue;
        if (blurred) {
          for (let c = 0; c < 4; c++) out[i + c] = cur[i + c]! + (blurred[i + c]! - cur[i + c]!) * cov;
        } else if (carry && inCarry) {
          for (let c = 0; c < 4; c++) out[i + c] = cur[i + c]! + (carry[ci + c]! - cur[i + c]!) * cov;
        }
      }
    }
    if (newCarry) {
      // Keep carrying what was picked up before, but let the surface under the brush rub off onto it.
      if (carry) for (let i = 0; i < newCarry.length; i++) newCarry[i] = carry[i]! * strength + newCarry[i]! * (1 - strength);
      this.carry = newCarry;
      this.carrySize = size;
    }
    const lock = this.target.lockAlpha;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = lock ? cur[i * 4 + 3]! : out[i * 4 + 3]!;
      if (a <= 0.0005) continue;
      const oa = out[i * 4 + 3]!;
      for (let c = 0; c < 3; c++) data[i * 4 + c] = oa > 0 ? Math.min(255, (out[i * 4 + c]! / oa) * 255) : 0;
      data[i * 4 + 3] = a * 255;
    }
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
