import { describe, expect, it } from 'vitest';
import { Stroke, defaultBrush } from './brush';
import { addLayer, createDocument, paintTarget } from './document';
import { History, patchCommand } from './history';
import { Selection, encloseArea, eraseOutside, eraseSelection, fillSelection, selectColorRange, wandSelect } from './selection';
import { livewire } from './livewire';
import { fillLayer, setPixel } from './test-utils';
import { TILE } from './tiles';

const W = 600; // wider than one tile so tile borders are crossed

describe('Selection shapes', () => {
  it('rectangle: full inside, partial on fractional edges, nothing outside', () => {
    const s = Selection.rect(W, 100, { x: 10.5, y: 10, w: 20, h: 10 });
    expect(s.at(20, 15)).toBe(255);
    expect(s.at(10, 15)).toBe(128); // half of the first column
    expect(s.at(30, 15)).toBe(128); // half of the last column
    expect(s.at(9, 15)).toBe(0);
    expect(s.at(20, 25)).toBe(0);
    expect(s.bounds()).toEqual({ x: 10, y: 10, w: 21, h: 10 });
  });

  it('polygon: a right triangle covers about half of its box, with soft diagonal', () => {
    const s = Selection.polygon(W, 100, [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ]);
    let total = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) total += s.at(x, y) / 255;
    expect(total).toBeGreaterThan(780);
    expect(total).toBeLessThan(820);
    expect(s.at(2, 2)).toBe(255);
    expect(s.at(38, 38)).toBe(0);
  });

  it('ellipse is symmetric and excludes the box corners', () => {
    const s = Selection.ellipse(W, 100, { x: 10, y: 10, w: 40, h: 20 });
    expect(s.at(30, 20)).toBe(255);
    expect(s.at(10, 10)).toBe(0);
    expect(s.at(29, 20)).toBe(s.at(30, 20));
  });
});

describe('Selection operations', () => {
  const box = (x: number, w: number) => Selection.rect(W, 100, { x, y: 0, w, h: 10 });

  it('add, subtract and intersect', () => {
    const a = box(0, 300);
    a.combine(box(250, 200), 'add');
    expect(a.at(449, 5)).toBe(255);
    expect(a.at(451, 5)).toBe(0);
    a.combine(box(100, 100), 'subtract');
    expect(a.at(150, 5)).toBe(0);
    expect(a.at(50, 5)).toBe(255);
    a.combine(box(0, 60), 'intersect');
    expect(a.at(50, 5)).toBe(255);
    expect(a.at(70, 5)).toBe(0);
  });

  it('invert flips every pixel, including the untouched tiles', () => {
    const s = box(0, 10);
    s.invert();
    expect(s.at(5, 5)).toBe(0);
    expect(s.at(500, 50)).toBe(255);
    expect(Selection.all(W, 100).at(3, 3)).toBe(255);
    expect(Selection.all(W, 100).isEmpty).toBe(false);
    s.invert();
    expect(s.at(5, 5)).toBe(255);
  });

  it('grow and shrink move the border by whole pixels, also across tile edges', () => {
    const s = box(250, 12); // spans the tile border at x = 256
    s.grow(3);
    expect(s.at(247, 5)).toBe(255);
    expect(s.at(246, 5)).toBe(0);
    expect(s.at(264, 5)).toBe(255);
    expect(s.at(265, 5)).toBe(0);
    s.grow(-3);
    expect(s.at(249, 5)).toBe(0);
    expect(s.at(250, 5)).toBe(255);
  });

  it('grow uses a disc: straight edges move r pixels, corners stay rounded', () => {
    const s = Selection.rect(W, 100, { x: 100, y: 40, w: 20, h: 20 });
    s.grow(4);
    expect(s.at(96, 50)).toBe(255); // straight side moved by 4
    expect(s.at(95, 50)).toBe(0);
    expect(s.at(96, 36)).toBe(0); // the square corner (4, 4) is outside a radius-4 disc
    expect(s.at(98, 37)).toBe(255);
    s.grow(-4);
    expect(s.at(100, 50)).toBe(255);
    expect(s.at(99, 50)).toBe(0);
  });

  it('smooth fades a hard edge over a pixel on each side without moving it or touching the inside', () => {
    const s = box(100, 10);
    s.smooth();
    expect(s.at(98, 5)).toBe(0);
    expect(s.at(99, 5)).toBeGreaterThan(0); // the rim reaches one pixel outside…
    expect(s.at(99, 5)).toBeLessThan(128);
    expect(s.at(100, 5)).toBeGreaterThan(128); // …and one inside
    expect(s.at(100, 5)).toBeLessThan(255);
    expect(s.at(104, 5)).toBe(255);
    expect(s.at(99, 5) + s.at(100, 5)).toBeGreaterThanOrEqual(254); // the two rim pixels add up to one whole pixel
    expect(s.at(99, 5) + s.at(100, 5)).toBeLessThanOrEqual(256);
  });

  it('smooth does not fade an area where it meets the page border', () => {
    const none = Selection.rect(W, 100, { x: 0, y: 0, w: 0, h: 0 });
    none.smooth();
    expect(none.isEmpty).toBe(true);
    const corner = Selection.rect(W, 100, { x: 0, y: 0, w: 20, h: 20 });
    corner.smooth();
    expect(corner.at(0, 0)).toBe(255);
    expect(corner.at(0, 10)).toBe(255);
    expect(corner.at(10, 0)).toBe(255);
    expect(corner.at(20, 10)).toBeLessThan(128); // the inner edge still fades
    expect(corner.at(19, 10)).toBeGreaterThan(128);
  });

  it('grow rounds half away from zero and moves a non-zero request by at least one pixel', () => {
    const a = box(100, 10);
    a.grow(0.3);
    expect(a.at(99, 5)).toBe(255);
    expect(a.at(98, 5)).toBe(0);
    const b = box(100, 10);
    b.grow(-0.3);
    expect(b.at(100, 5)).toBe(0);
    expect(b.at(101, 5)).toBe(255);
    const c = box(100, 10);
    c.grow(0);
    expect(c.at(99, 5)).toBe(0);
    expect(c.at(100, 5)).toBe(255);
    const d = box(100, 10);
    d.grow(1.5);
    expect(d.at(98, 5)).toBe(255);
    expect(d.at(97, 5)).toBe(0);
  });

  it('feather softens the edge but keeps the middle', () => {
    const s = Selection.rect(W, 100, { x: 100, y: 20, w: 60, h: 60 });
    s.feather(4);
    expect(s.at(130, 50)).toBe(255);
    const edge = s.at(100, 50);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(s.at(90, 50)).toBeLessThan(40);
  });
});

