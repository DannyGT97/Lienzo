import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, applyPressureCurve, loadPrefs, noticeMs, sanitizePrefs, savePrefs } from './prefs';

const memory = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: (k: string) => (k === PREFS_KEY ? value : null),
    setItem: (k: string, v: string) => {
      if (k === PREFS_KEY) value = v;
    },
    peek: () => value,
  };
};

describe('preferences', () => {
  it('gives every default when nothing is stored', () => {
    expect(loadPrefs(memory())).toEqual(DEFAULT_PREFS);
  });

  it('falls back field by field on wrong kinds and clamps numbers', () => {
    const p = sanitizePrefs({ usePressure: 'yes', pressureCurve: 'wild', fingerDraws: false, historySteps: 99999, undoMemoryMb: -5, brushOutline: 0 });
    expect(p.usePressure).toBe(true);
    expect(p.pressureCurve).toBe('default');
    expect(p.fingerDraws).toBe(false);
    expect(p.historySteps).toBe(1000);
    expect(p.undoMemoryMb).toBe(32);
    expect(p.brushOutline).toBe(true);
  });

  it('keeps the interface scale inside its range and 100 % by default', () => {
    expect(DEFAULT_PREFS.uiScale).toBe(100);
    expect(sanitizePrefs({ uiScale: 10 }).uiScale).toBe(50);
    expect(sanitizePrefs({ uiScale: 900 }).uiScale).toBe(200);
    expect(sanitizePrefs({ uiScale: 82.4 }).uiScale).toBe(80); // on the 5 % step grid
    expect(sanitizePrefs({ uiScale: 175 }).uiScale).toBe(175); // a range that used to stop at 150
    expect(sanitizePrefs({ uiScale: '80' }).uiScale).toBe(100);
  });

  it('keeps the notice duration to the known speeds and slow (4 s) by default', () => {
    expect(DEFAULT_PREFS.noticeSpeed).toBe('slow');
    expect(noticeMs(DEFAULT_PREFS.noticeSpeed)).toBe(4000);
    expect(sanitizePrefs({ noticeSpeed: 'slower' }).noticeSpeed).toBe('slower');
    expect(sanitizePrefs({ noticeSpeed: 'eternal' }).noticeSpeed).toBe('slow');
    expect(sanitizePrefs({ noticeSpeed: 3 }).noticeSpeed).toBe('slow');
  });

  it('treats NaN, strings and nulls as missing', () => {
    expect(sanitizePrefs({ historySteps: Number.NaN }).historySteps).toBe(DEFAULT_PREFS.historySteps);
    expect(sanitizePrefs({ historySteps: '50' }).historySteps).toBe(DEFAULT_PREFS.historySteps);
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs([1, 2])).toEqual(DEFAULT_PREFS);
  });

  it('drops keys no setting owns any more and keeps the valid ones when stored values are old', () => {
    const store = memory(JSON.stringify({ gpuAcceleration: true, virtualMemoryPath: 'D:/x', ramPercent: 80, historySteps: 50, undoMemoryMb: 512, uiScale: 120 }));
    const p = loadPrefs(store);
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(p.historySteps).toBe(50);
    expect(p.undoMemoryMb).toBe(512);
    expect(p.uiScale).toBe(120);
    savePrefs(store, p);
    expect(store.peek()).not.toMatch(/gpuAcceleration|virtualMemoryPath|ramPercent/);
  });

  it('survives corrupt storage', () => {
    expect(loadPrefs(memory('{not json'))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PREFS);
  });

  it('round-trips through the store and reports a refusing store', () => {
    const m = memory();
    const wanted = { ...DEFAULT_PREFS, pressureCurve: 'soft' as const, brushCrosshair: true, historySteps: 40 };
    expect(savePrefs(m, wanted)).toBe(true);
    expect(loadPrefs(m)).toEqual(wanted);
    expect(savePrefs({ setItem: () => { throw new Error('full'); } }, wanted)).toBe(false);
  });
});

describe('global pressure curve', () => {
  it('keeps the ends and the default curve straight', () => {
    for (const id of ['default', 'soft', 'firm'] as const) {
      expect(applyPressureCurve(0, id)).toBe(0);
      expect(applyPressureCurve(1, id)).toBe(1);
    }
    expect(applyPressureCurve(0.37, 'default')).toBe(0.37);
  });

  it('soft raises light touches and firm lowers them', () => {
    expect(applyPressureCurve(0.3, 'soft')).toBeGreaterThan(0.3);
    expect(applyPressureCurve(0.3, 'firm')).toBeLessThan(0.3);
  });

  it('never leaves 0..1, whatever the digitizer reports', () => {
    expect(applyPressureCurve(7, 'firm')).toBe(1);
    expect(applyPressureCurve(-2, 'soft')).toBe(0);
    expect(applyPressureCurve(Number.NaN, 'firm')).toBe(1); // an unreadable value counts as full pressure, like a mouse
  });
});

describe('autosave preferences', () => {
  it('start as Clip Studio does: every 15 minutes', () => {
    expect(DEFAULT_PREFS.autosave).toBe(true);
    expect(DEFAULT_PREFS.autosaveMinutes).toBe(15);
  });

  it('keep the interval within what makes sense and fall back on anything else', () => {
    expect(sanitizePrefs({ autosaveMinutes: 0 }).autosaveMinutes).toBe(1);
    expect(sanitizePrefs({ autosaveMinutes: 9999 }).autosaveMinutes).toBe(120);
    expect(sanitizePrefs({ autosaveMinutes: 7.4 }).autosaveMinutes).toBe(7);
    expect(sanitizePrefs({ autosaveMinutes: 'soon' }).autosaveMinutes).toBe(15);
    expect(sanitizePrefs({ autosave: false }).autosave).toBe(false);
    expect(sanitizePrefs({ autosave: 'no' }).autosave).toBe(true);
  });
});
