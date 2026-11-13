import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { flatten, flattenRegion, sampleDocument } from './composite';
import { Selection, fillSelection, wandSelect, type LookPicture } from './selection';
import { TILE } from './tiles';
import { fillLayer, setPixel } from './test-utils';

/**
 * The bucket fill and the filter preview run on shortcuts (uniform tiles, runs of equal pixels, whole-tile fills,
 * tile-wise grow). Each test here checks a shortcut against the plain per-pixel meaning it must keep.
 */

/** A small deterministic generator, so the pictures are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('flattening with flat-colour runs', () => {
  it('gives what composing each pixel on its own gives, across tiles, blends, masks and opacity', () => {
    const W = TILE * 2 + 40;
    const H = TILE + 30;
    const doc = createDocument(W, H, 300);
    const a = addLayer(doc, 'a');
    const b = addLayer(doc, 'b');
    const c = addLayer(doc, 'c');
    fillLayer(a, [30, 60, 90, 255]);
    // b: flat blocks with a noisy strip, so runs of equal pixels end and start inside a tile
    const rnd = lcg(7);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const noisy = x > 100 && x < 130;
        const v = noisy ? [rnd() * 255, rnd() * 255, rnd() * 255, 100 + rnd() * 155] : x < 60 ? [200, 20, 20, 255] : x > TILE + 50 ? [0, 0, 0, 0] : [20, 200, 40, 128];
        data.set(v.map(Math.round), i);
      }
    }
    b.surface.writeRect({ x: 0, y: 0, w: W, h: H }, data);
    b.blend = 'multiply';
    b.opacity = 0.8;
    setPixel(c, 5, 5, [255, 255, 255, 255]);
    setPixel(c, TILE + 3, TILE + 3, [10, 10, 250, 200]);
    c.blend = 'screen';

    const flat = flatten(doc);
    let worst = 0;
    for (let y = 0; y < H; y += 9) {
      for (let x = 0; x < W; x += 7) {
        const s = sampleDocument(doc, x, y);
        for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(s[k]! - flat[(y * W + x) * 4 + k]!));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);

    // a region that starts in the middle of a tile gives the same pixels as the same part of the whole page
    const region = { x: TILE - 20, y: 10, w: 90, h: TILE + 5 };
    const part = flattenRegion(doc, region);
    for (let y = 0; y < region.h; y += 11) {
      for (let x = 0; x < region.w; x += 5) {
        for (let k = 0; k < 4; k++) expect(part[(y * region.w + x) * 4 + k]).toBe(flat[((region.y + y) * W + region.x + x) * 4 + k]);
      }
    }
  });
});

/** The picture as the wand reads it: straight RGBA in tiles, null for an all-transparent tile. */
function pictureOf(width: number, height: number, px: Uint8ClampedArray, aligned: boolean): LookPicture {
  return {
    width,
    height,
    tile(tx, ty) {
      // `aligned: false` keeps the pixels the same but hands them over at an odd byte offset, which turns the
      // whole-tile shortcut off: the two must select exactly the same pixels.
      const backing = new Uint8ClampedArray(TILE * TILE * 4 + 1);
      const t = backing.subarray(1);
      let any = false;
      for (let y = 0; y < TILE; y++) {
        const py = ty * TILE + y;
        if (py >= height) break;
        for (let x = 0; x < TILE; x++) {
          const pxx = tx * TILE + x;
          if (pxx >= width) break;
          const s = (py * width + pxx) * 4;
          const d = (y * TILE + x) * 4;
          for (let k = 0; k < 4; k++) t[d + k] = px[s + k]!;
          if (px[s + 3]) any = true;
        }
      }
      if (!any) return null;
      return aligned ? new Uint8ClampedArray(t) : t;
    },
  };
}

