import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DecodedParquetBundle } from './utils/bundle';

interface FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

const mocks = vi.hoisted(() => ({
  decodeParquetBundle: vi.fn(),
  /** Runs in the fake worker's constructor, so a test can make spawning throw. */
  spawn: vi.fn(),
  /** How the fake worker answers a posted bundle; set per test. */
  reply: vi.fn(),
}));

// vitest (node env) cannot resolve '?worker&inline', so the worker is a fake that hands
// each posted message to `mocks.reply` on the next task.
vi.mock('./decode.worker?worker&inline', () => ({
  default: class {
    onmessage: FakeWorker['onmessage'] = null;
    onerror: FakeWorker['onerror'] = null;
    constructor() {
      mocks.spawn();
    }
    postMessage(message: unknown, transfer: Transferable[]): void {
      setTimeout(() => mocks.reply(this, message, transfer), 0);
    }
    terminate(): void {
      // no-op
    }
  },
}));

vi.mock('./utils/bundle', () => ({ decodeParquetBundle: mocks.decodeParquetBundle }));

import { generateDatasetHash } from '@protspace/utils';
import { decodeBundle } from './bundle-decoder';

const decoded = (formatVersion: number): DecodedParquetBundle => ({
  data: {
    protein_ids: [`P${formatVersion}`],
    projections: [],
    annotations: {},
    annotation_data: {},
  },
  settings: null,
  formatVersion,
  unplacedProteinCount: 0,
});

const answer = (worker: FakeWorker, data: unknown) =>
  worker.onmessage?.(new MessageEvent('message', { data }));

describe('decodeBundle', () => {
  const mainThread = decoded(2);
  let bytes: ArrayBuffer;
  let reread: () => Promise<ArrayBuffer>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('Worker', class {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bytes = new Uint8Array([1, 2, 3]).buffer;
    reread = vi.fn(async () => new Uint8Array([4, 5, 6]).buffer);
    mocks.decodeParquetBundle.mockResolvedValue(mainThread);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('decodes on the main thread when the browser has no Worker', async () => {
    vi.stubGlobal('Worker', undefined);

    await expect(decodeBundle(bytes, reread)).resolves.toBe(mainThread);
    expect(mocks.decodeParquetBundle).toHaveBeenCalledWith(bytes);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(reread).not.toHaveBeenCalled();
  });

  it('resolves with the worker result and remembers its dataset hash', async () => {
    const fromWorker = decoded(3);
    mocks.reply.mockImplementation((worker: FakeWorker) =>
      answer(worker, {
        type: 'decode-result',
        ok: true,
        ...fromWorker,
        datasetHash: 'worker-hash',
      }),
    );

    const result = await decodeBundle(bytes, reread);

    expect(result.data).toBe(fromWorker.data);
    // The worker's hash is remembered, so hashing the received data is a lookup.
    expect(generateDatasetHash(result.data)).toBe('worker-hash');
    expect(result.settings).toBeNull();
    expect(result.formatVersion).toBe(3);
    expect(mocks.decodeParquetBundle).not.toHaveBeenCalled();
  });

  it('transfers the bytes to the worker instead of cloning them', async () => {
    let transfer: Transferable[] | undefined;
    mocks.reply.mockImplementation(
      (worker: FakeWorker, _message: unknown, list: Transferable[]) => {
        transfer = list;
        answer(worker, { ok: true, ...decoded(3), datasetHash: 'h' });
      },
    );

    await decodeBundle(bytes, reread);

    expect(transfer).toHaveLength(1);
    expect(transfer?.[0]).toBe(bytes);
  });

  it.each<[string, () => void, string]>([
    [
      'cannot start',
      () =>
        mocks.spawn.mockImplementationOnce(() => {
          throw new Error('Worker spawn failed');
        }),
      'Worker spawn failed',
    ],
    [
      'reports a decode error',
      () =>
        mocks.reply.mockImplementation((worker: FakeWorker) =>
          answer(worker, { type: 'decode-result', ok: false, error: 'decode failed in worker' }),
        ),
      'decode failed in worker',
    ],
    [
      'fails without saying why',
      () => mocks.reply.mockImplementation((worker: FakeWorker) => answer(worker, { ok: false })),
      'worker decode failed',
    ],
    [
      'throws',
      () =>
        mocks.reply.mockImplementation((worker: FakeWorker) =>
          // Node has no ErrorEvent constructor; the decoder reads only `message`.
          worker.onerror?.({ message: 'Script error' } as ErrorEvent),
        ),
      'decode worker error: Script error',
    ],
  ])(
    'decodes a fresh read on the main thread when the worker %s',
    async (_label, failWorker, message) => {
      failWorker();

      await expect(decodeBundle(bytes, reread)).resolves.toBe(mainThread);

      expect(warn).toHaveBeenCalledWith(
        'Worker decode failed, falling back to main thread:',
        expect.objectContaining({ message }),
      );
      // The worker may have taken `bytes`, so the fallback decodes the re-read copy.
      expect(reread).toHaveBeenCalledOnce();
      const [fallbackBytes] = mocks.decodeParquetBundle.mock.calls[0] as [ArrayBuffer];
      expect([...new Uint8Array(fallbackBytes)]).toEqual([4, 5, 6]);
    },
  );
});
