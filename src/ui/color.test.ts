import { describe, expect, it } from 'vitest';
import { cmykToRgb, DEFAULT_COLOR_SET, fromHex, hsvToRgb, labToRgb, rgbToCmyk, rgbToHsv, rgbToLab, toHex } from './color';

describe('Lab and CMYK', () => {
  it('knows white, black and a mid grey in Lab', () => {
    const [L, a, b] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 1);
    expect(Math.abs(a)).toBeLessThan(0.1);
    expect(Math.abs(b)).toBeLessThan(0.1);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 3);
    expect(rgbToLab(119, 119, 119)[0]).toBeCloseTo(50, 0);
  });

  it('round-trips Lab and CMYK within one level', () => {
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const lab = rgbToLab(r, g, b);
          const cmyk = rgbToCmyk(r, g, b);
          for (const back of [labToRgb(...lab), cmykToRgb(...cmyk)]) {
            expect(Math.abs(back[0] - r)).toBeLessThanOrEqual(1);
            expect(Math.abs(back[1] - g)).toBeLessThanOrEqual(1);
            expect(Math.abs(back[2] - b)).toBeLessThanOrEqual(1);
          }
        }
  });

  it('turns pure inks into primaries and clips what the screen cannot show', () => {
    expect(cmykToRgb(100, 0, 0, 0)).toEqual([0, 255, 255]);
    expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 100]);
    expect(labToRgb(50, 127, 127).every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});

describe('colour conversion', () => {
  it('maps the primaries and greys', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(rgbToHsv(0, 255, 0)[0]).toBe(120);
    expect(rgbToHsv(0, 0, 255)[0]).toBe(240);
    expect(rgbToHsv(128, 128, 128)).toEqual([0, 0, 128 / 255]);
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
    expect(hsvToRgb(60, 1, 1)).toEqual([255, 255, 0]);
    expect(hsvToRgb(200, 0, 0.5)).toEqual([128, 128, 128]);
  });

  it('round-trips every 8-bit colour on a coarse grid within one level', () => {
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const [h, s, v] = rgbToHsv(r, g, b);
          const back = hsvToRgb(h, s, v);
          expect(Math.abs(back[0] - r)).toBeLessThanOrEqual(1);
          expect(Math.abs(back[1] - g)).toBeLessThanOrEqual(1);
          expect(Math.abs(back[2] - b)).toBeLessThanOrEqual(1);
        }
  });

  it('wraps hue and converts hex both ways', () => {
    expect(hsvToRgb(360, 1, 1)).toEqual(hsvToRgb(0, 1, 1));
    expect(hsvToRgb(-120, 1, 1)).toEqual(hsvToRgb(240, 1, 1));
    expect(toHex([255, 136, 0])).toBe('#ff8800');
    expect(fromHex('#ff8800')).toEqual([255, 136, 0]);
    for (const c of DEFAULT_COLOR_SET) expect(toHex(fromHex(c))).toBe(c);
  });
});
