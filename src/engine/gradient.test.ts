import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { applyGradient, colorAt, DITHER_16, ditherChannel, extendPosition } from './gradient';
import { GRADIENT_CHIPS, GRADIENT_IDS, presetStops } from './gradient-presets';
import { History, patchCommand } from './history';
import { Selection } from './selection';
import { fillLayer } from './test-utils';

const W = 600; // crosses a tile border
const H = 100;

describe('colorAt', () => {
  const stops = presetStops('foreground-to-background', [0, 0, 0], [200, 100, 50]).stops;

  it('runs between the stops and stays at the ends outside them', () => {
    expect(colorAt(stops, 0)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(colorAt(stops, 1)).toEqual({ r: 200, g: 100, b: 50, a: 1 });
    expect(colorAt(stops, 0.5)).toEqual({ r: 100, g: 50, b: 25, a: 1 });
    expect(colorAt(stops, -3).r).toBe(0);
    expect(colorAt(stops, 7).r).toBe(200);
  });

  it('fading to transparent keeps the colour', () => {
    const fade = presetStops('foreground-to-transparent', [200, 0, 0], [0, 0, 0]).stops;
    const mid = colorAt(fade, 0.5);
    expect(mid.a).toBeCloseTo(0.5, 6);
    expect([mid.r, mid.g, mid.b]).toEqual([200, 0, 0]);
  });

  it('a hard stop makes a sharp edge', () => {
    const stripes = presetStops('stripe', [0, 0, 0], [255, 255, 255]).stops;
    expect(colorAt(stripes, 0.2).r).toBe(0);
    expect(colorAt(stripes, 0.3).r).toBe(255);
  });
});

describe('applyGradient', () => {
  const fgToBg = presetStops('foreground-to-background', [0, 0, 0], [250, 250, 250]).stops;

  it('paints a linear gradient across tiles and undoes', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'g');
    const patch = applyGradient(layer.surface, layer.id, null, { shape: 'linear', from: { x: 0, y: 0 }, to: { x: W, y: 0 }, stops: fgToBg })!;
    expect(layer.surface.pixel(0, 50)[0]).toBeLessThan(5);
    expect(Math.abs(layer.surface.pixel(300, 50)[0] - 125)).toBeLessThan(3);
    expect(layer.surface.pixel(W - 1, 50)[0]).toBeGreaterThan(245);
    expect(layer.surface.pixel(300, 5)[0]).toBe(layer.surface.pixel(300, 90)[0]); // constant across the gradient line
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.alphaAt(300, 50)).toBe(0);
  });

  it('radial gradients are the same all round', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'r');
    applyGradient(layer.surface, layer.id, null, { shape: 'radial', from: { x: 300, y: 50 }, to: { x: 400, y: 50 }, stops: fgToBg });
    expect(layer.surface.pixel(300, 50)[0]).toBeLessThan(5);
    expect(Math.abs(layer.surface.pixel(350, 50)[0] - layer.surface.pixel(300, 100 - 1)[0])).toBeLessThan(40);
    expect(layer.surface.pixel(500, 50)[0]).toBeGreaterThan(245); // beyond the radius it stays at the end colour
  });

  it('stays inside the selection and lays over what is there', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'o');
    fillLayer(layer, [255, 0, 0, 255]);
    const sel = Selection.rect(W, H, { x: 100, y: 0, w: 100, h: H });
    const fade = presetStops('foreground-to-transparent', [0, 0, 255], [0, 0, 0]).stops;
    applyGradient(layer.surface, layer.id, sel, { shape: 'linear', from: { x: 100, y: 0 }, to: { x: 200, y: 0 }, stops: fade });
    expect(layer.surface.pixel(50, 50)).toEqual([255, 0, 0, 255]); // outside
    expect(layer.surface.pixel(101, 50)[2]).toBeGreaterThan(240); // mostly blue where the gradient is opaque
    expect(layer.surface.pixel(198, 50)[0]).toBeGreaterThan(240); // mostly the old red at the transparent end
  });

  it('erases with the erase gradient', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'e');
    fillLayer(layer, [10, 10, 10, 255]);
    const { stops, mode } = presetStops('gradient-erase', [0, 0, 0], [0, 0, 0]);
    applyGradient(layer.surface, layer.id, null, { shape: 'linear', from: { x: 0, y: 0 }, to: { x: W, y: 0 }, stops, mode });
    expect(layer.surface.alphaAt(2, 50)).toBeLessThan(10); // erased at the start
    expect(layer.surface.alphaAt(W - 3, 50)).toBeGreaterThan(245); // untouched at the end
  });

  it('does nothing when nothing would change', () => {
    const doc = createDocument(W, H, 300);
    const layer = addLayer(doc, 'n');
    const clear = presetStops('foreground-to-transparent', [0, 0, 0], [0, 0, 0]).stops.map((s) => ({ ...s, alpha: 0 }));
    expect(applyGradient(layer.surface, layer.id, null, { shape: 'linear', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, stops: clear })).toBeNull();
  });
});

