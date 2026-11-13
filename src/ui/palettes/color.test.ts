import { describe, expect, it } from 'vitest';
import { HISTORY_MAX, pushRecent } from './color';

describe('colour history', () => {
  it('puts the newest colour first and does not repeat one used before', () => {
    expect(pushRecent(['#111111', '#222222', '#333333'], '#222222')).toEqual(['#222222', '#111111', '#333333']);
    expect(pushRecent([], '#abcdef')).toEqual(['#abcdef']);
  });

  it('keeps many colours but stops at the limit, dropping the oldest', () => {
    const many = Array.from({ length: HISTORY_MAX }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
    const next = pushRecent(many, '#ffffff');
    expect(next).toHaveLength(HISTORY_MAX);
    expect(next[0]).toBe('#ffffff');
    expect(next).not.toContain(many[HISTORY_MAX - 1]);
  });
});
