import { rememberDatasetHash } from '@protspace/utils';
import DecodeWorker from './decode.worker?worker&inline';
import { decodeParquetBundle, type DecodedParquetBundle } from './utils/bundle';

/** What decode.worker.ts posts back: the decoded bundle and its dataset hashes, or the error. */
type WorkerDecodeMessage =
  | ({ ok: true; datasetHash: string; legacyDatasetHash: string } & DecodedParquetBundle)
  | { ok: false; rejected?: boolean; error?: string };

/** The worker decoded the bundle and refused it: decoding it again would refuse it too. */
class BundleRejectedError extends Error {}

/**
 * Decode+convert a parquetbundle in a worker, or on the main thread where workers are
 * unsupported or the worker fails. The worker takes `bytes` (they are transferred, not
 * cloned), so the main-thread fallback decodes a fresh copy from `reread` instead. A
 * bundle the worker refuses (malformed, over a limit) is not decoded again.
 */
export async function decodeBundle(
  bytes: ArrayBuffer,
  reread: () => Promise<ArrayBuffer>,
): Promise<DecodedParquetBundle> {
  if (typeof Worker === 'undefined') {
    return decodeParquetBundle(bytes);
  }
  try {
    return await decodeInWorker(bytes);
  } catch (workerError) {
    if (workerError instanceof BundleRejectedError) throw workerError;
    console.warn('Worker decode failed, falling back to main thread:', workerError);
    return decodeParquetBundle(await reread());
  }
}

/**
 * The result Float32/Int32 typed arrays are transferred back zero-copy. The worker also
 * hashes the dataset, and both its hashes are remembered for the received data, so
 * hashing it on the main thread is a lookup.
 * Rejects on worker spawn or runtime error, and with a {@link BundleRejectedError} when
 * the worker refuses the bundle.
 */
function decodeInWorker(bytes: ArrayBuffer): Promise<DecodedParquetBundle> {
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
        rememberDatasetHash(d.data, d.datasetHash, d.legacyDatasetHash);
        resolve(d);
      } else {
        const message = d?.error || 'worker decode failed';
        reject(d?.rejected ? new BundleRejectedError(message) : new Error(message));
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(`decode worker error: ${event.message || 'unknown'}`));
    };
    worker.postMessage({ type: 'decode-bundle', arrayBuffer: bytes }, [bytes]);
  });
}
