/**
 * Filters on a layer, in pieces. Before, a filter read the whole area into one block of floating-point numbers, filtered it in one call
 * and wrote it back: on a big layer that held the window for seconds (and needed hundreds of megabytes). Here the area is cut into
 * blocks (tiles for per-pixel filters); each block is filtered from the layer as it was, by the workers of `filter-pool` a few at a
 * time, and written back as it arrives. So:
 *  - the window is never held: between pieces the page draws and answers;
 *  - what has been done shows at once (`onPiece`), the middle of the view first;
 *  - the work can be stopped between pieces (`stop`), and what was written so far still comes back as a patch to undo.
 * The result is the one of `applyPixelFilter` / `applyAreaFilter` (the tests compare them).
 */
import type { StrokePatch } from './brush';
import type { AreaJob, PixelJob } from './filter-core';
import { inlineRunner, type FilterRunner } from './filter-pool';
import { coverageOver, scaledValues, type AreaFilter, type FilterContext, type PixelFilter, type Values } from './filters';
import type { Selection } from './selection';
import { TILE, type Rect, type TiledSurface } from './tiles';
import { TileRecorder } from './transform';

export interface RunOptions {
  /** Who does the pieces (default: on this thread). */
  runner?: FilterRunner;
  /** Called between pieces; the work stops when it says true. */
  stop?: () => boolean;
  /** Called after each piece is written, with the part of the page it changed. */
  onPiece?: (rect: Rect) => void;
  /** Called between pieces on this thread so the window gets a turn. */
  tick?: () => Promise<void>;
  /** The part of the page to filter (a preview filters what is on screen); the rest is left as it is. */
  limit?: Rect;
  /** The record of what the layer was before the filter: pass the one of an earlier pass to go on over its work (a finer preview over a coarse one). */
  recorder?: TileRecorder;
  /** The area an earlier pass worked on (its result's `frame`): over what a pass has written the layer's painted part is no longer what it was. */
  frame?: Rect;
  /** For a neighbourhood filter: 2 or 4 filters each block that many times smaller (a quick preview). */
  scale?: number;
  /** Where to start (page coordinates): the pieces nearest to it come first. */
  near?: { x: number; y: number };
}

export interface RunResult {
  patch: StrokePatch | null;
  /** The part of the page that was filtered (null when nothing was). */
  rect: Rect | null;
  /** False when `stop` ended the work before all of it was done. */
  complete: boolean;
  /** The record of the layer before the filter (what `o.recorder` takes). */
  recorder: TileRecorder;
  /** The area a neighbourhood filter worked on (what `o.frame` takes). */
  frame?: Rect;
}

/** Side of a block of an area, in pixels: small enough that one piece is a few milliseconds even for the slowest filter. */
const BLOCK = 160;
/** The biggest side of a block of a filter with a wide margin (a gaussian of radius 100 reads 300 pixels all round). */
const MAX_SIDE = 1024;
/** About how many bytes of blocks are being worked on at once. */
const MEMORY_IN_FLIGHT = 160_000_000;

