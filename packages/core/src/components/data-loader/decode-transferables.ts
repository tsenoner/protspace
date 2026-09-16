import { isCsrAnnotationData, type VisualizationData } from '@protspace/utils';

/**
 * ArrayBuffers of a decoded dataset that can move to the main thread zero-copy.
 *
 * Everything a v3 read produces in bulk is a typed array, and structured-cloning those
 * is what the format was designed to avoid: at 573K proteins the clone of the result
 * alone cost 3.7 s. What is left behind — the id strings, the projection metadata, the
 * numeric `(number | null)[]` columns — is cloned as before.
 *
 * Deduplicated through a `Set`, because `postMessage` throws on a duplicate entry in
 * the transfer list, and two views can legitimately share one buffer.
 *
 * Lives outside `decode.worker.ts` so node tests can import it: that module is only
 * loadable through Vite's `?worker` transform.
 */
export function collectTransferables(data: VisualizationData): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const push = (buffer: ArrayBufferLike | undefined) => {
    if (buffer instanceof ArrayBuffer) buffers.add(buffer);
  };

  for (const projection of data.projections) {
    if (projection.data instanceof Float32Array) push(projection.data.buffer);
  }
  for (const value of Object.values(data.annotation_data)) {
    if (value instanceof Int32Array) {
      push(value.buffer);
    } else if (isCsrAnnotationData(value)) {
      push(value.end.buffer);
      push(value.codes.buffer);
    }
  }
  for (const scores of Object.values(data.annotation_scores_csr ?? {})) {
    push(scores.hitEnd.buffer);
    push(scores.values.buffer);
  }
  for (const evidence of Object.values(data.annotation_evidence_csr ?? {})) {
    push(evidence.codes.buffer);
  }

  return [...buffers];
}
