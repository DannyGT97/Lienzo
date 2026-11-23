/**
 * The pieces of a filter (see `filter-core`) run on a few Web Workers at once, so a filter on a big layer uses the cores of the
 * device and never holds the window. Where a Worker cannot be had (tests, a worker that fails to start or dies) the piece runs
 * on this thread instead: slower to the eye, never a failure.
 */
import { runAreaJob, runPixelJob, type AreaJob, type PixelJob } from './filter-core';

export interface FilterRunner {
  /** How many pieces it is worth having in flight at once. */
  readonly concurrency: number;
  pixel(job: PixelJob): Promise<Uint8ClampedArray>;
  area(job: AreaJob): Promise<Float32Array>;
}

/** On this thread, one piece when asked (the caller gives the window a turn between pieces). */
export const inlineRunner: FilterRunner = {
  concurrency: 1,
  pixel: async (job) => runPixelJob(job),
  area: async (job) => runAreaJob(job),
};

type Request = { id: number; kind: 'pixel'; job: PixelJob } | { id: number; kind: 'area'; job: AreaJob };

interface Pending {
  req: Request;
  resolve(out: Uint8ClampedArray | Float32Array): void;
  reject(err: Error): void;
}

interface Slot {
  worker: Worker;
  jobs: Map<number, Pending>;
}

const PER_WORKER = 2;
let slots: Slot[] | null = null;
let broken = false;
let nextId = 0;
const waiting: Pending[] = [];

const workerCount = (): number => {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(3, cores - 1));
};

function runHere(p: Pending): void {
  try {
    p.resolve(p.req.kind === 'pixel' ? runPixelJob(p.req.job) : runAreaJob(p.req.job));
  } catch (err) {
    p.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

function breakDown(): void {
  broken = true;
  const lost: Pending[] = [];
  for (const s of slots ?? []) {
    s.worker.terminate();
    lost.push(...s.jobs.values());
    s.jobs.clear();
  }
  slots = null;
  lost.push(...waiting.splice(0));
  for (const p of lost) runHere(p);
}

function start(): Slot[] | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (slots) return slots;
  try {
    const made: Slot[] = [];
    for (let i = 0; i < workerCount(); i++) {
      const worker = new Worker(new URL('./filter.worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, jobs: new Map() };
      worker.onmessage = (e: MessageEvent<{ id: number; out?: Uint8ClampedArray | Float32Array; error?: string }>) => {
        const p = slot.jobs.get(e.data.id);
        if (!p) return;
        slot.jobs.delete(e.data.id);
        if (e.data.out) p.resolve(e.data.out);
        else p.reject(new Error(e.data.error ?? 'No se pudo aplicar el filtro.'));
        pump();
      };
      worker.onerror = () => breakDown();
      made.push(slot);
    }
    slots = made;
    return slots;
  } catch {
    broken = true;
    return null;
  }
}

function pump(): void {
  while (waiting.length && slots) {
    const slot = slots.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a));
    if (slot.jobs.size >= PER_WORKER) return;
    const p = waiting.shift()!;
    slot.jobs.set(p.req.id, p);
    // The buffers go over to the worker (not copied); the caller keeps nothing of them.
    const transfer: Transferable[] = p.req.kind === 'pixel' ? [p.req.job.tile.buffer] : [p.req.job.buf.buffer];
    if (p.req.kind === 'pixel' && p.req.job.cov !== 255) transfer.push(p.req.job.cov.buffer);
    slot.worker.postMessage(p.req, transfer);
  }
}

function submit<T extends Uint8ClampedArray | Float32Array>(req: Request): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const p: Pending = { req, resolve: resolve as Pending['resolve'], reject };
    if (!start()) return runHere(p);
    waiting.push(p);
    pump();
  });
}

/** The workers of the device (or this thread when there are none). */
export const poolRunner: FilterRunner = {
  get concurrency() {
    const s = start();
    return s ? s.length * PER_WORKER : 1;
  },
  pixel: (job) => submit<Uint8ClampedArray>({ id: nextId++, kind: 'pixel', job }),
  area: (job) => submit<Float32Array>({ id: nextId++, kind: 'area', job }),
};

/** For tests: forget the workers and start over. */
export function resetFilterPool(): void {
  for (const s of slots ?? []) s.worker.terminate();
  slots = null;
  broken = false;
  waiting.length = 0;
}
