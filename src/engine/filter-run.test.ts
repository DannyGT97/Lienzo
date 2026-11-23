import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { applyAreaFilterAsync, applyPixelFilterAsync } from './filter-run';
import { FILTERS, applyAreaFilter, applyPixelFilter, defaultValues, previewScale, type AreaFilter, type FilterContext, type PixelFilter } from './filters';
import { Selection } from './selection';
import type { Rect, TiledSurface } from './tiles';

const ctx: FilterContext = { main: [200, 30, 60], sub: [10, 240, 100] };

/** A page of 700 × 520 with a few painted shapes (some soft, some see-through), so blocks, tiles and edges all matter. */
function sample() {
  const doc = createDocument(700, 520, 300);
  const layer = addLayer(doc, 'l');
  let seed = 11;
  const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let n = 0; n < 7; n++) {
    const w = 60 + Math.floor(next() * 200);
    const h = 40 + Math.floor(next() * 160);
    const x = Math.floor(next() * (700 - w));
    const y = Math.floor(next() * (520 - h));
    const buf = new Uint8ClampedArray(w * h * 4);
    const c = [next() * 255, next() * 255, next() * 255];
    for (let i = 0; i < w * h; i++) {
      const edge = Math.min(i % w, w - (i % w), Math.floor(i / w), h - Math.floor(i / w));
      buf[i * 4] = c[0]! + (next() * 40 - 20);
      buf[i * 4 + 1] = c[1]! + (next() * 40 - 20);
      buf[i * 4 + 2] = c[2]! + (next() * 40 - 20);
      buf[i * 4 + 3] = Math.min(255, 40 + edge * 12);
    }
    layer.surface.writeRect({ x, y, w, h }, buf);
  }
  return { doc, layer };
}

const maxDiff = (a: TiledSurface, b: TiledSurface): number => {
  const all = { x: 0, y: 0, w: a.width, h: a.height };
  const pa = a.readRect(all);
  const pb = b.readRect(all);
  let worst = 0;
  for (let i = 0; i < pa.length; i += 4) {
    // Two pixels that cannot be seen (no alpha) are the same whatever their colour.
    if (pa[i + 3] === 0 && pb[i + 3] === 0) continue;
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(pa[i + c]! - pb[i + c]!));
  }
  return worst;
};

/** Tests need no window to give turns to; this makes the pieces go through the same waiting as in the app. */
const tick = (): Promise<void> => Promise.resolve();

