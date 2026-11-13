import { describe, expect, it } from 'vitest';
import { activeAfterClose, withoutTab } from './doc-tabs';

describe('document tabs', () => {
  it('keeps the open tab when another one is closed', () => {
    expect(activeAfterClose([1, 2, 3], 1, 3)).toBe(3);
    expect(activeAfterClose([1, 2, 3], 3, 2)).toBe(2);
  });

  it('opens the tab that took the place of the closed open one, else the last', () => {
    expect(activeAfterClose([1, 2, 3], 2, 2)).toBe(3);
    expect(activeAfterClose([1, 2, 3], 1, 1)).toBe(2);
    expect(activeAfterClose([1, 2, 3], 3, 3)).toBe(2);
  });

  it('says when no tab is left, and copes with an unknown tab', () => {
    expect(activeAfterClose([7], 7, 7)).toBeNull();
    expect(activeAfterClose([1, 2], 9, 2)).toBe(2);
    expect(activeAfterClose([1, 2], 9, 9)).toBe(1);
    expect(withoutTab([1, 2, 3], 2)).toEqual([1, 3]);
  });
});