describe('wand: whole-tile shortcut', () => {
  const W = TILE * 2 + 50;
  const H = TILE + 60;
  const px = new Uint8ClampedArray(W * H * 4);
  const rnd = lcg(11);
  // big flat areas (uniform tiles), a flat dark area, transparent areas and a noisy patch
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v: number[] = [255, 255, 255, 255];
      if (x > W - 90) v = [0, 0, 0, 0];
      else if (y > H - 40) v = [20, 20, 20, 255];
      else if (x > 300 && x < 330 && y > 20 && y < 80) v = [255 - rnd() * 40, 255 - rnd() * 40, 255, 255];
      px.set(v.map(Math.round), i);
    }
  }
  const limit = Selection.rect(W, H, { x: 40, y: 0, w: W - 80, h: H });

  for (const [tolerance, contiguous, gap, within] of [
    [0, true, 0, false],
    [24, true, 0, false],
    [24, false, 0, false],
    [24, true, 3, false],
    [24, true, 0, true],
  ] as const) {
    it(`selects the same pixels with and without the shortcut (tolerance ${tolerance}, contiguous ${contiguous}, gap ${gap}, within ${within})`, () => {
      const opts = { tolerance, contiguous, gap, within: within ? limit : null };
      const fast = wandSelect(W, H, pictureOf(W, H, px, true), 100, 10, opts);
      const slow = wandSelect(W, H, pictureOf(W, H, px, false), 100, 10, opts);
      expect(fast.isEmpty).toBe(false);
      for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) expect(fast.at(x, y)).toBe(slow.at(x, y));
      // a pixel of the far transparent area is never part of the white area
      expect(fast.at(W - 10, 10)).toBe(0);
    });
  }

  it('a transparent seed takes every transparent pixel, also in tiles the picture has no pixels for', () => {
    const empty = new Uint8ClampedArray(W * H * 4);
    const s = wandSelect(W, H, pictureOf(W, H, empty, true), 5, 5, { tolerance: 0, contiguous: true });
    expect(s.at(0, 0)).toBe(255);
    expect(s.at(W - 1, H - 1)).toBe(255);
    expect(s.at(TILE + 3, TILE + 3)).toBe(255);
  });
});

/** The disc the grow and shrink use: per row, the half-width is round(sqrt(n² - dy²)). Outside the page counts as `edge`. */
function reference(sel: Selection, x: number, y: number, n: number, kind: 'max' | 'min', width: number, height: number, edge: number): number {
  let best = kind === 'max' ? 0 : 255;
  for (let dy = -n; dy <= n; dy++) {
    const half = Math.round(Math.sqrt(n * n - dy * dy));
    for (let dx = -half; dx <= half; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      const v = xx < 0 || yy < 0 || xx >= width || yy >= height ? edge : sel.at(xx, yy);
      best = kind === 'max' ? Math.max(best, v) : Math.min(best, v);
    }
  }
  return best;
}

describe('grow and shrink one tile at a time', () => {
  const W = TILE * 2 + 90;
  const H = TILE + 120;
  const shapes: [string, () => Selection][] = [
    ['a rectangle across tile borders', () => Selection.rect(W, H, { x: TILE - 30, y: 40, w: 90, h: TILE })],
    ['a soft ellipse', () => Selection.ellipse(W, H, { x: 100.5, y: 30.5, w: 380, h: 200 })],
    ['a selection touching the page edge', () => Selection.rect(W, H, { x: 0, y: 0, w: TILE + 10, h: 25 })],
    [
      'an inverted selection',
      () => {
        const s = Selection.rect(W, H, { x: 60, y: 60, w: 300, h: 100 });
        s.invert();
        return s;
      },
    ],
  ];
  for (const [name, make] of shapes) {
    for (const r of [1, 4, 17, -1, -5, -23]) {
      it(`${name}, ${r > 0 ? 'grown' : 'shrunk'} by ${Math.abs(r)}`, () => {
        const before = make();
        const after = make();
        after.grow(r);
        const n = Math.abs(r);
        const edge = before.outside;
        for (let y = 0; y < H; y += 5) {
          for (let x = 0; x < W; x += 6) expect(after.at(x, y)).toBe(reference(before, x, y, n, r > 0 ? 'max' : 'min', W, H, edge));
        }
        // the edges of the page and of the tiles
        for (const x of [0, 1, TILE - 1, TILE, TILE + 1, W - 1]) {
          for (const y of [0, 1, TILE - 1, TILE, H - 1]) expect(after.at(x, y)).toBe(reference(before, x, y, n, r > 0 ? 'max' : 'min', W, H, edge));
        }
      });
    }
  }

  it('leaves a selection with no tiles of its own alone, and drops tiles that end up empty', () => {
    const none = new Selection(W, H);
    none.grow(5);
    expect(none.isEmpty).toBe(true);
    const all = Selection.all(W, H);
    all.grow(-3);
    expect(all.at(W - 1, H - 1)).toBe(255);
    const dot = Selection.rect(W, H, { x: 300, y: 100, w: 2, h: 2 });
    dot.grow(-2);
    expect(dot.isEmpty).toBe(true);
    expect(Array.from(dot.entries())).toHaveLength(0);
  });
});

