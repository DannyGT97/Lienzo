import { describe, expect, it, vi } from 'vitest';
import { collectSettings, flushSettings, isSetting, parseSettings, restoreSettings, startSettingsMirror, type SettingsFile } from './settings-store';

/** A Storage in memory. */
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

function fileOf(text: string | null) {
  const file = { text, writes: [] as string[], read: vi.fn(async () => file.text), write: vi.fn(async (t: string) => void (file.writes.push(t), (file.text = t))) };
  return file satisfies SettingsFile & Record<string, unknown>;
}

describe('settings-store', () => {
  it('only lienzo.* keys are settings, and not the open-tabs record', () => {
    expect(isSetting('lienzo.prefs')).toBe(true);
    expect(isSetting('lienzo.session.v1')).toBe(false);
    expect(isSetting('other')).toBe(false);
    const s = memory({ 'lienzo.prefs': '{}', 'lienzo.session.v1': 'x', foo: 'bar' });
    expect(collectSettings(s)).toEqual({ 'lienzo.prefs': '{}' });
  });

  it('reads a file defensively', () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings('not json')).toEqual({});
    expect(parseSettings('[1]')).toEqual({});
    expect(parseSettings(JSON.stringify({ 'lienzo.a': 'x', 'lienzo.b': 3, evil: 'y', 'lienzo.session.v1': 'z' }))).toEqual({ 'lienzo.a': 'x' });
  });

  it('puts the file back over the store and keeps keys only the store has', () => {
    const s = memory({ 'lienzo.a': 'old', 'lienzo.only': '1' });
    expect(restoreSettings(s, { 'lienzo.a': 'new', 'lienzo.b': '2' })).toBe(2);
    expect(Object.fromEntries(s.data)).toEqual({ 'lienzo.a': 'new', 'lienzo.only': '1', 'lienzo.b': '2' });
  });

  it('restores a wiped store from the file at start', async () => {
    const s = memory();
    const f = fileOf(JSON.stringify({ 'lienzo.prefs': '{"uiScale":120}' }));
    await startSettingsMirror(f, s, () => undefined);
    expect(s.getItem('lienzo.prefs')).toBe('{"uiScale":120}');
  });

  it('writes what the store held when there was no file yet, and later changes once, after a pause', async () => {
    vi.useFakeTimers();
    const s = memory({ 'lienzo.a': '1' });
    const f = fileOf(null);
    let changed = (): void => undefined;
    await startSettingsMirror(f, s, (c) => (changed = c));
    expect(JSON.parse(f.writes[0]!)).toEqual({ 'lienzo.a': '1' });
    s.setItem('lienzo.a', '2');
    changed();
    s.setItem('lienzo.a', '3');
    changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes).toHaveLength(2);
    expect(JSON.parse(f.writes[1]!)).toEqual({ 'lienzo.a': '3' });
    vi.useRealTimers();
  });

  it('flushSettings writes a pending change at once', async () => {
    vi.useFakeTimers();
    const s = memory({ 'lienzo.a': '1' });
    const f = fileOf(JSON.stringify({ 'lienzo.a': '1' }));
    let changed = (): void => undefined;
    await startSettingsMirror(f, s, (c) => (changed = c));
    s.setItem('lienzo.a', '9');
    changed();
    await flushSettings();
    expect(JSON.parse(f.text!)).toEqual({ 'lienzo.a': '9' });
    vi.useRealTimers();
  });

  it('never writes when the file could not be read (an empty store must not replace a good file)', async () => {
    const s = memory();
    const f = fileOf('{"lienzo.a":"1"}');
    f.read.mockRejectedValueOnce(new Error('boom'));
    await startSettingsMirror(f, s, () => undefined);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.text).toBe('{"lienzo.a":"1"}');
  });
});
