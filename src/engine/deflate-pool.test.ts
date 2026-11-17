import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDeflate } from './deflate-core';
import { deflateRaw, inflateRaw, resetDeflatePool } from './deflate-pool';

const sample = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7) & 31);

/** A Worker that answers on the next tick, like the real one, using the same core. */
class FakeWorker {
  static made = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWorker.made++;
  }
  postMessage(job: { id: number; op: 'deflate' | 'inflate'; data: Uint8Array }): void {
    void runDeflate(job.op, job.data).then((data) => this.onmessage?.({ data: { id: job.id, data } }));
  }
  terminate(): void {}
}

afterEach(() => {
  resetDeflatePool();
  vi.unstubAllGlobals();
});

describe('deflate-pool', () => {
  it('works on the calling thread when there is no Worker', async () => {
    const data = sample(5000);
    const packed = await deflateRaw(data);
    expect(packed.length).toBeLessThan(data.length);
    expect([...(await inflateRaw(packed))]).toEqual([...data]);
  });

  it('compresses only the bytes of a view, not its whole buffer', async () => {
    const whole = sample(1000);
    const view = new Uint8ClampedArray(whole.buffer, 100, 400);
    const back = await inflateRaw(await deflateRaw(view));
    expect([...back]).toEqual([...whole.subarray(100, 500)]);
  });

  it('round-trips through workers and keeps the caller\'s bytes', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const data = sample(4000);
    const before = [...data];
    const packed = await Promise.all(Array.from({ length: 12 }, () => deflateRaw(data)));
    expect(FakeWorker.made).toBeGreaterThan(0);
    for (const p of packed) expect([...(await inflateRaw(p))]).toEqual(before);
    expect([...data]).toEqual(before);
  });

  it('finishes pending jobs on this thread when a worker dies', async () => {
    class Dying extends FakeWorker {
      postMessage(): void {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Worker', Dying);
    const data = sample(3000);
    const packed = await Promise.all([deflateRaw(data), deflateRaw(data), deflateRaw(data)]);
    for (const p of packed) expect([...(await inflateRaw(p))]).toEqual([...data]);
  });
});
