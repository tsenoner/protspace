/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

// jsdom has no Worker, so the worker path only runs when isWorkerDecodeSupported is mocked.
vi.mock('./decode-worker-client', () => ({
  isWorkerDecodeSupported: vi.fn(() => false),
  decodeBundleInWorker: vi.fn(),
}));
vi.mock('./utils/bundle', async (importOriginal) => ({
  ...(await importOriginal<typeof Bundle>()),
  decodeParquetBundle: vi.fn(),
}));

import './data-loader';
import type { DataLoadedEventDetail } from './data-loader';
import type { DataErrorEventDetail } from './data-loader.events';
import { decodeBundleInWorker, isWorkerDecodeSupported } from './decode-worker-client';
import { decodeParquetBundle } from './utils/bundle';
import type * as Bundle from './utils/bundle';

const DATA = { protein_ids: ['P1'] } as unknown as VisualizationData;
const DECODED = { data: DATA, settings: null, formatVersion: 2, unplacedProteinCount: 3 };

/** A bundle file whose bytes jsdom can read (jsdom's File has no arrayBuffer()). */
function bundleFile(name = 'x.parquetbundle'): { file: File; bytes: ArrayBuffer } {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const file = new File([new Uint8Array(bytes)], name);
  Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(async () => bytes) });
  return { file, bytes };
}

describe('data-loader loading a file itself (no loadFromFileHandler)', () => {
  let dataLoader: HTMLElement & {
    loadFromFile: (file: File, options?: { source?: 'user' | 'auto' }) => Promise<void>;
    updateComplete: Promise<unknown>;
  };
  let loadingStarts: number;
  let loaded: DataLoadedEventDetail[];
  let errors: DataErrorEventDetail[];

  beforeEach(async () => {
    document.body.innerHTML = '';
    dataLoader = document.createElement('protspace-data-loader') as typeof dataLoader;
    document.body.appendChild(dataLoader);
    await dataLoader.updateComplete;

    loadingStarts = 0;
    loaded = [];
    errors = [];
    dataLoader.addEventListener('data-loading-start', () => loadingStarts++);
    dataLoader.addEventListener('data-loaded', (event) =>
      loaded.push((event as CustomEvent<DataLoadedEventDetail>).detail),
    );
    dataLoader.addEventListener('data-error', (event) =>
      errors.push((event as CustomEvent<DataErrorEventDetail>).detail),
    );
    vi.mocked(decodeParquetBundle).mockResolvedValue(DECODED);
  });

  afterEach(() => {
    vi.mocked(isWorkerDecodeSupported).mockReturnValue(false);
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects an unsupported extension before any loading UI appears', async () => {
    const { file } = bundleFile('proteins.fasta');

    await dataLoader.loadFromFile(file);

    expect(errors.map((error) => error.message)).toEqual([
      'Unsupported file format. Please upload a .parquetbundle file.',
    ]);
    expect(loadingStarts).toBe(0);
    expect(dataLoader.hasAttribute('loading')).toBe(false);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(loaded).toEqual([]);
  });

  it('rejects an oversized file without reading it, and clears the loading state', async () => {
    const { file } = bundleFile();
    Object.defineProperty(file, 'size', { value: 501 * 1024 * 1024 });

    await dataLoader.loadFromFile(file);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/^File too large: 501\.00MB exceeds limit/);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(dataLoader.hasAttribute('loading')).toBe(false);
    expect(loaded).toEqual([]);
  });

  it('carries the file, source, format version and unplaced count in data-loaded', async () => {
    const { file, bytes } = bundleFile();

    await dataLoader.loadFromFile(file, { source: 'auto' });

    expect(decodeParquetBundle).toHaveBeenCalledWith(bytes);
    expect(errors).toEqual([]);
    expect(loaded).toEqual([
      {
        data: DATA,
        settings: null,
        source: 'auto',
        file,
        bundleFormatVersion: 2,
        unplacedProteinCount: 3,
      },
    ]);
    expect(loadingStarts).toBe(1);
    expect(dataLoader.hasAttribute('loading')).toBe(false);
  });

  it('uses the worker result when the worker decodes the bundle', async () => {
    vi.mocked(isWorkerDecodeSupported).mockReturnValue(true);
    vi.mocked(decodeBundleInWorker).mockResolvedValue({ ...DECODED, formatVersion: 3 });
    const { file, bytes } = bundleFile();

    await dataLoader.loadFromFile(file);

    expect(decodeBundleInWorker).toHaveBeenCalledWith(bytes);
    expect(decodeParquetBundle).not.toHaveBeenCalled();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].bundleFormatVersion).toBe(3);
  });

  it('falls back to the main-thread decode when the worker rejects', async () => {
    vi.mocked(isWorkerDecodeSupported).mockReturnValue(true);
    vi.mocked(decodeBundleInWorker).mockRejectedValue(new Error('worker crashed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { file, bytes } = bundleFile();

    await dataLoader.loadFromFile(file);

    expect(decodeBundleInWorker).toHaveBeenCalledWith(bytes);
    expect(decodeParquetBundle).toHaveBeenCalledWith(bytes);
    expect(warn).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ data: DATA, bundleFormatVersion: 2, file });
    expect(dataLoader.hasAttribute('loading')).toBe(false);
  });
});
