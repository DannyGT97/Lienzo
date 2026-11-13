import { describe, expect, it } from 'vitest';
import { defaultBrush, type BrushSettings } from './brush';
import {
  BRUSH_CATEGORIES,
  BRUSH_PARAMS,
  paramByKey,
  paramsFor,
  positionToValue,
  snapValue,
  toolFamily,
  valueToPosition,
  whyInactive,
  type NumberParam,
} from './brush-params';

const num = (key: string): NumberParam => {
  const p = paramByKey(key);
  if (!p || p.kind !== 'number') throw new Error(`no number param ${key}`);
  return p;
};
const plain: BrushSettings = { ...defaultBrush };

describe('brush parameter catalogue', () => {
  it('has unique keys and only known categories', () => {
    const keys = BRUSH_PARAMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const known = new Set(BRUSH_CATEGORIES.map((c) => c.id));
    for (const p of BRUSH_PARAMS) expect(known.has(p.category)).toBe(true);
  });

  it('round-trips every number setting through its own setter and getter', () => {
    for (const p of BRUSH_PARAMS) {
      if (p.kind !== 'number') continue;
      const mid = snapValue(p, (p.min + p.max) / 2);
      const next: BrushSettings = { ...plain, ...p.set(mid) };
      expect(p.get(next), p.key).toBeCloseTo(mid, 6);
      // The limits are reachable and survive the round trip too.
      expect({ min: p.get({ ...plain, ...p.set(p.min) }), max: p.get({ ...plain, ...p.set(p.max) }) }, p.key).toEqual({ min: p.min, max: p.max });
    }
  });

  it('writes toggles through the same field it reads', () => {
    const t = paramByKey('pressureSize');
    expect(t?.kind).toBe('toggle');
    if (t?.kind !== 'toggle') return;
    expect(t.get({ ...plain, ...t.set(false) })).toBe(false);
    expect(t.get({ ...plain, ...t.set(true) })).toBe(true);
  });

  it('reads the plain brush as the values the sliders start at', () => {
    expect(num('size').get(plain)).toBe(12);
    expect(num('hardness').get(plain)).toBe(80);
    expect(num('opacity').get(plain)).toBe(100);
    expect(num('flow').get(plain)).toBe(100);
    expect(num('nibThickness').get(plain)).toBe(100);
    expect(num('pressureCurve').get(plain)).toBe(1);
    expect(num('grainScale').get(plain)).toBe(6);
  });
});

describe('what each kind of tool is offered', () => {
  it('maps tools to the engine that paints with them', () => {
    expect(toolFamily('brush')).toBe('stroke');
    expect(toolFamily('erase')).toBe('stroke');
    expect(toolFamily('smudge')).toBe('blend');
    expect(toolFamily('liquify')).toBe('blend');
    expect(toolFamily('hand')).toBe('none');
    expect(toolFamily('selrect')).toBe('none');
  });

  it('offers the blending tools only what their engines read', () => {
    expect(paramsFor('blend').map((p) => p.key).sort()).toEqual(['antialias', 'hardness', 'opacity', 'pressureSize', 'size']);
    expect(paramsFor('none')).toEqual([]);
  });

  it('offers pen tools every setting', () => {
    expect(paramsFor('stroke')).toHaveLength(BRUSH_PARAMS.length);
  });
});

describe('settings that have no effect yet say so', () => {
  const why = (key: string, s: BrushSettings): string | undefined => whyInactive(paramByKey(key)!, s);

  it('flags the stamp spacing until the brush stamps', () => {
    expect(why('spacing', plain)).toBeDefined();
    expect(why('spacing', { ...plain, flow: 0.5 })).toBeUndefined();
    expect(why('spacing', { ...plain, pressureFlow: 0.3 })).toBeUndefined();
  });

  it('flags the nib angle on a round nib and the grain size without grain', () => {
    expect(why('nibAngle', plain)).toBeDefined();
    expect(why('nibAngle', { ...plain, nibThickness: 0.4 })).toBeUndefined();
    expect(why('grainScale', plain)).toBeDefined();
    expect(why('grainScale', { ...plain, grain: 0.5 })).toBeUndefined();
  });

  it('flags the minimum size and the pressure curve when no pressure drives anything', () => {
    const off = { ...plain, pressureSize: 0 };
    expect(why('minSize', off)).toBeDefined();
    expect(why('minSize', plain)).toBeUndefined();
    expect(why('pressureCurve', off)).toBeDefined();
    expect(why('pressureCurve', { ...off, pressureOpacity: 0.5 })).toBeUndefined();
  });
});

describe('value editing', () => {
  it('snaps typed values to the range and the step', () => {
    expect(snapValue(num('hardness'), 150)).toBe(100);
    expect(snapValue(num('hardness'), -4)).toBe(0);
    expect(snapValue(num('hardness'), 33.4)).toBe(33);
    expect(snapValue(num('opacity'), 33.37)).toBe(33.4);
    expect(snapValue(num('pressureCurve'), 1.07)).toBe(1.05);
    expect(snapValue(num('size'), Number.NaN)).toBe(1);
  });

  it('maps the logarithmic size slider both ways', () => {
    const size = num('size');
    expect(valueToPosition(size, 1)).toBe(0);
    expect(valueToPosition(size, 2000)).toBe(1000);
    expect(positionToValue(size, 0)).toBe(1);
    expect(positionToValue(size, 1000)).toBe(2000);
    // A constant ratio per step: the middle of the slider is the geometric middle of the range.
    expect(positionToValue(size, 500)).toBeCloseTo(Math.sqrt(2000), 0);
    expect(valueToPosition(size, 12)).toBeGreaterThan(300);
  });

  it('maps a linear slider over its range', () => {
    const h = num('hardness');
    expect(valueToPosition(h, 50)).toBe(500);
    expect(positionToValue(h, 500)).toBe(50);
  });
});
