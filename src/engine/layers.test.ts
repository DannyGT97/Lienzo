import { describe, expect, it } from 'vitest';
import { Stroke, defaultBrush } from './brush';
import { flatten, flattenRegion, sampleDocument, thumbnail } from './composite';
import { addLayer, createDocument, paintTarget, removeLayer, type Document } from './document';
import { History, patchCommand } from './history';
import { addComp, applyComp, compMatches, recordComps, removeComp, renameComp, updateComp } from './layer-comps';
import { canRasterize, captureStructure, duplicateLayer, mergeLayerDown, rasterizeLayer, recordStructure } from './layer-ops';
import { depthOf, descendants, effectivelyVisible, groupLayers, layerTree, moveLayer, moveLayerTo, normalizeLayers, ungroupFolder } from './layer-tree';
import { applyMask, createMask, deleteMask, fillMask, invertMask, selectionFromMask, setMaskEnabled } from './mask-ops';
import { Selection, selectionFromAlpha } from './selection';
import { flattenFolder, mergeVisible } from './merge-ops';
import { bufPixel, fillLayer, setPixel } from './test-utils';

const W = 64;
const H = 64;
const names = (doc: Document): string[] => doc.layers.map((l) => l.name);

function stack(): { doc: Document; a: number; b: number; c: number } {
  const doc = createDocument(W, H, 300);
  doc.layers[0]!.name = 'a';
  const b = addLayer(doc, 'b');
  const c = addLayer(doc, 'c');
  return { doc, a: doc.layers[0]!.id, b: b.id, c: c.id };
}

describe('folders as a tree', () => {
  it('groups layers into a folder listed right after its members', () => {
    const { doc, a, b, c } = stack();
    const f = groupLayers(doc, [a, b], 'F')!;
    expect(names(doc)).toEqual(['a', 'b', 'F', 'c']);
    expect(doc.layers.find((l) => l.id === a)!.parent).toBe(f.id);
    expect(doc.layers.find((l) => l.id === c)!.parent).toBeNull();
    expect(depthOf(doc, a)).toBe(1);
    expect(descendants(doc, f.id).map((l) => l.name)).toEqual(['a', 'b']);
    expect(f.through).toBe(true);
  });

  it('moves a layer inside and out of a folder, keeping the list in folder-last order', () => {
    const { doc, a, b, c } = stack();
    const f = groupLayers(doc, [b], 'F')!;
    expect(moveLayerTo(doc, c, f.id, 0)).toBe(true);
    expect(names(doc)).toEqual(['a', 'c', 'b', 'F']);
    expect(moveLayerTo(doc, f.id, f.id, 0)).toBe(false);
    expect(moveLayerTo(doc, c, null, 0)).toBe(true);
    expect(names(doc)).toEqual(['c', 'a', 'b', 'F']);
    expect(doc.layers.find((l) => l.id === c)!.parent).toBeNull();
    // A folder cannot go into its own member.
    const g = groupLayers(doc, [f.id], 'G')!;
    expect(moveLayerTo(doc, g.id, f.id, 0)).toBe(false);
    expect(doc.layers.find((l) => l.id === a)!.parent).toBeNull();
  });

  it('moves among siblings and never out of the folder', () => {
    const { doc, a, b, c } = stack();
    groupLayers(doc, [a, b], 'F');
    moveLayer(doc, a, 1);
    expect(names(doc)).toEqual(['b', 'a', 'F', 'c']);
    moveLayer(doc, a, 1);
    expect(names(doc)).toEqual(['b', 'a', 'F', 'c']);
    moveLayer(doc, doc.layers.find((l) => l.name === 'F')!.id, 1);
    expect(names(doc)).toEqual(['c', 'b', 'a', 'F']);
    void c;
  });

  it('ungroups, and deleting a folder deletes its members', () => {
    const { doc, a, b } = stack();
    const f = groupLayers(doc, [a, b], 'F')!;
    expect(ungroupFolder(doc, f.id)).toBe(true);
    expect(names(doc)).toEqual(['a', 'b', 'c']);
    expect(doc.layers.every((l) => l.parent === null)).toBe(true);
    const g = groupLayers(doc, [a, b], 'G')!;
    removeLayer(doc, g.id);
    expect(names(doc)).toEqual(['c']);
    expect(doc.activeId).toBe(doc.layers[0]!.id);
  });

  it('repairs dangling parents', () => {
    const { doc, a } = stack();
    doc.layers.find((l) => l.id === a)!.parent = 999;
    normalizeLayers(doc);
    expect(doc.layers.find((l) => l.id === a)!.parent).toBeNull();
    expect(layerTree(doc.layers)).toHaveLength(3);
  });

  it('hidden folders hide their members', () => {
    const { doc, a } = stack();
    const f = groupLayers(doc, [a], 'F')!;
    expect(effectivelyVisible(doc, a)).toBe(true);
    f.visible = false;
    expect(effectivelyVisible(doc, a)).toBe(false);
  });

  it('undoes grouping through the structure history', () => {
    const { doc, a, b } = stack();
    const h = new History();
    const cmd = recordStructure(doc, 'Agrupar', () => void groupLayers(doc, [a, b], 'F'))!;
    h.push(cmd);
    expect(names(doc)).toEqual(['a', 'b', 'F', 'c']);
    h.undo();
    expect(names(doc)).toEqual(['a', 'b', 'c']);
    expect(doc.layers.every((l) => l.parent === null)).toBe(true);
    h.redo();
    expect(doc.layers.find((l) => l.id === a)!.parent).not.toBeNull();
  });

  it('duplicates a folder with its members', () => {
    const { doc, a, b } = stack();
    const f = groupLayers(doc, [a, b], 'F')!;
    setPixel(doc.layers.find((l) => l.id === a)!, 3, 3, [9, 9, 9, 255]);
    const copy = duplicateLayer(doc, f.id)!;
    expect(doc.layers.filter((l) => l.parent === copy.id)).toHaveLength(2);
    expect(doc.layers.filter((l) => l.parent === copy.id)[0]!.surface.alphaAt(3, 3)).toBe(255);
    expect(doc.layers).toHaveLength(7);
    expect(doc.activeId).toBe(copy.id);
  });
});

