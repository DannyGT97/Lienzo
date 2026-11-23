import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../app/prefs';
import { autosaveHint, buildSections, changedCount, fold, isChanged, isEditable, isLive, itemsOf, restore, search } from './prefs-model';

const sections = buildSections([['Memoria del documento', '1,2 GB']]);
const defaults = { ...DEFAULT_PREFS } as Record<string, unknown>;

describe('the options of the Preferences window', () => {
  it('every option that does something edits a real preference, and every real preference has an option', () => {
    const live = itemsOf({ id: 'all', title: '', icon: 'pen', groups: sections.flatMap((s) => s.groups) }).filter(isEditable);
    for (const i of live) expect(i.key in defaults, `${i.key} is not a preference`).toBe(true);
    expect(live.map((i) => i.key).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('keys are unique, and options that do nothing yet say what they show meanwhile', () => {
    const all = sections.flatMap(itemsOf);
    expect(new Set(all.map((i) => i.key)).size).toBe(all.length);
    for (const i of all.filter((x) => !isLive(x))) expect(i.placeholder, i.key).not.toBeUndefined();
  });

  it('range options stay inside what the preferences accept', () => {
    const range = (key: string) => {
      const c = sections.flatMap(itemsOf).find((i) => i.key === key)!.control;
      if (c.type !== 'range') throw new Error(key);
      return c;
    };
    expect([range('autosaveMinutes').min, range('autosaveMinutes').max]).toEqual([1, 120]);
    expect([range('historySteps').min, range('historySteps').max]).toEqual([10, 1000]);
    expect([range('undoMemoryMb').min, range('undoMemoryMb').max]).toEqual([32, 4096]);
    expect(range('uiScale').presets).toContain(100);
  });

  it('the memory figures go into Rendimiento, and without them the group is not there', () => {
    const perf = sections.find((s) => s.id === 'perf')!;
    expect(perf.groups[0]!.name).toBe('Memoria ahora');
    expect(perf.groups[0]!.items[0]).toMatchObject({ label: 'Memoria del documento', control: { type: 'info', value: '1,2 GB' } });
    expect(buildSections().find((s) => s.id === 'perf')!.groups[0]!.name).toBe('Deshacer');
  });
});

describe('what is changed and how it is restored', () => {
  const values = { ...defaults, autosaveMinutes: 5, brushCrosshair: true, uiScale: 125 };

  it('counts only the options that differ from their default', () => {
    expect(changedCount(sections.find((s) => s.id === 'file')!, values, defaults)).toBe(1);
    expect(changedCount(sections.find((s) => s.id === 'draw')!, values, defaults)).toBe(1);
    expect(changedCount(sections.find((s) => s.id === 'layers')!, values, defaults)).toBe(0);
    const item = sections.flatMap(itemsOf).find((i) => i.key === 'autosaveMinutes')!;
    expect(isChanged(item, values, defaults)).toBe(true);
    expect(isChanged(item, defaults, defaults)).toBe(false);
  });

  it('restores one section, or everything, and nothing else', () => {
    const one = restore(sections, values, defaults, 'file');
    expect(one.autosaveMinutes).toBe(DEFAULT_PREFS.autosaveMinutes);
    expect(one.brushCrosshair).toBe(true);
    const all = restore(sections, values, defaults);
    expect(all).toEqual(defaults);
    expect(values.autosaveMinutes).toBe(5); // the original is not touched
  });
});

describe('search', () => {
  it('finds without caring about accents or case, in the name, the hint and the extra words', () => {
    const names = (q: string) => search(sections, q, true).flatMap((h) => h.items.map((i) => i.key));
    expect(names('PRESION')).toContain('usePressure');
    expect(names('presion')).toContain('pressureCurve');
    expect(names('autoguardado')).toContain('autosave'); // an extra word
    expect(names('historial')).toContain('historySteps');
    expect(names('zzz')).toEqual([]);
    expect(search(sections, '   ', true)).toEqual([]);
  });

  it('leaves out what does nothing yet when those are hidden, and finds a section by its name', () => {
    expect(search(sections, 'tema', true).flatMap((h) => h.items.map((i) => i.key))).toContain('theme');
    expect(search(sections, 'tema', false).flatMap((h) => h.items.map((i) => i.key))).not.toContain('theme');
    expect(search(sections, 'rendimiento', false)[0]!.section.id).toBe('perf');
    expect(fold('Corrección')).toBe('correccion');
  });
});

describe('autosaveHint', () => {
  it('says what the interval means, or that the copies are off', () => {
    expect(autosaveHint({ autosave: true, autosaveMinutes: 15 })).toContain('15 min');
    expect(autosaveHint({ autosave: false, autosaveMinutes: 15 })).toContain('desactivadas');
  });
});
