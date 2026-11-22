/**
 * The selection against a plain model: the same page kept as one byte per pixel and every operation done the slow, obvious way.
 * Random pages (hard and soft edges, tiles that are all one value, a selection that covers everything but a hole), several tile borders.
 */
import { describe, expect, it } from 'vitest';
import { Selection, selectionFromDense, type CombineMode } from './selection';

const W = 530; // not a multiple of the tile, so the last tiles are partial
const H = 300;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A random selection and its dense model. `style` picks how it looks. */
function make(seed: number, style: 'blobs' | 'soft' | 'everythingButHoles' | 'empty'): { sel: Selection; model: Uint8Array } {
  const r = rng(seed);
  const model = new Uint8Array(W * H);
  if (style === 'everythingButHoles') model.fill(255);
  const blobs = 1 + Math.floor(r() * 4);
  for (let b = 0; b < (style === 'empty' ? 0 : blobs); b++) {
    const cx = Math.floor(r() * W);
    const cy = Math.floor(r() * H);
    const rx = 5 + Math.floor(r() * 120);
    const ry = 5 + Math.floor(r() * 80);
    for (let y = Math.max(0, cy - ry); y < Math.min(H, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x < Math.min(W, cx + rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d > 1) continue;
        const v = style === 'soft' ? Math.round(255 * (1 - d)) : 255;
        model[y * W + x] = style === 'everythingButHoles' ? 0 : Math.max(model[y * W + x]!, v);
      }
    }
  }
  const sel = selectionFromDense(W, H, model);
  return { sel, model };
}

function dense(sel: Selection): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = sel.at(x, y);
  return out;
}

function firstDifference(a: Uint8Array, b: Uint8Array): string {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `at (${i % W},${Math.floor(i / W)}): ${a[i]} vs ${b[i]}`;
  return '';
}

const styles = ['blobs', 'soft', 'everythingButHoles', 'empty'] as const;

describe('selection against a dense model', () => {
  it('holds what it was given, tile borders included', () => {
    for (const [i, style] of styles.entries()) {
      const { sel, model } = make(100 + i, style);
      expect(firstDifference(dense(sel), model)).toBe('');
    }
  });

  it('bounds are the smallest rectangle around the selected pixels', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { sel, model } = make(seed, styles[seed % 3]!);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (model[y * W + x]) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
      const b = sel.bounds();
      if (x1 < 0) expect(b).toBeNull();
      else expect(b, `seed ${seed}`).toEqual({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  });

  it('invert flips every pixel, and twice is the same selection', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { sel, model } = make(seed, styles[seed % 4]!);
      sel.invert();
      expect(firstDifference(dense(sel), model.map((v) => 255 - v))).toBe('');
      sel.invert();
      expect(firstDifference(dense(sel), model)).toBe('');
    }
  });

  it('combines like the plain formulas for add, subtract and intersect (and a hole in everything stays a hole)', () => {
    const modes: CombineMode[] = ['add', 'subtract', 'intersect', 'replace'];
    for (let seed = 1; seed <= 16; seed++) {
      const mode = modes[seed % 4]!;
      const a = make(seed, styles[seed % 4]!);
      const b = make(seed + 50, styles[(seed >> 1) % 4]!);
      a.sel.combine(b.sel, mode);
      const expected = a.model.map((v, i) => {
        const o = b.model[i]!;
        return mode === 'add' ? Math.max(v, o) : mode === 'subtract' ? Math.round((v * (255 - o)) / 255) : mode === 'intersect' ? Math.min(v, o) : o;
      });
      expect(firstDifference(dense(a.sel), expected), `${mode} seed ${seed}`).toBe('');
    }
  });

  it('growing never takes anything away and shrinking never adds, whatever the size', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const r of [1, 2, 5, 17, 40]) {
        const { sel, model } = make(seed, styles[seed % 4]!);
        const bigger = sel.clone();
        bigger.grow(r);
        const smaller = sel.clone();
        smaller.grow(-r);
        const g = dense(bigger);
        const s = dense(smaller);
        for (let i = 0; i < model.length; i++) {
          if (g[i]! < model[i]!) throw new Error(`grow ${r} seed ${seed} removed at (${i % W},${Math.floor(i / W)}): ${model[i]} → ${g[i]}`);
          if (s[i]! > model[i]!) throw new Error(`shrink ${r} seed ${seed} added at (${i % W},${Math.floor(i / W)}): ${model[i]} → ${s[i]}`);
        }
      }
    }
  });

  it('a hard selection grown by r reaches exactly the pixels within a disc of r', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const r of [1, 3, 8]) {
        const style = styles[seed % 2]!; // hard blobs / soft ones are binarised below
        const { model } = make(seed, style);
        const hard = model.map((v) => (v >= 128 ? 255 : 0));
        const sel = selectionFromDense(W, H, hard);
        sel.grow(r);
        const got = dense(sel);
        const reach = (x: number, y: number, want: 0 | 255): boolean => {
          for (let dy = -r; dy <= r; dy++) {
            const half = Math.round(Math.sqrt(r * r - dy * dy)); // the disc the engine documents: each row as wide as the circle there, rounded
            for (let dx = -half; dx <= half; dx++) {
              const px = x + dx;
              const py = y + dy;
              const v = px < 0 || py < 0 || px >= W || py >= H ? 0 : hard[py * W + px]!;
              if (v === want) return true;
            }
          }
          return false;
        };
        let bad = '';
        for (let y = 0; y < H && !bad; y++) {
          for (let x = 0; x < W; x++) {
            const expected = reach(x, y, 255) ? 255 : 0;
            if (got[y * W + x] !== expected) {
              bad = `r=${r} seed ${seed} at (${x},${y}): got ${got[y * W + x]}, the disc says ${expected}`;
              break;
            }
          }
        }
        expect(bad).toBe('');
      }
    }
  });

  it('feather keeps the total coverage about the same and inside the page', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { sel, model } = make(seed, 'blobs');
      const before = model.reduce((n, v) => n + v, 0);
      sel.feather(6);
      const after = dense(sel).reduce((n, v) => n + v, 0);
      // blobs touching the page edge lose a little there: allow a few percent
      expect(Math.abs(after - before) / Math.max(1, before), `seed ${seed}`).toBeLessThan(0.08);
    }
  });
});

