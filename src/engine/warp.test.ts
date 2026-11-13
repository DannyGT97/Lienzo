import { describe, expect, it } from 'vitest';
import { addLayer, createDocument } from './document';
import { Selection } from './selection';
import { TileRecorder, lift } from './transform';
import { Warp, applyH, dropWarp, homography, meshPoints, rectQuad, warpSelection } from './warp';
import { setPixel } from './test-utils';

const R = { x: 10, y: 10, w: 40, h: 20 };

describe('homography', () => {
  it('sends the corners where they were told to go, and is the identity for an unchanged shape', () => {
    const to: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 15, y: 12 }, { x: 60, y: 5 }, { x: 70, y: 40 }, { x: 8, y: 33 },
    ];
    const h = homography(rectQuad(R), to)!;
    const from = rectQuad(R);
    for (let i = 0; i < 4; i++) {
      const p = applyH(h, from[i]!.x, from[i]!.y);
      expect(p.x).toBeCloseTo(to[i]!.x, 6);
      expect(p.y).toBeCloseTo(to[i]!.y, 6);
    }
    const id = homography(rectQuad(R), rectQuad(R))!;
    const q = applyH(id, 23, 17);
    expect([q.x, q.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([23, 17]);
  });

  it('refuses a shape that collapsed onto a line', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }] as const;
    expect(homography(rectQuad(R), [line[0], line[1], line[2], line[3]])).toBeNull();
    expect(Warp.quad(R, [line[0], line[1], line[2], line[3]])).toBeNull();
  });
});

describe('warping pixels', () => {
  const setup = () => {
    const doc = createDocument(100, 80, 300);
    const layer = addLayer(doc, 'w');
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) setPixel(layer, x, y, [200, 40, 40, 255]);
    return { doc, layer };
  };

  it('an unchanged quad copies the pixels where they were', () => {
    const { layer } = setup();
    const surface = layer.surface;
    const rec = new TileRecorder(surface, layer.id);
    rec.watch(R);
    const lifted = lift(surface, R, null)!;
    expect(surface.alphaAt(20, 20)).toBe(0);
    const area = dropWarp(surface, lifted, Warp.quad(R, rectQuad(R))!)!;
    expect(area).toBeTruthy();
    expect(surface.pixel(20, 20)).toEqual([200, 40, 40, 255]);
    expect(surface.alphaAt(55, 20)).toBe(0); // outside the lifted box, nothing drawn
  });

  it('a perspective quad narrows one edge: the narrow side covers less of the page', () => {
    const { layer } = setup();
    const surface = layer.surface;
    const rec = new TileRecorder(surface, layer.id);
    rec.watch({ x: 0, y: 0, w: 100, h: 80 });
    const lifted = lift(surface, R, null)!;
    // The top edge shrinks to the middle half; the bottom edge keeps its width.
    const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 20, y: 10 }, { x: 40, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 },
    ];
    dropWarp(surface, lifted, Warp.quad(R, quad)!);
    expect(surface.alphaAt(30, 12)).toBe(255); // middle of the narrow top
    expect(surface.alphaAt(12, 12)).toBe(0); // the top corner moved in
    expect(surface.alphaAt(12, 28)).toBe(255); // the bottom is as wide as before
    expect(surface.alphaAt(48, 28)).toBe(255);
  });

  it('a mesh with the points unmoved is the same as nothing, and moving one point bends only its surroundings', () => {
    const { layer } = setup();
    const surface = layer.surface;
    const rec = new TileRecorder(surface, layer.id);
    rec.watch({ x: 0, y: 0, w: 100, h: 80 });
    const lifted = lift(surface, R, null)!;
    const pts = meshPoints(R, 4, 2);
    expect(pts).toHaveLength(15);
    // Pull the bottom middle point down by 10 pixels.
    pts[12] = { x: pts[12]!.x, y: pts[12]!.y + 10 };
    const w = Warp.mesh(R, 4, 2, pts)!;
    expect(w.cells).toHaveLength(8);
    dropWarp(surface, lifted, w);
    expect(surface.alphaAt(30, 35)).toBe(255); // below the old bottom edge, where the point was pulled
    expect(surface.alphaAt(11, 35)).toBe(0); // far from it nothing was drawn
    expect(surface.alphaAt(30, 15)).toBe(255);
  });

  it('draws every destination pixel once: no gaps along the seams of a mesh', () => {
    const { layer } = setup();
    const surface = layer.surface;
    const rec = new TileRecorder(surface, layer.id);
    rec.watch({ x: 0, y: 0, w: 100, h: 80 });
    const lifted = lift(surface, R, null)!;
    const w = Warp.mesh(R, 4, 2, meshPoints(R, 4, 2))!;
    dropWarp(surface, lifted, w);
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) expect(surface.alphaAt(x, y)).toBe(255);
  });
});

describe('warpSelection', () => {
  it('follows the warp', () => {
    const sel = Selection.rect(100, 80, R);
    const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: 30, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 30 }, { x: 30, y: 30 },
    ]; // the same shape moved 20 to the right
    const out = warpSelection(sel, R, Warp.quad(R, quad)!);
    expect(out.at(50, 20)).toBe(255);
    expect(out.at(15, 20)).toBe(0);
  });
});
