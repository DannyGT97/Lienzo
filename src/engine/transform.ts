import type { StrokePatch } from './brush';
import { Selection } from './selection';
import { TILE, TILE_BYTES, type Rect, type Tile, type TiledSurface } from './tiles';

/** Affine map: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** The map that applies `second` after `first`. */
export function compose(first: Affine, second: Affine): Affine {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

export function invert(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export const apply = (m: Affine, x: number, y: number): { x: number; y: number } => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
export const scaling = (sx: number, sy: number): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export const rotation = (rad: number): Affine => ({ a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: 0, f: 0 });

/** Rotate / scale / flip about a point: `m` is applied in a frame whose origin is (cx, cy). */
export const about = (m: Affine, cx: number, cy: number): Affine => compose(compose(translation(-cx, -cy), m), translation(cx, cy));

/** Box that holds the image of a rectangle under `m`. */
export function mapRect(r: Rect, m: Affine): Rect {
  const pts = [apply(m, r.x, r.y), apply(m, r.x + r.w, r.y), apply(m, r.x, r.y + r.h), apply(m, r.x + r.w, r.y + r.h)];
  const x0 = Math.min(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Pixels lifted out of a layer: straight RGBA of `rect`, with the selection coverage folded into alpha. */
export interface Lifted {
  rect: Rect;
  pixels: Uint8ClampedArray;
}

const clampRect = (r: Rect, w: number, h: number): Rect | null => {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** Tiles of a surface before an edit, so the edit can be turned into an undoable patch afterwards. */
export class TileRecorder {
  private readonly before = new Map<number, Tile | null>();

  constructor(
    private readonly surface: TiledSurface,
    private readonly layerId: number,
  ) {}

  /** Remember the current state of every tile the rectangle touches (call before changing them). */
  watch(r: Rect): void {
    for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++) {
      for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) {
        const k = this.surface.key(tx, ty);
        if (!this.before.has(k)) {
          const t = this.surface.get(tx, ty);
          this.before.set(k, t ? t.slice() : null);
        }
      }
    }
  }

  /**
   * A tile as it was before the first edit: the recorded copy when it was watched, otherwise what the surface
   * still holds (nothing has touched it yet). Lets a tool that edits in steps keep sampling the untouched image.
   */
  original(tx: number, ty: number): Tile | undefined {
    const k = this.surface.key(tx, ty);
    if (this.before.has(k)) return this.before.get(k) ?? undefined;
    return this.surface.get(tx, ty);
  }

  /** Put every watched tile back as it was. */
  restore(): void {
    for (const [k, t] of this.before) this.surface.put(this.surface.tx(k), this.surface.ty(k), t ? t.slice() : undefined);
  }

  patch(rect: Rect): StrokePatch | null {
    const tiles: StrokePatch['tiles'] = [];
    let bytes = 0;
    for (const [k, before] of this.before) {
      const tx = this.surface.tx(k);
      const ty = this.surface.ty(k);
      this.surface.dropIfEmpty(tx, ty);
      const now = this.surface.get(tx, ty);
      if (!before && !now) continue;
      tiles.push({ tx, ty, before, after: now ? now.slice() : null });
      bytes += (before ? TILE_BYTES : 0) + (now ? TILE_BYTES : 0);
    }
    return tiles.length ? { layerId: this.layerId, rect, tiles, bytes } : null;
  }
}

/**
 * Cut the selected pixels (or `rect` when nothing is selected) out of the layer and return them.
 * The recorder must already watch the area.
 */
export function lift(surface: TiledSurface, rect: Rect, sel: Selection | null): Lifted | null {
  const r = clampRect(rect, surface.width, surface.height);
  if (!r) return null;
  const pixels = surface.readRect(r);
  let any = false;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      const cov = sel ? sel.at(r.x + x, r.y + y) : 255;
      if (!cov || !pixels[i + 3]) {
        pixels[i + 3] = 0;
        continue;
      }
      any = true;
      pixels[i + 3] = (pixels[i + 3]! * cov) / 255;
      // The part left behind keeps (1 - coverage) of its alpha.
      const o = surface.get(Math.floor((r.x + x) / TILE), Math.floor((r.y + y) / TILE));
      if (o) {
        const oi = (((r.y + y) % TILE) * TILE + ((r.x + x) % TILE)) * 4;
        o[oi + 3] = (o[oi + 3]! * (255 - cov)) / 255;
      }
    }
  }
  if (!any) return null;
  for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++)
    for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) surface.touch(tx, ty);
  return { rect: r, pixels };
}