describe('repeat types (CSP 0..3)', () => {
  it('extends the position past the ends', () => {
    expect(extendPosition(-0.5, 'clamp')).toBe(0);
    expect(extendPosition(1.5, 'clamp')).toBe(1);
    expect(extendPosition(1.25, 'repeat')).toBeCloseTo(0.25);
    expect(extendPosition(-0.25, 'repeat')).toBeCloseTo(0.75);
    expect(extendPosition(1.25, 'mirror')).toBeCloseTo(0.75);
    expect(extendPosition(2.25, 'mirror')).toBeCloseTo(0.25);
    expect(extendPosition(-0.25, 'mirror')).toBeCloseTo(0.25);
    expect(extendPosition(1.5, 'none')).toBeNull();
    expect(extendPosition(0.5, 'none')).toBe(0.5);
  });

  it('leaves the pixels past the end untouched with "none" and repeats with "repeat"', () => {
    const stops = presetStops('foreground-to-background', [0, 0, 0], [200, 200, 200]).stops;
    const doc = createDocument(W, H, 300);
    const none = addLayer(doc, 'n');
    applyGradient(none.surface, none.id, null, { shape: 'linear', from: { x: 100, y: 0 }, to: { x: 200, y: 0 }, stops, repeat: 'none' });
    expect(none.surface.alphaAt(50, 50)).toBe(0);
    expect(none.surface.alphaAt(150, 50)).toBe(255);
    expect(none.surface.alphaAt(300, 50)).toBe(0);
    const rep = addLayer(doc, 'r');
    applyGradient(rep.surface, rep.id, null, { shape: 'linear', from: { x: 100, y: 0 }, to: { x: 200, y: 0 }, stops, repeat: 'repeat' });
    expect(rep.surface.alphaAt(300, 50)).toBe(255);
  });
});

describe('dither', () => {
  it('uses a 16x16 Bayer matrix where every threshold appears once', () => {
    expect(new Set(DITHER_16).size).toBe(256);
    expect(DITHER_16[1]).toBe(128);
    expect(DITHER_16[16]).toBe(192);
  });

  it('rounds a channel to a neighbouring whole value depending on the position', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++) {
        const v = ditherChannel(100.5, x, y);
        expect(v).toBeGreaterThanOrEqual(99);
        expect(v).toBeLessThanOrEqual(101);
        seen.add(v);
      }
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expect(ditherChannel(0, 3, 5)).toBe(0);
    expect(ditherChannel(255, 3, 5)).toBe(255);
  });
});

describe('colorAt with an empty end', () => {
  it('borrows the colour of the other end', () => {
    const stops = [
      { t: 0, color: [0, 0, 0] as const, alpha: 0 },
      { t: 1, color: [200, 100, 50] as const, alpha: 1 },
    ];
    expect(colorAt(stops, 0.5)).toEqual({ r: 200, g: 100, b: 50, a: 0.5 });
  });
});

describe('manga (halftone) gradient', () => {
  const ink = [0, 0, 0] as const;
  const halftone = { shape: 'dot' as const, lpi: 60, angle: 45, dpi: 300, ink };

  it('black to transparent becomes dots that grow from nothing to solid, and nothing in between is grey', () => {
    const doc = createDocument(400, 100, 300);
    const layer = addLayer(doc, 'l');
    const stops = presetStops('foreground-to-transparent', [0, 0, 0], [255, 255, 255]).stops;
    const patch = applyGradient(layer.surface, layer.id, null, { shape: 'linear', from: { x: 0, y: 0 }, to: { x: 400, y: 0 }, stops, halftone });
    expect(patch).not.toBeNull();
    const band = (x0: number): number => {
      let sum = 0;
      for (let y = 0; y < 100; y++) for (let x = x0; x < x0 + 20; x++) sum += layer.surface.alphaAt(x, y);
      return sum / (100 * 20 * 255);
    };
    expect(band(0)).toBeGreaterThan(0.9); // solid at the start
    expect(band(380)).toBeLessThan(0.05); // nothing at the end
    expect(band(100)).toBeGreaterThan(band(200));
    expect(band(200)).toBeGreaterThan(band(300));
    let empty = 0;
    let inked = 0;
    for (let x = 190; x < 210; x++)
      for (let y = 0; y < 100; y++) {
        const al = layer.surface.alphaAt(x, y);
        if (al === 0) empty++;
        else if (al >= 200) inked++;
      }
    expect(empty).toBeGreaterThan(0.2 * 2000); // in the middle the page is a screen of dots, not a flat grey
    expect(inked).toBeGreaterThan(0.2 * 2000);
    expect(layer.surface.pixel(10, 10).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('the screen follows the document resolution: a lower lpi gives bigger dots', () => {
    const count = (lpi: number): number => {
      const doc = createDocument(300, 300, 300);
      const layer = addLayer(doc, 'l');
      applyGradient(layer.surface, layer.id, null, { shape: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ t: 0, color: [0, 0, 0], alpha: 0.3 }, { t: 1, color: [0, 0, 0], alpha: 0.3 }], halftone: { ...halftone, lpi } });
      let changes = 0;
      for (let x = 1; x < 300; x++) if (layer.surface.alphaAt(x, 150) !== layer.surface.alphaAt(x - 1, 150)) changes++;
      return changes;
    };
    expect(count(30)).toBeLessThan(count(90));
  });

  it('a dark gradient to white also fades the dots out, and undo clears them', () => {
    const doc = createDocument(300, 100, 300);
    const layer = addLayer(doc, 'l');
    const stops = presetStops('foreground-to-background', [0, 0, 0], [255, 255, 255]).stops;
    const patch = applyGradient(layer.surface, layer.id, null, { shape: 'linear', from: { x: 0, y: 0 }, to: { x: 300, y: 0 }, stops, halftone })!;
    let sum = 0;
    for (let y = 0; y < 100; y++) for (let x = 280; x < 300; x++) sum += layer.surface.alphaAt(x, y);
    expect(sum).toBeLessThan(0.05 * 20 * 100 * 255); // almost no ink where the gradient has reached white
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.alphaAt(5, 5)).toBe(0);
  });
});