describe('wandSelect', () => {
  // Left half white, right half black, with a white dot on the black side.
  const picture = (x: number, y: number): [number, number, number, number] =>
    x < 50 || (x === 80 && y === 10) ? [255, 255, 255, 255] : [0, 0, 0, 255];

  it('contiguous mode stays inside the area that was clicked', () => {
    const s = wandSelect(100, 40, picture, 10, 10, { tolerance: 0, contiguous: true });
    expect(s.at(49, 39)).toBe(255);
    expect(s.at(50, 10)).toBe(0);
    expect(s.at(80, 10)).toBe(0);
  });

  it('within keeps the area inside the limit and ignores a seed outside it', () => {
    const limit = Selection.rect(100, 40, { x: 5, y: 5, w: 20, h: 20 });
    const s = wandSelect(100, 40, picture, 10, 10, { tolerance: 0, contiguous: true, within: limit });
    expect(s.at(10, 10)).toBe(255);
    expect(s.at(30, 10)).toBe(0);
    expect(wandSelect(100, 40, picture, 40, 10, { tolerance: 0, contiguous: true, within: limit }).isEmpty).toBe(true);
  });

  it('non contiguous mode takes every similar pixel', () => {
    const s = wandSelect(100, 40, picture, 10, 10, { tolerance: 0, contiguous: false });
    expect(s.at(80, 10)).toBe(255);
  });

  it('tolerance admits similar colours', () => {
    const grey = (x: number): [number, number, number, number] => [100 + (x % 3) * 10, 100, 100, 255];
    expect(wandSelect(30, 3, (x) => grey(x), 0, 0, { tolerance: 5, contiguous: true }).at(1, 0)).toBe(0);
    expect(wandSelect(30, 3, (x) => grey(x), 0, 0, { tolerance: 25, contiguous: true }).at(29, 2)).toBe(255);
  });

  it('treats pixels within the tolerance of transparent as one colour', () => {
    // alpha 3 and alpha 0 differ in colour, but with tolerance 5 both count as "empty", like CSP's block compare
    const s = wandSelect(20, 20, (x) => (x < 10 ? [0, 0, 0, 0] : [200, 50, 50, 3]), 2, 2, { tolerance: 5, contiguous: true });
    expect(s.at(15, 2)).toBe(255);
    const strict = wandSelect(20, 20, (x) => (x < 10 ? [0, 0, 0, 0] : [200, 50, 50, 3]), 2, 2, { tolerance: 0, contiguous: true });
    expect(strict.at(15, 2)).toBe(0);
  });

  it('treats transparent pixels as one colour', () => {
    const s = wandSelect(20, 20, (x) => (x < 10 ? [0, 0, 0, 0] : [9, 9, 9, 255]), 2, 2, { tolerance: 0, contiguous: true });
    expect(s.at(9, 19)).toBe(255);
    expect(s.at(10, 0)).toBe(0);
  });

  describe('as a picture of tiles', () => {
    const SIZE = TILE * 4;
    /** White paper with a black 1-pixel square outline from (20, 20) to (80, 80), counting which tiles were asked for. */
    const paper = (outline: boolean) => {
      const asked: string[] = [];
      return {
        asked,
        look: {
          width: SIZE,
          height: SIZE,
          tile(tx: number, ty: number): Uint8ClampedArray {
            asked.push(`${tx},${ty}`);
            const t = new Uint8ClampedArray(TILE * TILE * 4).fill(255);
            if (outline && tx === 0 && ty === 0) {
              for (let i = 20; i <= 80; i++) {
                for (const [x, y] of [[i, 20], [i, 80], [20, i], [80, i]] as const) t.set([0, 0, 0, 255], (y * TILE + x) * 4);
              }
            }
            return t;
          },
        },
      };
    };

    it('only reads the tiles the flood reaches: a closed shape inside one tile reads that tile alone', () => {
      const { look, asked } = paper(true);
      const s = wandSelect(SIZE, SIZE, look, 50, 50, { tolerance: 0, contiguous: true });
      expect(new Set(asked)).toEqual(new Set(['0,0']));
      expect(s.at(50, 50)).toBe(255);
      expect(s.at(21, 21)).toBe(255);
      expect(s.at(20, 20)).toBe(0); // the outline itself
      expect(s.at(10, 10)).toBe(0); // outside it
      expect(s.at(TILE + 10, 10)).toBe(0);
    });

    it('crosses into the next tiles when the area does, and selects all of them', () => {
      const { look, asked } = paper(false);
      const s = wandSelect(SIZE, SIZE, look, 5, 5, { tolerance: 0, contiguous: true });
      expect(new Set(asked).size).toBe(16);
      expect(s.at(0, 0)).toBe(255);
      expect(s.at(SIZE - 1, SIZE - 1)).toBe(255);
      expect(s.at(TILE, TILE)).toBe(255);
    });

    it('outside a closed shape selects the page around it and not the inside', () => {
      const { look } = paper(true);
      const s = wandSelect(SIZE, SIZE, look, 5, 5, { tolerance: 0, contiguous: true });
      expect(s.at(5, 5)).toBe(255);
      expect(s.at(SIZE - 1, SIZE - 1)).toBe(255);
      expect(s.at(50, 50)).toBe(0);
    });
  });
});

