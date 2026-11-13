import { describe, expect, it } from 'vitest';
import { applyCanvasProps, frameGuides, hasPaper, paperOf } from './canvas-props';
import { addLayer, createDocument, type Document } from './document';

function sample(): Document {
  const doc = createDocument(600, 300, 300);
  const paper = addLayer(doc, 'Papel');
  paper.kind = 'paper';
  paper.paperColor = [255, 255, 255];
  return doc;
}

describe('canvas properties', () => {
  it('puts a guide on each side at every distance that fits', () => {
    expect(frameGuides(600, 300, [10, 40])).toEqual({ v: [10, 590, 40, 560], h: [10, 290, 40, 260] });
    expect(frameGuides(600, 300, [0, 10, 10])).toEqual({ v: [10, 590], h: [10, 290] });
    expect(frameGuides(600, 300, [150])).toEqual({ v: [150, 450], h: [] }); // too deep for the short side
  });

  it('changes size, resolution, paper and guides as one step and undoes them together', () => {
    const doc = sample();
    const cmd = applyCanvasProps(doc, { rect: { x: -100, y: 0, w: 800, h: 300 }, dpi: 600, paper: [250, 240, 230], frame: [20] }, 'Propiedades')!;
    expect(cmd.pageChange).toBe(true);
    expect([doc.width, doc.height, doc.dpi]).toEqual([800, 300, 600]);
    expect(paperOf(doc)).toEqual([250, 240, 230]);
    expect(doc.guides).toEqual({ v: [20, 780], h: [20, 280] });
    cmd.undo();
    expect([doc.width, doc.height, doc.dpi]).toEqual([600, 300, 300]);
    expect(paperOf(doc)).toEqual([255, 255, 255]);
    expect(doc.guides).toEqual({ v: [], h: [] });
    cmd.redo();
    expect([doc.width, doc.dpi]).toEqual([800, 600]);
    expect(doc.guides).toEqual({ v: [20, 780], h: [20, 280] });
  });

  it('keeps existing guides and does not repeat them', () => {
    const doc = sample();
    doc.guides = { v: [20], h: [] };
    applyCanvasProps(doc, { frame: [20] }, 'Marco');
    expect(doc.guides).toEqual({ v: [20, 580], h: [20, 280] });
  });

  it('turns the paper off and on again', () => {
    const doc = sample();
    const cmd = applyCanvasProps(doc, { paper: null }, 'Papel')!;
    expect(paperOf(doc)).toBeNull();
    cmd.undo();
    expect(paperOf(doc)).toEqual([255, 255, 255]);
    applyCanvasProps(doc, { paper: null }, 'Papel');
    applyCanvasProps(doc, { paper: [10, 20, 30] }, 'Papel');
    expect(paperOf(doc)).toEqual([10, 20, 30]);
  });

  it('does nothing when nothing changes, and ignores paper in a page without it', () => {
    const doc = sample();
    expect(applyCanvasProps(doc, { rect: { x: 0, y: 0, w: 600, h: 300 }, dpi: 300, paper: [255, 255, 255], frame: [] }, 'x')).toBeNull();
    const bare = createDocument(100, 100, 72);
    expect(hasPaper(bare)).toBe(false);
    expect(applyCanvasProps(bare, { paper: [1, 2, 3] }, 'x')).toBeNull();
  });
});