describe('compositing folders', () => {
  const red: [number, number, number, number] = [255, 0, 0, 255];

  it('a pass-through folder gives the same picture as no folder', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [200, 200, 200, 255]);
    fillLayer(doc.layers.find((l) => l.id === b)!, [255, 255, 0, 255]);
    doc.layers.find((l) => l.id === b)!.blend = 'multiply';
    setPixel(doc.layers.find((l) => l.id === c)!, 5, 5, red);
    const flat = flatten(doc);
    groupLayers(doc, [b, c]);
    expect(Array.from(flatten(doc))).toEqual(Array.from(flat));
  });

  it('an isolated folder blends its members with each other first', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [200, 200, 200, 255]);
    setPixel(doc.layers.find((l) => l.id === b)!, 1, 1, [255, 255, 0, 255]);
    doc.layers.find((l) => l.id === c)!.blend = 'multiply';
    fillLayer(doc.layers.find((l) => l.id === c)!, [0, 255, 255, 255]);
    const f = groupLayers(doc, [b, c], 'F')!;
    f.through = true;
    const through = bufPixel(flatten(doc), W, 40, 40);
    f.through = false;
    const isolated = bufPixel(flatten(doc), W, 40, 40);
    // Through: the multiply sees the grey page below. Isolated: it sees nothing, so the cyan stays as it is.
    expect(through).toEqual([0, 200, 200, 255]);
    expect(isolated).toEqual([0, 255, 255, 255]);
  });

  it('folder opacity, visibility and blend apply to the combined image', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [0, 0, 0, 255]);
    setPixel(doc.layers.find((l) => l.id === b)!, 2, 2, [255, 255, 255, 255]);
    setPixel(doc.layers.find((l) => l.id === c)!, 2, 2, [255, 255, 255, 255]);
    const f = groupLayers(doc, [b, c], 'F')!;
    f.opacity = 0.5;
    expect(bufPixel(flatten(doc), W, 2, 2)[0]).toBe(128);
    f.visible = false;
    expect(bufPixel(flatten(doc), W, 2, 2)[0]).toBe(0);
    f.visible = true;
    f.opacity = 1;
    f.through = false;
    f.blend = 'multiply';
    expect(bufPixel(flatten(doc), W, 2, 2)[0]).toBe(0);
  });

  it('a clipped layer inside a folder is limited by the layer below it in that folder', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [255, 255, 255, 255]);
    setPixel(doc.layers.find((l) => l.id === b)!, 4, 4, [0, 0, 255, 255]);
    fillLayer(doc.layers.find((l) => l.id === c)!, [255, 0, 0, 255]);
    doc.layers.find((l) => l.id === c)!.clip = true;
    groupLayers(doc, [b, c]);
    const px = flatten(doc);
    expect(bufPixel(px, W, 4, 4)).toEqual([255, 0, 0, 255]);
    expect(bufPixel(px, W, 5, 5)).toEqual([255, 255, 255, 255]);
  });

  it('sampleDocument, flattenRegion and thumbnail agree with flatten', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [10, 20, 30, 255]);
    fillLayer(doc.layers.find((l) => l.id === b)!, [200, 100, 50, 255]);
    doc.layers.find((l) => l.id === b)!.blend = 'overlay';
    setPixel(doc.layers.find((l) => l.id === c)!, 7, 8, red);
    const f = groupLayers(doc, [b, c], 'F')!;
    f.through = false;
    f.opacity = 0.7;
    const m = createMask(doc, c, 'selection', Selection.rect(W, H, { x: 0, y: 0, w: 32, h: 32 }));
    expect(m).not.toBeNull();
    const flat = flatten(doc);
    for (const [x, y] of [[7, 8], [1, 1], [40, 40]] as const) {
      const s = sampleDocument(doc, x, y);
      const p = bufPixel(flat, W, x, y);
      for (let k = 0; k < 4; k++) expect(Math.round(s[k]!)).toBeCloseTo(p[k]!, -0.5);
    }
    const part = flattenRegion(doc, { x: 4, y: 4, w: 8, h: 8 });
    expect(Array.from(part.subarray(0, 4))).toEqual(bufPixel(flat, W, 4, 4));
    const t = thumbnail(doc, 1, 1);
    expect(t[3]).toBe(255);
  });

  it('a thumbnail that looks at fewer pixels gives the same colours, and covers the cells just as much', () => {
    const doc = createDocument(512, 512, 300);
    const l = addLayer(doc, 'Dibujo');
    fillLayer(l, [200, 40, 10, 255]);
    const full = thumbnail(doc, 16, 16);
    for (const sample of [2, 3, 4]) {
      const part = thumbnail(doc, 16, 16, { sample });
      for (const i of [0, 4 * 17, 4 * 255]) {
        expect(Array.from(part.subarray(i, i + 4))).toEqual(Array.from(full.subarray(i, i + 4)));
      }
    }
  });

  it('draft and reference layers are shown while working but left out of the output', () => {
    const { doc, a, b } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [255, 255, 255, 255]);
    const d = doc.layers.find((l) => l.id === b)!;
    fillLayer(d, [0, 0, 0, 255]);
    expect(bufPixel(flatten(doc), W, 3, 3)).toEqual([0, 0, 0, 255]);
    d.role = 'draft';
    expect(bufPixel(flatten(doc), W, 3, 3)).toEqual([0, 0, 0, 255]);
    expect(bufPixel(flatten(doc, { output: true }), W, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(sampleDocument(doc, 3, 3, { output: true })).toEqual([255, 255, 255, 255]);
    d.role = 'reference';
    expect(bufPixel(flatten(doc, { output: true }), W, 3, 3)).toEqual([255, 255, 255, 255]);
  });
});

