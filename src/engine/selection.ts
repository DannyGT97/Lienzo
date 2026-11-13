import type { StrokePatch } from './brush';
import { TILE, TILE_BYTES, type Rect, type Tile, type TiledSurface } from './tiles';

const T2 = TILE * TILE;

/** What the brush needs to stay inside a selection: the coverage of a tile (0 none, 255 whole tile, or per pixel). */
export interface SelectionClip {
  tile(tx: number, ty: number): Uint8Array | 0 | 255;
}

export type CombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * A selection: 8-bit coverage per pixel, stored sparsely in 256×256 tiles. Pixels of tiles that are not stored
 * all have the same value, `outside` (0 = not selected, 255 = selected), so "select all" and an inverted
 * selection cost nothing on a huge page.
 */
export class Selection implements SelectionClip {
  readonly tilesX: number;
  readonly tilesY: number;
  outside: 0 | 255 = 0;
  private readonly tiles = new Map<number, Uint8Array>();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.tilesX = Math.ceil(width / TILE);
    this.tilesY = Math.ceil(height / TILE);
  }

  // ---- construction ------------------------------------------------------------------------

  static all(width: number, height: number): Selection {
    const s = new Selection(width, height);
    s.outside = 255;
    return s;
  }

  /** Rectangle with real-valued edges: partly covered border pixels get partial coverage. */
  static rect(width: number, height: number, r: Rect): Selection {
    const s = new Selection(width, height);
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(width, r.x + r.w);
    const y1 = Math.min(height, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) return s;
    if (Number.isInteger(x0) && Number.isInteger(y0) && Number.isInteger(x1) && Number.isInteger(y1)) {
      // Whole pixels: fill each tile's rows directly instead of setting pixel by pixel.
      for (let ty = Math.floor(y0 / TILE); ty * TILE < y1; ty++) {
        for (let tx = Math.floor(x0 / TILE); tx * TILE < x1; tx++) {
          const ax = Math.max(x0, tx * TILE) - tx * TILE;
          const bx = Math.min(x1, (tx + 1) * TILE) - tx * TILE;
          const ay = Math.max(y0, ty * TILE) - ty * TILE;
          const by = Math.min(y1, (ty + 1) * TILE) - ty * TILE;
          const whole = ax === 0 && ay === 0 && bx === TILE && by === TILE;
          const t = new Uint8Array(T2);
          if (whole) t.fill(255);
          else for (let y = ay; y < by; y++) t.fill(255, (y << TILE_SHIFT) + ax, (y << TILE_SHIFT) + bx);
          s.adoptTile(tx, ty, t);
        }
      }
      return s;
    }
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0);
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const cx = Math.min(x + 1, x1) - Math.max(x, x0);
        s.set(x, y, Math.round(cx * cy * 255));
      }
    }
    return s;
  }

  /** Ellipse inscribed in the rectangle, anti-aliased by 4×4 supersampling of the edge pixels. */
  static ellipse(width: number, height: number, r: Rect): Selection {
    const s = new Selection(width, height);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rx = r.w / 2;
    const ry = r.h / 2;
    if (rx <= 0 || ry <= 0) return s;
    const inside = (x: number, y: number): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(height, Math.ceil(r.y + r.h)); y++) {
      for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(width, Math.ceil(r.x + r.w)); x++) {
        let hit = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hit++;
        if (hit) s.set(x, y, Math.round((hit / 16) * 255));
      }
    }
    return s;
  }

  /**
   * Area enclosed by a closed polygon (even-odd rule). Each pixel row is sampled 4 times; horizontal coverage
   * is exact, so edges are anti-aliased.
   */
  static polygon(width: number, height: number, pts: { x: number; y: number }[]): Selection {
    const s = new Selection(width, height);
    if (pts.length < 3) return s;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const SUB = 4;
    const rowCov = new Float32Array(width);
    for (let y = Math.max(0, Math.floor(minY)); y < Math.min(height, Math.ceil(maxY)); y++) {
      rowCov.fill(0);
      let any = false;
      for (let k = 0; k < SUB; k++) {
        const sy = y + (k + 0.5) / SUB;
        const xs: number[] = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[j]!;
          const b = pts[i]!;
          if (a.y > sy !== b.y > sy) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const x0 = Math.max(0, xs[i]!);
          const x1 = Math.min(width, xs[i + 1]!);
          if (x1 <= x0) continue;
          any = true;
          for (let x = Math.floor(x0); x < Math.ceil(x1); x++) rowCov[x]! += (Math.min(x + 1, x1) - Math.max(x, x0)) / SUB;
        }
      }
      if (!any) continue;
      for (let x = 0; x < width; x++) {
        const c = rowCov[x]!;
        if (c > 0.001) s.set(x, y, Math.min(255, Math.round(c * 255)));
      }
    }
    return s;
  }

  /** The area swept by a round pen of the given radius along a path (a single point gives a disc). */
  static stroke(width: number, height: number, pts: { x: number; y: number }[], radius: number): Selection {
    const s = new Selection(width, height);
    if (!pts.length) return s;
    const r = Math.max(0.5, radius);
    for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
      const a = pts[i]!;
      const b = pts[Math.min(i + 1, pts.length - 1)]!;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r - 1));
      const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + r + 1));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r - 1));
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + r + 1));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const t = len2 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
          const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
          const cov = Math.round(Math.min(1, Math.max(0, r + 0.5 - d)) * 255);
          if (cov > s.at(x, y)) s.set(x, y, cov);
        }
      }
    }
    return s;
  }

  clone(): Selection {
    const c = new Selection(this.width, this.height);
    c.outside = this.outside;
    for (const [k, t] of this.tiles) c.tiles.set(k, t.slice());
    return c;
  }

  // ---- reading and writing ------------------------------------------------------------------

  private key(tx: number, ty: number): number {
    return ty * this.tilesX + tx;
  }

  tile(tx: number, ty: number): Uint8Array | 0 | 255 {
    return this.tiles.get(this.key(tx, ty)) ?? this.outside;
  }

  /** Coverage 0..255 at a pixel. */
  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const t = this.tiles.get(this.key(Math.floor(x / TILE), Math.floor(y / TILE)));
    return t ? t[(y % TILE) * TILE + (x % TILE)]! : this.outside;
  }

  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const k = this.key(tx, ty);
    let t = this.tiles.get(k);
    if (!t) {
      if (v === this.outside) return;
      t = new Uint8Array(T2).fill(this.outside);
      this.tiles.set(k, t);
    }
    t[(y % TILE) * TILE + (x % TILE)] = v;
  }

  /** Store a whole tile of coverage values (a copy is kept). */
  putTile(tx: number, ty: number, data: Uint8Array): void {
    this.tiles.set(this.key(tx, ty), data.slice());
  }

  /** Store a tile of coverage values without copying it: the caller hands it over and does not touch it again. */
  adoptTile(tx: number, ty: number, data: Uint8Array): void {
    this.tiles.set(this.key(tx, ty), data);
  }

  /** Tiles that hold their own pixels (the rest are all `outside`). */
  *entries(): IterableIterator<[number, number, Uint8Array]> {
    for (const [k, t] of this.tiles) yield [k % this.tilesX, Math.floor(k / this.tilesX), t];
  }

  /** Drop tiles whose pixels all equal `outside`. */
  prune(): void {
    for (const [k, t] of this.tiles) {
      const v = this.outside;
      let same = true;
      for (let i = 0; i < T2; i++) {
        if (t[i] !== v) {
          same = false;
          break;
        }
      }
      if (same) this.tiles.delete(k);
    }
  }

  /** Nothing selected at all. */
  get isEmpty(): boolean {
    if (this.outside === 255) return false;
    for (const t of this.tiles.values()) for (let i = 0; i < T2; i++) if (t[i]) return false;
    return true;
  }

  /** Smallest rectangle holding every selected pixel (the whole page when `outside` is selected). */
  bounds(): Rect | null {
    if (this.outside === 255) return { x: 0, y: 0, w: this.width, h: this.height };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [tx, ty, t] of this.entries()) {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if (!t[y * TILE + x]) continue;
          const px = tx * TILE + x;
          const py = ty * TILE + y;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
    }
    return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---- editing ---------------------------------------------------------------------------------

  invert(): void {
    this.outside = (255 - this.outside) as 0 | 255;
    for (const t of this.tiles.values()) for (let i = 0; i < T2; i++) t[i] = 255 - t[i]!;
  }

  /** Combine with another selection of the same page; `this` is changed. */
  combine(other: Selection, mode: CombineMode): void {
    if (mode === 'replace') {
      this.outside = other.outside;
      this.tiles.clear();
      for (const [k, t] of other.tiles) this.tiles.set(k, t.slice());
      return;
    }
    const op = (a: number, b: number): number =>
      mode === 'add' ? Math.max(a, b) : mode === 'subtract' ? Math.round((a * (255 - b)) / 255) : Math.min(a, b);
    const keys = new Set([...this.tiles.keys(), ...other.tiles.keys()]);
    const nextOutside = op(this.outside, other.outside) as 0 | 255;
    for (const k of keys) {
      const a = this.tiles.get(k);
      const b = other.tiles.get(k);
      const out = new Uint8Array(T2);
      for (let i = 0; i < T2; i++) out[i] = op(a ? a[i]! : this.outside, b ? b[i]! : other.outside);
      this.tiles.set(k, out);
    }
    this.outside = nextOutside;
    this.prune();
  }

  /**
   * Grow (r > 0) or shrink (r < 0) the selection by r pixels with a circular structuring element. The radius rounds half away from zero and any non-zero request moves the edge at least one pixel.
   */
  grow(r: number): void {
    if (!(Math.abs(r) > 1e-8)) return;
    const n = Math.max(1, Math.round(Math.abs(r)));
    this.morph(n, r > 0 ? 'max' : 'min');
  }

  /** Soften the edge: a box blur of radius r applied three times (close to a Gaussian). */
  feather(r: number): void {
    const n = Math.round(r);
    if (n < 1) return;
    this.morph(n, 'blur');
  }

  /**
   * Anti-alias a hard edge: one 3×3 box pass, so a stair-stepped boundary fades over about two pixels and the area it
   * encloses stays the same (the edge moves neither in nor out). Soft edges that were already smooth only blur a little.
   */
  smooth(): void {
    this.morph(1, 'smooth');
  }

  private morph(n: number, kind: 'max' | 'min' | 'blur' | 'smooth'): void {
    if ((kind === 'max' || kind === 'min') && n <= TILE) {
      this.morphTiles(n, kind);
      return;
    }
    // Work on a dense buffer of the area that can change: every stored tile plus a margin of n pixels.
    let tx0 = Infinity;
    let ty0 = Infinity;
    let tx1 = -Infinity;
    let ty1 = -Infinity;
    for (const [tx, ty] of this.entries()) {
      tx0 = Math.min(tx0, tx);
      ty0 = Math.min(ty0, ty);
      tx1 = Math.max(tx1, tx);
      ty1 = Math.max(ty1, ty);
    }
    if (tx1 < tx0) return; // uniform selection: nothing to grow, shrink or blur
    const x0 = Math.max(0, tx0 * TILE - n);
    const y0 = Math.max(0, ty0 * TILE - n);
    const x1 = Math.min(this.width, (tx1 + 1) * TILE + n);
    const y1 = Math.min(this.height, (ty1 + 1) * TILE + n);
    const w = x1 - x0;
    const h = y1 - y0;
    let buf = this.readDense(x0, y0, w, h);
    // Outside the buffer the selection is constant: it is the edge value for min/max/blur.
    const edge = this.outside;
    if (kind === 'blur' || kind === 'smooth') {
      const passes = kind === 'blur' ? 3 : 1;
      const repeatEnds = kind === 'smooth'; // an area that reaches the page border keeps its border pixels whole
      for (let p = 0; p < passes; p++) buf = boxBlur1d(buf, w, h, n, edge, true, repeatEnds);
      for (let p = 0; p < passes; p++) buf = boxBlur1d(buf, w, h, n, edge, false, repeatEnds);
    } else buf = circularExtreme(buf, w, h, n, kind, edge);
    this.writeDense(x0, y0, w, h, buf);
    this.prune();
  }

  /**
   * Grow or shrink one tile at a time, each with the n pixels around it. A tile whose neighbours (all eight) hold the
   * same single value cannot change, so only tiles near an edge of the selection are worked on.
   */
  private morphTiles(n: number, kind: 'max' | 'min'): void {
    const edge = this.outside;
    const tilesX = Math.ceil(this.width / TILE);
    const tilesY = Math.ceil(this.height / TILE);
    let tx0 = Infinity;
    let ty0 = Infinity;
    let tx1 = -Infinity;
    let ty1 = -Infinity;
    for (const [tx, ty] of this.entries()) {
      tx0 = Math.min(tx0, tx);
      ty0 = Math.min(ty0, ty);
      tx1 = Math.max(tx1, tx);
      ty1 = Math.max(ty1, ty);
    }
    if (tx1 < tx0) return; // uniform selection: nothing to grow or shrink
    const known = new Map<number, number>();
    const uniformOf = (tx: number, ty: number): number => {
      if (tx < 0 || ty < 0 || tx >= tilesX || ty >= tilesY) return edge; // past the page edge the selection is `outside`
      const k = this.key(tx, ty);
      let v = known.get(k);
      if (v === undefined) {
        const t = this.tiles.get(k);
        v = t ? uniformCoverage(t, Math.min(TILE, this.width - tx * TILE), Math.min(TILE, this.height - ty * TILE)) : edge;
        known.set(k, v);
      }
      return v;
    };
    const changed = new Map<number, Uint8Array>();
    for (let ty = Math.max(0, ty0 - 1); ty <= Math.min(tilesY - 1, ty1 + 1); ty++) {
      for (let tx = Math.max(0, tx0 - 1); tx <= Math.min(tilesX - 1, tx1 + 1); tx++) {
        const v = uniformOf(tx, ty);
        if (v >= 0) {
          let flat = true;
          for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1; dx++) if (uniformOf(tx + dx, ty + dy) !== v) flat = false;
          if (flat) continue;
        }
        const bx0 = Math.max(0, tx * TILE - n);
        const by0 = Math.max(0, ty * TILE - n);
        const bw = Math.min(this.width, (tx + 1) * TILE + n) - bx0;
        const bh = Math.min(this.height, (ty + 1) * TILE + n) - by0;
        const buf = circularExtreme(this.readDense(bx0, by0, bw, bh), bw, bh, n, kind, edge);
        const out = new Uint8Array(T2).fill(edge);
        const w = Math.min(TILE, this.width - tx * TILE);
        const h = Math.min(TILE, this.height - ty * TILE);
        for (let y = 0; y < h; y++) {
          const at = (ty * TILE + y - by0) * bw + (tx * TILE - bx0);
          out.set(buf.subarray(at, at + w), y << TILE_SHIFT);
        }
        changed.set(this.key(tx, ty), out);
      }
    }
    for (const [k, t] of changed) this.tiles.set(k, t);
    this.prune();
  }

  /** The coverage of a w×h part of the page as one dense buffer, copied tile row by tile row. */
  private readDense(x0: number, y0: number, w: number, h: number): Uint8Array {
    const buf = new Uint8Array(w * h);
    for (let ty = Math.floor(y0 / TILE); ty * TILE < y0 + h; ty++) {
      for (let tx = Math.floor(x0 / TILE); tx * TILE < x0 + w; tx++) {
        const t = this.tile(tx, ty);
        const ax = Math.max(x0, tx * TILE);
        const bx = Math.min(x0 + w, (tx + 1) * TILE);
        for (let y = Math.max(y0, ty * TILE); y < Math.min(y0 + h, (ty + 1) * TILE); y++) {
          const at = (y - y0) * w + (ax - x0);
          if (typeof t === 'number') buf.fill(t, at, at + (bx - ax));
          else buf.set(t.subarray((y - ty * TILE) * TILE + (ax - tx * TILE), (y - ty * TILE) * TILE + (bx - tx * TILE)), at);
        }
      }
    }
    return buf;
  }

  /** Write a dense buffer back over the part of the page it was read from (tiles that end up all `outside` are pruned by the caller). */
  private writeDense(x0: number, y0: number, w: number, h: number, buf: Uint8Array): void {
    for (let ty = Math.floor(y0 / TILE); ty * TILE < y0 + h; ty++) {
      for (let tx = Math.floor(x0 / TILE); tx * TILE < x0 + w; tx++) {
        const k = this.key(tx, ty);
        let t = this.tiles.get(k);
        if (!t) {
          t = new Uint8Array(T2).fill(this.outside);
          this.tiles.set(k, t);
        }
        const ax = Math.max(x0, tx * TILE);
        const bx = Math.min(x0 + w, (tx + 1) * TILE);
        for (let y = Math.max(y0, ty * TILE); y < Math.min(y0 + h, (ty + 1) * TILE); y++) {
          const at = (y - y0) * w + (ax - x0);
          t.set(buf.subarray(at, at + (bx - ax)), (y - ty * TILE) * TILE + (ax - tx * TILE));
        }
      }
    }
  }
}

