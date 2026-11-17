/**
 * Where the library's files live. In the app it is a folder the native side owns (`src-tauri/src/library.rs`: Documents\Lienzo on
 * Windows, the app's folder on shared storage on Android); in a plain browser it is the page's private file system (OPFS), so the
 * same home screen works while developing. Both answer to the same small interface, with paths relative to the library folder.
 */
import { baseRel, joinRel, parentRel, type LibEntry } from './library';

/** Where the library is, for the person to find it. */
export interface LibLocation {
  path: string;
  /** Other apps and a computer can see it. */
  visible: boolean;
  /** The system's file explorer can be opened on it. */
  reveal: boolean;
  /** Android: the library is still in the app's private folder; allowing access to all files moves it to Documents/Lienzo. */
  needsAccess?: boolean;
}

export interface LibraryFs {
  readonly backend: 'native' | 'opfs';
  /** Where the folder is, as the person would look for it (for the browser: a note, since there is no real path). */
  where(): Promise<LibLocation>;
  /** Open the system's file explorer on a folder (or the folder holding a file). */
  reveal?(rel: string): Promise<void>;
  /** Android: open the page where the person allows access to all files, so the library can live in Documents/Lienzo. */
  requestAccess?(): Promise<void>;
  list(rel: string): Promise<LibEntry[]>;
  mkdir(rel: string): Promise<void>;
  /** Rename or move a file or folder; fails when the target exists. */
  move(from: string, to: string): Promise<void>;
  /** Copy a file or folder; fails when the target exists. */
  copy(from: string, to: string): Promise<void>;
  remove(rel: string): Promise<void>;
  read(rel: string): Promise<Blob>;
  /** Bytes `start` to `end` of a file, without reading the rest (for the pictures of a folder of big documents). */
  readRange(rel: string, start: number, end: number): Promise<Blob>;
  write(rel: string, data: Blob): Promise<void>;
}

const inApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The bytes of `blob` as base64 text, built by the browser off the main thread (see `writeOnAndroid` in file-io.ts for why not raw bytes). */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo preparar el archivo para guardarlo.'));
    reader.readAsDataURL(blob);
  });
}

const reason = (err: unknown): Error => (err instanceof Error ? err : new Error(typeof err === 'string' ? err : String(err)));

function nativeFs(): LibraryFs {
  const call = async <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw reason(err);
    }
  };
  return {
    backend: 'native',
    where: () => call<LibLocation>('library_info'),
    reveal: (rel) => call('library_reveal', { rel }),
    requestAccess: () => call('library_request_access'),
    async list(rel) {
      const items = await call<{ name: string; dir: boolean; size: number; modified: number }[]>('library_list', { rel });
      return items.map((e) => ({ ...e, rel: joinRel(rel, e.name) }));
    },
    mkdir: (rel) => call('library_mkdir', { rel }),
    move: (from, to) => call('library_move', { from, to }),
    copy: (from, to) => call('library_copy', { from, to }),
    remove: (rel) => call('library_remove', { rel }),
    async read(rel) {
      return new Blob([await call<ArrayBuffer>('library_read', { rel })]);
    },
    async readRange(rel, start, end) {
      return new Blob([await call<ArrayBuffer>('library_read_range', { rel, start, end })]);
    },
    async write(rel, data) {
      await call('library_write', { rel, data: await toBase64(data) });
    },
  };
}

type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]>; removeEntry(name: string, o?: { recursive?: boolean }): Promise<void> };

