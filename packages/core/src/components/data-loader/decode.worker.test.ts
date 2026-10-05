import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { generateDatasetHash, type VisualizationData } from '@protspace/utils';
import { decodeParquetBundle } from './utils/bundle';

const BUNDLES = [
  './utils/__fixtures__/v2-sample.parquetbundle',
  './utils/__fixtures__/v3-sample.parquetbundle',
  '../../../../../apps/web/tests/fixtures/data_custom.parquetbundle',
  '../../../../../apps/web/tests/fixtures/phosphatase_eat.parquetbundle',
  '../../../../../apps/web/tests/fixtures/raw_numeric_test.parquetbundle',
  '../../../../../apps/web/tests/fixtures/all_null_column.parquetbundle',
];

function read(path: string): ArrayBuffer {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// The worker module wires itself to `self`; this stands in for the worker scope.
const scope = {
  onmessage: null as ((event: { data: unknown }) => Promise<void>) | null,
  postMessage: vi.fn(),
};
vi.stubGlobal('self', scope);
await import('./decode.worker');

describe('decode worker dataset hash', () => {
  it.each(BUNDLES)('equals the main-thread hash for %s', async (path) => {
    const mainThreadHash = generateDatasetHash((await decodeParquetBundle(read(path))).data);

    scope.postMessage.mockClear();
    await scope.onmessage?.({ data: { type: 'decode-bundle', arrayBuffer: read(path) } });
    const [message, transfer] = scope.postMessage.mock.calls[0];
    // What the main thread receives: the buffers moved, everything else cloned.
    const received = structuredClone(message, { transfer }) as {
      datasetHash: string;
      data: VisualizationData;
    };

    expect(received.datasetHash).toBe(mainThreadHash);
    // A fresh id array misses the memo, so this hashes the received values again.
    const rehashed = { ...received.data, protein_ids: [...received.data.protein_ids] };
    expect(generateDatasetHash(rehashed)).toBe(mainThreadHash);
  });
});