/** One separable box-blur pass along rows (horizontal) or columns. */
function boxBlur1d(src: Uint8Array, w: number, h: number, n: number, edge: number, horizontal: boolean, repeatEnds = false): Uint8Array {
  const out = new Uint8Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  // Past the ends the value is `edge`, or (repeatEnds) the end pixel itself: the page border is then no boundary.
  const at = (line: number, i: number): number => (horizontal ? src[line * w + i]! : src[i * w + line]!);
  const get = (line: number, i: number): number => (i >= 0 && i < len ? at(line, i) : repeatEnds ? at(line, i < 0 ? 0 : len - 1) : edge);
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let i = -n; i <= n; i++) sum += get(line, i);
    const size = 2 * n + 1;
    for (let i = 0; i < len; i++) {
      const v = Math.round(sum / size);
      if (horizontal) out[line * w + i] = v;
      else out[i * w + line] = v;
      sum += get(line, i + n + 1) - get(line, i - n);
    }
  }
  return out;
}

/**
 * Maximum ('max') or minimum ('min') of every pixel's disc neighbourhood of radius n. The disc is a table of per-row
 * half-widths; the horizontal window grows one pixel per step, so the whole filter costs O(w * h * n).
 */
function circularExtreme(src: Uint8Array, w: number, h: number, n: number, kind: 'max' | 'min', edge: number): Uint8Array {
  const isMax = kind === 'max';
  const best = (a: number, b: number): number => (isMax ? (a > b ? a : b) : a < b ? a : b);
  const half: number[] = [];
  for (let dy = 0; dy <= n; dy++) half.push(Math.round(Math.sqrt(n * n - dy * dy)));
  const out = new Uint8Array(src.length).fill(isMax ? 0 : 255);
  const win = Uint8Array.from(src); // horizontal extreme over a window of half-width k
  for (let k = 0; k <= n; k++) {
    if (k > 0) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const a = x - k >= 0 ? src[row + x - k]! : edge;
          const b = x + k < w ? src[row + x + k]! : edge;
          win[row + x] = best(win[row + x]!, best(a, b));
        }
      }
    }
    for (let dy = 0; dy <= n; dy++) {
      if (half[dy] !== k) continue;
      for (const d of dy === 0 ? [0] : [dy, -dy]) {
        for (let y = 0; y < h; y++) {
          const yy = y + d;
          const row = y * w;
          if (yy < 0 || yy >= h) {
            for (let x = 0; x < w; x++) out[row + x] = best(out[row + x]!, edge);
          } else {
            const src2 = yy * w;
            for (let x = 0; x < w; x++) out[row + x] = best(out[row + x]!, win[src2 + x]!);
          }
        }
      }
    }
  }
  return out;
}

