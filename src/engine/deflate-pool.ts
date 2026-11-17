/**
 * Compression and decompression of tiles on a few Web Workers, so saving or opening a big page never holds the main thread
 * (the window kept drawing and answering). Where a Worker cannot be had (tests, a worker that fails to start or dies) the
 * same work runs on the calling thread, one job at a time as before: slower to the eye, never a failure.
 */
import { runDeflate, type DeflateOp } from './deflate-core';

interface Job {
  id: number;
  op: DeflateOp;
  /** What the caller gave: kept so the job can still run here if its worker is lost. */
  data: Uint8Array;
  resolve(out: Uint8Array): void;
  reject(err: Error): void;
}

interface Slot {
  worker: Worker;
  jobs: Map<number, Job>;
}

/** Jobs a worker holds at once: enough to keep it busy while the next message crosses over. */
const PER_WORKER = 2;

let slots: Slot[] | null = null;
let broken = false;
let nextId = 0;
const waiting: Job[] = [];

function workerCount(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

/** Give up on workers (for good): everything pending runs on this thread. */
function breakDown(): void {
  broken = true;
  const lost: Job[] = [];
  for (const s of slots ?? []) {
    s.worker.terminate();
    lost.push(...s.jobs.values());
    s.jobs.clear();
  }
  slots = null;
  lost.push(...waiting.splice(0));
  for (const job of lost) runHere(job);
}

function runHere(job: Job): void {
  runDeflate(job.op, job.data).then(job.resolve, (err) => job.reject(err instanceof Error ? err : new Error(String(err))));
}

function start(): Slot[] | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (slots) return slots;
  try {
    const made: Slot[] = [];
    for (let i = 0; i < workerCount(); i++) {
      const worker = new Worker(new URL('./deflate.worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, jobs: new Map() };
      worker.onmessage = (e: MessageEvent<{ id: number; data?: Uint8Array; error?: string }>) => {
        const job = slot.jobs.get(e.data.id);
        if (!job) return;
        slot.jobs.delete(e.data.id);
        if (e.data.data) job.resolve(e.data.data);
        else job.reject(new Error(e.data.error ?? 'No se pudo comprimir.'));
        pump();
      };
      // A worker that cannot load its script (or crashes) is not retried: the rest of the session works on this thread.
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
    const job = waiting.shift()!;
    slot.jobs.set(job.id, job);
    // A copy goes over (and is handed to the worker, not cloned again): the caller's bytes stay theirs.
    const copy = job.data.slice();
    slot.worker.postMessage({ id: job.id, op: job.op, data: copy }, [copy.buffer]);
  }
}

function submit(op: DeflateOp, data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const job: Job = { id: nextId++, op, data, resolve, reject };
    if (!start()) return runHere(job);
    waiting.push(job);
    pump();
  });
}

/** Raw deflate of `data` (a view is compressed as it is, not its whole buffer). */
export function deflateRaw(data: Uint8Array | Uint8ClampedArray): Promise<Uint8Array> {
  return submit('deflate', new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

/** Raw inflate of `data`. */
export function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return submit('inflate', data);
}

/** For tests: forget the workers and start over. */
export function resetDeflatePool(): void {
  for (const s of slots ?? []) s.worker.terminate();
  slots = null;
  broken = false;
  waiting.length = 0;
}
