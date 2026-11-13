import { describe, expect, it } from 'vitest';
import { drawerCap, limitDockWidth, limitToolColumnWidth, toolColumnCount } from './layout-resizers';

describe('dock width limits', () => {
  it('keeps at least 360 px of canvas space on desktop', () => {
    expect(limitDockWidth(900, 1360, 286, false)).toBe(714);
  });

  it('keeps drawers 40 px inside the viewport and at least 260 px wide when possible', () => {
    expect(limitDockWidth(900, 375, 0, true)).toBe(335);
    expect(limitDockWidth(120, 800, 0, true)).toBe(260);
  });

  it('supports constrained narrow viewports without returning an invalid range', () => {
    expect(limitDockWidth(500, 180, 200, true)).toBe(200);
  });

  it('caps a drawer at half the window once the interface scale makes it wide', () => {
    // 200 % in a 1280 px window: 640 screen px = 320 own px (380 own px would be 760 on screen).
    expect(drawerCap(640, 2)).toBe(320);
    expect(limitDockWidth(380, 640, 0, true, 2)).toBe(320);
    // The cap never goes under 380 screen px, nor under 260 own px.
    expect(drawerCap(375, 1)).toBe(380);
    expect(drawerCap(350, 2)).toBe(260);
    // At 100 % a drawer keeps the width it always had.
    expect(limitDockWidth(380, 1000, 0, true)).toBe(380);
  });
});

describe('tool column width limits', () => {
  it('allows a second icon column while preserving 140 px for the subtool dock', () => {
    expect(limitToolColumnWidth(180, 320)).toBe(180);
    expect(limitToolColumnWidth(300, 320)).toBe(180);
    expect(limitToolColumnWidth(400, 330, false, 180)).toBe(150);
  });

  it('keeps the strip as wide as larger touch buttons need', () => {
    expect(limitToolColumnWidth(20, 400, false, 140, 80)).toBe(80);
    expect(limitToolColumnWidth(500, 62, true, 140, 80)).toBe(4 * 74 + 8);
    expect(toolColumnCount(80, 80)).toBe(1);
    expect(toolColumnCount(160, 80)).toBe(2);
  });

  it('limits the strip to its four columns when the subtool panel is folded away', () => {
    expect(limitToolColumnWidth(150, 62, true)).toBe(150);
    expect(limitToolColumnWidth(400, 62, true)).toBe(184);
  });

  it('keeps the default one-column width if the dock is too narrow', () => {
    expect(limitToolColumnWidth(20, 180)).toBe(50);
  });
});

describe('tool column count', () => {
  it('grows one icon column per ~44 px, from one to four', () => {
    expect(toolColumnCount(56)).toBe(1);
    expect(toolColumnCount(96)).toBe(2);
    expect(toolColumnCount(140)).toBe(3);
    expect(toolColumnCount(190)).toBe(4);
    expect(toolColumnCount(400)).toBe(4);
  });
});