// ---- magic wand ---------------------------------------------------------------------------------

/**
 * The picture a selection tool looks at, handed out one page tile at a time so a tool only pays for the part it reaches
 * (flattening a whole blank page to find one closed area cost over a second).
 */
export interface LookPicture {
  readonly width: number;
  readonly height: number;
  /** Straight RGBA of page tile (tx, ty), TILE pixels wide (pixels past the page edge are not read); null when it is all transparent. */
  tile(tx: number, ty: number): ArrayLike<number> | null;
}

/** Straight RGBA of one pixel; the simple way to describe a picture, for small pictures and tests. */
export type LookPixel = (x: number, y: number) => [number, number, number, number];

const TILE_SHIFT = 31 - Math.clz32(TILE);
const TILE_MASK = TILE - 1;

/**
 * Whether every pixel of the w×h part of a tile that lies on the page holds the same four bytes (so a tool can decide
 * once for the whole tile). Only for 4-byte aligned tiles; anything else is simply "not known to be uniform".
 */
function uniformPixels(t: ArrayLike<number>, w: number, h: number): boolean {
  if (!(t instanceof Uint8ClampedArray || t instanceof Uint8Array) || (t.byteOffset & 3) !== 0 || t.length < T2 * 4) return false;
  const u = new Uint32Array(t.buffer, t.byteOffset, T2);
  const first = u[0]!;
  for (let y = 0; y < h; y++) {
    const row = y << TILE_SHIFT;
    for (let x = 0; x < w; x++) if (u[row + x] !== first) return false;
  }
  return true;
}

