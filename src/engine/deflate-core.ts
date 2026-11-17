/**
 * Raw deflate through the platform's streams. Chromium runs a `CompressionStream` on the thread that asked for it, so a few
 * hundred tiles in a row froze the window for seconds: `deflate-pool` hands this to Web Workers, and calls it directly only
 * where there are none (tests, a worker that could not start).
 */
export type DeflateOp = 'deflate' | 'inflate';

export async function runDeflate(op: DeflateOp, data: Uint8Array): Promise<Uint8Array> {
  const stream = op === 'deflate' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource).catch(() => undefined);
  void writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
