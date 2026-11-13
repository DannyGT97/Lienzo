import { TILE, TiledSurface } from './tiles';

/**
 * How pixels are re-sampled when the picture changes size. "average" is the high-precision one of Clip Studio's dialog:
 * every new pixel is the mean colour of the old area it covers when shrinking (and a smooth blend when enlarging).
 */
export type ResampleMethod = 'average' | 'bicubic' | 'bilinear' | 'nearest';

/** For each new pixel along one axis: the old pixels that feed it and their weights (summing to 1). */
interface AxisWeights {
  first: Int32Array;
  count: Int32Array;
  offset: Int32Array;
  w: Float32Array;
}

const catmullRom = (x: number): number => {
  const a = Math.abs(x);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
};

function axisWeights(from: number, to: number, method: ResampleMethod): AxisWeights {
  const s = from / to;
  const first = new Int32Array(to);
  const count = new Int32Array(to);
  const offset = new Int32Array(to);
  const all: number[] = [];
  const stretch = Math.max(1, s); // a kernel covers more old pixels when shrinking, so nothing is skipped
  for (let i = 0; i < to; i++) {
    const c = (i + 0.5) * s; // centre of the new pixel, in old pixels
    let lo: number;
    let taps: number[];
    if (method === 'nearest') {
      lo = Math.min(from - 1, Math.floor(c));
      taps = [1];
    } else if (method === 'average' && s > 1) {
      const a = i * s;
      const b = (i + 1) * s;
      lo = Math.floor(a);
      const hi = Math.min(from, Math.ceil(b));
      taps = [];
      for (let j = lo; j < hi; j++) taps.push((Math.min(j + 1, b) - Math.max(j, a)) / s);
    } else {
      const radius = method === 'bicubic' ? 2 * stretch : stretch;
      lo = Math.floor(c - radius);
      const hi = Math.ceil(c + radius);
      taps = [];
      for (let j = lo; j < hi; j++) {
        const d = Math.abs(j + 0.5 - c);
        taps.push(method === 'bicubic' ? catmullRom(d / stretch) : Math.max(0, 1 - d / stretch));
      }
    }
    // Old pixels past the edge repeat the edge pixel.
    const folded = new Map<number, number>();
    taps.forEach((wt, k) => {
      const j = Math.min(from - 1, Math.max(0, lo + k));
      folded.set(j, (folded.get(j) ?? 0) + wt);
    });
    const idx = [...folded.keys()].sort((x, y) => x - y);
    const sum = idx.reduce((t, j) => t + folded.get(j)!, 0) || 1;
    first[i] = idx[0]!;
    count[i] = idx.length;
    offset[i] = all.length;
    for (const j of idx) all.push(folded.get(j)! / sum);
  }
  return { first, count, offset, w: Float32Array.from(all) };
}

export interface ResampleOptions {
  /**
   * What the surface holds where it has no tile (a mask that shows everything holds 255); such surfaces are blended
   * channel by channel, the others with their colour weighted by their alpha so clear pixels do not tint the edges.
   */
  base?: 0 | 255;
}

/**
 * The surface at a new size. Only bands of the new picture that touch old pixels are computed and only tiles with
 * something in them are stored; the work is done a band of tiles at a time, so memory stays proportional to one band.
 */
