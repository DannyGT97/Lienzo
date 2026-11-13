import { describe, expect, it } from 'vitest';
import { dragHandle, handleCursor, handlePoint, hitHandle } from './canvas-resize';

const R = { x: 0, y: 0, w: 600, h: 300 };

describe('canvas size handles', () => {
  it('puts the eight handles on the corners and the middle of each side', () => {
    expect(handlePoint(R, 'nw')).toEqual({ x: 0, y: 0 });
    expect(handlePoint(R, 'e')).toEqual({ x: 600, y: 150 });
    expect(handlePoint(R, 'se')).toEqual({ x: 600, y: 300 });
    expect(handlePoint(R, 's')).toEqual({ x: 300, y: 300 });
  });

  it('finds the nearest handle within reach and nothing farther', () => {
    expect(hitHandle(R, { x: 5, y: 4 }, 10)).toBe('nw');
    expect(hitHandle(R, { x: 596, y: 150 }, 10)).toBe('e');
    expect(hitHandle(R, { x: 300, y: 150 }, 10)).toBeNull();
    // On a very small window the closer handle wins.
    expect(hitHandle({ x: 0, y: 0, w: 8, h: 8 }, { x: 7, y: 7 }, 10)).toBe('se');
  });

  it('moves only the edges the handle owns', () => {
    expect(dragHandle(R, 'e', { x: 800, y: -50 })).toEqual({ x: 0, y: 0, w: 800, h: 300 });
    expect(dragHandle(R, 'nw', { x: -40, y: -20 })).toEqual({ x: -40, y: -20, w: 640, h: 320 });
    expect(dragHandle(R, 's', { x: 9, y: 250.4 })).toEqual({ x: 0, y: 0, w: 600, h: 250 });
  });

  it('never turns the window inside out', () => {
    expect(dragHandle(R, 'w', { x: 900, y: 0 })).toEqual({ x: 599, y: 0, w: 1, h: 300 });
    expect(dragHandle(R, 'n', { x: 0, y: 900 })).toEqual({ x: 0, y: 299, w: 600, h: 1 });
    expect(dragHandle(R, 'e', { x: -50, y: 0 })).toEqual({ x: 0, y: 0, w: 1, h: 300 });
  });

  it('gives a resize cursor along the right axis', () => {
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('w')).toBe('ew-resize');
    expect(handleCursor('se')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
  });
});
