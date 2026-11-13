import { describe, expect, it } from 'vitest';
import { Stroke, defaultBrush } from './brush';
import { MAX_BLOCK_SIZE, TILE, TILE_BYTES, TiledSurface, assertWorkingBlocks, clipRect, tileRange } from './tiles';

const W = 600; // 3 tiles wide (256 + 256 + 88)
const H = 300; // 2 tiles tall

describe('TiledSurface', () => {
  it('is sparse: nothing is allocated until something is written', () => {
    const s = new TiledSurface(7016, 9921); // A3 at 600 dpi
    expect(s.tilesX).toBe(28);
    expect(s.tilesY).toBe(39);
    expect(s.tileCount).toBe(0);
    expect(s.isEmpty).toBe(true);
    expect(s.alphaAt(5000, 9000)).toBe(0);
    expect(s.readRect({ x: 100, y: 100, w: 4, h: 4 }).every((v) => v === 0)).toBe(true);
    expect(s.tileCount).toBe(0); // reading never allocates
  });

  it('writeRect/readRect round-trip across tile boundaries', () => {
    const s = new TiledSurface(W, H);
    const r = { x: 250, y: 250, w: 20, h: 20 }; // straddles four tiles
    const data = new Uint8ClampedArray(r.w * r.h * 4);
    for (let i = 0; i < r.w * r.h; i++) data.set([i % 251, 7, 9, 255], i * 4);
    s.writeRect(r, data);
    expect(s.tileCount).toBe(4);
    expect(Array.from(s.readRect(r))).toEqual(Array.from(data));
    expect(s.pixel(255, 255)).toEqual([(5 * 20 + 5) % 251, 7, 9, 255]);
    expect(s.alphaAt(256, 256)).toBe(255);
    expect(s.alphaAt(249, 249)).toBe(0);
  });

  it('does not create tiles for transparent data and drops tiles that become transparent', () => {
    const s = new TiledSurface(W, H);
    const r = { x: 0, y: 0, w: 4, h: 4 };
    s.writeRect(r, new Uint8ClampedArray(4 * 4 * 4)); // all transparent
    expect(s.tileCount).toBe(0);
    s.writeRect(r, new Uint8ClampedArray(4 * 4 * 4).fill(255));
    expect(s.tileCount).toBe(1);
    s.writeRect(r, new Uint8ClampedArray(4 * 4 * 4)); // erase it again
    expect(s.tileCount).toBe(0);
  });

  it('clips rectangles that hang off the surface', () => {
    const s = new TiledSurface(W, H);
    const r = { x: W - 2, y: H - 2, w: 6, h: 6 };
    const data = new Uint8ClampedArray(6 * 6 * 4).fill(200);
    s.writeRect(r, data);
    expect(s.alphaAt(W - 1, H - 1)).toBe(200);
    const back = s.readRect(r);
    expect(back[(0 * 6 + 0) * 4 + 3]).toBe(200);
    expect(back[(5 * 6 + 5) * 4 + 3]).toBe(0); // outside: stays transparent
  });

  it('tracks dirty tiles for renderers', () => {
    const s = new TiledSurface(W, H);
    expect(s.takeDirty()).toEqual([]);
    s.ensure(1, 0);
    s.touch(2, 1);
    expect(s.takeDirty().sort()).toEqual([s.key(1, 0), s.key(2, 1)].sort());
    expect(s.takeDirty()).toEqual([]);
    s.put(1, 0, undefined);
    expect(s.takeDirty()).toEqual([s.key(1, 0)]);
  });

  it('finds the content bounds and ignores the area outside the surface', () => {
    const s = new TiledSurface(W, H);
    expect(s.contentBounds()).toBeNull();
    s.writeRect({ x: 300, y: 20, w: 3, h: 2 }, new Uint8ClampedArray(3 * 2 * 4).fill(255));
    s.writeRect({ x: 10, y: 280, w: 1, h: 1 }, new Uint8ClampedArray(4).fill(255));
    expect(s.contentBounds()).toEqual({ x: 10, y: 20, w: 293, h: 261 });
  });

  it('clones deeply', () => {
    const s = new TiledSurface(W, H);
    s.writeRect({ x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray([1, 2, 3, 4]));
    const c = s.clone();
    c.writeRect({ x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray([9, 9, 9, 9]));
    expect(s.pixel(0, 0)).toEqual([1, 2, 3, 4]);
    expect(c.pixel(0, 0)).toEqual([9, 9, 9, 9]);
  });

  it('tileRange covers exactly the overlapped tiles, clipped to the grid', () => {
    const s = new TiledSurface(W, H);
    expect(tileRange(s, { x: 250, y: 250, w: 20, h: 20 })).toEqual({ tx0: 0, ty0: 0, tx1: 1, ty1: 1 });
    expect(tileRange(s, { x: TILE, y: 0, w: TILE, h: 10 })).toEqual({ tx0: 1, ty0: 0, tx1: 1, ty1: 0 });
    expect(tileRange(s, { x: -50, y: -50, w: 5000, h: 5000 })).toEqual({ tx0: 0, ty0: 0, tx1: 2, ty1: 1 });
  });
});

const solid = (w: number, h: number, v: number): Uint8ClampedArray => new Uint8ClampedArray(w * h * 4).fill(v);

describe('block access', () => {
  it('the block size is a property of the surface, not a constant of the store', () => {
    const d = new TiledSurface(W, H);
    expect([d.blockSize, d.blockBytes, d.tilesX, d.tilesY]).toEqual([TILE, TILE_BYTES, 3, 2]);
    const s = new TiledSurface(W, H, 100);
    expect([s.blockSize, s.blockBytes, s.tilesX, s.tilesY]).toEqual([100, 100 * 100 * 4, 6, 3]);
    expect(s.ensure(5, 2).length).toBe(s.blockBytes);
    expect(() => new TiledSurface(W, H, 0)).toThrow(RangeError);
    expect(() => new TiledSurface(W, H, 12.5)).toThrow(RangeError);
    expect(() => new TiledSurface(W, H, MAX_BLOCK_SIZE + 1)).toThrow(RangeError);
  });

  it('blockRect gives the pixels of a block, smaller on the right and bottom edges, and null off the grid', () => {
    const s = new TiledSurface(W, H);
    expect(s.blockRect(0, 0)).toEqual({ x: 0, y: 0, w: 256, h: 256 });
    expect(s.blockRect(2, 1)).toEqual({ x: 512, y: 256, w: 88, h: 44 });
    expect(s.blockRect(3, 0)).toBeNull();
    expect(s.blockRect(-1, 0)).toBeNull();
    expect(s.blockRect(0.5, 0)).toBeNull();
    expect(s.inGrid(2, 1)).toBe(true);
    expect(s.inGrid(2, 2)).toBe(false);
  });

  it('index is row-major: ty · tilesX + tx, and round-trips through tx/ty', () => {
    const s = new TiledSurface(W, H);
    expect(s.key(2, 1)).toBe(5);
    expect([s.tx(5), s.ty(5)]).toEqual([2, 1]);
    const t = s.ensure(2, 1);
    expect(s.getByKey(5)).toBe(t);
    expect(s.get(2, 1)).toBe(t);
    expect(s.get(1, 1)).toBeUndefined();
  });

  it('regions visits the overlapped blocks row by row, clipped to both region and surface, without allocating', () => {
    const s = new TiledSurface(W, H);
    s.ensure(1, 0);
    const seen = [...s.regions({ x: 250, y: 250, w: 400, h: 400 })];
    expect(seen.map((b) => [b.tx, b.ty])).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
    expect(seen.map((b) => b.tile !== undefined)).toEqual([false, true, false, false, false, false]);
    expect(seen[0]!.rect).toEqual({ x: 250, y: 250, w: 6, h: 6 });
    expect(seen[2]!.rect).toEqual({ x: 512, y: 250, w: 88, h: 6 });
    expect(seen[5]!.rect).toEqual({ x: 512, y: 256, w: 88, h: 44 });
    expect(s.tileCount).toBe(1); // the visit created nothing
    expect([...s.regions({ x: W, y: 0, w: 10, h: 10 })]).toEqual([]);
    expect([...s.regions({ x: 0, y: 0, w: 0, h: 10 })]).toEqual([]);
  });

  it('the regions of a rectangle cover each of its pixels exactly once', () => {
    const s = new TiledSurface(W, H, 100);
    const r = { x: 37, y: 41, w: 333, h: 201 };
    let area = 0;
    for (const b of s.regions(r)) {
      area += b.rect.w * b.rect.h;
      const br = s.blockRect(b.tx, b.ty)!;
      expect(b.rect.x).toBeGreaterThanOrEqual(br.x);
      expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(br.x + br.w);
      expect(b.rect.y).toBeGreaterThanOrEqual(br.y);
      expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(br.y + br.h);
    }
    expect(area).toBe(r.w * r.h);
  });
});

describe('regional update', () => {
  it('clipRect keeps only the part inside the surface', () => {
    expect(clipRect({ x: -5, y: -5, w: 10, h: 10 }, W, H)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(clipRect({ x: W - 3, y: H - 3, w: 9, h: 9 }, W, H)).toEqual({ x: W - 3, y: H - 3, w: 3, h: 3 });
    expect(clipRect({ x: W, y: 0, w: 5, h: 5 }, W, H)).toBeNull();
    expect(clipRect({ x: 0, y: 0, w: 0, h: 5 }, W, H)).toBeNull();
    expect(clipRect({ x: -20, y: 0, w: 10, h: 5 }, W, H)).toBeNull();
  });

  it('writeRect reports the area that was actually inside, and nothing for a rectangle fully outside', () => {
    const s = new TiledSurface(W, H);
    expect(s.writeRect({ x: W - 2, y: H - 2, w: 6, h: 6 }, solid(6, 6, 200))).toEqual({ x: W - 2, y: H - 2, w: 2, h: 2 });
    expect(s.writeRect({ x: -50, y: 0, w: 10, h: 10 }, solid(10, 10, 255))).toBeNull();
    expect(s.writeRect({ x: 0, y: H, w: 10, h: 10 }, solid(10, 10, 255))).toBeNull();
    expect(s.tileCount).toBe(1);
  });

  it('writing a region off the top-left does not shift the data that lands inside', () => {
    const s = new TiledSurface(W, H);
    const r = { x: -2, y: -2, w: 4, h: 4 };
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) data.set([x * 10, y * 10, 0, 255], (y * 4 + x) * 4);
    s.writeRect(r, data);
    expect(s.pixel(0, 0)).toEqual([20, 20, 0, 255]);
    expect(s.pixel(1, 1)).toEqual([30, 30, 0, 255]);
    expect(s.pixel(2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('only marks the blocks it changed as dirty', () => {
    const s = new TiledSurface(W, H);
    s.writeRect({ x: 250, y: 0, w: 12, h: 4 }, solid(12, 4, 255)); // blocks (0,0) and (1,0)
    expect(s.takeDirty().sort()).toEqual([s.key(0, 0), s.key(1, 0)]);
    s.writeRect({ x: 520, y: 0, w: 4, h: 4 }, solid(4, 4, 0)); // transparent over a missing block (2,0): no change
    expect(s.takeDirty()).toEqual([]);
    s.writeRect({ x: 300, y: 0, w: 4, h: 4 }, solid(4, 4, 0)); // transparent over an existing block: it is rewritten
    expect(s.takeDirty()).toEqual([s.key(1, 0)]);
  });

  it('clearRect erases a region across blocks, frees emptied blocks and never allocates', () => {
    const s = new TiledSurface(W, H);
    s.writeRect({ x: 0, y: 0, w: W, h: H }, solid(W, H, 255));
    expect(s.tileCount).toBe(6);
    s.takeDirty();
    expect(s.clearRect({ x: 0, y: 0, w: 256, h: 300 })).toEqual({ x: 0, y: 0, w: 256, h: 300 });
    expect(s.tileCount).toBe(4); // the two left blocks were emptied
    expect(s.alphaAt(255, 299)).toBe(0);
    expect(s.alphaAt(256, 0)).toBe(255);
    expect(s.takeDirty().sort()).toEqual([s.key(0, 0), s.key(0, 1)]);
    s.clearRect({ x: 300, y: 10, w: 4, h: 4 }); // part of a block: it stays, with a hole
    expect(s.tileCount).toBe(4);
    expect(s.alphaAt(301, 11)).toBe(0);
    expect(s.alphaAt(305, 11)).toBe(255);
    const blank = new TiledSurface(W, H);
    blank.clearRect({ x: 0, y: 0, w: W, h: H });
    expect(blank.tileCount).toBe(0);
    expect(blank.takeDirty()).toEqual([]);
    expect(blank.clearRect({ x: -9, y: -9, w: 5, h: 5 })).toBeNull();
  });

  it('works the same for any block size', () => {
    const r = { x: 17, y: 23, w: 410, h: 190 };
    const data = new Uint8ClampedArray(r.w * r.h * 4);
    for (let i = 0; i < r.w * r.h; i++) data.set([i % 251, (i >> 8) % 251, 5, 1 + (i % 254)], i * 4);
    const reference = new TiledSurface(W, H, 256);
    reference.writeRect(r, data);
    for (const size of [1, 7, 64, 100, 300, 1024]) {
      const s = new TiledSurface(W, H, size);
      s.writeRect(r, data);
      expect(Array.from(s.readRect(r))).toEqual(Array.from(data));
      expect(Array.from(s.readRect({ x: 0, y: 0, w: W, h: H }))).toEqual(Array.from(reference.readRect({ x: 0, y: 0, w: W, h: H })));
      expect(s.contentBounds()).toEqual(reference.contentBounds());
    }
  });
});

describe('separate roles', () => {
  it('reblock re-cuts the same pixels without touching the original', () => {
    const s = new TiledSurface(W, H, 100);
    s.writeRect({ x: 90, y: 90, w: 30, h: 30 }, solid(30, 30, 77));
    expect(s.tileCount).toBe(4);
    const t = s.reblock(TILE);
    expect([t.blockSize, t.tileCount]).toEqual([TILE, 1]);
    expect(Array.from(t.readRect({ x: 0, y: 0, w: W, h: H }))).toEqual(Array.from(s.readRect({ x: 0, y: 0, w: W, h: H })));
    expect(s.blockSize).toBe(100);
    expect(s.tileCount).toBe(4);
    t.clear();
    expect(s.alphaAt(100, 100)).toBe(77);
  });

  it('refuses a tile of the wrong size instead of corrupting later reads', () => {
    const s = new TiledSurface(W, H, 100);
    expect(() => s.put(0, 0, new Uint8ClampedArray(TILE_BYTES))).toThrow(RangeError);
    expect(s.tileCount).toBe(0);
    s.put(0, 0, new Uint8ClampedArray(s.blockBytes).fill(9));
    expect(s.tileCount).toBe(1);
  });

  it('clone keeps the block size and is independent of the source', () => {
    const s = new TiledSurface(W, H, 100);
    s.writeRect({ x: 0, y: 0, w: 1, h: 1 }, new Uint8ClampedArray([1, 2, 3, 4]));
    const c = s.clone();
    expect(c.blockSize).toBe(100);
    c.clearRect({ x: 0, y: 0, w: 1, h: 1 });
    expect(s.pixel(0, 0)).toEqual([1, 2, 3, 4]);
  });

  it('the stroke keeps its own snapshots: the patch holds copies, not the layer\'s tiles', () => {
    const s = new TiledSurface(W, H);
    s.writeRect({ x: 100, y: 100, w: 1, h: 1 }, new Uint8ClampedArray([9, 9, 9, 255]));
    const stroke = new Stroke({ id: 1, surface: s, lockAlpha: false }, { ...defaultBrush, color: [255, 0, 0] });
    stroke.addPoint(100, 100, 1);
    stroke.addPoint(140, 100, 1);
    const patch = stroke.finish()!;
    expect(s.alphaAt(120, 100)).toBeGreaterThan(0);
    const tile = patch.tiles.find((t) => t.tx === 0 && t.ty === 0)!;
    expect(tile.before).not.toBe(s.get(0, 0));
    expect(tile.after).not.toBe(s.get(0, 0));
    expect(tile.before![(100 * TILE + 100) * 4]).toBe(9); // the state before the stroke
    tile.after!.fill(0); // editing the patch cannot reach the layer
    expect(s.alphaAt(120, 100)).toBeGreaterThan(0);
  });

  it('cancelling a stroke puts the layer back as it was', () => {
    const s = new TiledSurface(W, H);
    const stroke = new Stroke({ id: 1, surface: s, lockAlpha: false }, defaultBrush);
    stroke.addPoint(50, 50, 1);
    stroke.addPoint(90, 50, 1);
    expect(s.tileCount).toBe(1);
    stroke.cancel();
    expect(s.tileCount).toBe(0);
  });

  it('the brush refuses a surface that is not cut into working blocks', () => {
    const odd = new TiledSurface(W, H, 100);
    expect(() => new Stroke({ id: 1, surface: odd, lockAlpha: false }, defaultBrush)).toThrow(RangeError);
    expect(() => assertWorkingBlocks(new TiledSurface(W, H))).not.toThrow();
  });
});