/** The one value a coverage tile has on the part of it that lies on the page, or -1 when it varies. */
function uniformCoverage(t: Uint8Array, w: number, h: number): number {
  const first = t[0]!;
  for (let y = 0; y < h; y++) {
    const row = y << TILE_SHIFT;
    for (let x = 0; x < w; x++) if (t[row + x] !== first) return -1;
  }
  return first;
}

/** A picture given as a pixel function, cut into tiles when asked for (nothing is built until a tool reads that tile). */
function pictureOf(width: number, height: number, pixel: LookPixel | LookPicture): LookPicture {
  if (typeof pixel !== 'function') return pixel;
  return {
    width,
    height,
    tile(tx, ty) {
      const out = new Uint8ClampedArray(T2 * 4);
      for (let y = 0; y < TILE && ty * TILE + y < height; y++) {
        for (let x = 0; x < TILE && tx * TILE + x < width; x++) out.set(pixel(tx * TILE + x, ty * TILE + y), (y * TILE + x) * 4);
      }
      return out;
    },
  };
}

/** The picture read pixel by pixel, for tools that visit every pixel anyway; tiles are fetched once each. */
export function lookPixels(look: LookPicture): LookPixel {
  const reader = new TileReader(look);
  return (x, y) => {
    const t = reader.tile(x >> TILE_SHIFT, y >> TILE_SHIFT);
    if (!t) return [0, 0, 0, 0];
    const i = (((y & TILE_MASK) << TILE_SHIFT) + (x & TILE_MASK)) * 4;
    return [t[i]!, t[i + 1]!, t[i + 2]!, t[i + 3]!];
  };
}

