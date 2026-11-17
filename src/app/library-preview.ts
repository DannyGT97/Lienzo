/**
 * The small pictures on the home screen's cards. `createPreviewer` turns any file the editor opens (.lienzo, .clip, .psd,
 * .ora, a plain picture) into a small PNG; `createThumbs` keeps them in IndexedDB (one per file, valid while the file's
 * date and size are the same) and makes them one at a time, so a folder of big pages never freezes the window.
 */
import { thumbnail } from '../engine/composite';
import { importClip, looksLikeClip, readClipPreview } from '../engine/clip-file';
import { SNIFF_BYTES, sniffImage, type RawImage } from '../engine/image-decode';
import { isLienzo, loadLienzo, readLienzoPreview } from '../engine/lienzo-file';
import { importOra, looksLikeOra, readOraPreview, type OraCodecs } from '../engine/ora-file';
import { importPsd, readPsdPreview } from '../engine/psd';
import { encodePng } from '../engine/png-encode';
import type { Document } from '../engine/document';

/** Longest side of a preview, in pixels (cards show it at up to ~200 css pixels, twice that for dense screens). */
export const PREVIEW_SIDE = 360;

/** A file to make a picture of, read in parts: a big document is never read whole when a part is enough. */
export interface Source {
  size: number;
  range(start: number, end: number): Promise<Blob>;
  all(): Promise<Blob>;
}
export const sourceOf = (blob: Blob): Source => ({ size: blob.size, range: async (a, b) => blob.slice(a, b), all: async () => blob });

/** The small PNG kept inside a `.lienzo` file when it is saved (see `saveLienzo`). */
export async function previewPng(doc: Document): Promise<Uint8Array | null> {
  const { w, h } = fit(doc.width, doc.height);
  // Looking at every pixel of a big page is slow on a tablet and not needed for a picture this small: about 16 per cell is plenty.
  const sample = Math.max(1, Math.floor(Math.min(doc.width / w, doc.height / h) / 4));
  const blob = await pngOf(w, h, thumbnail(doc, w, h, { output: true, sample }));
  return new Uint8Array(await blob.arrayBuffer());
}

export interface PreviewDeps {
  decodeImage(file: File): Promise<RawImage>;
  codecs: OraCodecs;
}

const fit = (w: number, h: number): { w: number; h: number } => {
  const s = Math.min(1, PREVIEW_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
};

async function pngOf(w: number, h: number, rgba: Uint8ClampedArray): Promise<Blob> {
  return new Blob([(await encodePng(w, h, rgba)) as BlobPart], { type: 'image/png' });
}

/** A full-size picture reduced to the preview size by the browser's own (smooth) scaler. */
async function shrink(img: RawImage): Promise<Blob> {
  const { w, h } = fit(img.width, img.height);
  if (w === img.width && h === img.height) return pngOf(w, h, img.data);
  const from = document.createElement('canvas');
  from.width = img.width;
  from.height = img.height;
  from.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const to = document.createElement('canvas');
  to.width = w;
  to.height = h;
  const g = to.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(from, 0, 0, w, h);
  return pngOf(w, h, g.getImageData(0, 0, w, h).data);
}

/** A PNG a file carries of itself, brought to the preview size (and used as it is when it already is that small). */
async function fromPng(png: Uint8Array): Promise<Blob | null> {
  if (png.length < 24) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const { w, h } = fit(view.getUint32(16), view.getUint32(20));
  if (view.getUint32(16) <= PREVIEW_SIDE && view.getUint32(20) <= PREVIEW_SIDE) return new Blob([png as BlobPart], { type: 'image/png' });
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }), { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return pngOf(w, h, g.getImageData(0, 0, w, h).data);
}

