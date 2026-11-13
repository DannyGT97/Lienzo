import { describe, expect, it } from 'vitest';
import { Stroke, defaultBrush } from './brush';
import { addLayer, createDocument, paintTarget } from './document';
import { History, patchCommand } from './history';
import { MultiStroke } from './multi-stroke';
import { followGuides, followPerspective, mirrorAcross, mirrors, projectOnLine, recordRulers, type Ruler } from './rulers';

describe('rulers', () => {
  const horizontal: Ruler = { id: 1, kind: 'line', pts: [{ x: 0, y: 50 }, { x: 100, y: 50 }] };

  it('projects and mirrors across a line', () => {
    expect(projectOnLine({ x: 30, y: 80 }, { x: 0, y: 50 }, { x: 100, y: 50 })).toEqual({ x: 30, y: 50 });
    expect(mirrorAcross({ x: 30, y: 80 }, { x: 0, y: 50 }, { x: 100, y: 50 })).toEqual({ x: 30, y: 20 });
    const diag = mirrorAcross({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(diag.x).toBeCloseTo(0, 9);
    expect(diag.y).toBeCloseTo(10, 9);
  });

  it('a stroke that starts near a line ruler stays on it, one that starts far away is free', () => {
    const near = followGuides([horizontal], { x: 20, y: 55 }, 10)!;
    expect(near({ x: 70, y: 90 })).toEqual({ x: 70, y: 50 });
    expect(followGuides([horizontal], { x: 20, y: 90 }, 10)).toBeNull();
    expect(followGuides([{ ...horizontal, kind: 'symmetry' }], { x: 20, y: 51 }, 10)).toBeNull();
  });

  it('with one vanishing point the stroke follows its ray from the start', () => {
    const vp: Ruler = { id: 2, kind: 'perspective', pts: [{ x: 100, y: 0 }] };
    const follow = followPerspective([vp], { x: 0, y: 0 }, 6)!;
    // From (0,0) to the vanishing point (100,0): a wobbly pen path is flattened onto y = 0.
    expect(follow({ x: 40, y: 7 })).toEqual({ x: 40, y: 0 });
    expect(followPerspective([horizontal], { x: 0, y: 0 }, 6)).toBeNull();
  });

  it('with several vanishing points it picks the one the pen heads to, after a few pixels', () => {
    const rulers: Ruler[] = [
      { id: 1, kind: 'perspective', pts: [{ x: 1000, y: 0 }] },
      { id: 2, kind: 'perspective', pts: [{ x: 0, y: 1000 }] },
    ];
    const f = followPerspective(rulers, { x: 0, y: 0 }, 6)!;
    expect(f({ x: 2, y: 1 })).toEqual({ x: 2, y: 1 }); // not decided yet
    const along = f({ x: 30, y: 4 });
    expect(along.y).toBeCloseTo(0, 6); // locked on the horizontal ray
    expect(f({ x: 60, y: 30 }).y).toBeCloseTo(0, 6); // and it stays there
    const g = followPerspective(rulers, { x: 0, y: 0 }, 6)!;
    g({ x: 3, y: 20 });
    expect(g({ x: 25, y: 60 }).x).toBeCloseTo(0, 6); // heading down: the vertical ray
  });

  it('records ruler edits as undoable steps', () => {
    const doc = createDocument(100, 100, 300);
    const h = new History();
    h.push(recordRulers(doc, 'Nueva regla', () => doc.rulers.push({ id: doc.nextRulerId++, kind: 'line', pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }))!);
    expect(doc.rulers).toHaveLength(1);
    h.undo();
    expect(doc.rulers).toHaveLength(0);
    h.redo();
    expect(doc.rulers[0]!.id).toBe(1);
    expect(recordRulers(doc, 'nada', () => undefined)).toBeNull();
  });
});

describe('MultiStroke', () => {
  const brush = { ...defaultBrush, size: 10, hardness: 1, color: [0, 0, 0] as [number, number, number], stabilization: 0, pressureSize: 0 };

  it('paints the stroke and its mirror image, and undoes both as one step', () => {
    const doc = createDocument(400, 100, 300);
    const layer = addLayer(doc, 'l');
    const axis: Ruler = { id: 1, kind: 'symmetry', pts: [{ x: 300, y: 0 }, { x: 300, y: 100 }] };
    const [mirror] = mirrors([axis]);
    const target = paintTarget(layer);
    const multi = new MultiStroke([new Stroke(target, brush), new Stroke(target, brush)], [(p) => p, mirror!]);
    for (let x = 100; x <= 250; x += 10) multi.addPoint(x, 40);
    const patch = multi.finish()!;
    expect(layer.surface.alphaAt(150, 40)).toBe(255);
    expect(layer.surface.alphaAt(350, 40)).toBe(255); // 250 mirrored across x = 300
    expect(layer.surface.alphaAt(399, 40)).toBe(255); // 201 mirrored
    expect(layer.surface.alphaAt(285, 40)).toBe(0); // between the two strokes
    const h = new History();
    h.push(patchCommand(doc, patch));
    h.undo();
    expect(layer.surface.alphaAt(150, 40)).toBe(0);
    expect(layer.surface.alphaAt(350, 40)).toBe(0);
    h.redo();
    expect(layer.surface.alphaAt(350, 40)).toBe(255);
  });
});