describe('applying a selection', () => {
  it('erases, fills and undoes through the history', () => {
    const doc = createDocument(W, 100, 300);
    const layer = addLayer(doc, 'a');
    fillLayer(layer, [10, 20, 30, 255]);
    const sel = Selection.rect(W, 100, { x: 250, y: 10, w: 20, h: 20 }); // crosses a tile border
    const h = new History();

    const erased = eraseSelection(layer.surface, layer.id, sel)!;
    h.push(patchCommand(doc, erased));
    expect(layer.surface.alphaAt(255, 20)).toBe(0);
    expect(layer.surface.alphaAt(257, 20)).toBe(0);
    expect(layer.surface.alphaAt(249, 20)).toBe(255);
    h.undo();
    expect(layer.surface.alphaAt(255, 20)).toBe(255);
    h.redo();
    expect(layer.surface.alphaAt(255, 20)).toBe(0);

    const filled = fillSelection(layer.surface, layer.id, sel, [200, 0, 0])!;
    h.push(patchCommand(doc, filled));
    expect(layer.surface.pixel(255, 20)).toEqual([200, 0, 0, 255]);
    h.undo();
    expect(layer.surface.alphaAt(255, 20)).toBe(0);
  });

  it('fills an empty layer and makes partly selected pixels partly opaque', () => {
    const doc = createDocument(W, 100, 300);
    const layer = addLayer(doc, 'b');
    const sel = Selection.rect(W, 100, { x: 5, y: 5, w: 10.5, h: 10 });
    fillSelection(layer.surface, layer.id, sel, [0, 0, 255])!;
    expect(layer.surface.pixel(8, 8)).toEqual([0, 0, 255, 255]);
    expect(layer.surface.pixel(15, 8)).toEqual([0, 0, 255, 128]);
    expect(layer.surface.alphaAt(16, 8)).toBe(0);
  });

  it('does nothing for an empty selection and can erase everything outside', () => {
    const doc = createDocument(W, 100, 300);
    const layer = addLayer(doc, 'c');
    fillLayer(layer, [1, 2, 3, 255]);
    expect(eraseSelection(layer.surface, layer.id, new Selection(W, 100))).toBeNull();
    const keep = Selection.rect(W, 100, { x: 100, y: 10, w: 30, h: 30 });
    eraseOutside(layer.surface, layer.id, keep);
    expect(layer.surface.alphaAt(110, 20)).toBe(255);
    expect(layer.surface.alphaAt(50, 20)).toBe(0);
    expect(layer.surface.alphaAt(300, 80)).toBe(0);
  });
});

