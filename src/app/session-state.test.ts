import { describe, expect, it } from 'vitest';
import type { StoredAutosave } from './autosave';
import { judgeCopy, parseSession, planRestore, serializeSession } from './session-state';

const copy = (key: string, unsaved?: boolean): StoredAutosave => ({ key, entry: { blob: new Blob(['x']), savedAt: 1, ...(unsaved === undefined ? {} : { unsaved }) } });

describe('session record', () => {
  it('round-trips and ignores anything malformed', () => {
    const r = { empty: false, tabs: ['a', 'b'], active: 'b' };
    expect(parseSession(serializeSession(r))).toEqual(r);
    for (const bad of [null, '', 'nope', '{}', '{"v":2,"empty":false,"tabs":[]}', '{"v":1,"empty":"no","tabs":[]}', '{"v":1,"empty":false}']) expect(parseSession(bad)).toBeNull();
  });
  it('drops keys that are not text, repeats, and an active tab that is not a tab', () => {
    expect(parseSession('{"v":1,"empty":false,"tabs":["a",3,"a",""],"active":"zzz"}')).toEqual({ empty: false, tabs: ['a'], active: null });
  });
  it('is only empty when no tab is listed', () => {
    expect(parseSession('{"v":1,"empty":true,"tabs":["a"],"active":"a"}')?.empty).toBe(false);
    expect(parseSession('{"v":1,"empty":true,"tabs":[],"active":null}')?.empty).toBe(true);
  });
});

describe('planRestore', () => {
  it('without a record nothing is restored and the app starts as before', () => {
    const p = planRestore(null, [copy('a', true), copy('b', false)]);
    expect(p.open).toEqual([]);
    expect(p.emptyStart).toBe(false);
    expect(p.orphans.map((s) => s.key)).toEqual(['a']);
    expect(p.stale.map((s) => s.key)).toEqual(['b']);
  });
  it('opens the recorded tabs in their order, saved or not, and skips the ones whose copy is gone', () => {
    const p = planRestore({ empty: false, tabs: ['b', 'gone', 'a'], active: 'a' }, [copy('a', false), copy('b', true), copy('c', true)]);
    expect(p.open.map((s) => s.key)).toEqual(['b', 'a']);
    expect(p.active).toBe('a');
    expect(p.orphans.map((s) => s.key)).toEqual(['c']);
  });
  it('falls back to the first tab when the active one has no copy', () => {
    expect(planRestore({ empty: false, tabs: ['x', 'a'], active: 'x' }, [copy('a', true)]).active).toBe('a');
  });
  it('a record of "nothing open" starts empty, but unsaved leftovers are still offered', () => {
    const p = planRestore({ empty: true, tabs: [], active: null }, [copy('old')]);
    expect(p.emptyStart).toBe(true);
    expect(p.orphans.map((s) => s.key)).toEqual(['old']);
  });
  it('a record whose tabs all lost their copy does not start empty', () => {
    expect(planRestore({ empty: false, tabs: ['gone'], active: 'gone' }, []).emptyStart).toBe(false);
  });
});

describe('judgeCopy', () => {
  // copy() stamps every copy at 1.
  it('puts a copy back while the file has not changed since, or cannot be told', () => {
    expect(judgeCopy(copy('a', true), null)).toBe('current');
    expect(judgeCopy(copy('a', true), 0)).toBe('current');
    expect(judgeCopy(copy('a', false), 0)).toBe('current');
  });
  it('drops a saved copy once the file is newer: it holds nothing the file lacks', () => {
    expect(judgeCopy(copy('a', false), 1)).toBe('behind');
    expect(judgeCopy(copy('a', false), 500)).toBe('behind');
  });
  it('never drops a copy with unsaved changes when the file is newer: the person decides', () => {
    expect(judgeCopy(copy('a', true), 500)).toBe('diverged');
    expect(judgeCopy(copy('a'), 500)).toBe('diverged'); // written before there was a flag: all had changes
  });
});
