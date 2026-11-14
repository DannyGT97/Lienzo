import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { FILTERS, applyAreaFilter, applyPixelFilter, curveLut, defaultValues, hslToRgb, rgbToHsl, type AreaFilter, type FilterContext, type PixelFilter } from './filters';
import { History, patchCommand } from './history';
import { Selection } from './selection';
import { fillLayer, setPixel } from './test-utils';

const ctx: FilterContext = { main: [10, 20, 30], sub: [250, 240, 230] };
const pix = FILTERS as Record<string, PixelFilter>;
const area = FILTERS as Record<string, AreaFilter>;

function layerWith(color: [number, number, number, number]) {
  const doc = createDocument(300, 100, 300);
  const layer = addLayer(doc, 'l');
  fillLayer(layer, color);
  return { doc, layer };
}

describe('colour conversions', () => {
  it('goes round trip', () => {
    for (const c of [[255, 0, 0], [12, 200, 90], [128, 128, 128], [0, 0, 0], [250, 250, 20]] as const) {
      const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
      const back = hslToRgb(h, s, l);
      c.forEach((v, i) => expect(Math.abs(back[i]! - v)).toBeLessThan(1));
    }
  });
});

describe('pixel filters', () => {
  it('invert, and undo through the history', () => {
    const { doc, layer } = layerWith([10, 100, 250, 255]);
    const patch = applyPixelFilter(layer.surface, layer.id, null, pix.invert!, {}, ctx)!;
    expect(layer.surface.pixel(150, 50)).toEqual([245, 155, 5, 255]);
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.pixel(150, 50)).toEqual([10, 100, 250, 255]);
  });

  it('only touches the selection, in proportion to its coverage', () => {
    const { layer } = layerWith([0, 0, 0, 255]);
    const sel = Selection.rect(300, 100, { x: 100, y: 0, w: 50.5, h: 100 });
    applyPixelFilter(layer.surface, layer.id, sel, pix.invert!, {}, ctx);
    expect(layer.surface.pixel(120, 10)).toEqual([255, 255, 255, 255]);
    expect(layer.surface.pixel(50, 10)).toEqual([0, 0, 0, 255]);
    expect(layer.surface.pixel(150, 10)[0]).toBe(128); // the half covered column
  });

  it('leaves transparent pixels alone', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    setPixel(layer, 5, 5, [10, 10, 10, 255]);
    expect(applyPixelFilter(layer.surface, layer.id, null, pix.invert!, {}, ctx)).not.toBeNull();
    expect(layer.surface.pixel(6, 5)).toEqual([0, 0, 0, 0]);
    expect(layer.surface.pixel(5, 5)).toEqual([245, 245, 245, 255]);
  });

  it('brightness and contrast', () => {
    const { layer } = layerWith([100, 100, 100, 255]);
    applyPixelFilter(layer.surface, layer.id, null, pix.brightness!, { brightness: 20, contrast: 0 }, ctx);
    expect(layer.surface.pixel(0, 0)[0]).toBe(151);
    const dark = layerWith([100, 100, 100, 255]).layer;
    applyPixelFilter(dark.surface, dark.id, null, pix.brightness!, { brightness: 0, contrast: 50 }, ctx);
    expect(dark.surface.pixel(0, 0)[0]).toBeLessThan(100); // below the middle grey gets darker with more contrast
  });

  it('hue shift turns red to green at 120 degrees and keeps grey', () => {
    const red = layerWith([255, 0, 0, 255]).layer;
    applyPixelFilter(red.surface, red.id, null, pix.hsv!, { hue: 120, sat: 0, light: 0 }, ctx);
    expect(red.surface.pixel(0, 0).slice(0, 3)).toEqual([0, 255, 0]);
    const grey = layerWith([90, 90, 90, 255]).layer;
    applyPixelFilter(grey.surface, grey.id, null, pix.hsv!, { hue: 77, sat: 50, light: 0 }, ctx);
    expect(grey.surface.pixel(0, 0).slice(0, 3)).toEqual([90, 90, 90]);
  });

  it('posterize, levels, binarize', () => {
    const a = layerWith([100, 130, 200, 255]).layer;
    applyPixelFilter(a.surface, a.id, null, pix.posterize!, { levels: 2 }, ctx);
    expect(a.surface.pixel(0, 0).slice(0, 3)).toEqual([0, 255, 255]);
    const b = layerWith([100, 100, 100, 255]).layer;
    applyPixelFilter(b.surface, b.id, null, pix.levels!, { black: 50, white: 150, gamma: 100 }, ctx);
    expect(b.surface.pixel(0, 0)[0]).toBe(128);
    const c = layerWith([200, 200, 200, 255]).layer;
    applyPixelFilter(c.surface, c.id, null, pix.binarize!, { threshold: 128 }, ctx);
    expect(c.surface.pixel(0, 0).slice(0, 3)).toEqual([255, 255, 255]);
    applyPixelFilter(c.surface, c.id, null, pix.invert!, {}, ctx);
    applyPixelFilter(c.surface, c.id, null, pix.binarize!, { threshold: 128 }, ctx);
    expect(c.surface.pixel(0, 0).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('gradient map and brightness to opacity use the main colour', () => {
    const g = layerWith([0, 0, 0, 255]).layer;
    applyPixelFilter(g.surface, g.id, null, pix.gradientmap!, {}, ctx);
    expect(g.surface.pixel(0, 0).slice(0, 3)).toEqual([10, 20, 30]);
    const ink = layerWith([255, 255, 255, 255]).layer;
    setPixel(ink, 3, 3, [0, 0, 0, 255]);
    applyPixelFilter(ink.surface, ink.id, null, pix.brightnessalpha!, {}, ctx);
    expect(ink.surface.pixel(10, 10)[3]).toBe(0); // white paper disappears
    expect(ink.surface.pixel(3, 3)).toEqual([10, 20, 30, 255]); // a black line turns into the main colour, solid
  });
});

describe('neighbourhood filters', () => {
  it('a blur spreads a dot out and keeps its total weight', () => {
    const { doc, layer } = layerWith([0, 0, 0, 0]);
    setPixel(layer, 150, 50, [0, 0, 0, 255]);
    const r = applyAreaFilter(layer.surface, layer.id, null, area.gaussian!, { radius: 6 }, ctx);
    expect(r && 'patch' in r && r.patch).toBeTruthy();
    const centre = layer.surface.alphaAt(150, 50);
    expect(centre).toBeLessThan(255);
    expect(centre).toBeGreaterThan(layer.surface.alphaAt(156, 50));
    expect(layer.surface.alphaAt(153, 50)).toBeGreaterThan(0);
    let sum = 0;
    for (let y = 20; y < 80; y++) for (let x = 120; x < 180; x++) sum += layer.surface.alphaAt(x, y);
    expect(sum).toBeGreaterThan(255 * 0.93);
    expect(sum).toBeLessThan(255 * 1.07);
    if (r && 'patch' in r && r.patch) {
      const h = new History();
      h.push(patchCommand(doc, r.patch));
      h.undo();
      expect(layer.surface.alphaAt(150, 50)).toBe(255);
      expect(layer.surface.alphaAt(153, 50)).toBe(0);
    }
  });

  it('a limit keeps the filter to that part of the layer, the same as a rectangular selection', () => {
    const make = () => {
      const { layer } = layerWith([0, 0, 0, 0]);
      for (let y = 10; y < 90; y += 7) for (let x = 20; x < 280; x += 9) setPixel(layer, x, y, [200, 30, 60, 255]);
      return layer;
    };
    const rect = { x: 100, y: 20, w: 120, h: 60 };
    const a = make();
    const b = make();
    const untouched = make();
    applyAreaFilter(a.surface, a.id, null, area.gaussian!, { radius: 4 }, ctx, rect);
    applyAreaFilter(b.surface, b.id, Selection.rect(300, 100, rect), area.gaussian!, { radius: 4 }, ctx);
    let differ = 0;
    let changedOutside = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 300; x++) {
        if (a.surface.alphaAt(x, y) !== b.surface.alphaAt(x, y)) differ++;
        const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        if (!inside && a.surface.alphaAt(x, y) !== untouched.surface.alphaAt(x, y)) changedOutside++;
      }
    }
    expect(differ).toBe(0);
    expect(changedOutside).toBe(0);
    expect(a.surface.alphaAt(103, 24)).not.toBe(untouched.surface.alphaAt(103, 24));
  });

  it('a blur inside the limit may spread over empty pixels of it, as with a selection of that rectangle', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    setPixel(layer, 150, 50, [0, 0, 0, 255]);
    const rect = { x: 100, y: 20, w: 120, h: 60 };
    applyAreaFilter(layer.surface, layer.id, null, area.gaussian!, { radius: 6 }, ctx, rect);
    expect(layer.surface.alphaAt(153, 50)).toBeGreaterThan(0);
    const b = layerWith([0, 0, 0, 0]).layer;
    setPixel(b, 150, 50, [0, 0, 0, 255]);
    applyAreaFilter(b.surface, b.id, Selection.rect(300, 100, rect), area.gaussian!, { radius: 6 }, ctx);
    for (let x = 140; x < 160; x++) expect(layer.surface.alphaAt(x, 50)).toBe(b.surface.alphaAt(x, 50));
  });

  it('a layer without content and no limit inside it gives nothing to filter', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    setPixel(layer, 10, 10, [0, 0, 0, 255]);
    expect(applyAreaFilter(layer.surface, layer.id, null, area.gaussian!, { radius: 4 }, ctx, { x: 200, y: 50, w: 50, h: 40 })).toBeNull();
  });

  it('motion blur smears along its angle only', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    setPixel(layer, 150, 50, [0, 0, 0, 255]);
    applyAreaFilter(layer.surface, layer.id, null, area.motion!, { angle: 0, distance: 21 }, ctx);
    expect(layer.surface.alphaAt(145, 50)).toBeGreaterThan(0);
    expect(layer.surface.alphaAt(150, 55)).toBe(0);
  });

  it('pixelate averages blocks and sharpen raises the contrast of an edge', () => {
    const p = layerWith([0, 0, 0, 255]).layer;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 150; x++) setPixel(p, x, y, [255, 255, 255, 255]);
    applyAreaFilter(p.surface, p.id, null, area.pixelate!, { size: 20 }, ctx);
    expect(p.surface.pixel(145, 5)[0]).toBe(p.surface.pixel(141, 7)[0]); // same block, same value
    const s = layerWith([0, 0, 0, 255]).layer;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 150; x++) setPixel(s, x, y, [200, 200, 200, 255]);
    for (let y = 0; y < 100; y++) for (let x = 150; x < 300; x++) setPixel(s, x, y, [100, 100, 100, 255]);
    applyAreaFilter(s.surface, s.id, null, area.sharpen!, { amount: 200, radius: 3 }, ctx);
    expect(s.surface.pixel(149, 50)[0]).toBeGreaterThan(200); // the light side of the edge gets lighter
    expect(s.surface.pixel(150, 50)[0]).toBeLessThan(100); // and the dark side darker
  });

  it('does nothing on an empty layer and refuses blocks that are too big', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    expect(applyAreaFilter(layer.surface, layer.id, null, area.gaussian!, defaultValues(area.gaussian!), ctx)).toBeNull();
    const big = createDocument(9000, 9000, 300);
    const l = addLayer(big, 'x');
    setPixel(l, 10, 10, [0, 0, 0, 255]);
    setPixel(l, 8900, 8900, [0, 0, 0, 255]);
    expect(applyAreaFilter(l.surface, l.id, null, area.gaussian!, { radius: 4 }, ctx)).toEqual({ tooLarge: true });
  });
});

