/** Worker side of `filter-pool`: a piece of a filter in, the piece done out. */
import { runAreaJob, runPixelJob, type AreaJob, type PixelJob } from './filter-core';

type Request = { id: number; kind: 'pixel'; job: PixelJob } | { id: number; kind: 'area'; job: AreaJob };

const scope = self as unknown as {
  onmessage: ((e: { data: Request }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data }) => {
  try {
    const out = data.kind === 'pixel' ? runPixelJob(data.job) : runAreaJob(data.job);
    scope.postMessage({ id: data.id, out }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