describe('painting inside a selection', () => {
  it('keeps the brush inside, partially on soft edges', () => {
    const doc = createDocument(W, 100, 300);
    const layer = addLayer(doc, 'p');
    const sel = Selection.rect(W, 100, { x: 100, y: 0, w: 200, h: 100 });
    const stroke = new Stroke(paintTarget(layer), { ...defaultBrush, size: 20, hardness: 1, color: [0, 0, 0] }, sel);
    stroke.addPoint(20, 50);
    for (let x = 20; x <= 400; x += 10) stroke.addPoint(x, 50);
    stroke.finish();
    expect(layer.surface.alphaAt(60, 50)).toBe(0); // before the selection
    expect(layer.surface.alphaAt(200, 50)).toBe(255); // inside
    expect(layer.surface.alphaAt(350, 50)).toBe(0); // after it
  });
});

describe('Selection.stroke', () => {
  it('covers the band the pen swept and nothing farther', () => {
    const s = Selection.stroke(100, 60, [{ x: 10, y: 30 }, { x: 90, y: 30 }], 5);
    expect(s.at(50, 30)).toBe(255);
    expect(s.at(50, 27)).toBe(255);
    expect(s.at(50, 40)).toBe(0);
    expect(s.at(95, 30)).toBe(0); // beyond the end cap
    expect(s.at(12, 30)).toBe(255); // inside the round cap
  });

  it('a single point makes a disc and an empty path makes nothing', () => {
    expect(Selection.stroke(50, 50, [{ x: 25, y: 25 }], 4).at(25, 25)).toBe(255);
    expect(Selection.stroke(50, 50, [], 4).isEmpty).toBe(true);
  });
});

describe('closing gaps in the bucket', () => {
  // A ring of black line work with a one pixel gap on the right, white inside and out.
  const W2 = 60;
  const ring = (x: number, y: number): [number, number, number, number] => {
    const d = Math.hypot(x - 30, y - 30);
    const onLine = d >= 15 && d < 17 && !(x > 44 && Math.abs(y - 30) < 1);
    return onLine ? [0, 0, 0, 255] : [255, 255, 255, 255];
  };

  it('leaks through the gap without the option', () => {
    const s = wandSelect(W2, W2, ring, 30, 30, { tolerance: 0, contiguous: true });
    expect(s.at(2, 2)).toBe(255);
  });

  it('stays inside once gaps up to the given width count as closed', () => {
    const s = wandSelect(W2, W2, ring, 30, 30, { tolerance: 0, contiguous: true, gap: 3 });
    expect(s.at(30, 30)).toBe(255);
    expect(s.at(2, 2)).toBe(0);
    expect(s.at(44, 30)).toBe(255); // grown back up to the line, also in the gap
  });
});