describe('magic wand against a plain flood fill', () => {
  const w = 300;
  const h = 140;
  // few colours in blocks plus a little noise, some transparent areas
  function picture(seed: number): Uint8Array {
    const r = rng(seed);
    const px = new Uint8Array(w * h * 4);
    const palette = [[255, 0, 0, 255], [250, 10, 5, 255], [0, 0, 255, 255], [0, 255, 0, 128], [0, 0, 0, 0], [20, 20, 20, 3]];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = palette[(Math.floor(x / 37) + Math.floor(y / 29) * 2 + Math.floor(r() * 1.15)) % palette.length]!;
        const n = r() < 0.05 ? Math.floor(r() * 12) : 0;
        px.set([Math.min(255, c[0]! + n), c[1]!, c[2]!, c[3]!], (y * w + x) * 4);
      }
    }
    return px;
  }

  function model(px: Uint8Array, sx: number, sy: number, tol: number, contiguous: boolean, within: Uint8Array | null): Uint8Array {
    const at = (x: number, y: number): number[] => Array.from(px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
    const seed = at(sx, sy);
    const seedClear = seed[3]! <= tol;
    const similar = (x: number, y: number): boolean => {
      if (within && within[y * w + x]! < 128) return false;
      const p = at(x, y);
      if (seedClear) return p[3]! <= tol;
      if (p[3]! <= tol) return false;
      return Math.max(...p.map((v, i) => Math.abs(v - seed[i]!))) <= tol;
    };
    const out = new Uint8Array(w * h);
    if (!contiguous) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (similar(x, y)) out[y * w + x] = 255;
      return out;
    }
    const stack = [[sx, sy]];
    if (!similar(sx, sy)) return out;
    out[sy * w + sx] = 255;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x! + dx;
        const ny = y! + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || out[ny * w + nx] || !similar(nx, ny)) continue;
        out[ny * w + nx] = 255;
        stack.push([nx, ny]);
      }
    }
    return out;
  }

  it('selects what a plain flood fill selects, at any tolerance', async () => {
    const { wandSelect } = await import('./selection');
    for (let seed = 1; seed <= 6; seed++) {
      const px = picture(seed);
      const look = (x: number, y: number): [number, number, number, number] => [px[(y * w + x) * 4]!, px[(y * w + x) * 4 + 1]!, px[(y * w + x) * 4 + 2]!, px[(y * w + x) * 4 + 3]!];
      const r = rng(seed * 31);
      for (const tol of [0, 8, 40, 130]) {
        for (const contiguous of [true, false]) {
          const sx = Math.floor(r() * w);
          const sy = Math.floor(r() * h);
          const got = wandSelect(w, h, look, sx, sy, { tolerance: tol, contiguous });
          const want = model(px, sx, sy, tol, contiguous, null);
          const out = new Uint8Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = got.at(x, y) >= 128 ? 255 : 0;
          let bad = '';
          for (let i = 0; i < out.length; i++) if (out[i] !== want[i]) { bad = `seed ${seed} tol ${tol} contiguous ${contiguous} seedpx (${sx},${sy}) differs at (${i % w},${Math.floor(i / w)}): got ${out[i]} want ${want[i]}`; break; }
          expect(bad).toBe('');
        }
      }
    }
  });
});
