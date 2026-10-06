import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the inline worker module — vitest (node env) cannot resolve '?worker&inline'.
// Each test installs its own FakeWorker subclass as the module's default export.
vi.mock('./decode.worker?worker&inline', () => ({ default: class {} }));

import * as workerModule from './decode.worker?worker&inline';
import { isWorkerDecodeSupported, decodeBundleInWorker } from './decode-worker-client';

const mod = workerModule as { default: unknown };
const OriginalWorker = mod.default;

/** A Worker stand-in that records what it is sent, then answers through `reply`. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((message: unknown, transfer?: Transferable[]) => {
    // Clone like a real Worker does, so a transfer list detaches the caller's buffer.
    structuredClone(message, { transfer });
    setTimeout(() => this.reply(this), 0);
  });

  constructor(private readonly reply: (worker: FakeWorker) => void) {
    FakeWorker.instances.push(this);
  }
}

function installWorker(reply: (worker: FakeWorker) => void): void {
  mod.default = class extends FakeWorker {
    constructor() {
      super(reply);
    }
  };
}

/** The single worker the call spawned, sent the caller's buffer as a clone and then ended. */
function expectOneClonedPostAndTerminate(buf: ArrayBuffer): void {
  expect(FakeWorker.instances).toHaveLength(1);
  const [worker] = FakeWorker.instances;
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  // Exactly one argument: no transfer list, so the main-thread fallback can reuse `buf`.
  expect(buf.byteLength).toBe(8);
  expect(worker.postMessage.mock.calls[0]).toHaveLength(1);
  // toEqual treats any two ArrayBuffers as equal, so check the caller's buffer by identity.
  const message = worker.postMessage.mock.calls[0][0] as { type: string; arrayBuffer: unknown };
  expect(Object.keys(message).sort()).toEqual(['arrayBuffer', 'type']);
  expect(message.type).toBe('decode-bundle');
  expect(message.arrayBuffer).toBe(buf);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
}

describe('isWorkerDecodeSupported', () => {
  it('returns true when Worker is defined on globalThis', () => {
    const original = (globalThis as Record<string, unknown>)['Worker'];
    (globalThis as Record<string, unknown>)['Worker'] = class MockWorker {};
    expect(isWorkerDecodeSupported()).toBe(true);
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>)['Worker'];
    } else {
      (globalThis as Record<string, unknown>)['Worker'] = original;
    }
  });

  it('returns false when Worker is deleted from globalThis', () => {
    const original = (globalThis as Record<string, unknown>)['Worker'];
    delete (globalThis as Record<string, unknown>)['Worker'];
    expect(isWorkerDecodeSupported()).toBe(false);
    if (original !== undefined) {
      (globalThis as Record<string, unknown>)['Worker'] = original;
    }
  });
});

describe('decodeBundleInWorker', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mod.default = OriginalWorker;
  });

  it('rejects when DecodeWorker constructor throws', async () => {
    vi.spyOn(mod, 'default').mockImplementationOnce(function () {
      throw new Error('Worker spawn failed');
    } as never);

    const buf = new ArrayBuffer(8);
    await expect(decodeBundleInWorker(buf)).rejects.toThrow('Worker spawn failed');
  });

  it('rejects when worker posts ok:false', async () => {
    installWorker((worker) =>
      worker.onmessage?.(
        new MessageEvent('message', {
          data: { type: 'decode-result', ok: false, error: 'decode failed in worker' },
        }),
      ),
    );

    const buf = new ArrayBuffer(8);
    await expect(decodeBundleInWorker(buf)).rejects.toThrow('decode failed in worker');
    expectOneClonedPostAndTerminate(buf);
  });

  it('resolves with data and settings when worker posts ok:true', async () => {
    const fakeData = {
      protein_ids: ['P12345'],
      projections: [],
      annotation_data: {},
      annotations: {},
      dimension: 2,
    };
    installWorker((worker) =>
      worker.onmessage?.(
        new MessageEvent('message', {
          data: {
            type: 'decode-result',
            ok: true,
            data: fakeData,
            settings: null,
            formatVersion: 2,
          },
        }),
      ),
    );

    const buf = new ArrayBuffer(8);
    const result = await decodeBundleInWorker(buf);
    expect(result.data).toBe(fakeData);
    expect(result.settings).toBeNull();
    expect(result.formatVersion).toBe(2);
    expectOneClonedPostAndTerminate(buf);
  });

  it('rejects when worker fires onerror', async () => {
    // A plain object shaped like ErrorEvent (node env lacks the ErrorEvent constructor).
    installWorker((worker) => worker.onerror?.({ message: 'Script error' } as ErrorEvent));

    const buf = new ArrayBuffer(8);
    await expect(decodeBundleInWorker(buf)).rejects.toThrow('decode worker error: Script error');
    expectOneClonedPostAndTerminate(buf);
  });
});
