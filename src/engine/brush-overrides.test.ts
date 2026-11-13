import { describe, expect, it } from 'vitest';
import { defaultBrush, type BrushSettings } from './brush';
import { BRUSH_PARAMS, paramByKey } from './brush-params';
import { diffParams, parseStore, shownParams, snapshotParams, withOverrides } from './brush-overrides';

const plain: BrushSettings = { ...defaultBrush };

describe('what a person changed on a sub tool', () => {
  it('stores nothing when nothing changed', () => {
    const base = snapshotParams(plain, 1);
    expect(diffParams(base, snapshotParams({ ...plain }, 1), 1)).toEqual({});
  });

  it('stores only the settings that differ, in the unit they are shown in', () => {
    const base = snapshotParams(plain, 1);
    const edited: BrushSettings = { ...plain, hardness: 0.4, pressureSize: 0, grain: 0.3 };
    expect(diffParams(base, snapshotParams(edited, 1), 1)).toEqual({ hardness: 40, pressureSize: false, grain: 30 });
  });

  it('ignores differences smaller than half a step', () => {
    const base = snapshotParams(plain, 1);
    expect(diffParams(base, snapshotParams({ ...plain, size: plain.size + 0.04 }, 1), 1)).toEqual({});
    expect(Object.keys(diffParams(base, snapshotParams({ ...plain, size: plain.size + 0.2 }, 1), 1))).toEqual(['size']);
  });

  it('keeps lengths per 150 dpi so they follow the page resolution', () => {
    // 20 px on a 300-dpi page (unit 2) is 10 per 150 dpi, and comes back as 20 there and 10 on a 150-dpi page.
    const stored = diffParams(snapshotParams(plain, 2), snapshotParams({ ...plain, size: 20, taperIn: 40 }, 2), 2);
    expect(stored).toEqual({ size: 10, taperIn: 20 });
    expect(shownParams(stored, 2)).toEqual({ size: 20, taperIn: 40 });
    expect(shownParams(stored, 1)).toEqual({ size: 10, taperIn: 20 });
  });

  it('does not scale settings that are not lengths', () => {
    const stored = diffParams(snapshotParams(plain, 2), snapshotParams({ ...plain, hardness: 0.5 }, 2), 2);
    expect(shownParams(stored, 4)).toEqual({ hardness: 50 });
  });

  it('shows stored values snapped to the range and drops unknown settings', () => {
    expect(shownParams({ hardness: 250, nonsense: 3, pressureSize: true }, 1)).toEqual({ hardness: 100, pressureSize: true });
    // A value of the wrong kind for its setting is ignored rather than coerced.
    expect(shownParams({ hardness: true, pressureSize: 1 }, 1)).toEqual({});
  });

  it('keeps only options a choice really offers', () => {
    expect(shownParams({ antialias: 3 }, 1)).toEqual({ antialias: 3 });
    expect(shownParams({ antialias: 7, hardness: 50 }, 1)).toEqual({ hardness: 50 });
    expect(parseStore({ 'pen.pen.x': { antialias: 0 }, 'pen.pen.y': { antialias: 1.5 }, 'pen.pen.z': { antialias: 'weak' } })).toEqual({ 'pen.pen.x': { antialias: 0 } });
  });

  it('round-trips every setting through a store', () => {
    for (const p of BRUSH_PARAMS) {
      const values = p.kind === 'choice' ? p.options.map((o) => o.value) : p.kind === 'number' ? [p.min, p.max] : [];
      const target = p.kind === 'toggle' ? !p.get(plain) : values.find((v) => v !== p.get(plain))!;
      const edited: BrushSettings = { ...plain, ...(p.kind === 'toggle' ? p.set(!p.get(plain)) : p.set(target as number)) };
      const stored = diffParams(snapshotParams(plain, 1), snapshotParams(edited, 1), 1);
      expect(Object.keys(stored), p.key).toContain(p.key);
      expect(shownParams(stored, 1)[p.key], p.key).toBe(target);
    }
  });
});

describe('the stored changes', () => {
  it('reads what was written and drops damaged entries', () => {
    const raw = {
      'pen.pen.g-pen': { size: 12, hardness: 'high', pressureSize: false, junk: 1 },
      'pen.pen.empty': {},
      'pen.pen.bad': 'x',
      list: [1, 2],
    };
    expect(parseStore(raw)).toEqual({ 'pen.pen.g-pen': { size: 12, pressureSize: false } });
  });

  it('survives values that are not an object at all', () => {
    for (const raw of [null, undefined, 5, 'text', [], true]) expect(parseStore(raw)).toEqual({});
  });

  it('replaces and removes the changes of one sub tool without touching the others', () => {
    const a = withOverrides({}, 'a', { size: 3 });
    const b = withOverrides(a, 'b', { hardness: 10 });
    expect(b).toEqual({ a: { size: 3 }, b: { hardness: 10 } });
    expect(withOverrides(b, 'a', {})).toEqual({ b: { hardness: 10 } });
    expect(a).toEqual({ a: { size: 3 } });
  });

  it('knows every key it can store', () => {
    for (const p of BRUSH_PARAMS) expect(paramByKey(p.key)).toBe(p);
  });
});
