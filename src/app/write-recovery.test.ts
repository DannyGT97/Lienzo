import { describe, expect, it } from 'vitest';
import { describeRecovery } from './write-recovery';

const name = (t: string): string => t.split('/').pop()!;

describe('describeRecovery', () => {
  it('says nothing when no write was cut', () => {
    expect(describeRecovery([], name)).toEqual({ done: null, failed: null });
  });

  it('says which files were completed, and which could not be and what to do', () => {
    const r = describeRecovery(
      [
        { target: 'content://x/a.lienzo', ok: true },
        { target: 'content://x/b.lienzo', ok: false, error: 'sin permiso' },
      ],
      name,
    );
    expect(r.done).toContain('«a.lienzo»');
    expect(r.done).not.toContain('b.lienzo');
    expect(r.failed).toContain('«b.lienzo»');
    expect(r.failed).toContain('sin permiso');
    expect(r.failed).toContain('Guardar como');
  });
});