/** Keeps the tiles of a picture that were already asked for. */
class TileReader {
  private readonly cache: (ArrayLike<number> | null | undefined)[];
  private readonly tilesX: number;
  constructor(private readonly look: LookPicture) {
    this.tilesX = Math.ceil(look.width / TILE);
    this.cache = new Array(this.tilesX * Math.ceil(look.height / TILE));
  }
  tile(tx: number, ty: number): ArrayLike<number> | null {
    const k = ty * this.tilesX + tx;
    let t = this.cache[k];
    if (t === undefined) {
      t = this.look.tile(tx, ty);
      this.cache[k] = t;
    }
    return t;
  }
}

export interface WandOptions {
  /** Only pixels inside this selection can belong to the area, and the search never wanders outside it. */
  within?: Selection | null;
  /** 0..255: how different (largest channel difference, alpha included) a pixel may be from the one clicked. */
  tolerance: number;
  /** Only the connected area (true), or every similar pixel of the page (false). */
  contiguous: boolean;
  /**
   * Gaps in the surrounding line work up to this many pixels wide do not let the area leak out (contiguous mode
   * only, and only on pages small enough to work on as one dense buffer).
   */
  gap?: number;
}

/** Pages up to this many pixels can be worked on as one dense buffer (closing gaps, enclosing). */
export const DENSE_LIMIT = 16_000_000;

/**
 * Select the pixels that look like the one at (x, y). `look` is the picture to look at (one layer or the whole page).
 * Contiguous mode uses a scan-line flood fill, so it does not need recursion; the picture and the result are read and
 * written as tiles, with no allocation per pixel.
 */
export function wandSelect(width: number, height: number, look: LookPixel | LookPicture, x: number, y: number, opts: WandOptions): Selection {
  const sel = new Selection(width, height);
  if (x < 0 || y < 0 || x >= width || y >= height) return sel;
  const limit = opts.within;
  if (limit && limit.at(x, y) < 128) return sel;
  const reader = new TileReader(pictureOf(width, height, look));
  const tol = opts.tolerance;
  const seedTile = reader.tile(x >> TILE_SHIFT, y >> TILE_SHIFT);
  const si = seedTile ? (((y & TILE_MASK) << TILE_SHIFT) + (x & TILE_MASK)) * 4 : 0;
  const sr = seedTile ? seedTile[si]! : 0;
  const sg = seedTile ? seedTile[si + 1]! : 0;
  const sb = seedTile ? seedTile[si + 2]! : 0;
  const sa = seedTile ? seedTile[si + 3]! : 0;
  // Pixels whose alpha is within the tolerance of zero all look alike whatever their colour channels hold
  // (the seed and the pixel count as the same colour when both are that transparent).
  const seedClear = sa <= tol;

  if (width * height <= DENSE_LIMIT) {
    // Which pixels look like the seed, worked out tile by tile with plain typed-array loops (no call per pixel).
    const tilesX = Math.ceil(width / TILE);
    const similar = new Uint8Array(width * height);
    const worked = new Uint8Array(tilesX * Math.ceil(height / TILE));
    const classify = (tx: number, ty: number): void => {
      worked[ty * tilesX + tx] = 1;
      const lt = limit ? limit.tile(tx, ty) : 255;
      if (lt === 0) return;
      const t = reader.tile(tx, ty);
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const w = Math.min(TILE, width - x0);
      const h = Math.min(TILE, height - y0);
      if (!t && !seedClear) return;
      if (t && lt === 255 && uniformPixels(t, w, h)) {
        // One colour all over the tile: it either all looks like the seed or none of it does.
        const a = t[3]!;
        if ((seedClear && a <= tol) || (Math.abs(a - sa) <= tol && Math.abs(t[0]! - sr) <= tol && Math.abs(t[1]! - sg) <= tol && Math.abs(t[2]! - sb) <= tol)) {
          for (let yy = 0; yy < h; yy++) similar.fill(1, (y0 + yy) * width + x0, (y0 + yy) * width + x0 + w);
        }
        return;
      }
      for (let yy = 0; yy < h; yy++) {
        const o = (y0 + yy) * width + x0;
        const row = yy << TILE_SHIFT;
        for (let xx = 0; xx < w; xx++) {
          if (lt !== 255 && lt[row + xx]! < 128) continue;
          if (!t) {
            similar[o + xx] = 1;
            continue;
          }
          const i = (row + xx) * 4;
          const a = t[i + 3]!;
          if (seedClear && a <= tol) similar[o + xx] = 1;
          else if (Math.abs(a - sa) <= tol && Math.abs(t[i]! - sr) <= tol && Math.abs(t[i + 1]! - sg) <= tol && Math.abs(t[i + 2]! - sb) <= tol) similar[o + xx] = 1;
        }
      }
    };
    // A flood fill only needs the tiles it reaches, and reading a tile of the picture can be expensive (the whole-page
    // picture is composed from every layer on the CPU), so there the tiles are worked out as the flood arrives at them.
    // Everything else needs the whole page.
    if (opts.contiguous && !((opts.gap ?? 0) > 0)) {
      floodDense(similar, width, height, x, y, worked, tilesX, classify);
      return selectionFromMask(width, height, similar, 2, worked);
    }
    for (let ty = 0; ty * TILE < height; ty++) for (let tx = 0; tx * TILE < width; tx++) classify(tx, ty);
    if (!opts.contiguous) return selectionFromMask(width, height, similar, 1);
    return wandClosingGaps(width, height, similar, x, y, Math.round(opts.gap!));
  }

  // Pages too big for a page-sized buffer: look at one pixel at a time and keep the result as sparse tiles.
  const near = (xx: number, yy: number): boolean => {
    if (limit) {
      const lt = limit.tile(xx >> TILE_SHIFT, yy >> TILE_SHIFT);
      if (lt === 0 || (lt !== 255 && lt[((yy & TILE_MASK) << TILE_SHIFT) + (xx & TILE_MASK)]! < 128)) return false;
    }
    const t = reader.tile(xx >> TILE_SHIFT, yy >> TILE_SHIFT);
    if (!t) return seedClear;
    const i = (((yy & TILE_MASK) << TILE_SHIFT) + (xx & TILE_MASK)) * 4;
    const a = t[i + 3]!;
    if (seedClear && a <= tol) return true;
    return Math.abs(a - sa) <= tol && Math.abs(t[i]! - sr) <= tol && Math.abs(t[i + 1]! - sg) <= tol && Math.abs(t[i + 2]! - sb) <= tol;
  };
  if (!opts.contiguous) {
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) if (near(xx, yy)) sel.set(xx, yy, 255);
    return sel;
  }
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop()!;
    const sx = stack.pop()!;
    if (sel.at(sx, sy) || !near(sx, sy)) continue;
    let l = sx;
    let r = sx;
    while (l > 0 && !sel.at(l - 1, sy) && near(l - 1, sy)) l--;
    while (r < width - 1 && !sel.at(r + 1, sy) && near(r + 1, sy)) r++;
    for (let xx = l; xx <= r; xx++) sel.set(xx, sy, 255);
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= height) continue;
      let inRun = false;
      for (let xx = l; xx <= r; xx++) {
        const ok = !sel.at(xx, ny) && near(xx, ny);
        if (ok && !inRun) stack.push(xx, ny);
        inRun = ok;
      }
    }
  }
  return sel;
}

