import { describe, expect, it } from 'vitest';
import { createTick } from './cooperate';
import { flattenRegion, flattenRegionAsync } from './composite';
import { createDocument, newLayer } from './document';
import { crc32, crc32Async, writeZip, writeZipAsync } from './zip';

describe('giving the window turns while long work runs', () => {
  it('costs nothing until the budget has passed, then waits for the next task of the event loop', async () => {
    let t = 0;
    const tick = createTick(10, () => t);
    let ran = false;
    setTimeout(() => (ran = true), 0);
    await tick(); // within budget: no wait, so the timer has not run
    expect(ran).toBe(false);
    t = 11;
    await tick(); // over budget: the other tasks get their turn first
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(true);
  });

  it('merges a page in pieces to exactly the pixels of the one-go merge, and yields along the way', async () => {
    const doc = createDocument(700, 530);
    let seed = 7;
    const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let i = 0; i < 3; i++) {
      const layer = newLayer(doc, `c${i}`);
      doc.layers.push(layer);
      const buf = new Uint8ClampedArray(300 * 200 * 4);
      for (let k = 0; k < buf.length; k += 4) {
        const v = next();
        buf[k] = v & 255;
        buf[k + 1] = (v >> 8) & 255;
        buf[k + 2] = (v >> 16) & 255;
        buf[k + 3] = i === 0 ? 255 : 128 + (v >> 24) % 100;
      }
      layer.surface.writeRect({ x: 100 + i * 90, y: 90 + i * 70, w: 300, h: 200 }, buf);
      if (i === 1) layer.blend = 'multiply';
    }
    let turns = 0;
    const region = { x: 13, y: 7, w: 640, h: 500 };
    const piecewise = await flattenRegionAsync(doc, region, { output: true }, async () => void turns++);
    expect(Buffer.from(piecewise).equals(Buffer.from(flattenRegion(doc, region, { output: true })))).toBe(true);
    expect(turns).toBeGreaterThan(4);
    expect((await flattenRegionAsync(doc, { x: 900, y: 0, w: 5, h: 5 }, {}, async () => {})).length).toBe(0);
  });

  it('checks and packs files the same whether or not it gives turns', async () => {
    const big = new Uint8Array(3 * (1 << 20) + 17).map((_, i) => (i * 31) & 255);
    let turns = 0;
    const tick = async (): Promise<void> => void turns++;
    expect(await crc32Async(big, tick)).toBe(crc32(big));
    expect(turns).toBeGreaterThanOrEqual(4);
    const files = [{ name: 'a', data: big }, { name: 'ñ/b', data: new Uint8Array([1, 2, 3]) }];
    expect(Buffer.from(await writeZipAsync(files, tick)).equals(Buffer.from(writeZip(files)))).toBe(true);
  });
});
