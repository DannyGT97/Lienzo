import { describe as suite, expect, it } from 'vitest';
import { MEMORY_NOTICE, createNoticeFilter, describe, isOutOfMemory } from './error-report';

suite('errors told to the person', () => {
  it('recognises the engine running out of memory, however the browser words it', () => {
    for (const t of ['Uncaught RangeError: Array buffer allocation failed', 'RangeError: Invalid typed array length: 1073741824', 'Invalid array length', 'out of memory', 'Failed: allocation failed']) {
      expect(isOutOfMemory(t), t).toBe(true);
    }
    for (const t of ['Uncaught TypeError: x is undefined', 'El archivo está dañado', 'No hay permiso de escritura']) expect(isOutOfMemory(t), t).toBe(false);
  });

  it('says what happened and what to do for a memory error, and drops the browser prefix of any other', () => {
    expect(describe('Uncaught RangeError: Array buffer allocation failed')).toEqual({ kind: 'memory', message: MEMORY_NOTICE });
    expect(MEMORY_NOTICE).toContain('Tu trabajo sigue abierto');
    expect(describe('Uncaught TypeError: algo falló')).toEqual({ kind: 'other', message: 'algo falló' });
    expect(describe('No se pudo guardar')).toEqual({ kind: 'other', message: 'No se pudo guardar' });
  });

  it('shows a repeated notice once, and again after a quiet time (longer for memory errors)', () => {
    let t = 0;
    const show = createNoticeFilter(() => t);
    expect(show('Uncaught RangeError: Array buffer allocation failed')).toBe(MEMORY_NOTICE);
    for (t = 1300; t < 15_000; t += 1300) expect(show('Uncaught RangeError: Array buffer allocation failed'), `t=${t}`).toBeNull();
    t = 25_000;
    expect(show('Array buffer allocation failed')).toBe(MEMORY_NOTICE);

    t = 100_000;
    expect(show('Uncaught Error: otro')).toBe('otro');
    t = 101_000;
    expect(show('Uncaught Error: otro')).toBeNull();
    expect(show('Uncaught Error: distinto')).toBe('distinto');
    t = 104_000;
    expect(show('Uncaught Error: otro')).toBe('otro');
  });
});
