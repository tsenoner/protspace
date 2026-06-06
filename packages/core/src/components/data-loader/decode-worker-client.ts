import DecodeWorker from './decode.worker?worker&inline';
import type { VisualizationData, BundleSettings } from '@protspace/utils';

export interface WorkerDecodeResult {
  data: VisualizationData;
  settings: BundleSettings | null;
}

export function isWorkerDecodeSupported(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Decode+convert a parquetbundle in a worker. The input `arrayBuffer` is cloned into
 * the worker via structured-clone (postMessage without transfer list), so the caller's
 * buffer remains valid for the main-thread fallback if the worker path fails.
 *
 * The result Float32/Int32 typed arrays are transferred back zero-copy.
 * Rejects on worker spawn or runtime error (caller falls back to the main-thread path).
 *
 * NOTE: Transfer-in is intentionally omitted here to keep the fallback safe. It can be
 * added as a future optimisation once the worker path is confirmed stable in production.
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
      const d = event.data as {
        ok: boolean;
        data?: VisualizationData;
        settings?: BundleSettings | null;
        error?: string;
      };
      cleanup();
      if (d?.ok) {
        resolve({ data: d.data as VisualizationData, settings: d.settings ?? null });
      } else {
        reject(new Error(d?.error || 'worker decode failed'));
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(`decode worker error: ${event.message || 'unknown'}`));
    };
    // Clone-in (no transfer list): keeps arrayBuffer valid for fallback if worker fails.
    worker.postMessage({ type: 'decode-bundle', arrayBuffer });
  });
}