/**
 * Put one pixel of the lifted image on the layer: the colour at source position (px, py) (page coordinates, the centre
 * of the pixel being written), bilinear on premultiplied colour, over what the layer already holds.
 */
export function shadeInto(surface: TiledSurface, src: Lifted, x: number, y: number, px: number, py: number): void {
  const { rect: sr, pixels: sp } = src;
  const sample = (sx: number, sy: number): [number, number, number, number] => {
    // Premultiplied value of the source pixel (transparent outside the lifted rectangle).
    if (sx < 0 || sy < 0 || sx >= sr.w || sy >= sr.h) return [0, 0, 0, 0];
    const i = (sy * sr.w + sx) * 4;
    const a = sp[i + 3]! / 255;
    return [sp[i]! * a, sp[i + 1]! * a, sp[i + 2]! * a, a];
  };
  const u = px - sr.x - 0.5;
  const v = py - sr.y - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const c00 = sample(x0, y0);
  const c10 = sample(x0 + 1, y0);
  const c01 = sample(x0, y0 + 1);
  const c11 = sample(x0 + 1, y0 + 1);
  const mix = (k: number): number => (c00[k]! * (1 - fx) + c10[k]! * fx) * (1 - fy) + (c01[k]! * (1 - fx) + c11[k]! * fx) * fy;
  const a = mix(3);
  if (a <= 0.001) return;
  const tile = surface.ensure(Math.floor(x / TILE), Math.floor(y / TILE));
  const o = ((y % TILE) * TILE + (x % TILE)) * 4;
  const ba = tile[o + 3]! / 255;
  const ra = a + ba * (1 - a);
  tile[o] = (mix(0) + (1 - a) * ba * tile[o]!) / ra;
  tile[o + 1] = (mix(1) + (1 - a) * ba * tile[o + 1]!) / ra;
  tile[o + 2] = (mix(2) + (1 - a) * ba * tile[o + 2]!) / ra;
  tile[o + 3] = ra * 255;
}

/** Mark every tile a rectangle touches as changed (so renderers and caches refresh them). */
export function touchArea(surface: TiledSurface, r: Rect): void {
  for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++)
    for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) surface.touch(tx, ty);
}

/**
 * Draw lifted pixels back through the map `m` (source pixel coordinates -> page coordinates) with bilinear
 * filtering on premultiplied colour, over what the layer already holds. Returns the area written.
 */
export function drop(surface: TiledSurface, src: Lifted, m: Affine): Rect | null {
  const inv = invert(m);
  if (!inv) return null;
  const dest = clampRect(mapRect(src.rect, m), surface.width, surface.height);
  if (!dest) return null;
  for (let y = dest.y; y < dest.y + dest.h; y++) {
    for (let x = dest.x; x < dest.x + dest.w; x++) {
      const p = apply(inv, x + 0.5, y + 0.5);
      shadeInto(surface, src, x, y, p.x, p.y);
    }
  }
  touchArea(surface, dest);
  return dest;
}

/** The selection after the same transform: its coverage is resampled through `m`. */
export function transformSelection(sel: Selection, from: Rect, m: Affine): Selection {
  const out = new Selection(sel.width, sel.height);
  const inv = invert(m);
  const dest = inv ? clampRect(mapRect(from, m), sel.width, sel.height) : null;
  if (!inv || !dest) return out;
  for (let y = dest.y; y < dest.y + dest.h; y++) {
    for (let x = dest.x; x < dest.x + dest.w; x++) {
      const p = apply(inv, x + 0.5, y + 0.5);
      const sx = Math.floor(p.x);
      const sy = Math.floor(p.y);
      if (sx < from.x || sy < from.y || sx >= from.x + from.w || sy >= from.y + from.h) continue;
      const v = sel.at(sx, sy);
      if (v) out.set(x, y, v);
    }
  }
  return out;
}

/** Transform part of a layer in one go (flip, rotate 90°, or any map) and describe it for the history. */
export function transformLayerPixels(
  surface: TiledSurface,
  layerId: number,
  rect: Rect,
  sel: Selection | null,
  m: Affine,
): { patch: StrokePatch | null; rect: Rect | null } {
  const rec = new TileRecorder(surface, layerId);
  const r = clampRect(rect, surface.width, surface.height);
  if (!r) return { patch: null, rect: null };
  rec.watch(r);
  const dest = clampRect(mapRect(r, m), surface.width, surface.height);
  if (dest) rec.watch(dest);
  const lifted = lift(surface, r, sel);
  if (!lifted) {
    rec.restore();
    return { patch: null, rect: null };
  }
  const written = drop(surface, lifted, m);
  const area = written ? unionRect(r, written) : r;
  return { patch: rec.patch(area), rect: area };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
