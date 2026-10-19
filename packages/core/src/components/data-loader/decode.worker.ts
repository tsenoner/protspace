import { generateDatasetHash, generateLegacyDatasetHash } from '@protspace/utils';
import { decodeParquetBundle } from './utils/bundle';
import { collectTransferables } from './decode-transferables';

interface DecodeRequest {
  type: 'decode-bundle';
  arrayBuffer: ArrayBuffer;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { arrayBuffer } = event.data;
  try {
    const decoded = await decodeParquetBundle(arrayBuffer);
    // Hashed here, before the buffers move, so the main thread need not walk the dataset.
    const datasetHash = generateDatasetHash(decoded.data);
    const legacyDatasetHash = generateLegacyDatasetHash(decoded.data);
    ctx.postMessage(
      { type: 'decode-result', ok: true, ...decoded, datasetHash, legacyDatasetHash },
      collectTransferables(decoded.data),
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
