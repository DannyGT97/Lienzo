import { describe, expect, it } from 'vitest';
import { clampUiScale, drawerBreakpoint, effectiveUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_PRESETS, UI_SCALE_STEP, wantsDrawers } from './ui-scale-model';

describe('interface scale choices', () => {
  it('keeps what the person types inside the range and on the step grid', () => {
    expect(clampUiScale(100)).toBe(100);
    expect(clampUiScale(1)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(1000)).toBe(UI_SCALE_MAX);
    expect(clampUiScale(112)).toBe(110);
    expect(clampUiScale(113)).toBe(115);
    expect(clampUiScale('125')).toBe(125);
  });

  it('falls back to 100 % for anything that is not a number', () => {
    for (const bad of [Number.NaN, Infinity, undefined, null, '', 'x', {}]) expect(clampUiScale(bad)).toBe(100);
  });

  it('offers quick values that are themselves valid choices', () => {
    for (const p of UI_SCALE_PRESETS) {
      expect(clampUiScale(p)).toBe(p);
      expect(p % UI_SCALE_STEP).toBe(0);
    }
    expect(UI_SCALE_PRESETS).toContain(100);
  });
});

describe('scale really applied in a window', () => {
  it('is the preference wherever the window has room for it', () => {
    expect(effectiveUiScale(100, 1280)).toBe(1);
    expect(effectiveUiScale(200, 1280)).toBe(2);
    expect(effectiveUiScale(50, 375)).toBe(0.5);
  });

  it('holds a large preference back on a narrow window, so the chrome keeps at least ~320 px', () => {
    expect(effectiveUiScale(200, 375)).toBeCloseTo(375 / 320);
    expect(effectiveUiScale(200, 640)).toBe(2);
    // The preference itself is untouched; only what is applied here changes, and it grows back with the window.
    expect(effectiveUiScale(200, 1000)).toBe(2);
  });

  it('never goes under 100 % just because the window is small', () => {
    expect(effectiveUiScale(100, 200)).toBe(1);
  });
});

describe('docks beside the canvas or side drawers', () => {
  it('keeps the old 1000 px limit at 100 % and below', () => {
    expect(drawerBreakpoint(1)).toBe(1000);
    expect(drawerBreakpoint(0.5)).toBe(1000);
    expect(wantsDrawers(1000, 1)).toBe(true);
    expect(wantsDrawers(1001, 1)).toBe(false);
  });

  it('asks for more room as the docks grow', () => {
    expect(drawerBreakpoint(1.5)).toBe(1286);
    expect(drawerBreakpoint(2)).toBe(1572);
    expect(wantsDrawers(1280, 1.5)).toBe(true);
    expect(wantsDrawers(1920, 2)).toBe(false);
  });
});