describe('tone curve and colour match', () => {
  it('the identity curve changes nothing and moving a handle bends the midtones', () => {
    const a = layerWith([128, 64, 200, 255]).layer;
    applyPixelFilter(a.surface, a.id, null, pix.tonecurve!, defaultValues(pix.tonecurve!), ctx);
    expect(a.surface.pixel(10, 10)).toEqual([128, 64, 200, 255]);
    const b = layerWith([128, 128, 128, 255]).layer;
    applyPixelFilter(b.surface, b.id, null, pix.tonecurve!, { ...defaultValues(pix.tonecurve!), c128: 200 }, ctx);
    expect(b.surface.pixel(10, 10)[0]).toBe(200);
  });

  it('the curve is monotone: raising the shadows never darkens a brighter level', () => {
    const lut = curveLut([0, 64, 128, 192, 255], [0, 140, 150, 160, 255]);
    expect(lut[64]).toBe(140);
    for (let i = 1; i < 256; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
  });

  it('colour match keeps the lightness and takes the hue of the main colour', () => {
    const { layer } = layerWith([200, 200, 200, 255]);
    applyPixelFilter(layer.surface, layer.id, null, pix.colormatch!, { amount: 100 }, { main: [255, 0, 0], sub: [0, 0, 0] });
    const [r, g, b] = layer.surface.pixel(5, 5);
    expect(r).toBeGreaterThan(g);
    expect(g).toBe(b);
  });
});

describe('effects', () => {
  const dot = (): ReturnType<typeof layerWith>['layer'] => {
    const { layer } = layerWith([0, 0, 0, 0]);
    for (let y = 45; y < 55; y++) for (let x = 145; x < 155; x++) setPixel(layer, x, y, [0, 0, 0, 255]);
    return layer;
  };

  it('lens blur spreads a square into a soft round halo', () => {
    const l = dot();
    applyAreaFilter(l.surface, l.id, null, area.lensblur!, { radius: 6 }, ctx);
    expect(l.surface.alphaAt(150, 50)).toBeGreaterThan(0);
    expect(l.surface.alphaAt(150, 50)).toBeLessThan(255);
    expect(l.surface.alphaAt(143, 50)).toBeGreaterThan(0);
    expect(l.surface.alphaAt(130, 50)).toBe(0);
  });

  it('radial blur leaves the centre alone and smears away from it', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 300; x++) setPixel(layer, x, y, x < 150 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    applyAreaFilter(layer.surface, layer.id, null, area.radialblur!, { mode: 1, amount: 30, cx: 0, cy: 50 }, ctx);
    expect(layer.surface.pixel(2, 50)[0]).toBeGreaterThan(250); // next to the centre nothing moves
    const edge = layer.surface.pixel(148, 50)[0]!;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('crystallize makes flat cells and keeps a flat colour flat', () => {
    const flat = layerWith([90, 120, 200, 255]).layer;
    applyAreaFilter(flat.surface, flat.id, null, area.crystallize!, { size: 20 }, ctx);
    expect(flat.surface.pixel(77, 33)).toEqual([90, 120, 200, 255]);
    const g = layerWith([0, 0, 0, 255]).layer;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 300; x++) setPixel(g, x, y, [(x * 255) / 300, 0, 0, 255]);
    applyAreaFilter(g.surface, g.id, null, area.crystallize!, { size: 30 }, ctx);
    let runs = 0;
    for (let x = 1; x < 300; x++) if (g.surface.pixel(x, 50)[0] !== g.surface.pixel(x - 1, 50)[0]) runs++;
    expect(runs).toBeLessThan(60); // a ramp has become a few dozen steps
  });

  it('glow lights up the surroundings of a bright shape', () => {
    const { layer } = layerWith([0, 0, 0, 0]);
    for (let y = 45; y < 55; y++) for (let x = 145; x < 155; x++) setPixel(layer, x, y, [255, 255, 255, 255]);
    applyAreaFilter(layer.surface, layer.id, null, area.glow!, { radius: 10, strength: 150, threshold: 0 }, ctx);
    expect(layer.surface.alphaAt(140, 50)).toBeGreaterThan(0);
    expect(layer.surface.alphaAt(150, 50)).toBe(255);
    const dark = dot();
    applyAreaFilter(dark.surface, dark.id, null, area.glow!, { radius: 10, strength: 150, threshold: 128 }, ctx);
    expect(dark.surface.alphaAt(140, 50)).toBe(0); // black is below the threshold: no glow
  });

  it('drop shadow lands offset, in the main colour, and only behind the shape', () => {
    const l = dot();
    applyAreaFilter(l.surface, l.id, null, area.dropshadow!, { dx: 12, dy: 0, blur: 0, opacity: 100 }, { main: [200, 10, 10], sub: [0, 0, 0] });
    expect(l.surface.pixel(160, 50)).toEqual([200, 10, 10, 255]);
    expect(l.surface.pixel(150, 50)).toEqual([0, 0, 0, 255]); // the shape itself is untouched
    expect(l.surface.alphaAt(130, 50)).toBe(0);
  });

  it('waves move rows sideways and a zero amplitude is a no-op', () => {
    const mk = (): ReturnType<typeof layerWith>['layer'] => {
      const { layer } = layerWith([0, 0, 0, 0]);
      for (let y = 0; y < 100; y++) for (let x = 100; x < 120; x++) setPixel(layer, x, y, [0, 0, 0, 255]);
      return layer;
    };
    const a = mk();
    applyAreaFilter(a.surface, a.id, null, area.wave!, { ampx: 0, lenx: 60, ampy: 0, leny: 60 }, ctx);
    expect(a.surface.alphaAt(110, 40)).toBe(255);
    const b = mk();
    applyAreaFilter(b.surface, b.id, null, area.wave!, { ampx: 10, lenx: 40, ampy: 0, leny: 60 }, ctx);
    const first = (y: number): number => {
      for (let x = 80; x < 140; x++) if (b.surface.alphaAt(x, y) > 128) return x;
      return -1;
    };
    expect(first(10)).not.toBe(first(20)); // the bar waves
  });
});
