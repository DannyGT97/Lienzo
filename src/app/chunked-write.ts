/**
 * Sending a document to the native side in pieces.
 *
 * Android's WebView cannot hand a request body to the native side, so every byte goes inside a JSON text. A whole document as one
 * string (a third bigger than the file) is built, copied and serialised on the page's own thread, and on a tablet that stopped the
 * whole window for seconds while saving: it did not answer touches or redraw. Sent in pieces of about a megabyte, each piece costs a
 * few milliseconds and the page gets the turn back between them, so the window keeps answering all through the save.
 */

/** A piece's size in file bytes (its base64 text is a third bigger). Small enough to be a few milliseconds of work on a tablet. */
export const CHUNK_BYTES = 1_000_000;

export interface ChunkSink {
  /** Start receiving. What it returns names the transfer in the calls that follow (or nothing, when the path is enough). */
  begin(): Promise<string | undefined>;
  /** The next piece, as base64 text. */
  chunk(token: string | undefined, base64: string): Promise<void>;
  /** All the pieces were sent: the file is written from them. */
  commit(token: string | undefined): Promise<void>;
  /** The transfer failed on the way: what was received is dropped. */
  abort(token: string | undefined): Promise<void>;
}

export interface ChunkOptions {
  chunkBytes?: number;
  /** Give the page the turn back between pieces (default: a timer, which lets the browser handle touches and draw). */
  pause?: () => Promise<void>;
  /** After each piece: how many bytes were sent of how many. */
  onProgress?: (sent: number, total: number) => void;
}

const pauseForThePage = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Send `blob` to `sink` piece by piece and commit it. If anything fails the transfer is aborted and the error is passed on. */
export async function writeInChunks(blob: Blob, sink: ChunkSink, toBase64: (piece: Blob) => Promise<string>, opts: ChunkOptions = {}): Promise<void> {
  const size = Math.max(1, opts.chunkBytes ?? CHUNK_BYTES);
  const pause = opts.pause ?? pauseForThePage;
  const token = await sink.begin();
  try {
    for (let at = 0; at < blob.size; at += size) {
      await sink.chunk(token, await toBase64(blob.slice(at, at + size)));
      opts.onProgress?.(Math.min(blob.size, at + size), blob.size);
      await pause();
    }
    await sink.commit(token);
  } catch (err) {
    await sink.abort(token).catch(() => undefined);
    throw err;
  }
}
