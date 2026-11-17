/** Worker side of `deflate-pool`: one job in, one answer out. */
import { runDeflate, type DeflateOp } from './deflate-core';

interface Job {
  id: number;
  op: DeflateOp;
  data: Uint8Array;
}

const scope = self as unknown as {
  onmessage: ((e: { data: Job }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, op, data } }) => {
  try {
    const out = await runDeflate(op, data);
    scope.postMessage({ id, data: out }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
