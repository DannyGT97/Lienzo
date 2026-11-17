import { describe, expect, it, vi } from 'vitest';
import { checkForUpdates, type UpdateOffer, type UpdatesDeps } from './updates';
import { noteLines, viewOf, type UpdatesChoice, type UpdatesScreen } from './updates-window';

function setup(answers: UpdatesChoice[] = ['primary', 'primary'], over: Partial<UpdatesDeps> = {}) {
  const log: string[] = [];
  let closed = 0;
  const deps: UpdatesDeps = {
    available: () => true,
    version: async () => '0.1.0',
    find: vi.fn(async () => null),
    window: () => ({
      show: async (s: UpdatesScreen) => {
        log.push(s.kind);
        return s.kind === 'checking' || s.kind === 'installing' ? 'close' : (answers.shift() ?? 'close');
      },
      close: () => void closed++,
    }),
    beforeInstall: vi.fn(async () => void log.push('saved')),
    ...over,
  };
  return { deps, log, closed: () => closed };
}

const offer = (install: UpdateOffer['install']): UpdateOffer => ({ version: '0.2.0', notes: 'Novedades', install });

describe('checkForUpdates', () => {
  it('does nothing in a browser, where there is no installed app to update', async () => {
    const { deps, log } = setup([], { available: () => false });
    await checkForUpdates(deps);
    expect(deps.find).not.toHaveBeenCalled();
    expect(log).toEqual(['unavailable']);
  });

  it('never touches the network until the person agrees', async () => {
    const { deps, closed } = setup(['secondary']);
    await checkForUpdates(deps);
    expect(deps.find).not.toHaveBeenCalled();
    expect(closed()).toBe(1);
  });

  it('says so when there is nothing newer', async () => {
    const { deps, log } = setup();
    await checkForUpdates(deps);
    expect(log).toEqual(['intro', 'checking', 'uptodate']);
  });

  it('keeps working when there is no connection, and says so', async () => {
    const { deps, log, closed } = setup(['primary', 'primary'], { find: vi.fn(async () => Promise.reject(new Error('sin red'))) });
    await checkForUpdates(deps);
    expect(log.at(-1)).toBe('error');
    expect(closed()).toBe(1);
  });

  it('installs only after a second yes, saving the work first', async () => {
    const install = vi.fn(async () => 'installer' as const);
    const { deps } = setup(['primary', 'secondary'], { find: async () => offer(install) });
    await checkForUpdates(deps);
    expect(install).not.toHaveBeenCalled(); // declined the offer
    const again = setup(['primary', 'primary', 'primary'], { find: async () => offer(install) });
    await checkForUpdates(again.deps);
    expect(again.deps.beforeInstall).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(again.log.at(-1)).toBe('handoff');
  });

  it('tells the person what Android needs when it has no permission to install yet', async () => {
    const { deps, log } = setup(['primary', 'primary', 'primary'], { find: async () => offer(async () => 'permission') });
    await checkForUpdates(deps);
    expect(log.at(-1)).toBe('permission');
  });

  it('leaves the current version alone when the installation fails', async () => {
    const { deps, log } = setup(['primary', 'primary', 'primary'], { find: async () => offer(async () => Promise.reject(new Error('la firma no es correcta'))) });
    await checkForUpdates(deps);
    expect(log.at(-1)).toBe('error');
  });
});

describe('updates window content', () => {
  it('shows both versions and the notes when there is something new', () => {
    const v = viewOf({ kind: 'available', current: '0.1.0', version: '0.2.0', notes: '- Pinceles nuevos\n- **Más rápido**' });
    expect(v.version).toEqual({ from: '0.1.0', to: '0.2.0' });
    expect(v.notes).toEqual(['Pinceles nuevos', 'Más rápido']);
  });

  it('has no buttons while it works', () => {
    expect(viewOf({ kind: 'checking' }).primary).toBeUndefined();
    expect(viewOf({ kind: 'installing', version: '0.2.0' }).busy).toBe(true);
  });

  it('cleans heading and list marks from the notes', () => {
    expect(noteLines('## Novedades\n\n* Uno\n1. Dos', 5)).toEqual(['Novedades', 'Uno', 'Dos']);
    expect(noteLines('a\nb\nc', 2)).toEqual(['a', 'b']);
  });
});
