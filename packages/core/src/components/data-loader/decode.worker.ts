import { extractRowsFromParquetBundle } from './utils/bundle';
import { convertParquetToVisualizationDataOptimized } from './utils/conversion';
import { validateRowsBasic } from './utils/validation';
import type { VisualizationData, BundleSettings } from '@protspace/utils';

interface DecodeRequest {
  type: 'decode-bundle';
  arrayBuffer: ArrayBuffer;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

/**
 * Collect transferable ArrayBuffers from the result (Float32 coords + Int32 annotation columns)
 * so they move zero-copy. Everything else (strings, metadata, number[][]) is structured-cloned.
 */
function collectTransferables(data: VisualizationData): Transferable[] {
  const transfer: Transferable[] = [];
  for (const projection of data.projections) {
    if (projection.data instanceof Float32Array) transfer.push(projection.data.buffer);
  }
  for (const value of Object.values(data.annotation_data)) {
    if (value instanceof Int32Array) transfer.push(value.buffer);
  }
  return transfer;
}

ctx.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { arrayBuffer } = event.data;
  try {
    const extraction = await extractRowsFromParquetBundle(arrayBuffer);
    validateRowsBasic(extraction.projections);
    const data = await convertParquetToVisualizationDataOptimized(extraction);
    const settings: BundleSettings | null = extraction.settings;
    ctx.postMessage(
      { type: 'decode-result', ok: true, data, settings },
      collectTransferables(data),
    );
  } catch (error) {
    ctx.postMessage(
      {
        type: 'decode-result',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      [],
    );
  }
};
