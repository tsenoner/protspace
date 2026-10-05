import { rememberDatasetHash } from '@protspace/utils';
import DecodeWorker from './decode.worker?worker&inline';
import type { DecodedParquetBundle } from './utils/bundle';

export type WorkerDecodeResult = DecodedParquetBundle;

/** What decode.worker.ts posts back: the decoded bundle and its dataset hash, or the error. */
type WorkerDecodeMessage =
  | ({ ok: true; datasetHash: string } & DecodedParquetBundle)
  | { ok: false; error?: string };

export function isWorkerDecodeSupported(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Decode+convert a parquetbundle in a worker. The input `arrayBuffer` is transferred, not
 * cloned, so it is detached once this returns: a caller that falls back to the main thread
 * must read the bytes again.
 *
 * The result Float32/Int32 typed arrays are transferred back zero-copy. The worker also
 * hashes the dataset, and that hash is remembered for the received data, so the main
 * thread's `generateDatasetHash` of it is a lookup.
 * Rejects on worker spawn or runtime error (caller falls back to the main-thread path).
 */
export function decodeBundleInWorker(arrayBuffer: ArrayBuffer): Promise<WorkerDecodeResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new DecodeWorker();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent) => {
      const d = event.data as WorkerDecodeMessage | undefined;
      cleanup();
      if (d?.ok) {
        rememberDatasetHash(d.data, d.datasetHash);
        resolve(d);
      } else {
        reject(new Error(d?.error || 'worker decode failed'));
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(`decode worker error: ${event.message || 'unknown'}`));
    };
    worker.postMessage({ type: 'decode-bundle', arrayBuffer }, [arrayBuffer]);
  });
}