/**
 * Scan-line flood fill over a dense mask: from (x, y), pixels marked 1 that connect to it are marked 2.
 * (4-connected, like the sparse version.)
 */
function floodDense(mask: Uint8Array, width: number, height: number, x: number, y: number, worked: Uint8Array, tilesX: number, classify: (tx: number, ty: number) => void): void {
  /** The mask at (px, py), once the tile it belongs to has been worked out. */
  const at = (px: number, py: number): number => {
    const tx = px >> TILE_SHIFT;
    const ty = py >> TILE_SHIFT;
    if (!worked[ty * tilesX + tx]) classify(tx, ty);
    return mask[py * width + px]!;
  };
  if (at(x, y) !== 1) return;
  const stack: number[] = [y * width + x];
  while (stack.length) {
    const i = stack.pop()!;
    const sy = Math.floor(i / width);
    const row = sy * width;
    if (at(i - row, sy) !== 1) continue;
    let l = i - row;
    let r = l;
    while (l > 0 && at(l - 1, sy) === 1) l--;
    while (r < width - 1 && at(r + 1, sy) === 1) r++;
    mask.fill(2, row + l, row + r + 1);
    for (let ny = sy - 1; ny <= sy + 1; ny += 2) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let inRun = false;
      for (let xx = l; xx <= r; xx++) {
        const ok = at(xx, ny) === 1;
        if (ok && !inRun) stack.push(nrow + xx);
        inRun = ok;
      }
    }
  }
}

/**
 * A selection from a dense mask: pixels equal to `on` are selected fully. Tiles are filled straight from the mask rows.
 * With `only`, the tiles it does not mark were never worked out (nothing in them can be selected) and are skipped.
 */
function selectionFromMask(width: number, height: number, mask: Uint8Array, on: number, only?: Uint8Array): Selection {
  const sel = new Selection(width, height);
  const scratch = new Uint8Array(T2);
  const tilesX = Math.ceil(width / TILE);
  for (let ty = 0; ty * TILE < height; ty++) {
    for (let tx = 0; tx * TILE < width; tx++) {
      if (only && !only[ty * tilesX + tx]) continue;
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const w = Math.min(TILE, width - x0);
      const h = Math.min(TILE, height - y0);
      if (w < TILE || h < TILE) scratch.fill(0); // the part past the page edge must not keep the previous tile's values
      let any = 0;
      for (let yy = 0; yy < h; yy++) {
        const o = (y0 + yy) * width + x0;
        const row = yy << TILE_SHIFT;
        for (let xx = 0; xx < w; xx++) {
          const v = mask[o + xx] === on ? 255 : 0;
          scratch[row + xx] = v;
          any |= v;
        }
      }
      if (any) sel.adoptTile(tx, ty, scratch.slice());
    }
  }
  return sel;
}

/**
 * Select every pixel of the picture whose colour is within `tolerance` (largest channel difference, 0..255) of
 * `target`, wherever it is on the page. Pixels that are mostly transparent count as not there; partly
 * transparent ones are selected in proportion to how opaque they are.
 */
export function selectColorRange(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
  target: readonly [number, number, number],
  tolerance: number,
): Selection {
  const sel = new Selection(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      if (p[3] < 8) continue;
      if (Math.max(Math.abs(p[0] - target[0]), Math.abs(p[1] - target[1]), Math.abs(p[2] - target[2])) <= tolerance) sel.set(x, y, p[3]);
    }
  }
  return sel;
}

