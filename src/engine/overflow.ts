import type { Layer } from './document';
import type { Command } from './history';
import { TileRecorder, drop, lift, mapRect, translation, compose, unionRect, type Affine, type Lifted } from './transform';
import { TiledSurface, type Rect } from './tiles';
import { Warp, dropWarp } from './warp';

/**
 * What a pixel layer holds beyond the edge of its page (Clip Studio keeps it too): pasted pictures bigger than the page,
 * or content moved out of it. It is not drawn, exported or painted on; the transform brings it back into view.
 * `surface` is in its own coordinates, whose (0, 0) is the page point (x, y), so x and y may be negative. The part of
 * the layer inside the page always lives in `layer.surface`, never here.
 */
export interface Overflow {
  x: number;
  y: number;
  surface: TiledSurface;
}

/** Pixels whose local (0, 0) sits at page point (x, y). */
export interface Placed {
  surface: TiledSurface;
  x: number;
  y: number;
}

/** How far from the page edge a transformed layer keeps what falls outside it, in pages (more is dropped). */
const KEEP_PAGES = 1;

const inter = (a: Rect, b: Rect): Rect | null => {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** Where the overflow's pixels are, in page coordinates (null when it holds none). */
export function overflowBounds(o: Overflow | undefined): Rect | null {
  const b = o?.surface.contentBounds();
  return o && b ? { x: b.x + o.x, y: b.y + o.y, w: b.w, h: b.h } : null;
}

/** The layer's pixels as parts in page coordinates: the page's own and the overflow. */
export function placedOf(layer: Layer): Placed[] {
  const out: Placed[] = [{ surface: layer.surface, x: 0, y: 0 }];
  if (layer.overflow) out.push({ surface: layer.overflow.surface, x: layer.overflow.x, y: layer.overflow.y });
  return out;
}

/** The area, in page coordinates, that all the layer's pixels (inside the page or beyond it) occupy. */
export function layerReach(layer: Layer): Rect | null {
  let u: Rect | null = null;
  for (const p of placedOf(layer)) {
    const b = p.surface.contentBounds();
    if (b) u = u ? unionRect(u, { x: b.x + p.x, y: b.y + p.y, w: b.w, h: b.h }) : { x: b.x + p.x, y: b.y + p.y, w: b.w, h: b.h };
  }
  return u;
}

/** Write the opaque pixels of `px` over `r` of the surface, leaving what is there under its transparent ones (parts share tiles). */
function overlay(surface: TiledSurface, r: Rect, px: Uint8ClampedArray): void {
  const there = surface.readRect(r);
  let any = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    there[i] = px[i]!;
    there[i + 1] = px[i + 1]!;
    there[i + 2] = px[i + 2]!;
    there[i + 3] = px[i + 3]!;
    any = true;
  }
  if (any) surface.writeRect(r, there);
}

/**
 * Put pixels (given in page coordinates) onto a page of w×h: what is inside goes to `into` (a new surface when omitted;
 * it is written over, so it should be blank where parts land), what is outside becomes the returned overflow (undefined
 * when nothing is outside). The parts must not overlap each other.
 */
export function settle(parts: readonly Placed[], w: number, h: number, into?: TiledSurface): { surface: TiledSurface; overflow: Overflow | undefined } {
  const page: Rect = { x: 0, y: 0, w, h };
  const surface = into ?? new TiledSurface(w, h);
  let reach: Rect | null = null;
  for (const p of parts) {
    const b = p.surface.contentBounds();
    if (b) reach = reach ? unionRect(reach, { x: b.x + p.x, y: b.y + p.y, w: b.w, h: b.h }) : { x: b.x + p.x, y: b.y + p.y, w: b.w, h: b.h };
  }
  if (!reach) return { surface, overflow: undefined };
  const out = reach.x < 0 || reach.y < 0 || reach.x + reach.w > w || reach.y + reach.h > h;
  const ox = Math.min(reach.x, 0);
  const oy = Math.min(reach.y, 0);
  const store = out ? new TiledSurface(Math.max(reach.x + reach.w, w) - ox, Math.max(reach.y + reach.h, h) - oy) : null;
  for (const p of parts) {
    for (const [tx, ty] of p.surface.entries()) {
      const local = p.surface.blockRect(tx, ty);
      if (!local) continue;
      const at: Rect = { x: local.x + p.x, y: local.y + p.y, w: local.w, h: local.h };
      const px = p.surface.readRect(local);
      const inside = inter(at, page);
      if (inside) {
        const sub = new Uint8ClampedArray(inside.w * inside.h * 4);
        for (let y = 0; y < inside.h; y++) {
          const from = ((inside.y - at.y + y) * at.w + (inside.x - at.x)) * 4;
          sub.set(px.subarray(from, from + inside.w * 4), y * inside.w * 4);
        }
        overlay(surface, inside, sub);
        if (inside.w === at.w && inside.h === at.h) continue;
        // The part of the block that is on the page is not kept twice.
        for (let y = 0; y < inside.h; y++) px.fill(0, ((inside.y - at.y + y) * at.w + (inside.x - at.x)) * 4, ((inside.y - at.y + y) * at.w + (inside.x - at.x) + inside.w) * 4);
      }
      if (store) overlay(store, { x: at.x - ox, y: at.y - oy, w: at.w, h: at.h }, px);
    }
  }
  surface.markAllDirty();
  const kept = store && !store.isEmpty ? { x: ox, y: oy, surface: store } : undefined;
  return { surface, overflow: kept };
}