describe('layer masks', () => {
  const setup = () => {
    const doc = createDocument(300, 100, 300);
    doc.layers[0]!.kind; // paper-less test document: one transparent layer
    const base = doc.layers[0]!;
    fillLayer(base, [255, 255, 255, 255]);
    const layer = addLayer(doc, 'ink');
    fillLayer(layer, [0, 0, 0, 255]);
    return { doc, layer };
  };

  it('hide-all and show-all masks', () => {
    const { doc, layer } = setup();
    createMask(doc, layer.id, 'hide');
    expect(bufPixel(flatten(doc), 300, 10, 10)).toEqual([255, 255, 255, 255]);
    deleteMask(doc, layer.id);
    createMask(doc, layer.id, 'show');
    expect(bufPixel(flatten(doc), 300, 10, 10)).toEqual([0, 0, 0, 255]);
  });

  it('a mask made from a selection shows only the selection, and its opposite the rest', () => {
    const { doc, layer } = setup();
    const sel = Selection.rect(300, 100, { x: 100, y: 0, w: 100, h: 100 }); // crosses a tile border
    createMask(doc, layer.id, 'selection', sel);
    let px = flatten(doc);
    expect(bufPixel(px, 300, 150, 50)[0]).toBe(0);
    expect(bufPixel(px, 300, 50, 50)[0]).toBe(255);
    expect(bufPixel(px, 300, 250, 50)[0]).toBe(255);
    deleteMask(doc, layer.id);
    createMask(doc, layer.id, 'outside', sel);
    px = flatten(doc);
    expect(bufPixel(px, 300, 150, 50)[0]).toBe(255);
    expect(bufPixel(px, 300, 50, 50)[0]).toBe(0);
  });

  it('painting on a mask hides with dark, shows with light and the eraser shows again, all undoable', () => {
    const { doc, layer } = setup();
    createMask(doc, layer.id, 'show');
    const h = new History();
    const paint = (color: [number, number, number], erase = false, y = 50): void => {
      const s = new Stroke(paintTarget(layer, true), { ...defaultBrush, size: 20, hardness: 1, color, erase });
      s.addPoint(20, y);
      for (let x = 20; x <= 120; x += 10) s.addPoint(x, y);
      h.push(patchCommand(doc, s.finish()!));
    };
    paint([0, 0, 0]);
    expect(sampleDocument(doc, 60, 50)[0]).toBe(255); // hidden: white page shows
    expect(sampleDocument(doc, 60, 80)[0]).toBe(0);
    paint([255, 255, 255]);
    expect(sampleDocument(doc, 60, 50)[0]).toBe(0);
    paint([0, 0, 0]);
    paint([0, 0, 0], true);
    expect(sampleDocument(doc, 60, 50)[0]).toBe(0);
    h.undo();
    expect(sampleDocument(doc, 60, 50)[0]).toBe(255);
    h.undo();
    h.undo();
    expect(sampleDocument(doc, 60, 50)[0]).toBe(255);
    h.undo();
    expect(layer.mask!.surface.isEmpty).toBe(true);
    expect(sampleDocument(doc, 60, 50)[0]).toBe(0);
    h.redo();
    expect(sampleDocument(doc, 60, 50)[0]).toBe(255);
  });

  it('painting on a hide-all mask reveals, and a stroke that returns to the default leaves no tiles behind', () => {
    const { doc, layer } = setup();
    createMask(doc, layer.id, 'hide');
    const s = new Stroke(paintTarget(layer, true), { ...defaultBrush, size: 16, hardness: 1, color: [255, 255, 255] });
    s.addPoint(30, 50);
    s.addPoint(60, 50);
    const patch = s.finish()!;
    expect(patch.onMask).toBe(true);
    expect(sampleDocument(doc, 45, 50)[0]).toBe(0);
    expect(sampleDocument(doc, 45, 90)[0]).toBe(255);
    const e = new Stroke(paintTarget(layer, true), { ...defaultBrush, size: 120, hardness: 1, color: [0, 0, 0] });
    e.addPoint(45, 50);
    e.addPoint(46, 50);
    e.finish();
    expect(layer.mask!.surface.isEmpty).toBe(true);
  });

  it('a disabled mask is ignored, invert flips it, fill shows or hides the selection', () => {
    const { doc, layer } = setup();
    createMask(doc, layer.id, 'hide');
    expect(sampleDocument(doc, 10, 10)[0]).toBe(255);
    setMaskEnabled(doc, layer.id, false);
    expect(sampleDocument(doc, 10, 10)[0]).toBe(0);
    setMaskEnabled(doc, layer.id, true);
    invertMask(doc, layer.id);
    expect(sampleDocument(doc, 10, 10)[0]).toBe(0);
    const sel = Selection.rect(300, 100, { x: 0, y: 0, w: 20, h: 20 });
    const cmd = fillMask(doc, layer.id, sel, 0)!;
    expect(sampleDocument(doc, 10, 10)[0]).toBe(255);
    expect(sampleDocument(doc, 40, 40)[0]).toBe(0);
    cmd.undo();
    expect(sampleDocument(doc, 10, 10)[0]).toBe(0);
    const all = Selection.all(300, 100);
    fillMask(doc, layer.id, all, 0);
    expect(layer.mask!.base).toBe(0);
    expect(layer.mask!.surface.isEmpty).toBe(true);
  });

  it('turns a mask into a selection and back', () => {
    const { doc, layer } = setup();
    createMask(doc, layer.id, 'selection', Selection.rect(300, 100, { x: 100, y: 10, w: 50, h: 50 }));
    const sel = selectionFromMask(doc, layer)!;
    expect(sel.at(120, 30)).toBe(255);
    expect(sel.at(10, 30)).toBe(0);
    expect(sel.bounds()).toEqual({ x: 100, y: 10, w: 50, h: 50 });
  });

  it('applying a mask bakes it into the pixels and undoes', () => {
    const { doc, layer } = setup();
    createMask(doc, layer.id, 'selection', Selection.rect(300, 100, { x: 0, y: 0, w: 128, h: 100 }));
    const h = new History();
    const cmd = applyMask(doc, layer.id)!;
    h.push(cmd);
    expect(layer.mask).toBeUndefined();
    expect(layer.surface.alphaAt(10, 10)).toBe(255);
    expect(layer.surface.alphaAt(200, 10)).toBe(0);
    expect(sampleDocument(doc, 200, 10)[0]).toBe(255);
    h.undo();
    expect(layer.mask).toBeDefined();
    expect(layer.surface.alphaAt(200, 10)).toBe(255);
    expect(sampleDocument(doc, 200, 10)[0]).toBe(255); // still hidden by the restored mask
  });

  it('the mask also limits clipped layers and merging down', () => {
    const { doc, layer } = setup();
    const clipped = addLayer(doc, 'clipped');
    fillLayer(clipped, [255, 0, 0, 255]);
    clipped.clip = true;
    createMask(doc, layer.id, 'selection', Selection.rect(300, 100, { x: 0, y: 0, w: 100, h: 100 }));
    const px = flatten(doc);
    expect(bufPixel(px, 300, 50, 50)).toEqual([255, 0, 0, 255]);
    expect(bufPixel(px, 300, 200, 50)).toEqual([255, 255, 255, 255]); // base hidden, so the clipped layer too
    // Merge the masked layer into the one below it (the page): the mask is honoured.
    const doc2 = createDocument(300, 100, 300);
    fillLayer(doc2.layers[0]!, [255, 255, 255, 255]);
    const top = addLayer(doc2, 't');
    fillLayer(top, [0, 0, 0, 255]);
    createMask(doc2, top.id, 'selection', Selection.rect(300, 100, { x: 0, y: 0, w: 100, h: 100 }));
    const merged = mergeLayerDown(doc2, top.id)!;
    expect(merged).not.toBeNull();
    expect(doc2.layers[0]!.surface.pixel(50, 50)).toEqual([0, 0, 0, 255]);
    expect(doc2.layers[0]!.surface.pixel(200, 50)).toEqual([255, 255, 255, 255]);
  });

  it('structure snapshots remember masks', () => {
    const { doc, layer } = setup();
    const before = captureStructure(doc);
    const h = new History();
    h.push(createMask(doc, layer.id, 'hide')!);
    expect(layer.mask).toBeDefined();
    h.undo();
    expect(layer.mask).toBeUndefined();
    h.redo();
    expect(layer.mask).toBeDefined();
    void before;
  });
});