export function resampleSurface(src: TiledSurface, width: number, height: number, method: ResampleMethod, opts: ResampleOptions = {}): TiledSurface {
  const base = opts.base ?? 0;
  const out = new TiledSurface(width, height);
  const wx = axisWeights(src.width, width, method);
  const wy = axisWeights(src.height, height, method);
  const populated = new Set<number>();
  for (const [, ty] of src.entries()) populated.add(ty);
  if (base === 0 && !populated.size) return out;

  const constant = new Float32Array(width * 4).fill(255);
  const sourceRow = new Float32Array(src.width * 4);
  const rowOf = new Map<number, Float32Array | null>();

  /** One old row, already resampled along x (colour premultiplied by alpha unless the surface is blended straight). */
  const horizontal = (sy: number): Float32Array | null => {
    const ty = Math.floor(sy / TILE);
    if (!populated.has(ty)) return base === 255 ? constant : null;
    const premul = base === 0;
    const ly = sy - ty * TILE;
    for (let x = 0; x < src.width; x++) {
      const tile = src.get(Math.floor(x / TILE), ty);
      const o = x * 4;
      if (!tile) {
        sourceRow[o] = sourceRow[o + 1] = sourceRow[o + 2] = sourceRow[o + 3] = base;
        continue;
      }
      const i = (ly * TILE + (x % TILE)) * 4;
      const a = tile[i + 3]!;
      const k = premul ? a / 255 : 1;
      sourceRow[o] = tile[i]! * k;
      sourceRow[o + 1] = tile[i + 1]! * k;
      sourceRow[o + 2] = tile[i + 2]! * k;
      sourceRow[o + 3] = a;
    }
    const row = new Float32Array(width * 4);
    for (let x = 0; x < width; x++) {
      const f = wx.first[x]!;
      const n = wx.count[x]!;
      const off = wx.offset[x]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < n; k++) {
        const wt = wx.w[off + k]!;
        const o = (f + k) * 4;
        r += sourceRow[o]! * wt;
        g += sourceRow[o + 1]! * wt;
        b += sourceRow[o + 2]! * wt;
        a += sourceRow[o + 3]! * wt;
      }
      row[x * 4] = r;
      row[x * 4 + 1] = g;
      row[x * 4 + 2] = b;
      row[x * 4 + 3] = a;
    }
    return row;
  };

  const acc = new Float32Array(width * 4);
  const px = new Uint8ClampedArray(width * 4);
  for (let y = 0; y < height; y++) {
    if (y % TILE === 0) rowOf.clear(); // rows are reused inside a band only
    const f = wy.first[y]!;
    const n = wy.count[y]!;
    const off = wy.offset[y]!;
    acc.fill(0);
    let any = false;
    for (let k = 0; k < n; k++) {
      const sy = f + k;
      let row = rowOf.get(sy);
      if (row === undefined) {
        row = horizontal(sy);
        rowOf.set(sy, row);
      }
      if (!row) continue;
      any = true;
      const wt = wy.w[off + k]!;
      for (let i = 0; i < acc.length; i++) acc[i] = acc[i]! + row[i]! * wt;
    }
    if (!any) continue;
    let content = false;
    for (let x = 0; x < width; x++) {
      const i = x * 4;
      const a = Math.min(255, Math.max(0, acc[i + 3]!));
      if (base === 0) {
        const k = a > 0 ? 255 / a : 0;
        px[i] = acc[i]! * k;
        px[i + 1] = acc[i + 1]! * k;
        px[i + 2] = acc[i + 2]! * k;
        px[i + 3] = a;
      } else {
        px[i] = acc[i]!;
        px[i + 1] = acc[i + 1]!;
        px[i + 2] = acc[i + 2]!;
        px[i + 3] = a;
      }
      if (px[i + 3] !== base) content = true;
      else if (base === 255 && (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255)) content = true;
    }
    if (!content) continue; // a row of nothing leaves the tiles as they start
    store(out, px, y, width, base);
  }
  out.markAllDirty();
  return out;
}

/** Write one finished row into the tiles that have something in them (a tile is made when this row is the first to need it). */
function store(out: TiledSurface, px: Uint8ClampedArray, y: number, width: number, base: 0 | 255): void {
  const ty = Math.floor(y / TILE);
  const ly = y - ty * TILE;
  for (let tx = 0; tx < out.tilesX; tx++) {
    const x0 = tx * TILE;
    const x1 = Math.min(width, x0 + TILE);
    let tile = out.get(tx, ty);
    if (!tile) {
      let used = false;
      for (let x = x0; x < x1 && !used; x++) {
        const i = x * 4;
        used = base === 0 ? px[i + 3]! !== 0 : px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255 || px[i + 3] !== 255;
      }
      if (!used) continue;
      tile = out.ensure(tx, ty);
      if (base === 255) tile.fill(255);
    }
    tile.set(px.subarray(x0 * 4, x1 * 4), (ly * TILE) * 4);
  }
}