describe('filters by pieces give what filtering the whole layer gives', () => {
  for (const f of Object.values(FILTERS)) {
    it(`${f.id}: the whole layer`, async () => {
      const a = sample();
      const b = sample();
      const v = defaultValues(f);
      if (f.kind === 'pixel') applyPixelFilter(a.layer.surface, a.layer.id, null, f, v, ctx);
      else applyAreaFilter(a.layer.surface, a.layer.id, null, f, v, ctx);
      const res = f.kind === 'pixel' ? await applyPixelFilterAsync(b.layer.surface, b.layer.id, null, f as PixelFilter, v, ctx, { tick }) : await applyAreaFilterAsync(b.layer.surface, b.layer.id, null, f as AreaFilter, v, ctx, { tick });
      expect(res.complete).toBe(true);
      // Neighbourhood filters work a block at a time with their margins: the same to within the rounding of the blur's own tails.
      expect(maxDiff(a.layer.surface, b.layer.surface)).toBeLessThanOrEqual(f.kind === 'pixel' ? 0 : 2);
    });

    it(`${f.id}: inside a selection`, async () => {
      const a = sample();
      const b = sample();
      const v = defaultValues(f);
      const rect: Rect = { x: 130, y: 90, w: 380, h: 300 };
      const sa = Selection.rect(700, 520, rect);
      const sb = Selection.rect(700, 520, rect);
      if (f.kind === 'pixel') applyPixelFilter(a.layer.surface, a.layer.id, sa, f, v, ctx);
      else applyAreaFilter(a.layer.surface, a.layer.id, sa, f, v, ctx);
      if (f.kind === 'pixel') await applyPixelFilterAsync(b.layer.surface, b.layer.id, sb, f as PixelFilter, v, ctx, { tick });
      else await applyAreaFilterAsync(b.layer.surface, b.layer.id, sb, f as AreaFilter, v, ctx, { tick });
      expect(maxDiff(a.layer.surface, b.layer.surface)).toBeLessThanOrEqual(f.kind === 'pixel' ? 0 : 2);
    });
  }

  it('a preview of part of the page shows exactly what the whole layer will have there, and leaves the rest alone', async () => {
    for (const f of Object.values(FILTERS)) {
      const whole = sample();
      const part = sample();
      const untouched = sample();
      const v = defaultValues(f);
      const view: Rect = { x: 200, y: 150, w: 260, h: 200 };
      if (f.kind === 'pixel') {
        await applyPixelFilterAsync(whole.layer.surface, whole.layer.id, null, f, v, ctx, { tick });
        await applyPixelFilterAsync(part.layer.surface, part.layer.id, null, f, v, ctx, { tick, limit: view });
      } else {
        await applyAreaFilterAsync(whole.layer.surface, whole.layer.id, null, f, v, ctx, { tick });
        await applyAreaFilterAsync(part.layer.surface, part.layer.id, null, f, v, ctx, { tick, limit: view });
      }
      const a = part.layer.surface.readRect(view);
      const b = whole.layer.surface.readRect(view);
      let worst = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i + 3] !== 0 || b[i + 3] !== 0) for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(a[i + c]! - b[i + c]!));
      expect(worst, f.id).toBeLessThanOrEqual(f.kind === 'pixel' ? 0 : 2);
      // Away from the view nothing changed (a pixel filter works by tiles, so only what is out of the tiles the view touches is checked).
      const away: Rect = { x: 0, y: 0, w: 120, h: 100 };
      expect(Buffer.from(part.layer.surface.readRect(away)).equals(Buffer.from(untouched.layer.surface.readRect(away)))).toBe(true);
    }
  });

  it('stops between pieces when asked and still hands back what was done, to be undone', async () => {
    const a = sample();
    const before = a.layer.surface.readRect({ x: 0, y: 0, w: 700, h: 520 });
    let pieces = 0;
    const res = await applyAreaFilterAsync(a.layer.surface, a.layer.id, null, FILTERS.gaussian as AreaFilter, { radius: 6 }, ctx, { tick, stop: () => pieces >= 3, onPiece: () => pieces++ });
    expect(res.complete).toBe(false);
    expect(res.patch).not.toBeNull();
    expect(Buffer.from(a.layer.surface.readRect({ x: 0, y: 0, w: 700, h: 520 })).equals(Buffer.from(before))).toBe(false);
    // Putting the patch's tiles back as they were restores the layer.
    for (const t of res.patch!.tiles) a.layer.surface.put(t.tx, t.ty, t.before ? t.before.slice() : undefined);
    expect(Buffer.from(a.layer.surface.readRect({ x: 0, y: 0, w: 700, h: 520 })).equals(Buffer.from(before))).toBe(true);
  });

  it('a preview made smaller looks like the full-size one (a few levels apart on average) and covers the same pixels', async () => {
    const wide: Record<string, Record<string, number>> = {
      gaussian: { radius: 14 },
      motion: { angle: 30, distance: 30 },
      lensblur: { radius: 12 },
      glow: { radius: 16, strength: 100, threshold: 0 },
      dropshadow: { dx: 12, dy: 10, blur: 12, opacity: 70 },
      radialblur: { mode: 0, amount: 20, cx: 50, cy: 50 },
      wave: { ampx: 12, lenx: 80, ampy: 6, leny: 90 },
    };
    for (const [id, v] of Object.entries(wide)) {
      const f = FILTERS[id] as AreaFilter;
      const full = sample();
      const small = sample();
      await applyAreaFilterAsync(full.layer.surface, full.layer.id, null, f, v, ctx, { tick });
      const r = await applyAreaFilterAsync(small.layer.surface, small.layer.id, null, f, v, ctx, { tick, scale: 2 });
      expect(r.complete).toBe(true);
      const a = full.layer.surface.readRect({ x: 0, y: 0, w: 700, h: 520 });
      const b = small.layer.surface.readRect({ x: 0, y: 0, w: 700, h: 520 });
      let sum = 0;
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] === 0 && b[i + 3] === 0) continue;
        n++;
        sum += (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) + Math.abs(a[i + 3]! - b[i + 3]!)) / 4;
      }
      expect(sum / n, id).toBeLessThan(12);
    }
  });

  it('a filter is previewed smaller only when the page is big and its lengths stay a few pixels long', () => {
    const g = FILTERS.gaussian as AreaFilter;
    expect(previewScale(g, { radius: 20 }, 100_000)).toBe(1); // a small area: nothing to save
    expect(previewScale(g, { radius: 20 }, 2_000_000)).toBe(2);
    expect(previewScale(g, { radius: 20 }, 20_000_000)).toBe(4);
    expect(previewScale(g, { radius: 5 }, 20_000_000)).toBe(1); // 5 shrunk by 2 would be 2.5: another picture
    expect(previewScale(FILTERS.sharpen as AreaFilter, { amount: 100, radius: 20 }, 20_000_000)).toBe(1); // fine detail: always full size
    expect(previewScale(FILTERS.radialblur as AreaFilter, { mode: 0, amount: 20, cx: 50, cy: 50 }, 20_000_000)).toBe(4);
  });
});
