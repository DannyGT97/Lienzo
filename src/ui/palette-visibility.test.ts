import { describe, expect, it } from 'vitest';
import { SHOWN_KEY, loadShown, saveShown } from './palette-visibility';

const store = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SHOWN_KEY, initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};
const right = new Set(['navigator', 'history', 'layerorder']);
const left = new Set(['brushsize']);

describe('palette visibility', () => {
  it('reads back what was saved', () => {
    const s = store();
    expect(saveShown(s, { right: ['navigator', 'layerorder'], left: ['brushsize'] })).toBe(true);
    const got = loadShown(s, right, left)!;
    expect([...got.right]).toEqual(['navigator', 'layerorder']);
    expect([...got.left]).toEqual(['brushsize']);
  });

  it('keeps a deliberately empty dock empty instead of falling back to the defaults', () => {
    const s = store();
    saveShown(s, { right: [], left: [] });
    const got = loadShown(s, right, left)!;
    expect(got.right.size).toBe(0);
    expect(got.left.size).toBe(0);
  });

  it('drops ids the version does not know and ignores wrong types', () => {
    const got = loadShown(store(JSON.stringify({ right: ['navigator', 'gone', 7, null], left: 'x' })), right, left)!;
    expect([...got.right]).toEqual(['navigator']);
    expect(got.left.size).toBe(0);
  });

  it('gives nothing back for missing or unreadable data', () => {
    expect(loadShown(store(), right, left)).toBeNull();
    expect(loadShown(store('{broken'), right, left)).toBeNull();
    expect(loadShown(store('null'), right, left)).toBeNull();
    expect(loadShown(store('[]'), right, left)).toBeNull();
    expect(loadShown({ getItem: () => { throw new Error('blocked'); } }, right, left)).toBeNull();
  });

  it('reports a refusing storage', () => {
    expect(saveShown({ setItem: () => { throw new Error('full'); } }, { right: [], left: [] })).toBe(false);
  });
});