describe('encloseArea', () => {
  // White page with a black frame: a rough loop around the frame picks the white inside, not the frame.
  const frame = (x: number, y: number): [number, number, number, number] =>
    x >= 20 && x < 22 && y >= 20 && y < 60 ? [0, 0, 0, 255] : x >= 58 && x < 60 && y >= 20 && y < 60 ? [0, 0, 0, 255] : [255, 255, 255, 255];

  it('selects what looks like the inside of the loop, up to the lines', () => {
    const loop = [{ x: 10, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 70 }, { x: 10, y: 70 }];
    const s = encloseArea(80, 80, frame, loop, 10);
    expect(s.at(40, 40)).toBe(255);
    expect(s.at(20, 40)).toBe(0); // the line
    expect(s.at(5, 40)).toBe(0); // outside the loop
  });

  it('does nothing for a loop that is not closed', () => {
    expect(encloseArea(80, 80, frame, [{ x: 1, y: 1 }, { x: 5, y: 5 }], 10).isEmpty).toBe(true);
  });
});

describe('livewire', () => {
  // A dark vertical line at x = 40 on white: a path between two points near it should hug it.
  const line = (x: number): [number, number, number, number] => (x === 40 ? [0, 0, 0, 255] : [255, 255, 255, 255]);

  it('follows the strongest edge between two points', () => {
    const path = livewire(100, 100, (x) => line(x), { x: 41, y: 10 }, { x: 41, y: 70 });
    expect(path[0]!.y).toBeLessThan(11);
    expect(path[path.length - 1]!.y).toBeGreaterThan(69);
    const off = path.filter((p) => Math.abs(p.x - 40.5) > 2.5).length;
    expect(off).toBe(0); // never wanders away from the line
  });

  it('gives back a straight line when the points are the same or the window is too big', () => {
    expect(livewire(100, 100, () => [0, 0, 0, 255], { x: 5, y: 5 }, { x: 5, y: 5 })).toHaveLength(2);
    expect(livewire(2000, 2000, () => [0, 0, 0, 255], { x: 5, y: 5 }, { x: 900, y: 900 })).toHaveLength(2);
  });
});

describe('the leftover pen (paint behind)', () => {
  it('only fills what is empty and keeps existing pixels', () => {
    const doc = createDocument(200, 100, 300);
    const layer = addLayer(doc, 'l');
    setPixel(layer, 50, 50, [10, 10, 10, 255]);
    const stroke = new Stroke(paintTarget(layer), { ...defaultBrush, size: 20, hardness: 1, color: [200, 0, 0], behind: true });
    stroke.addPoint(30, 50);
    for (let x = 30; x <= 70; x += 5) stroke.addPoint(x, 50);
    stroke.finish();
    expect(layer.surface.pixel(50, 50)).toEqual([10, 10, 10, 255]); // the line stays on top
    expect(layer.surface.pixel(42, 50)).toEqual([200, 0, 0, 255]); // the gap beside it gets the colour
  });

  it('is the same as a normal stroke on an empty layer', () => {
    const doc = createDocument(200, 100, 300);
    const layer = addLayer(doc, 'm');
    const stroke = new Stroke(paintTarget(layer), { ...defaultBrush, size: 20, hardness: 1, color: [0, 120, 0], behind: true });
    stroke.addPoint(100, 50);
    stroke.addPoint(110, 50);
    stroke.finish();
    expect(layer.surface.pixel(105, 50)).toEqual([0, 120, 0, 255]);
  });
});