/** A selection from a dense mask (nonzero = selected). */
export function selectionFromDense(width: number, height: number, mask: Uint8Array): Selection {
  const sel = new Selection(width, height);
  const tilesX = Math.ceil(width / TILE);
  const tilesY = Math.ceil(height / TILE);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let tile: Uint8Array | null = null;
      for (let y = 0; y < TILE; y++) {
        const py = ty * TILE + y;
        if (py >= height) break;
        for (let x = 0; x < TILE; x++) {
          const px = tx * TILE + x;
          if (px >= width) break;
          const v = mask[py * width + px]!;
          if (!v) continue;
          tile ??= new Uint8Array(T2);
          tile[y * TILE + x] = v;
        }
      }
      if (tile) sel.putTile(tx, ty, tile);
    }
  }
  return sel;
}

/** Grow a dense 0/1 mask by r pixels in every direction (a square window, done as two running sums). */
function dilateDense(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const run = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    run[0] = 0;
    for (let x = 0; x < w; x++) run[x + 1] = run[x]! + mask[y * w + x]!;
    for (let x = 0; x < w; x++) tmp[y * w + x] = run[Math.min(w, x + r + 1)]! - run[Math.max(0, x - r)]! > 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    run[0] = 0;
    for (let y = 0; y < h; y++) run[y + 1] = run[y]! + tmp[y * w + x]!;
    for (let y = 0; y < h; y++) out[y * w + x] = run[Math.min(h, y + r + 1)]! - run[Math.max(0, y - r)]! > 0 ? 1 : 0;
  }
  return out;
}

/**
 * Flood fill from (x, y) that treats gaps up to about `gap` pixels wide in the line work as closed: the fill may
 * not come within `gap` pixels of a line, then the result is grown by the same amount back up to the lines.
 */
function wandClosingGaps(width: number, height: number, similar: Uint8Array, x: number, y: number, gap: number): Selection {
  const n = width * height;
  const line = new Uint8Array(n);
  for (let i = 0; i < n; i++) line[i] = similar[i] === 1 ? 0 : 1;
  const barrier = dilateDense(line, width, height, gap);
  const seed = y * width + x;
  const open = (i: number): boolean => i === seed || (similar[i] === 1 && barrier[i] === 0);
  const region = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [seed];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !open(i)) continue;
    const sy = Math.floor(i / width);
    const sx = i - sy * width;
    let l = sx;
    let r = sx;
    while (l > 0 && !seen[sy * width + l - 1] && open(sy * width + l - 1)) l--;
    while (r < width - 1 && !seen[sy * width + r + 1] && open(sy * width + r + 1)) r++;
    for (let xx = l; xx <= r; xx++) {
      seen[sy * width + xx] = 1;
      region[sy * width + xx] = 1;
    }
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= height) continue;
      let inRun = false;
      for (let xx = l; xx <= r; xx++) {
        const j = ny * width + xx;
        const ok = !seen[j] && open(j);
        if (ok && !inRun) stack.push(j);
        inRun = ok;
      }
    }
  }
  // Grow back up to the lines (only over pixels that look like the area).
  const grown = dilateDense(region, width, height, gap);
  const result = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (grown[i] && similar[i]) result[i] = 255;
  return selectionFromDense(width, height, result);
}

/**
 * "Enclose and fill": the area inside a rough loop, up to the line work. The colour most of the inside has
 * (the lines are the rarer colours) defines the area; everything inside the loop that looks like it is
 * selected, however it is shaped.
 */
export function encloseArea(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
  loop: { x: number; y: number }[],
  tolerance: number,
): Selection {
  if (loop.length < 3) return new Selection(width, height);
  const inside = Selection.polygon(width, height, loop);
  const b = inside.bounds();
  if (!b) return new Selection(width, height);
  const counts = new Map<number, { n: number; c: [number, number, number, number] }>();
  const step = Math.max(1, Math.floor(Math.sqrt((b.w * b.h) / 4000)));
  for (let yy = b.y; yy < b.y + b.h; yy += step) {
    for (let xx = b.x; xx < b.x + b.w; xx += step) {
      if (inside.at(xx, yy) < 128) continue;
      const c = pixel(xx, yy);
      const key = c[3] < 16 ? -1 : (c[0] >> 4) * 4096 + (c[1] >> 4) * 256 + (c[2] >> 4) * 16 + (c[3] >> 4);
      const e = counts.get(key);
      if (e) e.n++;
      else counts.set(key, { n: 1, c });
    }
  }
  let best: { n: number; c: [number, number, number, number] } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  if (!best) return new Selection(width, height);
  const seed = best.c;
  const out = new Selection(width, height);
  for (let yy = b.y; yy < b.y + b.h; yy++) {
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      const cov = inside.at(xx, yy);
      if (!cov) continue;
      const p = pixel(xx, yy);
      const same =
        seed[3] < 16
          ? p[3] <= Math.max(16, tolerance)
          : Math.max(Math.abs(p[0] - seed[0]), Math.abs(p[1] - seed[1]), Math.abs(p[2] - seed[2]), Math.abs(p[3] - seed[3])) <= tolerance;
      if (same) out.set(xx, yy, cov);
    }
  }
  return out;
}

// ---- applying a selection to pixels ------------------------------------------------------------------

type PixelFn = (tile: Tile, o: number, cov: number) => void;

/**
 * Run `fn` on every pixel of the layer under the selection and describe the change as a patch for the history.
 * Tiles with no pixels are skipped unless `create` (filling can paint on empty tiles).
 * `solid` (a pixel packed as the tile stores it) is what `fn` would give a fully covered pixel: those are then written
 * directly instead of going through `fn`, which is much cheaper on a large area.
 */
