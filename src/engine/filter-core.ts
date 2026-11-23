/**
 * What one piece of a filter's work is, and how it is done: the same functions run on the page (tests, a worker that cannot start)
 * and on the Web Workers of `filter-pool`. A piece is a tile of pixels (per-pixel filters) or a block of the area with its
 * surroundings (neighbourhood filters), so any number of them can be worked on at once and none needs the whole layer.
 */
import { FILTERS, clamp255, type AreaFilter, type BlockAt, type FilterContext, type PixelFilter, type Values } from './filters';

export interface PixelJob {
  id: string;
  values: Values;
  ctx: FilterContext;
  /** The tile, straight RGBA, `stride` pixels wide; only the first `w` × `h` pixels are the page's. */
  tile: Uint8ClampedArray;
  /** How much of each pixel the filter reaches (0..255): 255 for the whole tile, or one byte per pixel of it. */
  cov: Uint8Array | 255;
  stride: number;
  w: number;
  h: number;
}

export interface AreaJob {
  id: string;
  values: Values;
  ctx: FilterContext;
  /** Premultiplied RGBA (0..1) of the block with its surroundings. */
  buf: Float32Array;
  w: number;
  h: number;
  at: BlockAt;
}

const makers = new Map<string, (c: number[]) => void>();

/** The function a per-pixel filter applies for these values (kept: a drag asks for the same one tile after tile). */
function pixelFn(job: PixelJob): (c: number[]) => void {
  const key = `${job.id}|${JSON.stringify(job.values)}|${job.ctx.main.join(',')}|${job.ctx.sub.join(',')}`;
  let fn = makers.get(key);
  if (!fn) {
    fn = (FILTERS[job.id] as PixelFilter).make(job.values, job.ctx);
    if (makers.size > 8) makers.clear();
    makers.set(key, fn);
  }
  return fn;
}

/** Filter one tile: the same arithmetic as `applyPixelFilter` (a transparent pixel is left alone; a partly covered one is mixed). */
export function runPixelJob(job: PixelJob): Uint8ClampedArray {
  const run = pixelFn(job);
  const t = job.tile;
  const px = [0, 0, 0, 0];
  for (let y = 0; y < job.h; y++) {
    for (let x = 0; x < job.w; x++) {
      const i = y * job.stride + x;
      const c = job.cov === 255 ? 255 : job.cov[i]!;
      if (!c) continue;
      const o = i * 4;
      if (t[o + 3] === 0) continue;
      px[0] = t[o]!;
      px[1] = t[o + 1]!;
      px[2] = t[o + 2]!;
      px[3] = t[o + 3]!;
      run(px);
      const k = c / 255;
      for (let j = 0; j < 4; j++) t[o + j] = t[o + j]! + (clamp255(px[j]!) - t[o + j]!) * k;
    }
  }
  return t;
}

/** Filter one block of an area. */
export function runAreaJob(job: AreaJob): Float32Array {
  (FILTERS[job.id] as AreaFilter).run(job.buf, job.w, job.h, job.values, job.ctx, job.at);
  return job.buf;
}
