/**
 * Working block size of the engine. The brush, the compositor, the GL renderer and the `.lienzo` file are all written
 * against it, so every surface a document creates uses it. `TiledSurface` itself does not depend on this number: its
 * block size is a property of each surface (see `blockSize`), because the format imposes no size.
 */
export const TILE = 256;
export const TILE_BYTES = TILE * TILE * 4;

/** Upper bound for a surface's block size: a block is allocated whole, so this keeps one allocation under 64 MB. */
export const MAX_BLOCK_SIZE = 4096;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Tile = Uint8ClampedArray; // blockSize × blockSize straight-alpha RGBA

/** One block visited by a regional access: its coordinates, its pixels (if it exists) and the part inside the region. */
export interface BlockRegion {
  tx: number;
  ty: number;
  /** The block's pixels, or undefined when nothing was ever painted on it. Read-only: use `put`/`writeRect` to change it. */
  tile: Tile | undefined;
  /** The overlap with the requested region, in surface coordinates, already clipped to the surface. */
  rect: Rect;
}

const transparent = (t: Tile): boolean => {
  for (let i = 3; i < t.length; i += 4) if (t[i] !== 0) return false;
  return true;
};

/** `r` clipped to a `width`×`height` surface, or null when nothing of it is inside. */
export function clipRect(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Sparse pixel storage: the image is cut into square blocks (256×256 by default) and a block only exists once
 * something is painted on it. A blank A3 page at 600 dpi costs nothing instead of 278 MB, and a stroke only touches
 * the blocks it crosses. Pixels are straight (non-premultiplied) RGBA, 8 bits per channel.
 *
 * This class is only the **durable pixels** of a layer (or of its mask/source). Two things are deliberately kept
 * outside it:
 *  - the temporary buffers of a stroke in progress (`Stroke` in `brush.ts`: a snapshot of each block it enters and its
 *    coverage mask), which only reach the surface through `put`/`ensure` and are discarded or turned into an undo
 *    patch when the stroke ends;
 *  - the render cache (GPU textures in `gl-renderer.ts`, flattened rows in `composite.ts`), which owns its own copy of
 *    the pixels and learns about changes through `takeDirty`, a list of block keys with no pixel data in it.
 *
 * Blocks are addressed by (tx, ty) in block units; `key` is the linear index `ty·tilesX + tx`.
 */
export class TiledSurface {
  readonly tilesX: number;
  readonly tilesY: number;
  /** Side of a block in pixels. */
  readonly blockSize: number;
  /** Bytes of one block's pixels. */
  readonly blockBytes: number;
  private readonly tiles = new Map<number, Tile>();
  private dirty = new Set<number>();

  constructor(
    readonly width: number,
    readonly height: number,
    blockSize: number = TILE,
  ) {
    if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > MAX_BLOCK_SIZE) {
      throw new RangeError(`Tamaño de bloque no válido: ${blockSize}`);
    }
    this.blockSize = blockSize;
    this.blockBytes = blockSize * blockSize * 4;
    this.tilesX = Math.ceil(width / blockSize);
    this.tilesY = Math.ceil(height / blockSize);
  }

  key(tx: number, ty: number): number {
    return ty * this.tilesX + tx;
  }

  tx(key: number): number {
    return key % this.tilesX;
  }

  ty(key: number): number {
    return Math.floor(key / this.tilesX);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  /** Bytes of pixel data held by the blocks that exist (blank areas cost nothing). */
  get pixelBytes(): number {
    return this.tiles.size * this.blockBytes;
  }

  get isEmpty(): boolean {
    return this.tiles.size === 0;
  }

  /** Whether (tx, ty) is a block of this surface's grid (it may still have no pixels). */
  inGrid(tx: number, ty: number): boolean {
    return Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < this.tilesX && ty < this.tilesY;
  }

  /** Pixel rectangle of block (tx, ty), clipped to the surface (edge blocks are smaller); null outside the grid. */
  blockRect(tx: number, ty: number): Rect | null {
    if (!this.inGrid(tx, ty)) return null;
    const s = this.blockSize;
    return clipRect({ x: tx * s, y: ty * s, w: s, h: s }, this.width, this.height);
  }

  /** Block coordinates overlapped by a pixel rectangle, clipped to the grid; null when it touches none. */
  blockRange(r: Rect): { tx0: number; ty0: number; tx1: number; ty1: number } | null {
    const c = clipRect(r, this.width, this.height);
    if (!c) return null;
    const s = this.blockSize;
    return { tx0: Math.floor(c.x / s), ty0: Math.floor(c.y / s), tx1: Math.floor((c.x + c.w - 1) / s), ty1: Math.floor((c.y + c.h - 1) / s) };
  }

  get(tx: number, ty: number): Tile | undefined {
    return this.tiles.get(ty * this.tilesX + tx);
  }

  getByKey(key: number): Tile | undefined {
    return this.tiles.get(key);
  }

  /** The tile at (tx, ty), created transparent if it did not exist. */
  ensure(tx: number, ty: number): Tile {
    const k = ty * this.tilesX + tx;
    let t = this.tiles.get(k);
    if (!t) {
      t = new Uint8ClampedArray(this.blockBytes);
      this.tiles.set(k, t);
      this.dirty.add(k);
    }
    return t;
  }

  /** Replace a tile (or remove it with undefined). A tile of the wrong size is refused: it would corrupt every read. */
  put(tx: number, ty: number, tile: Tile | undefined): void {
    if (tile && tile.length !== this.blockBytes) throw new RangeError(`Bloque de ${tile.length} bytes en una superficie de bloques de ${this.blockBytes}`);
    const k = ty * this.tilesX + tx;
    if (tile) this.tiles.set(k, tile);
    else this.tiles.delete(k);
    this.dirty.add(k);
  }

  /** Mark a tile as changed so renderers re-upload it. */
  touch(tx: number, ty: number): void {
    this.dirty.add(ty * this.tilesX + tx);
  }

  *entries(): IterableIterator<[number, number, Tile]> {
    for (const [k, t] of this.tiles) yield [k % this.tilesX, Math.floor(k / this.tilesX), t];
  }

  /** Keys changed since the last call (created, edited, replaced or removed). */
  takeDirty(): number[] {
    const out = [...this.dirty];
    this.dirty = new Set();
    return out;
  }

  markAllDirty(): void {
    for (const k of this.tiles.keys()) this.dirty.add(k);
  }

  clear(): void {
    for (const k of this.tiles.keys()) this.dirty.add(k);
    this.tiles.clear();
  }

  clone(): TiledSurface {
    const c = new TiledSurface(this.width, this.height, this.blockSize);
    for (const [k, t] of this.tiles) c.tiles.set(k, t.slice());
    c.markAllDirty();
    return c;
  }

  /** The same pixels cut into blocks of another size (a new surface; this one is left alone). */
  reblock(blockSize: number): TiledSurface {
    const out = new TiledSurface(this.width, this.height, blockSize);
    if (blockSize === this.blockSize) {
      for (const [k, t] of this.tiles) out.tiles.set(k, t.slice());
      out.markAllDirty();
      return out;
    }
    for (const [tx, ty] of this.entries()) {
      const r = this.blockRect(tx, ty);
      if (r) out.writeRect(r, this.readRect(r));
    }
    return out;
  }

  /** Alpha 0..255 at a pixel (0 outside the surface or on a missing tile). */
  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const s = this.blockSize;
    const t = this.tiles.get(Math.floor(y / s) * this.tilesX + Math.floor(x / s));
    return t ? t[((y % s) * s + (x % s)) * 4 + 3]! : 0;
  }

  /** RGBA of one pixel as [r, g, b, a]. */
  pixel(x: number, y: number): [number, number, number, number] {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const s = this.blockSize;
    const t = this.tiles.get(Math.floor(y / s) * this.tilesX + Math.floor(x / s));
    if (!t) return [0, 0, 0, 0];
    const i = ((y % s) * s + (x % s)) * 4;
    return [t[i]!, t[i + 1]!, t[i + 2]!, t[i + 3]!];
  }

  /**
   * The blocks overlapping `r`, each with the part of `r` inside it (clipped to the surface), row by row. Reading
   * through this never allocates a block; a block that was never painted comes with `tile: undefined`.
   */
  *regions(r: Rect): IterableIterator<BlockRegion> {
    const range = this.blockRange(r);
    const c = clipRect(r, this.width, this.height);
    if (!range || !c) return;
    const s = this.blockSize;
    for (let ty = range.ty0; ty <= range.ty1; ty++) {
      for (let tx = range.tx0; tx <= range.tx1; tx++) {
        const x0 = Math.max(c.x, tx * s);
        const y0 = Math.max(c.y, ty * s);
        const x1 = Math.min(c.x + c.w, (tx + 1) * s);
        const y1 = Math.min(c.y + c.h, (ty + 1) * s);
        yield { tx, ty, tile: this.get(tx, ty), rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
      }
    }
  }

  /** Dense RGBA copy of a rectangle (transparent where there are no tiles or outside the surface). */
  readRect(r: Rect): Uint8ClampedArray {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const s = this.blockSize;
    for (const { tx, ty, tile, rect } of this.regions(r)) {
      if (!tile) continue;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        const src = ((y - ty * s) * s + (rect.x - tx * s)) * 4;
        out.set(tile.subarray(src, src + rect.w * 4), ((y - r.y) * r.w + (rect.x - r.x)) * 4);
      }
    }
    return out;
  }

  /**
   * Copy dense RGBA into a rectangle. Tiles that would only receive fully
   * transparent pixels are not created, and existing tiles that end up fully
   * transparent are removed. Returns the part of the rectangle inside the surface (the area that changed), or null.
   */
  writeRect(r: Rect, data: ArrayLike<number>): Rect | null {
    const s = this.blockSize;
    for (const { tx, ty, tile, rect } of this.regions(r)) {
      let t = tile;
      const x0 = rect.x;
      const y0 = rect.y;
      const x1 = rect.x + rect.w;
      const y1 = rect.y + rect.h;
      if (!t) {
        let any = false;
        for (let y = y0; y < y1 && !any; y++) {
          for (let x = x0; x < x1; x++) {
            if (data[((y - r.y) * r.w + (x - r.x)) * 4 + 3] !== 0) {
              any = true;
              break;
            }
          }
        }
        if (!any) continue;
        t = this.ensure(tx, ty);
      }
      for (let y = y0; y < y1; y++) {
        const dst = ((y - ty * s) * s + (x0 - tx * s)) * 4;
        const src = ((y - r.y) * r.w + (x0 - r.x)) * 4;
        for (let i = 0; i < (x1 - x0) * 4; i++) t[dst + i] = data[src + i]!;
      }
      this.touch(tx, ty);
      if (transparent(t)) this.put(tx, ty, undefined);
    }
    return clipRect(r, this.width, this.height);
  }

  /**
   * Make a rectangle fully transparent. Blocks that were never painted are left alone (nothing is allocated) and
   * blocks that end up empty are removed. Returns the part of the rectangle inside the surface, or null.
   */
  clearRect(r: Rect): Rect | null {
    const s = this.blockSize;
    for (const { tx, ty, tile, rect } of this.regions(r)) {
      if (!tile) continue;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        const o = ((y - ty * s) * s + (rect.x - tx * s)) * 4;
        tile.fill(0, o, o + rect.w * 4);
      }
      this.touch(tx, ty);
      if (transparent(tile)) this.put(tx, ty, undefined);
    }
    return clipRect(r, this.width, this.height);
  }

  /** Remove a tile if nothing visible is left on it; returns true when removed. */
  dropIfEmpty(tx: number, ty: number): boolean {
    const t = this.get(tx, ty);
    if (t && transparent(t)) {
      this.put(tx, ty, undefined);
      return true;
    }
    return false;
  }

  /** Remove a tile whose every pixel has alpha `a` (a mask's own default); returns true when removed. */
  dropIfUniform(tx: number, ty: number, a: number): boolean {
    const t = this.get(tx, ty);
    if (!t) return false;
    for (let i = 3; i < t.length; i += 4) if (t[i] !== a) return false;
    this.put(tx, ty, undefined);
    return true;
  }

  /** Bounding box of every pixel with alpha > 0, or null when the surface is blank. */
  contentBounds(): Rect | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const s = this.blockSize;
    for (const [tx, ty, t] of this.entries()) {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          if (t[(y * s + x) * 4 + 3] === 0) continue;
          const px = tx * s + x;
          const py = ty * s + y;
          if (px >= this.width || py >= this.height) continue;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
    }
    return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

/** Throws unless the surface uses the engine's working block size (`TILE`), which the brush and the renderers assume. */
export function assertWorkingBlocks(s: { blockSize: number }): void {
  if (s.blockSize !== TILE) throw new RangeError(`Esta operación necesita bloques de ${TILE}×${TILE}; la superficie usa ${s.blockSize}×${s.blockSize}.`);
}

/** Tile coordinates overlapped by a pixel rectangle, clipped to the surface. */
export function tileRange(
  s: { tilesX: number; tilesY: number; blockSize?: number },
  r: Rect,
): { tx0: number; ty0: number; tx1: number; ty1: number } {
  const size = s.blockSize ?? TILE;
  return {
    tx0: Math.max(0, Math.floor(r.x / size)),
    ty0: Math.max(0, Math.floor(r.y / size)),
    tx1: Math.min(s.tilesX - 1, Math.floor((r.x + r.w - 1) / size)),
    ty1: Math.min(s.tilesY - 1, Math.floor((r.y + r.h - 1) / size)),
  };
}