describe('integer rectangles', () => {
  it('cover exactly the pixels inside, also over tile borders, page edges and partly outside the page', () => {
    const W = TILE * 2 + 30;
    const H = TILE + 20;
    const s = Selection.rect(W, H, { x: TILE - 10, y: 5, w: TILE + 20, h: H });
    expect(s.at(TILE - 11, 10)).toBe(0);
    expect(s.at(TILE - 10, 5)).toBe(255);
    expect(s.at(TILE * 2 + 9, H - 1)).toBe(255);
    expect(s.at(TILE * 2 + 10, 10)).toBe(0);
    expect(s.at(TILE, 4)).toBe(0);
    expect(s.bounds()).toEqual({ x: TILE - 10, y: 5, w: TILE + 20, h: H - 5 });
    const off = Selection.rect(W, H, { x: -20, y: -5, w: 50, h: 30 });
    expect(off.bounds()).toEqual({ x: 0, y: 0, w: 30, h: 25 });
    expect(Selection.rect(W, H, { x: W + 5, y: 0, w: 10, h: 10 }).isEmpty).toBe(true);
    // a whole tile is one value, so it can be skipped by the callers that check for it
    const whole = Selection.rect(W, H, { x: 0, y: 0, w: W, h: H });
    expect(whole.tile(0, 0)).not.toBe(0);
    expect(whole.at(W - 1, H - 1)).toBe(255);
  });
});

describe('bucket fill write path', () => {
  const W = TILE * 2 + 40;
  const H = TILE + 40;

  /** What filling a pixel with a colour at full opacity and coverage c/255 gives, written out. */
  function expected(old: number[], color: readonly number[], c: number): number[] {
    const ta = c / 255;
    const ba = old[3]! / 255;
    const ra = ta + ba * (1 - ta);
    if (ra <= 0) return old;
    const w = (1 - ta) * ba;
    return [0, 1, 2].map((k) => Math.max(0, Math.min(255, Math.round((ta * color[k]! + w * old[k]!) / ra)))).concat(Math.max(0, Math.min(255, Math.round(ra * 255))));
  }

  it('paints fully covered tiles and rows directly and the soft edge by coverage, like the per-pixel formula', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'l');
    const rnd = lcg(3);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([rnd() * 255, rnd() * 255, rnd() * 255, rnd() < 0.5 ? 255 : rnd() * 255].map(Math.round), i * 4);
    layer.surface.writeRect({ x: 0, y: 0, w: W, h: H }, data);
    const before = (x: number, y: number): number[] => layer.surface.pixel(x, y);
    const olds = new Map<string, number[]>();
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 5) olds.set(`${x},${y}`, before(x, y));

    const sel = Selection.ellipse(W, H, { x: 20.5, y: 10.5, w: W - 40, h: H - 20 }); // covers whole tiles inside, soft at the rim
    const color = [12, 200, 90] as const;
    const patch = fillSelection(layer.surface, layer.id, sel, color)!;
    expect(patch).not.toBeNull();
    for (const [key, old] of olds) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const got = layer.surface.pixel(x, y);
      const want = expected(old, color, sel.at(x, y));
      // the stored pixels are rounded by the tile, so allow one step
      for (let k = 0; k < 4; k++) expect(Math.abs(got[k]! - want[k]!)).toBeLessThanOrEqual(1);
    }
    // the patch rectangle holds every pixel that changed
    const r = patch.rect;
    for (const [key, old] of olds) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const now = layer.surface.pixel(x, y);
      if (now.some((v, k) => v !== old[k])) {
        expect(x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h).toBe(true);
      }
    }
  });

  it('a second identical fill changes nothing, and a fill on an empty layer covers just the selection', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'l');
    const sel = Selection.rect(W, H, { x: TILE - 5, y: 7, w: 40, h: TILE + 3 });
    const first = fillSelection(layer.surface, layer.id, sel, [200, 10, 10])!;
    expect(first.rect).toEqual({ x: TILE - 5, y: 7, w: 40, h: TILE + 3 });
    expect(layer.surface.pixel(TILE, 8)).toEqual([200, 10, 10, 255]);
    expect(layer.surface.alphaAt(TILE - 6, 8)).toBe(0);
    expect(fillSelection(layer.surface, layer.id, sel, [200, 10, 10])).toBeNull();
    // another colour over part of it: the patch is just the part that changed
    const part = Selection.rect(W, H, { x: TILE, y: 20, w: 5, h: 5 });
    const second = fillSelection(layer.surface, layer.id, part, [0, 0, 255])!;
    expect(second.rect).toEqual({ x: TILE, y: 20, w: 5, h: 5 });
  });
});
