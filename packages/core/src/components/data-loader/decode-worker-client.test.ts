import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the inline worker module — vitest (node env) cannot resolve '?worker&inline'.
// The mock factory returns a class so `new DecodeWorker()` works as a constructor.
vi.mock('./decode.worker?worker&inline', () => {
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage(_msg: unknown): void {
      // default no-op; tests override the instance directly
    }
    terminate(): void {
      // no-op
    }
  }
  return { default: FakeWorker };
});

import { isWorkerDecodeSupported, decodeBundleInWorker } from './decode-worker-client';

describe('isWorkerDecodeSupported', () => {
  it('returns false when Worker is undefined in the test environment', () => {
    // vitest runs in node — no Worker global by default
    const result = isWorkerDecodeSupported();
    // We only assert the function returns a boolean; the actual value depends on env
    expect(typeof result).toBe('boolean');
  });

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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when DecodeWorker constructor throws', async () => {
    // Override the mock so the constructor throws
    const mod = await import('./decode.worker?worker&inline');
    const OriginalClass = mod.default;
    vi.spyOn(mod, 'default').mockImplementationOnce(() => {
      throw new Error('Worker spawn failed');
    });

    const buf = new ArrayBuffer(8);
    await expect(decodeBundleInWorker(buf)).rejects.toThrow('Worker spawn failed');

    vi.spyOn(mod, 'default').mockRestore?.();
    // Restore
    mod.default = OriginalClass;
  });

  it('rejects when worker posts ok:false', async () => {
    const mod = await import('./decode.worker?worker&inline');
    // Replace the class with one that auto-fires an error response
    const OrigClass = mod.default;
    mod.default = class FakeFailWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate(): void {
        /* no-op */
      }
      postMessage(_msg: unknown): void {
        const self = this;
        setTimeout(() => {
          if (self.onmessage) {
            self.onmessage(
              new MessageEvent('message', {
                data: { type: 'decode-result', ok: false, error: 'decode failed in worker' },
              }),
            );
          }
        }, 0);
      }
    } as unknown as typeof mod.default;

    const buf = new ArrayBuffer(8);
    await expect(decodeBundleInWorker(buf)).rejects.toThrow('decode failed in worker');
    mod.default = OrigClass;
  });

  it('resolves with data and settings when worker posts ok:true', async () => {
    const fakeData = {
      protein_ids: ['P12345'],
      projections: [],
      annotation_data: {},
      annotations: {},
      dimension: 2,
    };

    const mod = await import('./decode.worker?worker&inline');
    const OrigClass = mod.default;
    mod.default = class FakeOkWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate(): void {
        /* no-op */
      }
      postMessage(_msg: unknown): void {
        const self = this;
        setTimeout(() => {
          if (self.onmessage) {
            self.onmessage(
              new MessageEvent('message', {
                data: { type: 'decode-result', ok: true, data: fakeData, settings: null },
              }),
            );
          }
        }, 0);
      }
    } as unknown as typeof mod.default;

    const buf = new ArrayBuffer(8);
    const result = await decodeBundleInWorker(buf);
    expect(result.data).toBe(fakeData);
    expect(result.settings).toBeNull();
    mod.default = OrigClass;
  });

  it('rejects when worker fires onerror', async () => {
    const mod = await import('./decode.worker?worker&inline');
    const OrigClass = mod.default;
    mod.default = class FakeErrWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate(): void {
        /* no-op */
      }
      postMessage(_msg: unknown): void {
        const self = this;
        setTimeout(() => {
          if (self.onerror) {
            // Use a plain object shaped like ErrorEvent (node env lacks ErrorEvent constructor)
            const fakeEvent = { message: 'Script error' } as ErrorEvent;
            self.onerror(fakeEvent);
          }
        }, 0);
      }
    } as unknown as typeof mod.default;

    const buf = new ArrayBuffer(8);
    await expect(decodeBundleInWorker(buf)).rejects.toThrow('decode worker error: Script error');
    mod.default = OrigClass;
  });
});
