/**
 * @vitest-environment jsdom
 */
import { File as NodeFile } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeBundleInWorker: vi.fn(),
  decodeParquetBundle: vi.fn(),
}));

vi.mock('./decode-worker-client', () => ({
  isWorkerDecodeSupported: () => true,
  decodeBundleInWorker: mocks.decodeBundleInWorker,
}));

vi.mock('./utils/bundle', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  decodeParquetBundle: mocks.decodeParquetBundle,
}));

import './data-loader';
import type { DataLoader } from './data-loader';

describe('data-loader main-thread fallback', () => {
  it('reads the file again when the worker took the bytes and failed', async () => {
    mocks.decodeBundleInWorker.mockImplementation(async (buffer: ArrayBuffer) => {
      buffer.transfer();
      throw new Error('worker crashed');
    });
    let fallbackBytes: number[] = [];
    mocks.decodeParquetBundle.mockImplementation(async (buffer: ArrayBuffer) => {
      fallbackBytes = [...new Uint8Array(buffer)];
      return {
        data: { protein_ids: [], projections: [], annotations: {}, annotation_data: {} },
        settings: null,
        formatVersion: 3,
        unplacedProteinCount: 0,
      };
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

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
