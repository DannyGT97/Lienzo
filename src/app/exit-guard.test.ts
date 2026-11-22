import { describe, expect, it } from 'vitest';
import { createExitGuard, leaveMessage, type ExitDeps, type LeaveChoice } from './exit-guard';

function harness(unsaved: string[], choice: LeaveChoice, saved = true, hold = false) {
  const log: string[] = [];
  let release: (() => void) | null = null;
  const deps: ExitDeps = {
    unsaved: () => unsaved,
    ask: async (message, label) => {
      log.push(`ask: ${message} [${label}]`);
      if (hold) await new Promise<void>((r) => (release = r));
      return choice;
    },
    saveAll: async () => (log.push('saveAll'), saved),
    discard: async () => void log.push('discard'),
    quit: async () => void log.push('quit'),
  };
  return { log, guard: createExitGuard(deps), release: () => release?.() };
}

describe('leaving with unsaved changes', () => {
  it('quits at once when there is nothing to lose, without asking', async () => {
    const h = harness([], 'save');
    await h.guard.requestExit();
    expect(h.log).toEqual(['quit']);
  });

  it('always asks when a document has changes, even though the autosave holds a copy, and stays when told to', async () => {
    const h = harness(['Dibujo'], 'cancel');
    await h.guard.requestExit();
    expect(h.log).toEqual(['ask: «Dibujo» tiene cambios sin guardar. ¿Quieres guardarlos antes de salir? [Guardar]']);
  });

  it('saves first and only then quits', async () => {
    const h = harness(['A', 'B'], 'save');
    await h.guard.requestExit();
    expect(h.log.slice(1)).toEqual(['saveAll', 'quit']);
    expect(h.log[0]).toContain('[Guardar todo]');
  });

  it('stays open when a save was cancelled or failed', async () => {
    const h = harness(['A'], 'save', false);
    await h.guard.requestExit();
    expect(h.log.slice(1)).toEqual(['saveAll']);
  });

  it('drops the copies and quits when the person lets the changes go', async () => {
    const h = harness(['A'], 'discard');
    await h.guard.requestExit();
    expect(h.log.slice(1)).toEqual(['discard', 'quit']);
  });

  it('does not stack a second question while the first is open, and can be asked again afterwards', async () => {
    const h = harness(['A'], 'cancel', true, true);
    const first = h.guard.requestExit();
    await h.guard.requestExit();
    await h.guard.requestExit();
    expect(h.log.filter((l) => l.startsWith('ask')).length).toBe(1);
    h.release();
    await first;
    const again = h.guard.requestExit();
    h.release();
    await again;
    expect(h.log.filter((l) => l.startsWith('ask')).length).toBe(2);
  });
});

describe('leaveMessage', () => {
  it('names the document, or counts them', () => {
    expect(leaveMessage(['A'])).toContain('«A» tiene cambios');
    const many = leaveMessage(['1', '2', '3', '4', '5', '6', '7']);
    expect(many).toContain('7 documentos');
    expect(many).toContain('«5»');
    expect(many).toContain('y 2 más');
    expect(many).not.toContain('«6»');
  });
});
