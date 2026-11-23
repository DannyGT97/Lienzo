/** Worker side of `psd-write`: a PSD description in, its bytes out. */
import { writePsd, type Psd, type WriteOptions } from 'ag-psd';

const scope = self as unknown as {
  onmessage: ((e: { data: { psd: Psd; options: WriteOptions } }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data: { psd, options } }) => {
  try {
    const bytes = writePsd(psd, options).slice(0);
    scope.postMessage({ bytes }, [bytes]);
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
