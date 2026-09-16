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
    const { data, settings } = await decodeParquetBundle(arrayBuffer);
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
