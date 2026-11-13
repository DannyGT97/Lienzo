import { describe, expect, it, vi } from 'vitest';
import { checkForUpdates, type UpdateOffer, type UpdatesDeps } from './updates';

function setup(over: Partial<UpdatesDeps> = {}) {
  const log: string[] = [];
  const deps: UpdatesDeps = {
    available: () => true,
    version: async () => '0.1.0',
    find: vi.fn(async () => null),
    confirm: vi.fn(async (m: string) => {
      log.push(`confirm:${m.slice(0, 24)}`);
      return true;
    }),
    alert: vi.fn(async (m: string) => void log.push(`alert:${m.slice(0, 30)}`)),
    busy: (t: string) => {
      log.push(`busy:${t}`);
      return { done: () => void log.push('done') };
    },
    say: (t: string) => void log.push(`say:${t}`),
    beforeInstall: vi.fn(async () => void log.push('saved')),
    ...over,
  };
  return { deps, log };
}

const offer = (install: UpdateOffer['install']): UpdateOffer => ({ version: '0.2.0', notes: 'Novedades', install });

describe('checkForUpdates', () => {
  it('does nothing in a browser, where there is no installed app to update', async () => {
    const { deps } = setup({ available: () => false });
    await checkForUpdates(deps);
    expect(deps.find).not.toHaveBeenCalled();
    expect(deps.alert).toHaveBeenCalledOnce();
  });

  it('never touches the network until the person agrees', async () => {
    const { deps } = setup({ confirm: vi.fn(async () => false) });
    await checkForUpdates(deps);
    expect(deps.find).not.toHaveBeenCalled();
  });

  it('says so when there is nothing newer', async () => {
    const { deps, log } = setup();
    await checkForUpdates(deps);
    expect(log.some((l) => l.startsWith('say:Lienzo 0.1.0 está al día'))).toBe(true);
  });

  it('keeps working when there is no connection, and says so', async () => {
    const { deps, log } = setup({ find: vi.fn(async () => Promise.reject(new Error('sin red'))) });
    await checkForUpdates(deps);
    expect(log.at(-1)).toMatch(/^alert:No se pudo comprobar/);
    expect(log).toContain('done'); // the busy notice is closed
  });

  it('installs only after a second yes, saving the work first', async () => {
    const install = vi.fn(async () => 'installer' as const);
    const answers = [true, false];
    const { deps } = setup({ find: async () => offer(install), confirm: vi.fn(async () => answers.shift() ?? false) });
    await checkForUpdates(deps);
    expect(install).not.toHaveBeenCalled(); // declined the offer
    answers.push(true, true);
    await checkForUpdates(deps);
    expect(deps.beforeInstall).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
  });

  it('tells the person what Android needs when it has no permission to install yet', async () => {
    const { deps, log } = setup({ find: async () => offer(async () => 'permission') });
    await checkForUpdates(deps);
    expect(log.at(-1)).toMatch(/^alert:Android necesita tu permiso/);
  });

  it('leaves the current version alone when the installation fails', async () => {
    const { deps, log } = setup({ find: async () => offer(async () => Promise.reject(new Error('la firma no es correcta'))) });
    await checkForUpdates(deps);
    expect(log.at(-1)).toMatch(/^alert:No se pudo instalar/);
  });
});
