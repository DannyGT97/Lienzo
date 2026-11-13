import { describe, expect, it } from 'vitest';
import { flatten } from './composite';
import { addLayer, createDocument, removeLayer } from './document';
import { groupLayers, moveLayer } from './layer-tree';
import { History } from './history';
import { canMergeDown, copyLayers, duplicateLayer, mergeLayerDown, pasteLayers, recordStructure } from './layer-ops';
import { bufPixel as px, fillLayer, setPixel } from './test-utils';

function doc2() {
  const doc = createDocument(40, 40, 300);
  const base = doc.layers[0]!;
  const top = addLayer(doc, 'Arriba');
  return { doc, base, top };
}

describe('duplicateLayer', () => {
  it('copies the pixels and settings into an independent layer above the original', () => {
    const { doc, top } = doc2();
    setPixel(top, 3, 4, [200, 10, 20, 255]);
    top.opacity = 0.4;
    top.blend = 'multiply';
    const copy = duplicateLayer(doc, top.id)!;
    expect(doc.layers.indexOf(copy)).toBe(doc.layers.indexOf(top) + 1);
    expect(doc.activeId).toBe(copy.id);
    expect(copy.name).toBe('Arriba copia');
    expect(copy.opacity).toBe(0.4);
    expect(copy.blend).toBe('multiply');
    expect(copy.surface.pixel(3, 4)).toEqual([200, 10, 20, 255]);
    setPixel(copy, 3, 4, [0, 0, 0, 255]);
    expect(top.surface.pixel(3, 4)).toEqual([200, 10, 20, 255]);
  });
});

describe('mergeLayerDown', () => {
  it('paints the upper layer onto the lower one and removes it', () => {
    const { doc, base, top } = doc2();
    fillLayer(base, [0, 0, 255, 255]);
    setPixel(top, 5, 5, [255, 0, 0, 255]);
    const flatBefore = flatten(doc);
    const cmd = mergeLayerDown(doc, top.id)!;
    expect(doc.layers).toHaveLength(1);
    expect(doc.activeId).toBe(base.id);
    expect(base.surface.pixel(5, 5)).toEqual([255, 0, 0, 255]);
    expect(base.surface.pixel(6, 5)).toEqual([0, 0, 255, 255]);
    expect(Array.from(flatten(doc))).toEqual(Array.from(flatBefore));
    cmd.undo();
    expect(doc.layers).toHaveLength(2);
    expect(base.surface.pixel(5, 5)).toEqual([0, 0, 255, 255]);
    expect(top.surface.pixel(5, 5)).toEqual([255, 0, 0, 255]);
    cmd.redo();
    expect(doc.layers).toHaveLength(1);
    expect(base.surface.pixel(5, 5)).toEqual([255, 0, 0, 255]);
  });

  it('keeps the look of the page with opacity and a blend mode', () => {
    const { doc, base, top } = doc2();
    fillLayer(base, [200, 200, 200, 255]);
    fillLayer(top, [100, 50, 255, 255]);
    top.opacity = 0.5;
    top.blend = 'multiply';
    const before = flatten(doc);
    mergeLayerDown(doc, top.id);
    const after = flatten(doc);
    for (const [x, y] of [[0, 0], [20, 20], [39, 39]] as const) {
      const a = px(before, 40, x, y);
      const b = px(after, 40, x, y);
      for (let k = 0; k < 4; k++) expect(Math.abs(a[k]! - b[k]!)).toBeLessThanOrEqual(1);
    }
  });

  it('clips to the lower layer alpha when the upper layer is clipped', () => {
    const { doc, base, top } = doc2();
    setPixel(base, 1, 1, [0, 255, 0, 255]);
    setPixel(top, 1, 1, [255, 0, 0, 255]);
    setPixel(top, 2, 2, [255, 0, 0, 255]);
    top.clip = true;
    mergeLayerDown(doc, top.id);
    expect(base.surface.pixel(1, 1)).toEqual([255, 0, 0, 255]);
    expect(base.surface.alphaAt(2, 2)).toBe(0);
  });

  it('refuses to merge into the paper or the bottom layer', () => {
    const { doc, base, top } = doc2();
    expect(canMergeDown(doc, base.id)).toBe(false);
    base.kind = 'paper';
    expect(canMergeDown(doc, top.id)).toBe(false);
    expect(mergeLayerDown(doc, top.id)).toBeNull();
  });
});

