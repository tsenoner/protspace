/**
 * @vitest-environment jsdom
 */
import { File as NodeFile } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeBundle: vi.fn(),
}));

vi.mock('./bundle-decoder', () => ({
  decodeBundle: mocks.decodeBundle,
}));

import './data-loader';
import type { DataLoader } from './data-loader';

describe('data-loader main-thread fallback', () => {
  it('reads the file again when the worker took the bytes and failed', async () => {
    let fallbackBytes: number[] = [];
    mocks.decodeBundle.mockImplementation(
      async (bytes: ArrayBuffer, reread: () => Promise<ArrayBuffer>) => {
        // What a failed worker decode leaves: the bytes moved, then the decoder re-reads.
        bytes.transfer();
        fallbackBytes = [...new Uint8Array(await reread())];
        return {
          data: { protein_ids: [], projections: [], annotations: {}, annotation_data: {} },
          settings: null,
          formatVersion: 3,
          unplacedProteinCount: 0,
        };
      },
    );

    const loader = document.createElement('protspace-data-loader') as DataLoader;
    document.body.appendChild(loader);
    const loaded = vi.fn();
    loader.addEventListener('data-loaded', loaded);

    // jsdom's File has no arrayBuffer(); node's does.
    const file = new NodeFile([new Uint8Array([1, 2, 3])], 'x.parquetbundle');
    await loader.loadFromFile(file as unknown as File);

    expect(fallbackBytes).toEqual([1, 2, 3]);
    expect(loaded).toHaveBeenCalledOnce();
  });
});