function opfsFs(): LibraryFs {
  let rootPromise: Promise<Dir> | null = null;
  const root = (): Promise<Dir> => (rootPromise ??= navigator.storage.getDirectory().then((d) => d.getDirectoryHandle('Lienzo', { create: true }) as Promise<Dir>));
  /** The folder at `rel` ("" is the library itself). */
  const dirAt = async (rel: string, create = false): Promise<Dir> => {
    let d = await root();
    for (const part of rel.split('/').filter(Boolean)) d = (await d.getDirectoryHandle(part, { create })) as Dir;
    return d;
  };
  const exists = async (rel: string): Promise<boolean> => {
    const parent = await dirAt(parentRel(rel)).catch(() => null);
    if (!parent) return false;
    const name = baseRel(rel);
    for await (const [n] of parent.entries()) if (n.toLowerCase() === name.toLowerCase()) return true;
    return false;
  };
  const isDir = async (rel: string): Promise<boolean> => {
    try {
      await dirAt(rel);
      return true;
    } catch {
      return false;
    }
  };
  const fileAt = async (rel: string, create = false): Promise<FileSystemFileHandle> => (await dirAt(parentRel(rel), create)).getFileHandle(baseRel(rel), { create });

  const copyTree = async (from: string, to: string): Promise<void> => {
    if (await isDir(from)) {
      await dirAt(to, true);
      for await (const [name] of (await dirAt(from)).entries()) await copyTree(joinRel(from, name), joinRel(to, name));
    } else {
      await api.write(to, await api.read(from));
    }
  };

  const api: LibraryFs = {
    backend: 'opfs',
    async where() {
      return { path: 'Almacenamiento privado del navegador (solo para pruebas)', visible: false, reveal: false };
    },
    async list(rel) {
      const out: LibEntry[] = [];
      for await (const [name, h] of (await dirAt(rel)).entries()) {
        if (h.kind === 'directory') out.push({ name, rel: joinRel(rel, name), dir: true, size: 0, modified: 0 });
        else {
          const f = await (h as FileSystemFileHandle).getFile();
          out.push({ name, rel: joinRel(rel, name), dir: false, size: f.size, modified: f.lastModified });
        }
      }
      return out;
    },
    async mkdir(rel) {
      if (await exists(rel)) throw new Error('ya existe algo con ese nombre');
      await dirAt(rel, true);
    },
    async move(from, to) {
      if (to === from || to.startsWith(`${from}/`)) throw new Error('una carpeta no se puede mover dentro de sí misma');
      if (from.toLowerCase() !== to.toLowerCase() && (await exists(to))) throw new Error('ya existe algo con ese nombre');
      await copyTree(from, to);
      await api.remove(from);
    },
    async copy(from, to) {
      if (await exists(to)) throw new Error('ya existe algo con ese nombre');
      if (to.startsWith(`${from}/`)) throw new Error('una carpeta no se puede copiar dentro de sí misma');
      await copyTree(from, to);
    },
    async remove(rel) {
      await (await dirAt(parentRel(rel))).removeEntry(baseRel(rel), { recursive: true });
    },
    async read(rel) {
      return (await fileAt(rel)).getFile();
    },
    async readRange(rel, start, end) {
      return (await (await fileAt(rel)).getFile()).slice(start, end);
    },
    async write(rel, data) {
      const out = await (await fileAt(rel, true)).createWritable();
      await out.write(data);
      await out.close();
    },
  };
  return api;
}

let cached: LibraryFs | null | undefined;

/** The library's storage, or null when this browser has none (then the home screen offers only recent files). */
export function libraryFs(): LibraryFs | null {
  if (cached !== undefined) return cached;
  if (inApp()) cached = nativeFs();
  else if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') cached = opfsFs();
  else cached = null;
  return cached;
}

/** Every folder of the library, depth first, as paths ("" is the library itself and comes first). */
export async function allFolders(fs: LibraryFs, from = '', depth = 6, arrange?: (parent: string, names: string[]) => string[]): Promise<string[]> {
  const out = [from];
  if (depth <= 0) return out;
  const items = await fs.list(from).catch(() => [] as LibEntry[]);
  const dirs = items.filter((i) => i.dir && !i.name.startsWith('.'));
  const names = arrange ? arrange(from, dirs.map((d) => d.name)) : dirs.map((d) => d.name).sort((a, b) => a.localeCompare(b, 'es'));
  for (const name of names) out.push(...(await allFolders(fs, joinRel(from, name), depth - 1, arrange)));
  return out;
}
