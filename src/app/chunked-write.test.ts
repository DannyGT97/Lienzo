import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, writeInChunks, type ChunkSink } from './chunked-write';

const text = async (b: Blob): Promise<string> => `${b.size}`;

function recorder(failAt = -1) {
  const log: string[] = [];
  let n = 0;
  const sink: ChunkSink = {
    begin: async () => (log.push('begin'), 'tok'),
    chunk: async (token, data) => {
      if (n++ === failAt) throw new Error('se cortó');
      log.push(`chunk ${token} ${data}`);
    },
    commit: async (token) => void log.push(`commit ${token}`),
    abort: async (token) => void log.push(`abort ${token}`),
  };
  return { log, sink };
}

describe('writing a document in pieces', () => {
  it('sends the file in order, in pieces of the chosen size, and then commits', async () => {
    const { log, sink } = recorder();
    await writeInChunks(new Blob([new Uint8Array(25)]), sink, text, { chunkBytes: 10 });
    expect(log).toEqual(['begin', 'chunk tok 10', 'chunk tok 10', 'chunk tok 5', 'commit tok']);
  });

  it('gives the page the turn back after every piece, so it keeps answering while a big file goes out', async () => {
    const { log, sink } = recorder();
    let turns = 0;
    await writeInChunks(new Blob([new Uint8Array(35)]), sink, text, { chunkBytes: 10, pause: async () => void turns++ });
    expect(turns).toBe(4);
    expect(log.at(-1)).toBe('commit tok');
  });

  it('a big document is never one message', async () => {
    const { log, sink } = recorder();
    const pieces: number[] = [];
    await writeInChunks(new Blob([new Uint8Array(CHUNK_BYTES * 3 + 123)]), sink, async (b) => (pieces.push(b.size), 'x'), { pause: async () => undefined });
    expect(pieces).toEqual([CHUNK_BYTES, CHUNK_BYTES, CHUNK_BYTES, 123]);
    expect(Math.max(...pieces)).toBeLessThanOrEqual(1_000_000);
    expect(log.filter((l) => l.startsWith('chunk')).length).toBe(4);
  });

  it('an empty file still begins and commits, so an empty document is written', async () => {
    const { log, sink } = recorder();
    await writeInChunks(new Blob([]), sink, text);
    expect(log).toEqual(['begin', 'commit tok']);
  });

  it('drops what was received and passes the error on when a piece fails, and never commits', async () => {
    const { log, sink } = recorder(1);
    await expect(writeInChunks(new Blob([new Uint8Array(30)]), sink, text, { chunkBytes: 10, pause: async () => undefined })).rejects.toThrow('se cortó');
    expect(log).toEqual(['begin', 'chunk tok 10', 'abort tok']);
  });

  it('reports progress', async () => {
    const { sink } = recorder();
    const seen: string[] = [];
    await writeInChunks(new Blob([new Uint8Array(25)]), sink, text, { chunkBytes: 10, pause: async () => undefined, onProgress: (a, b) => seen.push(`${a}/${b}`) });
    expect(seen).toEqual(['10/25', '20/25', '25/25']);
  });
});