describe('reference layers and merging', () => {
  it('"only reference" shows just the reference layers (and what is inside a reference folder)', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [255, 255, 255, 255]);
    fillLayer(doc.layers.find((l) => l.id === b)!, [255, 0, 0, 255]);
    setPixel(doc.layers.find((l) => l.id === c)!, 3, 3, [0, 0, 255, 255]);
    doc.layers.find((l) => l.id === b)!.role = 'reference';
    const px = flatten(doc, { only: 'reference' });
    expect(bufPixel(px, W, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(bufPixel(px, W, 40, 40)).toEqual([255, 0, 0, 255]);
    doc.layers.find((l) => l.id === b)!.role = 'normal';
    const f = groupLayers(doc, [b, c], 'F')!;
    f.role = 'reference';
    expect(bufPixel(flatten(doc, { only: 'reference' }), W, 3, 3)).toEqual([0, 0, 255, 255]);
    expect(bufPixel(flatten(doc, { only: 'reference' }), W, 40, 40)).toEqual([255, 0, 0, 255]);
  });

  it('merges the visible layers into one, keeping hidden ones, and undoes', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [255, 255, 255, 255]);
    fillLayer(doc.layers.find((l) => l.id === b)!, [255, 0, 0, 128]);
    setPixel(doc.layers.find((l) => l.id === c)!, 3, 3, [0, 0, 255, 255]);
    doc.layers.find((l) => l.id === c)!.visible = false;
    const before = Array.from(flatten(doc));
    const h = new History();
    const cmd = mergeVisible(doc, 'visible', false)!;
    h.push(cmd);
    expect(names(doc)).toEqual(['Capas combinadas', 'c']);
    expect(Array.from(flatten(doc))).toEqual(before);
    h.undo();
    expect(names(doc)).toEqual(['a', 'b', 'c']);
    expect(Array.from(flatten(doc))).toEqual(before);
    const copy = mergeVisible(doc, 'visible', true)!;
    expect(copy).not.toBeNull();
    expect(names(doc)).toEqual(['a', 'b', 'c', 'Capas visibles']);
    expect(mergeVisible(createDocument(8, 8), 'visible', false)).toBeNull();
  });

  it('turns a folder into one raster layer that looks the same', () => {
    const { doc, a, b, c } = stack();
    fillLayer(doc.layers.find((l) => l.id === a)!, [255, 255, 255, 255]);
    fillLayer(doc.layers.find((l) => l.id === b)!, [0, 200, 0, 255]);
    setPixel(doc.layers.find((l) => l.id === c)!, 4, 4, [200, 0, 0, 255]);
    doc.layers.find((l) => l.id === c)!.blend = 'multiply';
    const f = groupLayers(doc, [b, c], 'F')!;
    f.through = false;
    f.opacity = 0.5;
    const before = Array.from(flatten(doc));
    const cmd = flattenFolder(doc, f.id)!;
    expect(cmd).not.toBeNull();
    expect(names(doc)).toEqual(['a', 'F']);
    expect(doc.layers[1]!.kind).toBe('raster');
    // The folder's half-transparent image goes through 8-bit storage, so each channel may be off by one.
    const after = Array.from(flatten(doc));
    expect(Math.max(...after.map((v, i) => Math.abs(v - before[i]!)))).toBeLessThanOrEqual(1);
    cmd.undo();
    expect(names(doc)).toEqual(['a', 'b', 'c', 'F']);
  });

  it('draws a selection from a layer\'s pixels', () => {
    const { doc, a } = stack();
    setPixel(doc.layers.find((l) => l.id === a)!, 10, 10, [1, 2, 3, 255]);
    setPixel(doc.layers.find((l) => l.id === a)!, 11, 10, [1, 2, 3, 100]);
    const sel = selectionFromAlpha(doc.layers.find((l) => l.id === a)!.surface);
    expect(sel.at(10, 10)).toBe(255);
    expect(sel.at(11, 10)).toBe(100);
    expect(sel.at(12, 10)).toBe(0);
  });
});

