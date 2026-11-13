import { describe, expect, it } from 'vitest';
import { TOUCH_UI_KEY, initialTouchUi, isTouchPlatform } from './touch-mode';

const store = (v?: string) => ({ getItem: (k: string) => (k === TOUCH_UI_KEY ? (v ?? null) : null) });

describe('touch layout choice', () => {
  it('starts off on a desktop and on on a touch device when nothing was chosen', () => {
    expect(initialTouchUi(store(), false)).toBe(false);
    expect(initialTouchUi(store(), true)).toBe(true);
    expect(initialTouchUi(null, false)).toBe(false);
  });

  it('keeps an explicit choice over the platform', () => {
    expect(initialTouchUi(store('1'), false)).toBe(true);
    expect(initialTouchUi(store('0'), true)).toBe(false);
  });

  it('ignores garbage and blocked storage', () => {
    expect(initialTouchUi(store('maybe'), true)).toBe(true);
    expect(initialTouchUi({ getItem: () => { throw new Error('blocked'); } }, false)).toBe(false);
  });

  it('recognises phones and tablets, including iPadOS posing as a Mac', () => {
    expect(isTouchPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Tab) Chrome/120', maxTouchPoints: 5 })).toBe(true);
    expect(isTouchPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', maxTouchPoints: 5 })).toBe(true);
    expect(isTouchPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true);
    expect(isTouchPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false);
    expect(isTouchPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', maxTouchPoints: 10 })).toBe(false);
  });
});
