/**
 * `writePsd` (ag-psd) compresses every channel of every layer in one synchronous call: on a tablet a page of a few dozen layers
 * kept the window still for seconds. It runs on a Web Worker; the pixel buffers are handed over (not copied). Where a Worker
 * cannot be had (tests, a worker that fails to start) it runs here as before.
 */
import { writePsd, type Psd, type WriteOptions } from 'ag-psd';

/** Every pixel buffer a PSD description holds, each once (a buffer in the list twice would make the transfer fail). */
export function pixelBuffers(psd: Psd): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>();
  const add = (image?: { data: Uint8ClampedArray | Uint8Array | number[] } | null): void => {
    const data = image?.data;
    if (data && !Array.isArray(data) && data.buffer instanceof ArrayBuffer) found.add(data.buffer);
  };
  const walk = (layers: Psd['children']): void => {
    for (const l of layers ?? []) {
      add(l.imageData as never);
      add(l.mask?.imageData as never);
      walk(l.children);
    }
  };
  add(psd.imageData as never);
  walk(psd.children);
  return [...found];
}

let worker: Worker | null = null;
let broken = false;

function start(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' });
    return worker;
  } catch {
    broken = true;
    return null;
  }
}

/** The bytes of `psd`. The pixel buffers of `psd` are given away: the caller must not use them afterwards. */
export function writePsdOffThread(psd: Psd, options: WriteOptions): Promise<ArrayBuffer> {
  const w = start();
  if (!w) return Promise.resolve(writePsd(psd, options).slice(0));
  return new Promise((resolve, reject) => {
    const give = (): void => {
      w.onmessage = null;
      w.onerror = null;
    };
    w.onmessage = (e: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => {
      give();
      if (e.data.bytes) resolve(e.data.bytes);
      else reject(new Error(e.data.error ?? 'No se pudo crear el PSD.'));
    };
    // A worker that cannot load or dies is not tried again; this save is made here instead.
    w.onerror = () => {
      give();
      broken = true;
      worker?.terminate();
      worker = null;
      try {
        resolve(writePsd(psd, options).slice(0));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    try {
      w.postMessage({ psd, options }, pixelBuffers(psd));
    } catch (err) {
      give();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
