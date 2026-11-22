import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAutosave } from './autosave';

/** A tiny stand-in for IndexedDB where every write takes `delay` ms to land, and for the page's events. */
function fakePage(delay: number) {
  const stored = new Map<string, unknown>();
  const puts: { key: string; at: number }[] = [];
  const handlers = new Map<string, (() => void)[]>();
  const on = (type: string, fn: () => void): void => void handlers.set(type, [...(handlers.get(type) ?? []), fn]);
  const store = (tx: { oncomplete?: () => void }) => ({
    put(value: unknown, key: string) {
      const req = { result: undefined as unknown };
      setTimeout(() => {
        stored.set(key, value);
        puts.push({ key, at: Date.now() });
        tx.oncomplete?.();
      }, delay);
      return req;
    },
    delete(key: string) {
      const req = { result: undefined as unknown };
      setTimeout(() => {
        stored.delete(key);
        tx.oncomplete?.();
      }, delay);
      return req;
    },
  });
  const db = {
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction() {
      const tx: { oncomplete?: () => void; objectStore?: () => unknown } = {};
      tx.objectStore = () => store(tx);
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', {
    open() {
      const req: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = {};
      queueMicrotask(() => {
        req.result = db;
        req.onsuccess?.();
      });
      return req;
    },
  });
  vi.stubGlobal('document', { addEventListener: on, visibilityState: 'visible' });
  vi.stubGlobal('window', { addEventListener: on });
  return { stored, puts, fire: (type: string) => handlers.get(type)?.forEach((fn) => fn()) };
}

describe('autosave when the app goes to the background', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('writes what changed while an earlier copy was still being stored (the last chance before Android may end the app)', async () => {
    const page = fakePage(1000);
    let version = 1;
    const autosave = startAutosave({
      save: async () => new Blob([`v${version}`]),
      stamp: () => `v${version}`,
      busy: () => false,
      keep: () => true,
      dirty: () => true,
      key: () => 'doc-a',
      describe: () => ({ name: 'A', file: null }),
      onError: () => undefined,
      everyMs: () => 1000,
    });
    version = 2;
    // The periodic copy of version 2 starts and takes a second to store...
    await vi.advanceTimersByTimeAsync(5000);
    expect(page.puts.length).toBe(0);
    // ...the person keeps drawing, and the app is sent to the background before it lands.
    version = 3;
    page.fire('pagehide');
    // (less than the next periodic round, which would hide the problem: the app may not live that long)
    await vi.advanceTimersByTimeAsync(3000);
    const last = page.stored.get('doc-a') as { blob: Blob };
    expect(await last.blob.text()).toBe('v3');
    void autosave;
  });
});
