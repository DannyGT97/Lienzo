import { describe, expect, it } from 'vitest';
import { MAX_PIXELS, comicLayout, formatLength, fromPx, hexToRgb, rgbToHex, toMm, toPx, validate, validateComic } from './new-doc';

describe('new document validation', () => {
  it('accepts the page presets, up to A3 at 600 dpi', () => {
    expect(validate(2480, 3508, 300)).toBeNull();
    expect(validate(7016, 9921, 600)).toBeNull();
  });

  it('rejects nonsense and oversized pages', () => {
    expect(validate(0, 100, 300)).not.toBeNull();
    expect(validate(Number.NaN, 100, 300)).not.toBeNull();
    expect(validate(8, 8, 300)).not.toBeNull();
    expect(validate(30_000, 100, 300)).not.toBeNull();
    expect(validate(15_000, Math.ceil(MAX_PIXELS / 15_000) + 1, 300)).not.toBeNull();
    expect(validate(1000, 1000, 5)).not.toBeNull();
  });
});

describe('new document units', () => {
  it('converts between physical units and pixels at a resolution', () => {
    expect(Math.round(toPx(210, 'mm', 300))).toBe(2480);
    expect(Math.round(toPx(297, 'mm', 300))).toBe(3508);
    expect(toPx(1, 'in', 300)).toBe(300);
    expect(toPx(2.54, 'cm', 300)).toBeCloseTo(300, 6);
    expect(toPx(640, 'px', 300)).toBe(640);
    expect(fromPx(300, 'in', 300)).toBe(1);
    expect(fromPx(2480, 'mm', 300)).toBeCloseTo(209.97, 1);
    expect(toMm(300, 'px', 300)).toBeCloseTo(25.4, 6);
    expect(toMm(3, 'cm', 300)).toBe(30);
  });

  it('formats lengths without trailing zeros', () => {
    expect(formatLength(210, 'mm')).toBe('210');
    expect(formatLength(209.97, 'mm')).toBe('210');
    expect(formatLength(8.2677, 'in')).toBe('8.27');
    expect(formatLength(1080.4, 'px')).toBe('1080');
  });
});

describe('manga page layout', () => {
  it('adds the bleed on every side and guides the trim box and the inner border', () => {
    const l = comicLayout({ trimW: 182, trimH: 257, bleed: 3, margin: 15 }, 600);
    const px = (mm: number): number => Math.round(toPx(mm, 'mm', 600));
    expect(l.width).toBe(px(182) + 2 * px(3));
    expect(l.height).toBe(px(257) + 2 * px(3));
    expect(l.guides.v).toEqual([px(3), px(3) + px(15), px(3) + px(182) - px(15), px(3) + px(182)]);
    expect(l.guides.h).toHaveLength(4);
  });

  it('drops guides that would sit on the page edge', () => {
    const l = comicLayout({ trimW: 100, trimH: 150, bleed: 0, margin: 0 }, 300);
    expect(l.guides).toEqual({ v: [], h: [] });
  });

  it('rejects impossible setups', () => {
    expect(validateComic({ trimW: 182, trimH: 257, bleed: 3, margin: 15 })).toBeNull();
    expect(validateComic({ trimW: 0, trimH: 257, bleed: 3, margin: 15 })).not.toBeNull();
    expect(validateComic({ trimW: 182, trimH: 257, bleed: -1, margin: 15 })).not.toBeNull();
    expect(validateComic({ trimW: 100, trimH: 150, bleed: 3, margin: 50 })).not.toBeNull();
  });
});

describe('paper colour', () => {
  it('round-trips hex and falls back to white on garbage', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(rgbToHex([255, 128, 0])).toBe('#ff8000');
    expect(hexToRgb('nope')).toEqual([255, 255, 255]);
  });
});
