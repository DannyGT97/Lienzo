/**
 * Saving and opening files. In the app (Tauri, on the desktop and on Android) the system's own file dialog is used,
 * so the person chooses where a file goes and which one to open. In a plain browser the File System Access API is
 * used where it exists, and a download otherwise.
 */

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Where a document came from or was saved to, so "Save" can write to the same place again. */
export type FileRef =
  | { kind: 'tauri'; path: string; name: string }
  | { kind: 'browser'; handle: FileSystemFileHandle; name: string }
  /** A file of the app's own library (library.ts): `rel` is its path inside the library folder. */
  | { kind: 'library'; rel: string; name: string };

async function library() {
  const { libraryFs } = await import('./library-fs');
  const fs = libraryFs();
  if (!fs) throw new Error('La biblioteca no está disponible en este navegador.');
  return fs;
}

export const isApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const onAndroid = (): boolean => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/** Where files live: the desktop app (real paths), Android (opaque content addresses) or a plain browser. */
export type FilePlatform = 'desktop' | 'android' | 'browser';
export const filePlatform = (): FilePlatform => (!isApp() ? 'browser' : onAndroid() ? 'android' : 'desktop');

/**
 * Whether the save dialog lets the person pick the file type and tells us the name they ended with. Android's does
 * neither: it has no type list (the filters only narrow the MIME types) and answers with an opaque content address, so
 * the caller has to ask for the type itself before opening it.
 */
export const dialogReportsType = (): boolean => !(isApp() && onAndroid());

/** The file name at the end of a path or a content address (Android). */
export function nameOfPath(path: string): string {
  let tail = path;
  try {
    tail = decodeURIComponent(path);
  } catch {
    // keep the raw text
  }
  const last = tail.split(/[\\/:]/).filter(Boolean).pop() ?? path;
  return last;
}

/**
 * The name the system shows for a file. Plain paths carry it; an Android content address does not (it ends in an
 * opaque id such as "1026"), so the provider is asked for the file's display name.
 */
export async function displayName(path: string): Promise<string> {
  if (/^content:\/\//i.test(path)) {
    try {
      const { basename } = await import('@tauri-apps/api/path');
      const real = await basename(path);
      if (real) return real;
    } catch {
      // the provider did not answer: fall back to what the address itself says
    }
  }
  return nameOfPath(path);
}

/**
 * Writing was refused because this app holds no write permission for the file. Android grants a picked file only what
 * the picker asked for: a file chosen with "Abrir" is readable, never writable, and a file saved earlier loses its
 * write grant when the app is restarted. Nothing was written.
 */
export class WriteDeniedError extends Error {
  constructor(readonly fileName: string, cause: unknown) {
    super(`No hay permiso para escribir en «${fileName}».`, { cause });
    this.name = 'WriteDeniedError';
  }
}

// Also the desktop app's own refusal: a path outside the folders its capability allows and that no dialog chose in this run ("forbidden path").
const isPermissionRefusal = (err: unknown): boolean => /Permission Denial|SecurityException|grantUriPermission|EACCES|permission denied|forbidden path|not allowed on the scope/i.test(err instanceof Error ? err.message : String(err));

const mimeFor = (ext: string): string =>
  ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', tga: 'image/x-tga', tif: 'image/tiff', psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop', ora: 'image/openraster' })[ext] ?? 'application/octet-stream';

function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
};

const pickerTypes = (filters: FileFilter[]): unknown =>
  filters.map((f) => ({ description: f.name, accept: { [mimeFor(f.extensions[0]!)]: f.extensions.map((e) => `.${e}`) } }));

/** Where a save is going: a file the person picked, or (no picker available) a download under the suggested name. */
export type SaveTarget = { ref: FileRef } | { download: string };

/**
 * Ask where to save, without writing anything yet, so the caller can tell from the name the person chose which format
 * to encode. Null when cancelled.
 */
export async function chooseSaveTarget(suggested: string, filters: FileFilter[]): Promise<SaveTarget | null> {
  if (isApp()) {
    let path: string | null;
    if (onAndroid()) {
      // Our own dialog, which keeps the write grant after the app restarts (the stock one does not: the file could be saved
      // again only until the app's process ended). One extension per type keeps a lone type a lone MIME type (jpg/jpeg are one).
      const { invoke } = await import('@tauri-apps/api/core');
      path = (await invoke<string | null>('create_document', { fileName: suggested, extensions: filters.map((f) => f.extensions[0]!) })) ?? null;
    } else {
      const { save } = await import('@tauri-apps/plugin-dialog');
      path = await save({ defaultPath: suggested, filters });
    }
    if (!path) return null;
    // A content address on Android has no readable name in it: the provider is asked, and the name that was asked for
    // is what is left when it does not answer.
    const named = await displayName(path);
    return { ref: { kind: 'tauri', path, name: /\.[a-z0-9]{2,5}$/i.test(named) ? named : suggested } };
  }
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: suggested, types: pickerTypes(filters) });
      return { ref: { kind: 'browser', handle, name: handle.name } };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }
  return { download: suggested };
}

/** Write to a chosen target. Returns where the file went (null when it was only downloaded). */
export async function writeToTarget(target: SaveTarget, blob: Blob): Promise<FileRef | null> {
  if ('download' in target) {
    downloadBlob(blob, target.download);
    return null;
  }
  await saveTo(target.ref, blob);
  return target.ref;
}

/** Ask where to save and write the file there. Returns where it went (null when cancelled, or when it was only downloaded). */
export async function saveAs(blob: Blob, suggested: string, filters: FileFilter[]): Promise<{ ref: FileRef | null; cancelled: boolean }> {
  const target = await chooseSaveTarget(suggested, filters);
  if (!target) return { ref: null, cancelled: true };
  return { ref: await writeToTarget(target, blob), cancelled: false };
}