describe('locking and rasterizing', () => {
  it('the lock is part of the layer properties: undoable and copied by duplicate', () => {
    const { doc, b } = stack();
    const h = new History();
    const cmd = recordStructure(doc, 'Bloquear capa', () => (doc.layers.find((l) => l.id === b)!.locked = true))!;
    h.push(cmd);
    expect(doc.layers.find((l) => l.id === b)!.locked).toBe(true);
    const dup = duplicateLayer(doc, b)!;
    expect(doc.layers.find((l) => l.id === dup.id)!.locked).toBe(true);
    h.undo();
    h.undo();
    expect(doc.layers.find((l) => l.id === b)!.locked).toBe(false);
  });

  it('turns a tone layer into pixels and back', () => {
    const doc = createDocument(W, H, 300);
    const tone = addLayer(doc, 'tono', undefined, 'tone');
    setPixel({ surface: tone.source! } as typeof tone, 5, 5, [0, 0, 0, 255]);
    setPixel(tone, 5, 5, [0, 0, 0, 255]);
    expect(canRasterize(tone)).toBe(true);
    const cmd = rasterizeLayer(tone)!;
    expect(tone.kind).toBe('raster');
    expect(tone.tone).toBeUndefined();
    expect(tone.source).toBeUndefined();
    expect(tone.surface.alphaAt(5, 5)).toBe(255); // the pixels stay
    cmd.undo();
    expect(tone.kind).toBe('tone');
    expect(tone.tone).toBeDefined();
    expect(tone.source).toBeDefined();
    cmd.redo();
    expect(tone.kind).toBe('raster');
  });

  it('refuses plain pixel layers', () => {
    const { doc, a } = stack();
    const l = doc.layers.find((x) => x.id === a)!;
    expect(canRasterize(l)).toBe(false);
    expect(rasterizeLayer(l)).toBeNull();
  });
});

