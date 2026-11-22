/**
 * The app's settings (every `lienzo.*` key of `localStorage`: preferences, brush adjustments, which palettes are shown,
 * dock sizes…) are mirrored to a file of the app's own (`settings.json`, src-tauri/src/settings.rs).
 *
 * `localStorage` belongs to the WebView: its data can be cleared, the dev server and the installed app each have their own,
 * and the last changes may not have reached the disk when an update closes the app. The file has none of those problems:
 * at start the file's values are put back into `localStorage` (before anything reads it), and every change is written out.
 * In a plain browser there is no file and `localStorage` alone is used, as before.
 */

/** The page's own keys. */
const PREFIX = 'lienzo.';
/** Not settings: the open tabs belong to the autosave copies, which live in the WebView's own database. */
const EXCLUDED = new Set(['lienzo.session.v1']);

export const isSetting = (key: string): boolean => key.startsWith(PREFIX) && !EXCLUDED.has(key);

type ReadableStore = Pick<Storage, 'length' | 'key' | 'getItem'>;
type WritableStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Every setting in the store, as text by key. */
export function collectSettings(store: ReadableStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === null || !isSetting(key)) continue;
    const value = store.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** What a settings file holds. Defensive: anything that is not a plain object of text values by setting key is left out. */
export function parseSettings(text: string | null): Record<string, string> {
  if (!text) return {};
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) if (isSetting(key) && typeof value === 'string') out[key] = value;
    return out;
  } catch {
    return {};
  }
}

/** The file is the record kept on purpose: its values replace the ones in the store; keys only the store has stay. Returns how many changed. */
export function restoreSettings(store: WritableStore, saved: Record<string, string>): number {
  let changed = 0;
  for (const [key, value] of Object.entries(saved)) {
    try {
      if (store.getItem(key) === value) continue;
      store.setItem(key, value);
      changed++;
    } catch {
      // storage refuses writes: the session simply starts without that value
    }
  }
  return changed;
}

export interface SettingsFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

/** Writes soon after a change, not at each one (a slider sends dozens). */
const WRITE_DELAY_MS = 400;
/** A file that does not answer must not keep the app from starting. */
const READ_TIMEOUT_MS = 3000;

let pending: (() => Promise<void>) | null = null;

/** Write any change not yet in the file (before an update closes the app). */
export async function flushSettings(): Promise<void> {
  await pending?.();
}

/**
 * Put the file's settings in `store` and keep the file up to date from then on. `watch` is where changes to `store` come from:
 * it is given a function to call after each one. Never throws: without a working file the settings last as long as the store does.
 */
export async function startSettingsMirror(file: SettingsFile, store: ReadableStore & WritableStore, watch: (changed: () => void) => void): Promise<void> {
  let saved: string | null;
  try {
    let stop: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, fail) => (stop = setTimeout(() => fail(new Error('timeout')), READ_TIMEOUT_MS)));
    try {
      saved = await Promise.race([file.read(), timeout]);
    } finally {
      clearTimeout(stop);
    }
  } catch {
    // Not knowing what the file holds, nothing is written to it: a store that lost its data must never replace a good file.
    return;
  }
  restoreSettings(store, parseSettings(saved));

  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const push = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    chain = chain.then(async () => {
      const text = JSON.stringify(collectSettings(store));
      if (text === last) return;
      try {
        await file.write(text);
        last = text;
      } catch {
        // tried again with the next change
      }
    });
    return chain;
  };
  pending = push;
  watch(() => {
    if (timer === null) timer = setTimeout(() => void push(), WRITE_DELAY_MS);
  });
  // Brought up to date at once: what the store held before the file existed (first start after this feature) goes in now.
  void push();
}

/** Tell `changed` whenever `localStorage` is written to or cleared. A Storage cannot be patched on the instance (that would store a value). */
export function watchLocalStorage(changed: () => void): void {
  const proto = Storage.prototype;
  for (const name of ['setItem', 'removeItem', 'clear'] as const) {
    const original = proto[name] as (...args: unknown[]) => unknown;
    proto[name] = function (this: Storage, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (this === localStorage && (name === 'clear' || typeof args[0] !== 'string' || isSetting(args[0]))) changed();
      return result;
    } as never;
  }
  const flush = (): void => void flushSettings();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

/** At the start of the app (see `settings-boot.ts`): in the desktop and Android app, mirror the settings to their file. */
export async function bootSettings(): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await startSettingsMirror(
      { read: () => invoke<string | null>('settings_read'), write: (data) => invoke<void>('settings_write', { data }) },
      localStorage,
      watchLocalStorage,
    );
  } catch {
    // no file, no mirror: localStorage alone, as in a browser
  }
}