describe('the gradient library', () => {
  const main = [10, 20, 30] as const;
  const sub = [200, 210, 220] as const;

  it('has unique ids and every preset reads into ordered stops', () => {
    expect(new Set(GRADIENT_IDS).size).toBe(GRADIENT_IDS.length);
    expect(GRADIENT_IDS.length).toBeGreaterThan(80);
    expect(GRADIENT_CHIPS.map((c) => c.id)).toEqual(['basic', 'landscape', 'materials', 'color', 'manga']);
    for (const id of GRADIENT_IDS) {
      const { stops } = presetStops(id, main, sub);
      expect(stops.length, id).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < stops.length; i++) {
        expect(Number.isNaN(stops[i]!.t) || Number.isNaN(stops[i]!.alpha), id).toBe(false);
        if (i > 0) expect(stops[i]!.t, id).toBeGreaterThanOrEqual(stops[i - 1]!.t);
        expect(stops[i]!.color.every((c) => c >= 0 && c <= 255 && !Number.isNaN(c)), id).toBe(true);
      }
      expect(stops[0]!.t, id).toBe(0);
      expect(stops[stops.length - 1]!.t, id).toBe(1);
    }
  });

  it('keeps the older gradients as they were', () => {
    expect(presetStops('rainbow', main, sub).stops).toHaveLength(6);
    expect(presetStops('midday-sky', main, sub).stops[1]).toEqual({ t: 0.7, color: [150, 200, 250], alpha: 1 });
    expect(presetStops('stripe', main, sub).stops).toHaveLength(8);
  });

  it('background colour stripes are the stripes the other way round', () => {
    const a = presetStops('stripe', main, sub).stops;
    const b = presetStops('background-color-stripe', main, sub).stops;
    expect(colorAt(a, 0.1).r).toBe(10);
    expect(colorAt(b, 0.1).r).toBe(200);
    expect(colorAt(b, 0.3).r).toBe(10);
  });

  it('the shape and the halftone belong to the preset, an unknown id fades the foreground', () => {
    expect(presetStops('sun', main, sub).shape).toBe('radial');
    expect(presetStops('bubble', main, sub).shape).toBe('conic');
    expect(presetStops('sunset', main, sub).shape).toBeUndefined();
    expect(presetStops('manga-gradient', main, sub).halftone).toBeDefined();
    expect(presetStops('gradient-erase', main, sub).mode).toBe('erase');
    expect(presetStops('nope', main, sub).stops.map((s) => s.alpha)).toEqual([1, 0]);
  });

  it('a conic gradient turns once around its centre, from the direction of the drag', () => {
    const doc = createDocument(100, 100, 300);
    const layer = addLayer(doc, 'c');
    const stops = presetStops('foreground-to-background', [0, 0, 0], [255, 255, 255]).stops;
    applyGradient(layer.surface, layer.id, null, { shape: 'conic', from: { x: 50, y: 50 }, to: { x: 90, y: 50 }, stops });
    const at = (x: number, y: number): number => layer.surface.pixel(x, y)[0]!;
    expect(at(80, 49)).toBeGreaterThan(240); // just before a full turn: the end colour
    expect(at(80, 51)).toBeLessThan(15); // just after the start direction: the start colour
    expect(at(20, 50)).toBeGreaterThan(110); // half way round: in the middle
    expect(at(20, 50)).toBeLessThan(145);
  });
});
