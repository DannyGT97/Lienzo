/**
 * The files opened or saved lately, for File ▸ Open recent. Each one is kept as the reference the app uses to read it
 * again (a path, an Android content address, or a browser file handle), so the list lives in IndexedDB, which can store
 * file handles; localStorage could not. Reading is defensive: anything that is not a well-formed list is an empty one.
 */
import type { FileRef } from './file-io';

export interface RecentFile {
  ref: FileRef;
  name: string;
}

export const MAX_RECENT = 10;

/** Whether two references are the same file. Browser handles can only be compared by the browser itself. */
export type SameFile = (a: FileRef, b: FileRef) => Promise<boolean>;

export const sameFile: SameFile = async (a, b) => {
  if (a.kind === 'tauri' && b.kind === 'tauri') return a.path === b.path;
  if (a.kind === 'browser' && b.kind === 'browser') {
    try {
      return await a.handle.isSameEntry(b.handle);
    } catch {
      return false;
    }
  }
  return false;
};

/** `ref` goes first and the same file is not listed twice; only the newest `max` stay. */
export async function mergeRecent(list: readonly RecentFile[], ref: FileRef, same: SameFile, max = MAX_RECENT): Promise<RecentFile[]> {
  const kept: RecentFile[] = [];
  for (const item of list) if (!(await same(item.ref, ref))) kept.push(item);
  return [{ ref, name: ref.name }, ...kept].slice(0, max);
}

/** The list without `ref`. */
export async function withoutRecent(list: readonly RecentFile[], ref: FileRef, same: SameFile): Promise<RecentFile[]> {
  const kept: RecentFile[] = [];
  for (const item of list) if (!(await same(item.ref, ref))) kept.push(item);
  return kept;
}

/** Keep only entries that look like a reference the app can read back. */
export function parseRecent(raw: unknown, max = MAX_RECENT): RecentFile[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentFile[] = [];
  for (const item of raw) {
    const ref = (item as { ref?: unknown } | null)?.ref as Partial<FileRef> | undefined;
    if (!ref || typeof ref.name !== 'string' || !ref.name) continue;
    if (ref.kind === 'tauri' && typeof (ref as { path?: unknown }).path === 'string') out.push({ ref: ref as FileRef, name: ref.name });
    else if (ref.kind === 'browser' && (ref as { handle?: unknown }).handle && typeof (ref as { handle: { getFile?: unknown } }).handle.getFile === 'function') out.push({ ref: ref as FileRef, name: ref.name });
  }
  return out.slice(0, max);
}

const DB_NAME = 'lienzo-recent';
const STORE = 'files';
const KEY = 'list';

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

/** The stored list, or an empty one when there is none or storage cannot be used. */
export async function loadRecent(): Promise<RecentFile[]> {
  try {
    return parseRecent(await run('readonly', (s) => s.get(KEY)));
  } catch {
    return [];
  }
}

/** False when storage refuses: the list then lasts only for this session. */
export async function storeRecent(list: readonly RecentFile[]): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(list.map((r) => ({ ref: r.ref, name: r.name })), KEY));
    return true;
  } catch {
    return false;
  }
}
