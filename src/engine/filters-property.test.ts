/**
 * Every filter, with its parameters at the default, at both ends of their ranges and at some mixes, on a picture with opaque,
 * translucent and empty areas, with and without a selection. What must hold whatever the filter is:
 *  - it does not throw, and does not take for ever;
 *  - what it computes is a number (a NaN or an infinity would be turned into black or nothing without a word);
 *  - the history can take the change back and the layer is exactly as it was;
 *  - outside the selection not one byte changes.
 */
import { describe, expect, it } from 'vitest';
import { addLayer, createDocument, type Layer } from './document';
import { FILTERS, applyAreaFilter, applyPixelFilter, defaultValues, type AreaFilter, type Filter, type FilterContext, type PixelFilter } from './filters';
import { History, patchCommand } from './history';
import { Selection } from './selection';
import { TILE } from './tiles';

const ctx: FilterContext = { main: [10, 20, 30], sub: [250, 240, 230] };
const W = 300;
const H = 200;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function picture(): { layer: Layer; doc: ReturnType<typeof createDocument> } {
  const doc = createDocument(W, H, 300);
  const layer = addLayer(doc, 'l');
  const r = rng(7);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const zone = Math.floor(x / 50) % 3; // 0: empty, 1: opaque, 2: translucent
      data[o] = Math.floor(r() * 256);
      data[o + 1] = Math.floor(r() * 256);
      data[o + 2] = Math.floor(r() * 256);
      data[o + 3] = zone === 0 && y % 40 < 30 ? 0 : zone === 1 ? 255 : Math.floor(r() * 256);
    }
  }
  layer.surface.writeRect({ x: 0, y: 0, w: W, h: H }, data);
  return { layer, doc };
}

function snapshot(layer: Layer): Uint8ClampedArray {
  return layer.surface.readRect({ x: 0, y: 0, w: W, h: H });
}

function selection(): Selection {
  const sel = new Selection(W, H);
  for (let y = 40; y < 160; y++) for (let x = 90; x < 260; x++) sel.set(x, y, 255);
  sel.feather(5);
  return sel;
}

/** The value sets to try: default, every parameter at its minimum, at its maximum, and some mixes. */
function valueSets(f: Filter): Record<string, number>[] {
  const def = defaultValues(f);
  const sets = [def, Object.fromEntries(f.params.map((q) => [q.id, q.min])), Object.fromEntries(f.params.map((q) => [q.id, q.max]))];
  const r = rng(99);
  for (let i = 0; i < 3; i++) sets.push(Object.fromEntries(f.params.map((q) => [q.id, q.min + Math.round(((q.max - q.min) * r()) / q.step) * q.step])));
  return sets;
}

describe('every filter, whatever its values', () => {
  for (const [id, f] of Object.entries(FILTERS)) {
    it(`${id}: finite numbers, no throw, quick`, () => {
      for (const v of valueSets(f)) {
        const t0 = performance.now();
        if (f.kind === 'pixel') {
          const run = (f as PixelFilter).make(v, ctx);
          for (const px of [[0, 0, 0, 255], [255, 255, 255, 255], [10, 200, 90, 128], [255, 0, 0, 1], [0, 0, 0, 0]]) {
            const c = [...px];
            run(c);
            expect(c.every(Number.isFinite), `${id} ${JSON.stringify(v)} on ${px}: ${c}`).toBe(true);
          }
        } else {
          const a = f as AreaFilter;
          const w = 64;
          const h = 48;
          const m = a.margin(v);
          const bw = w + 2 * m;
          const bh = h + 2 * m;
          const buf = new Float32Array(bw * bh * 4);
          const r = rng(5);
          for (let i = 0; i < bw * bh; i++) {
            const al = i % 7 === 0 ? 0 : r();
            buf[i * 4] = r() * al;
            buf[i * 4 + 1] = r() * al;
            buf[i * 4 + 2] = r() * al;
            buf[i * 4 + 3] = al;
          }
          a.run(buf, bw, bh, v, ctx);
          let bad = -1;
          for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i]!)) { bad = i; break; }
          expect(bad, `${id} ${JSON.stringify(v)}: not a number at ${bad}`).toBe(-1);
        }
        expect(performance.now() - t0, `${id} ${JSON.stringify(v)} took too long`).toBeLessThan(4000);
      }
    }, 60000);

    it(`${id}: undo restores the layer exactly, and nothing outside the selection changes`, () => {
      for (const useSelection of [false, true]) {
        for (const v of valueSets(f).slice(0, 4)) {
          const { layer, doc } = picture();
          const before = snapshot(layer);
          const sel = useSelection ? selection() : null;
          let patch;
          if (f.kind === 'pixel') patch = applyPixelFilter(layer.surface, layer.id, sel, f, v, ctx);
          else {
            const res = applyAreaFilter(layer.surface, layer.id, sel, f, v, ctx);
            patch = res && 'patch' in res ? res.patch : null;
          }
          const after = snapshot(layer);
          if (sel) {
            let changed = 0;
            let first = '';
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                if (sel.at(x, y) !== 0) continue;
                const o = (y * W + x) * 4;
                // (the colour of a fully transparent pixel is nothing: it is not told apart)
                if (before[o + 3] !== after[o + 3] || (before[o + 3] !== 0 && (before[o] !== after[o] || before[o + 1] !== after[o + 1] || before[o + 2] !== after[o + 2]))) {
                  changed++;
                  if (!first) first = `(${x},${y}) ${Array.from(before.subarray(o, o + 4))} → ${Array.from(after.subarray(o, o + 4))}`;
                }
              }
            }
            expect(changed, `${id} ${JSON.stringify(v)}: pixels outside the selection changed, first ${first}`).toBe(0);
          }
          if (!patch) {
            expect(Buffer.from(after).equals(Buffer.from(before)), `${id}: no patch but the layer changed`).toBe(true);
            continue;
          }
          const h = new History();
          h.push(patchCommand(doc, patch));
          h.undo();
          expect(Buffer.from(snapshot(layer)).equals(Buffer.from(before)), `${id} ${JSON.stringify(v)} sel=${useSelection}: undo did not restore`).toBe(true);
          h.redo();
          expect(Buffer.from(snapshot(layer)).equals(Buffer.from(after)), `${id} ${JSON.stringify(v)} sel=${useSelection}: redo differs`).toBe(true);
        }
      }
    }, 120000);
  }

  it('a block of tiles is a block of TILE pixels', () => {
    expect(TILE).toBeGreaterThan(0);
  });
});