describe('layer comps', () => {
  it('remembers visibility, opacity and mode, and puts them back', () => {
    const { doc, a, b, c } = stack();
    const L = (id: number) => doc.layers.find((l) => l.id === id)!;
    const comp = addComp(doc, 'base');
    L(b).visible = false;
    L(c).opacity = 0.4;
    L(a).blend = 'multiply';
    expect(compMatches(doc, comp)).toBe(false);
    expect(applyComp(doc, comp.id)).toBe(true);
    expect(L(b).visible).toBe(true);
    expect(L(c).opacity).toBe(1);
    expect(L(a).blend).toBe('normal');
    expect(compMatches(doc, comp)).toBe(true);
  });

  it('leaves layers made later alone and ignores layers that are gone', () => {
    const { doc, b } = stack();
    const comp = addComp(doc, 'x');
    const later = addLayer(doc, 'later');
    later.visible = false;
    removeLayer(doc, b);
    expect(applyComp(doc, comp.id)).toBe(true);
    expect(later.visible).toBe(false);
    expect(compMatches(doc, comp)).toBe(true);
  });

  it('update, rename and remove are undoable steps', () => {
    const { doc, b } = stack();
    const h = new History();
    h.push(recordComps(doc, 'nueva', () => void addComp(doc, 'uno'))!);
    const id = doc.comps[0]!.id;
    doc.layers.find((l) => l.id === b)!.visible = false;
    h.push(recordComps(doc, 'actualizar', () => void updateComp(doc, id))!);
    expect(doc.comps[0]!.entries.find((e) => e.id === b)!.visible).toBe(false);
    h.undo();
    expect(doc.comps[0]!.entries.find((e) => e.id === b)!.visible).toBe(true);
    h.push(recordComps(doc, 'renombrar', () => void renameComp(doc, id, 'dos'))!);
    expect(doc.comps[0]!.name).toBe('dos');
    h.push(recordComps(doc, 'borrar', () => void removeComp(doc, id))!);
    expect(doc.comps).toHaveLength(0);
    h.undo();
    expect(doc.comps[0]!.name).toBe('dos');
    expect(recordComps(doc, 'nada', () => void renameComp(doc, id, 'dos'))).toBeNull();
  });
});