describe('recordStructure', () => {
  it('undoes and redoes adding, moving, renaming and deleting layers', () => {
    const { doc, base, top } = doc2();
    const h = new History();
    const push = (label: string, change: () => void) => {
      const cmd = recordStructure(doc, label, change);
      if (cmd) h.push(cmd);
      return cmd;
    };
    expect(push('nada', () => undefined)).toBeNull();
    push('Mover', () => moveLayer(doc, top.id, -1));
    expect(doc.layers.map((l) => l.id)).toEqual([top.id, base.id]);
    push('Nombre', () => (top.name = 'Otro'));
    push('Borrar', () => removeLayer(doc, top.id));
    expect(doc.layers).toHaveLength(1);
    h.undo();
    expect(doc.layers).toHaveLength(2);
    expect(top.name).toBe('Otro');
    h.undo();
    expect(top.name).toBe('Arriba');
    h.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([base.id, top.id]);
    h.redo();
    h.redo();
    h.redo();
    expect(doc.layers.map((l) => l.id)).toEqual([base.id]);
    expect(h.undoLabels()).toEqual(['Mover', 'Nombre', 'Borrar']);
  });
});

describe('copyLayers / pasteLayers', () => {
  function source() {
    const doc = createDocument(40, 40, 300);
    const a = addLayer(doc, 'A');
    const b = addLayer(doc, 'B');
    const c = addLayer(doc, 'C');
    setPixel(a, 1, 1, [255, 0, 0, 255]);
    setPixel(b, 2, 2, [0, 255, 0, 255]);
    setPixel(c, 3, 3, [0, 0, 255, 255]);
    const folder = groupLayers(doc, [a.id, b.id], 'Carpeta')!;
    return { doc, a, b, c, folder };
  }

  it('copies several layers and a folder with its members into another document', () => {
    const { doc, a, b, c, folder } = source();
    const clip = copyLayers(doc, [folder.id, c.id])!;
    expect(clip.layers.map((l) => l.name)).toEqual(['A', 'B', 'Carpeta', 'C']);

    const other = createDocument(60, 50, 150);
    const before = other.layers.length;
    const made = pasteLayers(other, clip);
    expect(made).toHaveLength(4);
    expect(other.layers).toHaveLength(before + 4);
    expect(new Set(other.layers.map((l) => l.id)).size).toBe(other.layers.length);
    const pf = other.layers.find((l) => l.name === 'Carpeta')!;
    expect(pf.kind).toBe('folder');
    expect(other.layers.filter((l) => l.parent === pf.id).map((l) => l.name)).toEqual(['A', 'B']);
    expect(other.layers.find((l) => l.name === 'C')!.parent).toBeNull();
    expect(other.layers.find((l) => l.name === 'B')!.surface.pixel(2, 2)).toEqual([0, 255, 0, 255]);
    expect(other.layers.find((l) => l.name === 'C')!.surface.width).toBe(60);
    expect(other.activeId).toBe(other.layers.find((l) => l.name === 'C')!.id);
    // the original is untouched and the copy is independent of it
    expect([a, b, c].every((l) => doc.layers.includes(l))).toBe(true);
    setPixel(a, 1, 1, [9, 9, 9, 255]);
    expect(other.layers.find((l) => l.name === 'A')!.surface.pixel(1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('keeps the snapshot when the source changes afterwards and can be pasted again', () => {
    const { doc, c } = source();
    const clip = copyLayers(doc, [c.id])!;
    removeLayer(doc, c.id);
    const other = createDocument(40, 40, 300);
    pasteLayers(other, clip);
    pasteLayers(other, clip);
    expect(other.layers.filter((l) => l.name === 'C')).toHaveLength(2);
    expect(new Set(other.layers.map((l) => l.id)).size).toBe(other.layers.length);
  });

  it('is one undoable step', () => {
    const { doc, folder } = source();
    const clip = copyLayers(doc, [folder.id])!;
    const other = createDocument(40, 40, 300);
    const history = new History();
    const names = other.layers.map((l) => l.name);
    history.push(recordStructure(other, 'Pegar capas', () => void pasteLayers(other, clip))!);
    expect(other.layers).toHaveLength(names.length + 3);
    history.undo();
    expect(other.layers.map((l) => l.name)).toEqual(names);
    history.redo();
    expect(other.layers).toHaveLength(names.length + 3);
  });

  it('puts the layers inside an open folder when it is the active layer', () => {
    const { doc, c } = source();
    const clip = copyLayers(doc, [c.id])!;
    const other = createDocument(40, 40, 300);
    const f = addLayer(other, 'F', undefined, 'folder');
    other.activeId = f.id;
    pasteLayers(other, clip);
    expect(other.layers.find((l) => l.name === 'C')!.parent).toBe(f.id);
  });

  it('leaves the page paper out but copies an extra paper layer that was chosen', () => {
    const { doc, c } = source();
    const paper = addLayer(doc, 'Papel', 0, 'paper');
    const extra = addLayer(doc, 'Papel 2', undefined, 'paper');
    const clip = copyLayers(doc, [paper.id, extra.id, c.id])!;
    expect(clip.layers.map((l) => l.name)).toEqual(['C', 'Papel 2']);
  });

  it('keeps a single reference layer in the document it is pasted into', () => {
    const { doc, c } = source();
    c.role = 'reference';
    const clip = copyLayers(doc, [c.id])!;
    const other = createDocument(40, 40, 300);
    other.layers[0]!.role = 'reference';
    pasteLayers(other, clip);
    expect(other.layers.filter((l) => l.role === 'reference')).toHaveLength(1);
    const empty = createDocument(40, 40, 300);
    pasteLayers(empty, clip);
    expect(empty.layers.filter((l) => l.role === 'reference')).toHaveLength(1);
    duplicateLayer(doc, c.id);
    expect(doc.layers.filter((l) => l.role === 'reference')).toHaveLength(1);
  });

  it('carries every kind of layer with all of its content', () => {
    const doc = createDocument(40, 40, 300);
    const tone = addLayer(doc, 'T', undefined, 'tone');
    setPixel(tone, 2, 2, [0, 0, 0, 255]);
    tone.source!.writeRect({ x: 5, y: 5, w: 1, h: 1 }, new Uint8ClampedArray([0, 0, 0, 255]));
    const adj = addLayer(doc, 'Aj', undefined, 'adjust');
    adj.adjust!.values = { amount: 0.5 };
    const vec = addLayer(doc, 'V', undefined, 'vector');
    vec.vector = [{ points: [{ x: 1, y: 1 }], color: [0, 0, 0, 255], size: 2 } as never];
    const masked = addLayer(doc, 'M');
    setPixel(masked, 4, 4, [1, 2, 3, 255]);
    masked.mask = { surface: masked.surface.clone(), base: 255, enabled: true };
    masked.clip = true;
    masked.visible = false;
    masked.opacity = 0.4;
    masked.blend = 'multiply';
    const clip = copyLayers(doc, [tone.id, adj.id, vec.id, masked.id])!;
    const other = createDocument(40, 40, 300);
    pasteLayers(other, clip);
    const get = (n: string) => other.layers.find((l) => l.name === n)!;
    expect(get('T').surface.pixel(2, 2)).toEqual([0, 0, 0, 255]);
    expect(get('T').source!.pixel(5, 5)).toEqual([0, 0, 0, 255]);
    expect(get('Aj').adjust!.values).toEqual({ amount: 0.5 });
    expect(get('V').vector).toHaveLength(1);
    const m = get('M');
    expect(m.surface.pixel(4, 4)).toEqual([1, 2, 3, 255]);
    expect(m.mask).toMatchObject({ base: 255, enabled: true });
    expect([m.clip, m.visible, m.opacity, m.blend]).toEqual([true, false, 0.4, 'multiply']);
  });

  it('gives nothing for unknown layers', () => {
    const { doc } = source();
    expect(copyLayers(doc, [9999])).toBeNull();
  });
});
