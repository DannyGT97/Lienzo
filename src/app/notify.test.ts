import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifier, visibleNotices } from './notify';

let base = 4000;
const make = () => createNotifier({ ms: () => base });

beforeEach(() => {
  vi.useFakeTimers();
  base = 4000;
});
afterEach(() => vi.useRealTimers());

describe('plain notices', () => {
  it('fade after the configured time, and success lasts a second longer', () => {
    const n = make();
    n.info('Copiado');
    n.success('Guardado');
    vi.advanceTimersByTime(3999);
    expect(n.notices().map((x) => x.title)).toEqual(['Copiado', 'Guardado']);
    vi.advanceTimersByTime(1);
    expect(n.notices().map((x) => x.title)).toEqual(['Guardado']);
    vi.advanceTimersByTime(1000);
    expect(n.notices()).toHaveLength(0);
  });

  it('reads the duration again each time, so the preference applies at once', () => {
    const n = make();
    base = 2000;
    n.info('Rápido');
    vi.advanceTimersByTime(2000);
    expect(n.notices()).toHaveLength(0);
  });

  it('a repeated short notice stays one and lasts longer', () => {
    const n = make();
    n.info('Capa bloqueada');
    vi.advanceTimersByTime(3000);
    n.info('Capa bloqueada');
    vi.advanceTimersByTime(3000);
    expect(n.notices()).toHaveLength(1);
    expect(n.notices()[0]!.count).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(n.notices()).toHaveLength(0);
  });

  it('holding pauses the countdown and releasing continues with what was left', () => {
    const n = make();
    n.info('A');
    vi.advanceTimersByTime(3000);
    n.hold(true);
    vi.advanceTimersByTime(60_000);
    expect(n.notices()).toHaveLength(1);
    n.hold(false);
    vi.advanceTimersByTime(999);
    expect(n.notices()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(n.notices()).toHaveLength(0);
  });

  it('a notice that arrives while held waits for the release', () => {
    const n = make();
    n.hold(true);
    n.info('A');
    vi.advanceTimersByTime(10_000);
    expect(n.notices()).toHaveLength(1);
    n.hold(false);
    vi.advanceTimersByTime(4000);
    expect(n.notices()).toHaveLength(0);
  });
});

describe('warnings and errors', () => {
  it('stay until closed', () => {
    const n = make();
    const id = n.error('No se pudo guardar');
    vi.advanceTimersByTime(600_000);
    expect(n.notices()).toHaveLength(1);
    n.dismiss(id);
    expect(n.notices()).toHaveLength(0);
  });

  it('group the same one as ×N with the latest detail and one history line', () => {
    const n = make();
    n.warning('Guardado con avisos', { detail: 'uno' });
    n.warning('Guardado con avisos', { detail: 'dos' });
    n.warning('Guardado con avisos', { detail: 'tres' });
    expect(n.notices()).toHaveLength(1);
    expect(n.notices()[0]).toMatchObject({ count: 3, detail: ['tres'] });
    expect(n.history()).toHaveLength(1);
    expect(n.history()[0]!.count).toBe(3);
    expect(n.unread()).toBe(3);
  });

  it('a different level or title is a different notice', () => {
    const n = make();
    n.warning('A');
    n.error('A');
    n.warning('B');
    expect(n.notices()).toHaveLength(3);
  });

  it('an action closes the notice unless it keeps it open', () => {
    const n = make();
    const run = vi.fn();
    const keep = vi.fn();
    const id = n.error('Fallo', { actions: [{ label: 'Reintentar', run }, { label: 'Ver', run: keep, keep: true }] });
    n.activate(id, 1);
    expect(keep).toHaveBeenCalled();
    expect(n.notices()).toHaveLength(1);
    n.activate(id, 0);
    expect(run).toHaveBeenCalled();
    expect(n.notices()).toHaveLength(0);
  });

  it('reports the worst level on screen', () => {
    const n = make();
    expect(n.worst()).toBeNull();
    n.warning('W');
    expect(n.worst()).toBe('warning');
    const e = n.error('E');
    expect(n.worst()).toBe('error');
    n.dismiss(e);
    expect(n.worst()).toBe('warning');
  });
});

describe('history', () => {
  it('keeps the last 30, newest first, and counts unread', () => {
    const n = make();
    for (let i = 0; i < 35; i++) n.warning(`aviso ${i}`);
    expect(n.history()).toHaveLength(30);
    expect(n.history()[0]!.title).toBe('aviso 34');
    expect(n.unread()).toBe(35);
    n.markRead();
    expect(n.unread()).toBe(0);
    n.clearHistory();
    expect(n.history()).toHaveLength(0);
  });
});

describe('visible notices', () => {
  it('shows the newest three and counts the rest', () => {
    const n = make();
    for (const t of ['a', 'b', 'c', 'd', 'e']) n.warning(t);
    const { shown, hidden } = visibleNotices(n.notices());
    expect(shown.map((x) => x.title)).toEqual(['c', 'd', 'e']);
    expect(hidden).toBe(2);
  });
});

describe('busy', () => {
  it('a quick operation never shows the busy notice, only its result', () => {
    const n = make();
    const op = n.busy('Guardando…');
    vi.advanceTimersByTime(399);
    expect(n.notices()).toHaveLength(0);
    op.done('success', 'Guardado');
    expect(n.notices().map((x) => [x.title, x.busy])).toEqual([['Guardado', undefined]]);
  });

  it('a slow one appears after the delay and stays as long as the operation needs', () => {
    const n = make();
    const op = n.busy('Ampliando imagen…');
    vi.advanceTimersByTime(400);
    expect(n.notices()[0]).toMatchObject({ title: 'Ampliando imagen…', busy: { pct: null } });
    vi.advanceTimersByTime(10 * 60_000);
    expect(n.notices()).toHaveLength(1);
    op.progress(0.4, 'Fase 2 de 3');
    expect(n.notices()[0]!.busy).toMatchObject({ pct: 0.4, sub: 'Fase 2 de 3' });
    op.progress(7);
    expect(n.notices()[0]!.busy!.pct).toBe(1);
  });

  it('once shown it stays a minimum time, then the result takes its place and fades normally', () => {
    const n = make();
    n.info('otro');
    const op = n.busy('Abriendo…');
    vi.advanceTimersByTime(400);
    n.info('después');
    op.done('success', 'Abierto');
    expect(n.notices()[1]!.busy).toBeDefined();
    vi.advanceTimersByTime(599);
    expect(n.notices()[1]!.busy).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(n.notices().map((x) => x.title)).toEqual(['otro', 'Abierto', 'después']);
    expect(n.notices().every((x) => !x.busy)).toBe(true);
  });

  it('a result that is a warning or an error stays', () => {
    const n = make();
    const op = n.busy('Guardando…');
    vi.advanceTimersByTime(400);
    op.done('error', 'No se pudo guardar');
    vi.advanceTimersByTime(600);
    vi.advanceTimersByTime(600_000);
    expect(n.notices().map((x) => x.title)).toEqual(['No se pudo guardar']);
  });

  it('done without a result just removes the notice', () => {
    const n = make();
    const op = n.busy('Trabajando…');
    vi.advanceTimersByTime(1000);
    op.done();
    expect(n.notices()).toHaveLength(0);
  });

  it('only a cancelable operation can be cancelled; the signal aborts and the result says nothing changed', () => {
    const n = make();
    const plain = n.busy('Guardando…');
    plain.cancel();
    expect(plain.signal.aborted).toBe(false);

    const onCancel = vi.fn();
    const op = n.busy('Ampliando…', { cancelable: true, onCancel });
    vi.advanceTimersByTime(400);
    op.cancel();
    expect(op.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(n.notices().find((x) => x.busy?.cancelable)!.busy!.cancelling).toBe(true);
    op.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    op.cancelled();
    vi.advanceTimersByTime(600);
    const result = n.notices().find((x) => x.title === 'Cancelado');
    expect(result).toMatchObject({ level: 'info', detail: ['No se cambió nada.'] });
  });

  it('ending twice does nothing the second time', () => {
    const n = make();
    const op = n.busy('X');
    op.done('success', 'Hecho');
    op.done('error', 'Otra cosa');
    expect(n.notices().map((x) => x.title)).toEqual(['Hecho']);
  });
});
