/**
 * Autosave: a copy of each open document, kept inside the app's own browser storage (IndexedDB), refreshed shortly
 * after it changes and whenever the app goes to the background. Nothing outside the app's private storage is touched.
 *
 * Own design: every open document has its own entry, the entry says
 * which file the document belongs to and whether it holds changes that are in no file (`unsaved`). The copies of
 * saved documents are what lets the next start open the same tabs without reading their files again (an Android
 * content address may not be readable after a restart); only copies with unsaved changes are ever offered as
 * "recover". An entry is deleted when its tab is closed.
 */
import type { FileRef } from './file-io';

const DB_NAME = 'lienzo-autosave';
const STORE = 'docs';
/** More entries than this are the oldest ones to go when the app starts. */
export const MAX_ENTRIES = 5;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir el almacenamiento.'));
  });
}

async function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = use(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo usar el almacenamiento.'));
      tx.onabort = () => reject(tx.error ?? new Error('No se pudo usar el almacenamiento.'));
    });
  } finally {
    db.close();
  }
}

export interface AutosaveEntry {
  blob: Blob;
  savedAt: number;
  /** The document's name when it was copied (absent in entries written by older versions). */
  name?: string;
  /** The file the document belongs to, or null/absent when it was never saved to one. */
  file?: FileRef | null;
  /**
   * Whether the copy holds changes that are in no file. A copy of a saved document is kept too, so that the next
   * start can open the same tabs again (see `session-state.ts`); only the ones with changes are ever offered as
   * "recover". Absent in entries written by older versions, which all had changes.
   */
  unsaved?: boolean;
}

export interface StoredAutosave {
  key: string;
  entry: AutosaveEntry;
}

/** A new, unique name for a document's entry. */
export const newAutosaveKey = (): string => `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const writeAutosave = (key: string, entry: AutosaveEntry): Promise<unknown> => run('readwrite', (s) => s.put(entry, key));
export const removeAutosave = (key: string): Promise<unknown> => run('readwrite', (s) => s.delete(key));

/**
 * Every stored entry, newest first. Older versions kept one entry under the key "current"; it is listed like the
 * others (without a name or file). Anything that is not a well-formed entry is skipped and left alone.
 */
export async function listAutosaves(): Promise<StoredAutosave[]> {
  const db = await open();
  try {
    return await new Promise<StoredAutosave[]>((resolve, reject) => {
      const found: StoredAutosave[] = [];
      const tx = db.transaction(STORE, 'readonly');
      const cursor = tx.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        const v = c.value as Partial<AutosaveEntry> | undefined;
        if (typeof c.key === 'string' && v && v.blob instanceof Blob && typeof v.savedAt === 'number') found.push({ key: c.key, entry: v as AutosaveEntry });
        c.continue();
      };
      tx.oncomplete = () => resolve(found.sort((a, b) => b.entry.savedAt - a.entry.savedAt));
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo usar el almacenamiento.'));
      tx.onabort = () => reject(tx.error ?? new Error('No se pudo usar el almacenamiento.'));
    });
  } finally {
    db.close();
  }
}

/**
 * Keep the `MAX_ENTRIES` newest of `all` (given newest first) and every one in `open` (the documents that are open
 * as tabs, whatever their number); the rest are deleted. Returns what was kept, newest first.
 */
export async function trimAutosaves(all: StoredAutosave[], open: ReadonlySet<string> = new Set()): Promise<StoredAutosave[]> {
  const kept: StoredAutosave[] = [];
  let others = 0;
  for (const s of all) {
    if (open.has(s.key) || others++ < MAX_ENTRIES) kept.push(s);
    else await removeAutosave(s.key).catch(() => undefined);
  }
  return kept;
}

/**
 * Keep an autosave up to date. `stamp` says what state the document is in (any change gives a different text);
 * nothing is written while it equals the stamp of the last write, nor while `busy` says a stroke is under way.
 * A document that is not worth a copy (`keep` says no: none is open, or it is a blank one nobody touched) has no
 * entry: the entry is deleted instead.
 */
export function startAutosave(d: {
  save: () => Promise<Blob>;
  stamp: () => string;
  busy: () => boolean;
  /** Whether the document is worth a copy at all. */
  keep: () => boolean;
  /** Whether the document has changes that are not in a file. */
  dirty: () => boolean;
  /** The entry the open document writes to. */
  key: () => string;
  /** The document's name and file, stored with the copy. */
  describe: () => { name: string; file: FileRef | null };
  /** Called with an error message when saving failed (once per failure streak). */
  onError: (message: string) => void;
  /** Milliseconds between copies while the document is being worked on, or null for none (read each time, so a preference takes effect at once). A copy is always written when the app goes to the background. */
  everyMs: () => number | null;
}): { flush: () => Promise<void> } {
  // What was last written, per entry: with several documents open, going back to one that has not changed
  // must not write it again.
  const written = new Map<string, string>([[d.key(), d.stamp()]]); // the state at the start is not worth saving
  let inflight: Promise<void> | null = null;
  let failing = false;
  async function write(key: string, now: string): Promise<void> {
    try {
      if (d.keep()) {
        const meta = d.describe();
        await writeAutosave(key, { blob: await d.save(), savedAt: Date.now(), unsaved: d.dirty(), ...meta });
        // The document may have been closed while the copy was being written. (If it was saved meanwhile, its stamp
        // changed with it, so the next round writes the copy again as saved.)
        if (!d.keep()) await removeAutosave(key);
      } else {
        await removeAutosave(key);
      }
      written.set(key, now);
      failing = false;
    } catch (err) {
      if (!failing) d.onError(err instanceof Error ? err.message : String(err));
      failing = true;
    }
  }
  /**
   * Write the open document if it changed since its last write. A write in progress is waited for first: the caller
   * that is about to swap the open document (switching tabs) can then do it knowing no copy is half made.
   */
  async function flush(): Promise<void> {
    while (inflight) await inflight;
    if (d.busy()) return;
    const key = d.key();
    const now = d.stamp();
    if (written.get(key) === now) return;
    inflight = write(key, now).finally(() => {
      inflight = null;
    });
    await inflight;
  }
  const tick = (): void => {
    if (!inflight) void flush();
  };
  // Looked at every few seconds so that the interval can change while the app runs; a copy is made when it has passed since the last.
  let lastAt = Date.now();
  setInterval(() => {
    const every = d.everyMs();
    if (every === null || Date.now() - lastAt < every) return;
    lastAt = Date.now();
    tick();
  }, 5000);
  const now = (): void => {
    lastAt = Date.now();
    tick();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') now();
  });
  window.addEventListener('pagehide', now);
  return { flush };
}