function applyToSurface(surface: TiledSurface, layerId: number, sel: Selection, fn: PixelFn, create: boolean, solid?: number): StrokePatch | null {
  const keys: [number, number][] = [];
  if (create) {
    const b = sel.bounds();
    if (!b) return null;
    for (let ty = Math.floor(b.y / TILE); ty <= Math.floor((b.y + b.h - 1) / TILE); ty++)
      for (let tx = Math.floor(b.x / TILE); tx <= Math.floor((b.x + b.w - 1) / TILE); tx++) keys.push([tx, ty]);
  } else {
    for (const [tx, ty] of surface.entries()) keys.push([tx, ty]);
  }
  const tiles: StrokePatch['tiles'] = [];
  let bytes = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [tx, ty] of keys) {
    const cov = sel.tile(tx, ty);
    if (cov === 0) continue;
    const existing = surface.get(tx, ty);
    if (!existing && !create) continue;
    const before = existing ? existing.slice() : null;
    const tile = existing ?? surface.ensure(tx, ty);
    let changed = false;
    const u32 = solid !== undefined && (tile.byteOffset & 3) === 0 ? new Uint32Array(tile.buffer, tile.byteOffset, T2) : null;
    const w = Math.min(TILE, surface.width - tx * TILE);
    const h = Math.min(TILE, surface.height - ty * TILE);
    if (u32 && (cov === 255 || uniformCoverage(cov, w, h) === 255)) {
      // The whole tile is covered: each row only needs its first and last pixel that differ found, then one fill.
      for (let yy = 0; yy < h; yy++) {
        const row = yy << TILE_SHIFT;
        let a = 0;
        while (a < w && u32[row + a] === solid) a++;
        if (a === w) continue;
        let b = w - 1;
        while (u32[row + b] === solid) b--;
        u32.fill(solid!, row + a, row + b + 1);
        changed = true;
        const py = ty * TILE + yy;
        if (tx * TILE + a < x0) x0 = tx * TILE + a;
        if (tx * TILE + b > x1) x1 = tx * TILE + b;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    else for (let yy = 0; yy < h; yy++) {
      const py = ty * TILE + yy;
      for (let xx = 0; xx < w; xx++) {
        const i = (yy << TILE_SHIFT) + xx;
        const c = cov === 255 ? 255 : cov[i]!;
        if (!c) continue;
        if (u32 && c === 255) {
          if (u32[i] === solid) continue;
          u32[i] = solid!;
        } else {
          const o = i * 4;
          const was = tile[o]! + tile[o + 1]! * 256 + tile[o + 2]! * 65536 + tile[o + 3]! * 16777216;
          fn(tile, o, c);
          if (was === tile[o]! + tile[o + 1]! * 256 + tile[o + 2]! * 65536 + tile[o + 3]! * 16777216) continue;
        }
        const px = tx * TILE + xx;
        changed = true;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    if (!changed) {
      if (!before) surface.put(tx, ty, undefined);
      continue;
    }
    surface.dropIfEmpty(tx, ty);
    const after = surface.get(tx, ty);
    tiles.push({ tx, ty, before, after: after ? after.slice() : null });
    bytes += (before ? TILE_BYTES : 0) + (after ? TILE_BYTES : 0);
    surface.touch(tx, ty);
  }
  if (!tiles.length) return null;
  return { layerId, rect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, tiles, bytes };
}

/**
 * Change every pixel of a layer (inside the selection, if any) with `fn(tile, offset, coverage)` and describe the
 * change as a patch for the history. Tiles with no pixels are left alone.
 */
export function mapPixels(surface: TiledSurface, layerId: number, sel: Selection | null, fn: (tile: Tile, offset: number, coverage: number) => void): StrokePatch | null {
  return applyToSurface(surface, layerId, sel ?? Selection.all(surface.width, surface.height), fn, false);
}

/** Erase the selected pixels (partly selected pixels become partly transparent). */
export function eraseSelection(surface: TiledSurface, layerId: number, sel: Selection): StrokePatch | null {
  return applyToSurface(
    surface,
    layerId,
    sel,
    (t, o, c) => {
      t[o + 3] = (t[o + 3]! * (255 - c)) / 255;
    },
    false,
  );
}

/** Paint the selected pixels with a colour at the given opacity (0..1). */
export function fillSelection(
  surface: TiledSurface,
  layerId: number,
  sel: Selection,
  color: readonly [number, number, number],
  opacity = 1,
): StrokePatch | null {
  // A fully covered pixel at full opacity becomes the colour itself (packed with the tile's own rounding).
  const solid = opacity >= 1 ? new Uint32Array(new Uint8ClampedArray([color[0], color[1], color[2], 255]).buffer)[0] : undefined;
  return applyToSurface(
    surface,
    layerId,
    sel,
    (t, o, c) => {
      const ta = (c / 255) * opacity;
      const ba = t[o + 3]! / 255;
      const ra = ta + ba * (1 - ta);
      if (ra <= 0) return;
      const w = (1 - ta) * ba;
      t[o] = (ta * color[0] + w * t[o]!) / ra;
      t[o + 1] = (ta * color[1] + w * t[o + 1]!) / ra;
      t[o + 2] = (ta * color[2] + w * t[o + 2]!) / ra;
      t[o + 3] = ra * 255;
    },
    true,
    solid,
  );
}

/** Erase everything except the selection. */
export function eraseOutside(surface: TiledSurface, layerId: number, sel: Selection): StrokePatch | null {
  const inv = sel.clone();
  inv.invert();
  return eraseSelection(surface, layerId, inv);
}

/** The selection that covers whatever a layer has painted: the coverage of a pixel is its alpha. */
export function selectionFromAlpha(surface: TiledSurface): Selection {
  const sel = new Selection(surface.width, surface.height);
  for (const [tx, ty, t] of surface.entries()) {
    const cov = new Uint8Array(T2);
    let any = false;
    for (let i = 0; i < T2; i++) {
      const a = t[i * 4 + 3]!;
      cov[i] = a;
      if (a) any = true;
    }
    if (any) sel.putTile(tx, ty, cov);
  }
  return sel;
}