describe('brush character: curve, minimum size, taper and grain', () => {
  const thickness = (layer: ReturnType<typeof addLayer>, x: number, h = 120): number => {
    let n = 0;
    for (let y = 0; y < h; y++) if (layer.surface.alphaAt(x, y) > 128) n++;
    return n;
  };
  const line = (settings: Partial<typeof defaultBrush>, pressure = 1) => {
    const doc = createDocument(400, 120, 300);
    const layer = addLayer(doc, 'l');
    const stroke = new Stroke(paintTarget(layer), { ...defaultBrush, size: 30, hardness: 1, color: [0, 0, 0], stabilization: 0, ...settings });
    stroke.addPoint(30, 60, pressure);
    for (let x = 40; x <= 360; x += 10) stroke.addPoint(x, 60, pressure);
    const patch = stroke.finish();
    return { doc, layer, patch };
  };

  it('a pressure curve above 1 makes the same light touch thinner', () => {
    const linear = thickness(line({ pressureSize: 1 }, 0.5).layer, 200);
    const firm = thickness(line({ pressureSize: 1, pressureCurve: 2 }, 0.5).layer, 200);
    expect(linear).toBeGreaterThan(firm + 5);
    const soft = thickness(line({ pressureSize: 1, pressureCurve: 0.5 }, 0.5).layer, 200);
    expect(soft).toBeGreaterThan(linear);
  });

  it('a drawn pressure graph decides how a touch maps to width', () => {
    const hard = [[0, 0], [0.75, 0.25], [1, 1]] as const;
    const linear = thickness(line({ pressureSize: 1 }, 0.5).layer, 200);
    const real = thickness(line({ pressureSize: 1, pressureGraph: hard }, 0.5).layer, 200);
    expect(real).toBeLessThan(linear / 2);
    const full = thickness(line({ pressureSize: 1, pressureGraph: hard }, 1).layer, 200);
    expect(full).toBeGreaterThanOrEqual(28);
  });

  it('a flat nib draws a thin line along its length direction and a thick one across it', () => {
    const along = thickness(line({ nibThickness: 0.3, nibAngle: 0 }).layer, 200);
    const across = thickness(line({ nibThickness: 0.3, nibAngle: 90 }).layer, 200);
    expect(along).toBeGreaterThanOrEqual(8);
    expect(along).toBeLessThanOrEqual(11);
    expect(across).toBeGreaterThanOrEqual(28);
    expect(thickness(line({}).layer, 200)).toBeGreaterThanOrEqual(28);
  });

  it('a flat nib still paints a clean round-ended line and undoes in one step', () => {
    const { layer, patch } = line({ nibThickness: 0.5, nibAngle: 45 });
    expect(patch).not.toBeNull();
    expect(layer.surface.alphaAt(200, 60)).toBe(255);
    expect(layer.surface.alphaAt(200, 10)).toBe(0);
  });

  it('the minimum size keeps a feather-light touch from vanishing', () => {
    const none = thickness(line({ pressureSize: 1 }, 0.05).layer, 200);
    const kept = thickness(line({ pressureSize: 1, minSize: 0.5 }, 0.05).layer, 200);
    expect(none).toBeLessThan(5);
    expect(kept).toBeGreaterThanOrEqual(13); // half of 30
  });

  it('taper in starts thin and reaches full size', () => {
    const { layer } = line({ taperIn: 100 });
    const start = thickness(layer, 34);
    const middle = thickness(layer, 250);
    expect(start).toBeLessThan(middle / 2);
    expect(middle).toBeGreaterThanOrEqual(28);
  });

  it('taper out thins the end when the pen is lifted, and the step still undoes cleanly', () => {
    const { doc, layer, patch } = line({ taperOut: 100 });
    expect(thickness(layer, 340)).toBeLessThan(thickness(layer, 150) / 2);
    expect(thickness(layer, 150)).toBeGreaterThanOrEqual(28);
    const h = new History();
    h.push(patchCommand(doc, patch!));
    h.undo();
    expect(layer.surface.alphaAt(150, 60)).toBe(0);
    h.redo();
    expect(layer.surface.alphaAt(150, 60)).toBe(255);
  });

  it('grain leaves holes in the paint that depend on the place, not on the stroke', () => {
    const grainy = line({ grain: 0.9, grainScale: 4 }).layer;
    let solid = 0;
    let thin = 0;
    for (let x = 100; x < 300; x++) {
      const a = grainy.surface.alphaAt(x, 60);
      if (a === 255) solid++;
      else if (a < 200) thin++;
    }
    expect(solid).toBeGreaterThan(5);
    expect(thin).toBeGreaterThan(20);
    const again = line({ grain: 0.9, grainScale: 4 }).layer;
    expect(again.surface.alphaAt(150, 60)).toBe(grainy.surface.alphaAt(150, 60));
  });
});

describe('selectColorRange', () => {
  it('selects the pixels near a colour all over the page, in proportion to their opacity', () => {
    const picture = (x: number, y: number): [number, number, number, number] =>
      x < 10 ? [250, 0, 0, 255] : x < 20 ? [240, 10, 10, 128] : x < 30 ? [0, 0, 255, 255] : [0, 0, 0, 0];
    const s = selectColorRange(40, 5, picture, [255, 0, 0], 20);
    expect(s.at(5, 2)).toBe(255);
    expect(s.at(15, 2)).toBe(128);
    expect(s.at(25, 2)).toBe(0); // blue
    expect(s.at(35, 2)).toBe(0); // transparent
    expect(selectColorRange(40, 5, picture, [255, 0, 0], 3).at(15, 2)).toBe(0); // too strict for the second block
  });
});
