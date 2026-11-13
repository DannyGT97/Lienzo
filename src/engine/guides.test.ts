import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { emptyGuides, guideAt, recordGuides, snapPoint } from './guides';
import { History } from './history';

describe('snapPoint', () => {
  const g = { v: [100], h: [50, 200] };

  it('pulls each axis onto a close guide and leaves the rest alone', () => {
    expect(snapPoint({ x: 103, y: 300 }, g, { guides: true, gridStep: 0, tolerance: 5 })).toEqual({ x: 100, y: 300 });
    expect(snapPoint({ x: 140, y: 197 }, g, { guides: true, gridStep: 0, tolerance: 5 })).toEqual({ x: 140, y: 200 });
  });

  it('does nothing when snapping is off, and the grid works without guides', () => {
    expect(snapPoint({ x: 103, y: 52 }, g, { guides: false, gridStep: 0, tolerance: 5 })).toEqual({ x: 103, y: 52 });
    expect(snapPoint({ x: 33, y: 61 }, emptyGuides(), { guides: false, gridStep: 20, tolerance: 4 })).toEqual({ x: 33, y: 60 });
  });

  it('guides win over the grid', () => {
    expect(snapPoint({ x: 102, y: 0 }, g, { guides: true, gridStep: 20, tolerance: 5 }).x).toBe(100);
    expect(snapPoint({ x: 121, y: 0 }, g, { guides: true, gridStep: 20, tolerance: 5 }).x).toBe(120);
  });
});

describe('guideAt', () => {
  it('finds the closest guide under the pointer', () => {
    const g = { v: [100, 110], h: [40] };
    expect(guideAt({ x: 108, y: 500 }, g, 4)).toEqual({ axis: 'v', index: 1 });
    expect(guideAt({ x: 500, y: 42 }, g, 4)).toEqual({ axis: 'h', index: 0 });
    expect(guideAt({ x: 500, y: 500 }, g, 4)).toBeNull();
  });
});

describe('recordGuides', () => {
  it('makes guide edits undoable', () => {
    const doc = createDocument(100, 100, 300);
    const h = new History();
    h.push(recordGuides(doc, 'Nueva guía', () => doc.guides.v.push(30))!);
    h.push(recordGuides(doc, 'Mover guía', () => (doc.guides.v[0] = 45))!);
    expect(doc.guides.v).toEqual([45]);
    h.undo();
    expect(doc.guides.v).toEqual([30]);
    h.undo();
    expect(doc.guides.v).toEqual([]);
    h.redo();
    expect(doc.guides.v).toEqual([30]);
    expect(recordGuides(doc, 'nada', () => undefined)).toBeNull();
  });
});