const intersect = (a: Rect, b: Rect): Rect | null => {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

const union = (a: Rect | null, b: Rect): Rect => {
  if (!a) return b;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Order pieces so the ones nearest to `near` come first (the middle of what is on screen). */
function byDistance<T extends { rect: Rect }>(pieces: T[], near: { x: number; y: number } | undefined): T[] {
  if (!near) return pieces;
  const d = (p: T): number => Math.hypot(p.rect.x + p.rect.w / 2 - near.x, p.rect.y + p.rect.h / 2 - near.y);
  return pieces.sort((a, b) => d(a) - d(b));
}

/**
 * Keeps a few pieces in flight and hands their results back in the order they were asked for: while the workers do some, the
 * caller prepares the next and writes the finished ones.
 */
async function pipeline<P, R>(pieces: readonly P[], depth: number, start: (p: P) => Promise<R>, done: (p: P, r: R) => void, o: RunOptions): Promise<boolean> {
  const flying: { p: P; r: Promise<R> }[] = [];
  let next = 0;
  let stopped = false;
  while (next < pieces.length || flying.length) {
    while (!stopped && next < pieces.length && flying.length < depth) {
      const p = pieces[next++]!;
      flying.push({ p, r: start(p) });
      await o.tick?.();
    }
    const head = flying.shift();
    if (!head) break;
    const r = await head.r;
    if (!stopped && o.stop?.()) stopped = true; // what is still in flight is dropped (its result is not written)
    if (!stopped) done(head.p, r);
  }
  return !stopped;
}

/** A per-pixel filter on a layer (inside the selection when there is one), tile by tile. */
export async function applyPixelFilterAsync(
  surface: TiledSurface,
  layerId: number,
  sel: Selection | null,
  f: PixelFilter,
  v: Values,
  ctx: FilterContext,
  o: RunOptions = {},
): Promise<RunResult> {
  const runner = o.runner ?? inlineRunner;
  const rec = o.recorder ?? new TileRecorder(surface, layerId);
  const pieces: { tx: number; ty: number; rect: Rect; cov: Uint8Array | 255 }[] = [];
  for (const [tx, ty] of surface.entries()) {
    const rect: Rect = { x: tx * TILE, y: ty * TILE, w: Math.min(TILE, surface.width - tx * TILE), h: Math.min(TILE, surface.height - ty * TILE) };
    if (o.limit && !intersect(rect, o.limit)) continue;
    const cov = sel ? sel.tile(tx, ty) : 255;
    if (cov === 0) continue;
    pieces.push({ tx, ty, rect, cov });
  }
  let changed: Rect | null = null;
  const complete = await pipeline(
    byDistance(pieces, o.near),
    runner.concurrency,
    (p) => {
      const tile = surface.get(p.tx, p.ty)!;
      const job: PixelJob = {
        id: f.id,
        values: v,
        ctx,
        tile: tile.slice(),
        cov: p.cov === 255 ? 255 : p.cov.slice(), // the selection's own array must not be handed over
        stride: TILE,
        w: p.rect.w,
        h: p.rect.h,
      };
      return runner.pixel(job);
    },
    (p, out) => {
      const tile = surface.get(p.tx, p.ty);
      if (!tile) return;
      let same = true;
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== tile[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
      rec.watch(p.rect);
      tile.set(out);
      surface.touch(p.tx, p.ty);
      changed = union(changed, p.rect);
      o.onPiece?.(p.rect);
    },
    o,
  );
  const rect = changed as Rect | null;
  return { patch: rect ? rec.patch(rect) : null, rect, complete, recorder: rec };
}

/** The pixels of `rect` as they were before the filter touched the layer (straight RGBA); outside `frame` they are transparent. */
function readOriginal(surface: TiledSurface, rec: TileRecorder, rect: Rect, frame: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const r = intersect(rect, frame);
  if (!r) return out;
  for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++) {
    for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) {
      const tile = rec.original(tx, ty);
      if (!tile) continue;
      const xa = Math.max(r.x, tx * TILE);
      const xb = Math.min(r.x + r.w, (tx + 1) * TILE);
      const ya = Math.max(r.y, ty * TILE);
      const yb = Math.min(r.y + r.h, (ty + 1) * TILE);
      for (let y = ya; y < yb; y++) {
        const from = ((y - ty * TILE) * TILE + (xa - tx * TILE)) * 4;
        out.set(tile.subarray(from, from + (xb - xa) * 4), ((y - rect.y) * rect.w + (xa - rect.x)) * 4);
      }
    }
  }
  return out;
}

/** The area an area filter works on: the selection's (or the layer's painted part) bounds and the filter's margin, as `applyAreaFilter` takes it. */
export function areaFrame(surface: TiledSurface, sel: Selection | null, f: AreaFilter, v: Values): Rect | null {
  const base = sel ? sel.bounds() : surface.contentBounds();
  if (!base) return null;
  const m = f.margin(v);
  const x0 = Math.max(0, Math.floor(base.x) - m);
  const y0 = Math.max(0, Math.floor(base.y) - m);
  const x1 = Math.min(surface.width, Math.ceil(base.x + base.w) + m);
  const y1 = Math.min(surface.height, Math.ceil(base.y + base.h) + m);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * A neighbourhood filter on a layer (inside the selection when there is one), block by block. `limit` (a preview) filters only that part
 * of the area, which is still the same area as for the whole layer (a centre, a grid or a wave sit where they would). `scale` 2 or 4: each
 * block is filtered `scale` times smaller (with its lengths shrunk the same, see `previewScale`) and enlarged back, which is far less work
 * for a preview that is soon made again at full size.
 */
export async function applyAreaFilterAsync(
  surface: TiledSurface,
  layerId: number,
  sel: Selection | null,
  f: AreaFilter,
  v: Values,
  ctx: FilterContext,
  o: RunOptions = {},
): Promise<RunResult> {
  const frame = o.frame ?? areaFrame(surface, sel, f, v);
  const target = frame && o.limit ? intersect(frame, o.limit) : frame;
  const runner = o.runner ?? inlineRunner;
  const rec = o.recorder ?? new TileRecorder(surface, layerId);
  if (!frame || !target) return { patch: null, rect: null, complete: true, recorder: rec };
  const m = f.margin(v);
  const k = o.scale && o.scale > 1 ? Math.floor(o.scale) : 1;
  const sv = scaledValues(f, v, k);
  const cell = Math.max(1, Math.round(f.cell?.(v) ?? 1));
  // A block is a multiple of the cell (and of the scale) and as wide as its margins: otherwise the margins would be most of the work.
  const unit = cell * k;
  const side = Math.max(unit, Math.ceil(Math.min(MAX_SIDE, Math.max(BLOCK, 3 * m)) / unit) * unit);
  const jobBytes = ((side + 2 * m) / k) ** 2 * 16 + (side + 2 * m) ** 2 * 4;
  const depth = Math.max(1, Math.min(runner.concurrency, Math.floor(MEMORY_IN_FLIGHT / jobBytes)));
  const pieces: { rect: Rect; read: Rect; write: Rect }[] = [];
  // Blocks start at whole blocks from the corner of the frame, so a grid of cells sits where it would for the whole layer.
  for (let by = Math.floor((target.y - frame.y) / side); frame.y + by * side < target.y + target.h; by++) {
    for (let bx = Math.floor((target.x - frame.x) / side); frame.x + bx * side < target.x + target.w; bx++) {
      const rect = intersect({ x: frame.x + bx * side, y: frame.y + by * side, w: side, h: side }, frame)!;
      const write = intersect(rect, target);
      if (!write) continue;
      const want = f.reach ? f.reach(v, rect, frame) : { x: rect.x - m, y: rect.y - m, w: rect.w + 2 * m, h: rect.h + 2 * m };
      let read = intersect(want, frame);
      if (!read) continue;
      if (k > 1) {
        // Whole steps of the reduction from the corner of the frame (what lies past the frame's edge counts as transparent).
        const ax = frame.x + Math.floor((read.x - frame.x) / k) * k;
        const ay = frame.y + Math.floor((read.y - frame.y) / k) * k;
        read = { x: ax, y: ay, w: Math.ceil((read.x + read.w - ax) / k) * k, h: Math.ceil((read.y + read.h - ay) / k) * k };
      }
      pieces.push({ rect, read, write });
    }
  }
  const cover = (r: Rect): Uint8Array | null => (sel ? coverageOver(sel, r) : null);
  let changed: Rect | null = null;
  const complete = await pipeline(
    byDistance(
      pieces.map((p) => ({ ...p, rect: p.write })),
      o.near,
    ),
    depth,
    (p) => {
      const src = readOriginal(surface, rec, p.read, frame);
      const sw = p.read.w / k;
      const sh = p.read.h / k;
      const buf = new Float32Array(sw * sh * 4);
      if (k === 1) {
        for (let i = 0; i < sw * sh; i++) {
          const a = src[i * 4 + 3]! / 255;
          buf[i * 4] = (src[i * 4]! / 255) * a;
          buf[i * 4 + 1] = (src[i * 4 + 1]! / 255) * a;
          buf[i * 4 + 2] = (src[i * 4 + 2]! / 255) * a;
          buf[i * 4 + 3] = a;
        }
      } else {
        const w = p.read.w;
        const inv = 1 / (k * k);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let j = 0; j < k; j++) {
              for (let i = 0; i < k; i++) {
                const q = ((y * k + j) * w + x * k + i) * 4;
                const pa = src[q + 3]! / 255;
                r += (src[q]! / 255) * pa;
                g += (src[q + 1]! / 255) * pa;
                b += (src[q + 2]! / 255) * pa;
                a += pa;
              }
            }
            const o4 = (y * sw + x) * 4;
            buf[o4] = r * inv;
            buf[o4 + 1] = g * inv;
            buf[o4 + 2] = b * inv;
            buf[o4 + 3] = a * inv;
          }
        }
      }
      const job: AreaJob = { id: f.id, values: sv, ctx, buf, w: sw, h: sh, at: { x: (p.read.x - frame.x) / k, y: (p.read.y - frame.y) / k, fw: frame.w / k, fh: frame.h / k } };
      return runner.area(job).then((out) => ({ out, src, sw, sh }));
    },
    (p, { out, src, sw, sh }) => {
      const w = p.write;
      const cov = cover(w);
      const px = new Uint8ClampedArray(w.w * w.h * 4);
      const s4 = [0, 0, 0, 0];
      for (let y = 0; y < w.h; y++) {
        for (let x = 0; x < w.w; x++) {
          const fx = w.x + x - p.read.x;
          const fy = w.y + y - p.read.y;
          const bi = (fy * p.read.w + fx) * 4;
          if (k === 1) {
            s4[0] = out[bi]!;
            s4[1] = out[bi + 1]!;
            s4[2] = out[bi + 2]!;
            s4[3] = out[bi + 3]!;
          } else {
            // Back to full size: bilinear between the centres of the reduced pixels.
            const u = Math.min(sw - 1, Math.max(0, (fx + 0.5) / k - 0.5));
            const t = Math.min(sh - 1, Math.max(0, (fy + 0.5) / k - 0.5));
            const u0 = Math.floor(u);
            const t0 = Math.floor(t);
            const u1 = Math.min(sw - 1, u0 + 1);
            const t1 = Math.min(sh - 1, t0 + 1);
            const du = u - u0;
            const dt = t - t0;
            for (let c = 0; c < 4; c++) {
              s4[c] = (out[(t0 * sw + u0) * 4 + c]! * (1 - du) + out[(t0 * sw + u1) * 4 + c]! * du) * (1 - dt) + (out[(t1 * sw + u0) * 4 + c]! * (1 - du) + out[(t1 * sw + u1) * 4 + c]! * du) * dt;
            }
          }
          let a: number;
          let pm0: number;
          let pm1: number;
          let pm2: number;
          if (cov) {
            const kc = cov[y * w.w + x]! / 255;
            const oa = src[bi + 3]! / 255;
            const o0 = (src[bi]! / 255) * oa;
            const o1 = (src[bi + 1]! / 255) * oa;
            const o2 = (src[bi + 2]! / 255) * oa;
            a = oa + (s4[3]! - oa) * kc;
            if (a <= 0.0005) continue;
            pm0 = o0 + (s4[0]! - o0) * kc;
            pm1 = o1 + (s4[1]! - o1) * kc;
            pm2 = o2 + (s4[2]! - o2) * kc;
          } else {
            a = s4[3]!;
            if (a <= 0.0005) continue;
            pm0 = s4[0]!;
            pm1 = s4[1]!;
            pm2 = s4[2]!;
          }
          const o4 = (y * w.w + x) * 4;
          px[o4] = Math.min(255, (pm0 / a) * 255);
          px[o4 + 1] = Math.min(255, (pm1 / a) * 255);
          px[o4 + 2] = Math.min(255, (pm2 / a) * 255);
          px[o4 + 3] = a * 255;
        }
      }
      rec.watch(w);
      surface.writeRect(w, px);
      changed = union(changed, w);
      o.onPiece?.(w);
    },
    o,
  );
  const rect = changed as Rect | null;
  return { patch: rect ? rec.patch(rect) : null, rect, complete, recorder: rec, frame };
}