export function createPreviewer(deps: PreviewDeps): (src: Source, name: string) => Promise<Blob | null> {
  const ofDocument = (doc: Document): Promise<Blob | null> => {
    const { w, h } = fit(doc.width, doc.height);
    return pngOf(w, h, thumbnail(doc, w, h, { output: true }));
  };
  return async (src, name) => {
    // A .lienzo carries its own picture: it is read from the first bytes, and the whole document only when it has none.
    const kept = await readLienzoPreview(src.range);
    if (kept) return new Blob([kept as BlobPart], { type: 'image/png' });
    const blob = await src.all();
    if (await isLienzo(blob)) return ofDocument(await loadLienzo(blob));
    const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
    // Each format keeps a picture of its page: it is used when it is there, and the layers are only read when it is not.
    if (looksLikeClip(head)) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const png = readClipPreview(bytes);
      const quick = png ? await fromPng(png).catch(() => null) : null;
      return quick ?? ofDocument((await importClip(bytes, deps.codecs)).value);
    }
    if (looksLikeOra(head)) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const png = await readOraPreview(bytes);
      const quick = png ? await fromPng(png).catch(() => null) : null;
      return quick ?? ofDocument((await importOra(bytes, deps.codecs)).value);
    }
    if (sniffImage(head, name) === 'psd') {
      const buffer = await blob.arrayBuffer();
      const merged = readPsdPreview(buffer);
      return merged ? shrink(merged) : ofDocument(importPsd(buffer).value);
    }
    return shrink(await deps.decodeImage(new File([blob], name)));
  };
}

// ---- the cache -------------------------------------------------------------------------------------------

const DB = 'lienzo-thumbs';
const STORE = 'thumbs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('sin almacenamiento'));
  });
}

async function dbRun<T>(mode: IDBTransactionMode, use: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = use(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('sin almacenamiento'));
    });
  } finally {
    db.close();
  }
}

interface Stored {
  sig: string;
  blob: Blob | null;
}

export interface Thumbs {
  /**
   * The preview of the file `id` as an object URL, or null when there is none (the file cannot be drawn). `sig` says which
   * version of the file it is (date and size); `read` gets the file, and is only called when no valid preview is stored.
   */
  get(id: string, sig: string, read: () => Source): Promise<string | null>;
  /** The preview if it is already in memory (null: known to have none; undefined: not known yet). Never waits. */
  peek(id: string, sig: string): string | null | undefined;
  /** Forget the previews of a file that was deleted or moved. */
  forget(id: string): void;
}

export function createThumbs(preview: (src: Source, name: string) => Promise<Blob | null>): Thumbs {
  const urls = new Map<string, { sig: string; url: string | null }>();
  const pending = new Map<string, Promise<string | null>>();
  let queue: Promise<unknown> = Promise.resolve();

  const urlOf = (id: string, sig: string, blob: Blob | null): string | null => {
    const old = urls.get(id);
    if (old?.url) URL.revokeObjectURL(old.url);
    const url = blob ? URL.createObjectURL(blob) : null;
    urls.set(id, { sig, url });
    return url;
  };

  return {
    peek(id, sig) {
      const have = urls.get(id);
      return have && have.sig === sig ? have.url : undefined;
    },
    get(id, sig, read) {
      const have = urls.get(id);
      if (have && have.sig === sig) return Promise.resolve(have.url);
      const key = `${id}|${sig}`;
      const running = pending.get(key);
      if (running) return running;
      const job = (queue = queue.then(async () => {
        try {
          const stored = await dbRun<Stored | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
          if (stored && stored.sig === sig) return urlOf(id, sig, stored.blob);
          let blob: Blob | null = null;
          try {
            blob = await preview(read(), id.slice(id.lastIndexOf('/') + 1));
          } catch {
            blob = null; // a file that cannot be drawn is remembered as such, so it is not tried again every time
          }
          await dbRun('readwrite', (s) => s.put({ sig, blob } satisfies Stored, id)).catch(() => undefined);
          return urlOf(id, sig, blob);
        } finally {
          pending.delete(key);
        }
      }));
      pending.set(key, job as Promise<string | null>);
      return job as Promise<string | null>;
    },
    forget(id) {
      const old = urls.get(id);
      if (old?.url) URL.revokeObjectURL(old.url);
      urls.delete(id);
      void dbRun('readwrite', (s) => s.delete(id)).catch(() => undefined);
    },
  };
}