/** The bytes of `blob` as base64 text. The browser builds it itself, off the main thread. */
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

/**
 * Android's WebView cannot hand a request body to the native side through Tauri's fast channel, so Tauri sends the bytes as
 * JSON text, one number per byte, and the native side reads them back as one JSON value per byte. A 50 MB document is then
 * ~200 MB of text that freezes the page for a long time and can run the tablet out of memory. Here the file travels as one
 * base64 string (a third bigger than the file, not four times) and `write_document` (src-tauri) decodes and writes it.
 */
async function writeOnAndroid(path: string, blob: Blob): Promise<void> {
  const data = await toBase64(blob);
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_document', { path, data });
}

/** Write to a place a document was saved to or opened from before. */
export async function saveTo(ref: FileRef, blob: Blob): Promise<void> {
  if (ref.kind === 'library') {
    await (await library()).write(ref.rel, blob);
    return;
  }
  if (ref.kind === 'tauri') {
    try {
      if (onAndroid()) await writeOnAndroid(ref.path, blob);
      else {
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(ref.path, new Uint8Array(await blob.arrayBuffer()));
      }
    } catch (err) {
      if (isPermissionRefusal(err)) throw new WriteDeniedError(ref.name, err);
      throw err;
    }
    return;
  }
  const out = await ref.handle.createWritable();
  await out.write(blob);
  await out.close();
}

/** Whether there is a real file picker (otherwise the caller uses a plain file input). */
export const hasPicker = (): boolean => isApp() || (typeof window !== 'undefined' && 'showOpenFilePicker' in window);

/**
 * Read a file the app knew before (a recent one). A browser handle may need the person to allow access again; the click
 * that asked for the file is the gesture the browser wants for that. Read and write are asked together, so saving later works.
 */
export async function readKnownFile(ref: FileRef): Promise<Blob> {
  if (ref.kind === 'browser') {
    const h = ref.handle as FileSystemFileHandle & { requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState> };
    if (h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Lienzo no tiene permiso para abrir este archivo.');
  }
  return readFrom(ref);
}

/** Read again the file a document was saved to or opened from. */
export async function readFrom(ref: FileRef): Promise<Blob> {
  if (ref.kind === 'library') return (await library()).read(ref.rel);
  if (ref.kind === 'tauri') {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return new Blob([(await readFile(ref.path)) as BlobPart]);
  }
  return ref.handle.getFile();
}

/**
 * When the file behind `ref` was last changed (milliseconds), or null when that cannot be told: the file is gone, or
 * the browser would have to ask for permission first (which needs a click, so it is never asked here).
 */
export async function modifiedAt(ref: FileRef): Promise<number | null> {
  try {
    if (ref.kind === 'library') {
      const fs = await library();
      const rel = ref.rel;
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      return (await fs.list(dir)).find((e) => e.rel === rel)?.modified || null;
    }
    if (ref.kind === 'tauri') {
      const { stat } = await import('@tauri-apps/plugin-fs');
      return (await stat(ref.path)).mtime?.getTime() ?? null;
    }
    const handle = ref.handle as FileSystemFileHandle & { queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState> };
    if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') return null;
    return (await handle.getFile()).lastModified;
  } catch {
    return null;
  }
}

/**
 * The path or content address of the file the person picks to open (null when cancelled). Android's stock dialog hands
 * out a temporary read-only grant, so a file opened through it could never be saved back in place; there the app's own
 * document picker is used, which keeps read+write access (see DocPickerPlugin.kt).
 */
async function pickPath(filters: FileFilter[]): Promise<string | null> {
  if (onAndroid()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('pick_document', { extensions: filters.flatMap((f) => f.extensions) })) ?? null;
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple: false, directory: false, filters });
  return (Array.isArray(picked) ? picked[0] : picked) ?? null;
}

/** Let the person choose a file to open. Returns null when cancelled. */
export async function openFile(filters: FileFilter[]): Promise<{ ref: FileRef | null; blob: Blob; name: string } | null> {
  if (isApp()) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await pickPath(filters);
    if (!path) return null;
    const bytes = await readFile(path);
    const name = await displayName(path);
    return { ref: { kind: 'tauri', path, name }, blob: new Blob([bytes as BlobPart]), name };
  }
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: pickerTypes(filters), multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      return { ref: { kind: 'browser', handle, name: file.name }, blob: file, name: file.name };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }
  return null; // the caller falls back to its own file input
}

/** A file the person chose, to be read when its turn comes (so a long list can show its progress and be stopped). */
export type PickedFile = () => Promise<{ blob: Blob; name: string }>;

/**
 * Let the person choose several files at once, to copy them somewhere (the library). Nothing is read yet: each answer reads its
 * file when called. Null when cancelled, and also when there is no picker that allows several (the caller then uses a file input).
 */
export async function openFiles(filters: FileFilter[]): Promise<PickedFile[] | null> {
  if (isApp()) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    let paths: string[];
    if (onAndroid()) {
      const { invoke } = await import('@tauri-apps/api/core');
      paths = await invoke<string[]>('pick_documents', { extensions: filters.flatMap((f) => f.extensions) });
    } else {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ multiple: true, directory: false, filters });
      paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    }
    if (!paths.length) return null;
    return paths.map((path): PickedFile => async () => ({ blob: new Blob([(await readFile(path)) as BlobPart]), name: await displayName(path) }));
  }
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({ types: pickerTypes(filters), multiple: true });
      if (!handles.length) return null;
      return handles.map((h): PickedFile => async () => ({ blob: await h.getFile(), name: h.name }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }
  return null;
}