/** A copy of the layer's pixels for a page of w×h: the same page size is a plain copy, otherwise what moves off one page lands in the other, inside or beyond it. */
export function carryPixels(layer: Layer, w: number, h: number): { surface: TiledSurface; overflow: Overflow | undefined } {
  if (layer.surface.width === w && layer.surface.height === h && !layer.overflow) return { surface: layer.surface.clone(), overflow: undefined };
  return settle(placedOf(layer), w, h);
}

/** A history step for a change of what a layer holds beyond its page. */
export function overflowCommand(layer: Layer, before: Overflow | undefined, after: Overflow | undefined, label: string): Command | null {
  if (before === after) return null;
  const bytes = (o: Overflow | undefined): number => o?.surface.pixelBytes ?? 0;
  return {
    label,
    region: null,
    bytes: bytes(before) + bytes(after),
    undo: () => {
      if (before) layer.overflow = before;
      else delete layer.overflow;
    },
    redo: () => {
      if (after) layer.overflow = after;
      else delete layer.overflow;
    },
  };
}

/**
 * Take every pixel of the layer out of it, inside the page or beyond it, and return them as one image (page
 * coordinates; the rectangle may stick out of the page). The recorder must watch the layer's surface. The layer's
 * `overflow` is left to the caller (it is only read).
 */
export function liftEverything(layer: Layer, rec: TileRecorder): Lifted | null {
  const reach = layerReach(layer);
  if (!reach) return null;
  const pageR = inter(reach, { x: 0, y: 0, w: layer.surface.width, h: layer.surface.height });
  const pixels = new Uint8ClampedArray(reach.w * reach.h * 4);
  const put = (r: Rect, px: ArrayLike<number>): void => {
    for (let y = 0; y < r.h; y++) {
      const to = ((r.y - reach.y + y) * reach.w + (r.x - reach.x)) * 4;
      for (let i = 0; i < r.w * 4; i += 4) {
        const from = y * r.w * 4 + i;
        if (px[from + 3] === 0) continue;
        for (let k = 0; k < 4; k++) pixels[to + i + k] = px[from + k]!;
      }
    }
  };
  if (pageR) {
    rec.watch(pageR);
    const l = lift(layer.surface, pageR, null);
    if (l) put(l.rect, l.pixels);
  }
  const o = layer.overflow;
  if (o) {
    const local = inter({ x: reach.x - o.x, y: reach.y - o.y, w: reach.w, h: reach.h }, { x: 0, y: 0, w: o.surface.width, h: o.surface.height });
    if (local) put({ x: local.x + o.x, y: local.y + o.y, w: local.w, h: local.h }, o.surface.readRect(local));
  }
  let any = false;
  for (let i = 3; i < pixels.length && !any; i += 4) any = pixels[i] !== 0;
  return any ? { rect: reach, pixels } : null;
}

/** Whether a shape sticks out of the page. */
export const sticksOut = (r: Rect, w: number, h: number): boolean => r.x < 0 || r.y < 0 || r.x + r.w > w || r.y + r.h > h;

/**
 * Draw lifted pixels back onto the layer through a map or a warp. What lands on the page is written into the layer;
 * what lands beyond it (up to a page away from the edge) becomes the layer's overflow. Returns the page area written
 * and the overflow now held; the layer's `overflow` is set. The recorder must have watched the layer's surface where
 * the lifted pixels came from; the tiles to be written are watched here.
 */
export function dropEverything(layer: Layer, rec: TileRecorder, src: Lifted, how: { m: Affine } | { warp: Warp }): { area: Rect | null; overflow: Overflow | undefined } {
  const w = layer.surface.width;
  const h = layer.surface.height;
  const shape = 'm' in how ? mapRect(src.rect, how.m) : how.warp.bounds();
  // Room kept around the page: a page, or as much as the picture was big if that is more (so moving it never cuts it).
  const mx = Math.max(w * KEEP_PAGES, Math.ceil(src.rect.w));
  const my = Math.max(h * KEEP_PAGES, Math.ceil(src.rect.h));
  const limit: Rect = { x: -mx, y: -my, w: w + 2 * mx, h: h + 2 * my };
  const d = inter({ x: Math.floor(shape.x), y: Math.floor(shape.y), w: Math.ceil(shape.x + shape.w) - Math.floor(shape.x), h: Math.ceil(shape.y + shape.h) - Math.floor(shape.y) }, limit);
  delete layer.overflow;
  if (!d) return { area: null, overflow: undefined };
  const tmp = new TiledSurface(d.w, d.h);
  if ('m' in how) drop(tmp, src, compose(how.m, translation(-d.x, -d.y)));
  else {
    const shifted = Warp.shifted(how.warp, -d.x, -d.y);
    const moved: Lifted = { rect: { x: src.rect.x - d.x, y: src.rect.y - d.y, w: src.rect.w, h: src.rect.h }, pixels: src.pixels };
    if (shifted) dropWarp(tmp, moved, shifted);
  }
  const area = inter(d, { x: 0, y: 0, w, h });
  if (area) rec.watch(area);
  const done = settle([{ surface: tmp, x: d.x, y: d.y }], w, h, layer.surface);
  if (done.overflow) layer.overflow = done.overflow;
  return { area, overflow: done.overflow };
}
