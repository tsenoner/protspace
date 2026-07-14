import { describe, expect, it, vi } from 'vitest';
import { createLoadQueue } from './load-queue';

function makeFile(name: string) {
  return new File([''], name, { type: 'application/octet-stream' });
}

describe('createLoadQueue', () => {
  it('runs a single enqueued load to completion', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const loadFn = vi.fn(async () => {});
    const file = makeFile('a.parquetbundle');

    // enqueueLoadFromFile awaits the finalization promise, so resolve concurrently
    const promise = queue.enqueueLoadFromFile(file, undefined, loadFn);
    // loadFn runs synchronously within the microtask, so meta is available after a tick
    await vi.waitFor(() => expect(loadFn).toHaveBeenCalled());
    queue.resolvePendingLoadFinalization(queue.getLoadMetaForFile(file)!.sequence);
    await promise;

    expect(loadFn).toHaveBeenCalledOnce();
  });

  it('assigns incrementing sequence numbers', () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const a = makeFile('a.parquetbundle');
    const b = makeFile('b.parquetbundle');

    const metaA = queue.registerFileLoad(a, 'user');
    const metaB = queue.registerFileLoad(b, 'user');

    expect(metaB.sequence).toBe(metaA.sequence + 1);
  });

  it('tracks the running load meta during execution', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const file = makeFile('a.parquetbundle');
    let capturedRunning: ReturnType<typeof queue.getRunningLoadMeta> = null;

    const loadFn = vi.fn(async () => {
      capturedRunning = queue.getRunningLoadMeta();
    });

    const promise = queue.enqueueLoadFromFile(file, undefined, loadFn);
    // Resolve finalization so the queue can complete
    const meta = queue.getLoadMetaForFile(file)!;
    queue.resolvePendingLoadFinalization(meta.sequence);
    await promise;

    expect(capturedRunning).not.toBeNull();
    expect(capturedRunning!.kind).toBe('user');
  });

  it('clears running meta after load completes', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const file = makeFile('a.parquetbundle');

    const promise = queue.enqueueLoadFromFile(file, undefined, async () => {});
    const meta = queue.getLoadMetaForFile(file)!;
    queue.resolvePendingLoadFinalization(meta.sequence);
    await promise;

    expect(queue.getRunningLoadMeta()).toBeNull();
  });

  it('queues loads sequentially — second waits for first', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const order: string[] = [];

    const fileA = makeFile('a.parquetbundle');
    const fileB = makeFile('b.parquetbundle');

    const promiseA = queue.enqueueLoadFromFile(fileA, undefined, async () => {
      order.push('a-start');
    });

    const promiseB = queue.enqueueLoadFromFile(fileB, undefined, async () => {
      order.push('b-start');
    });

    // Resolve A's finalization so B can proceed
    const metaA = queue.getLoadMetaForFile(fileA)!;
    queue.resolvePendingLoadFinalization(metaA.sequence);
    await promiseA;

    // Now resolve B
    const metaB = queue.getLoadMetaForFile(fileB)!;
    queue.resolvePendingLoadFinalization(metaB.sequence);
    await promiseB;

    expect(order).toEqual(['a-start', 'b-start']);
  });

  it('second load becomes the running meta while first is still pending finalization', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const fileA = makeFile('a.parquetbundle');
    const fileB = makeFile('b.parquetbundle');

    let runningDuringB: ReturnType<typeof queue.getRunningLoadMeta> = null;

    queue.enqueueLoadFromFile(fileA, undefined, async () => {});

    // Resolve A so B can start
    const metaA = queue.getLoadMetaForFile(fileA)!;
    queue.resolvePendingLoadFinalization(metaA.sequence);

    const promiseB = queue.enqueueLoadFromFile(fileB, undefined, async () => {
      runningDuringB = queue.getRunningLoadMeta();
    });

    const metaB = queue.getLoadMetaForFile(fileB)!;
    queue.resolvePendingLoadFinalization(metaB.sequence);
    await promiseB;

    expect(runningDuringB).not.toBeNull();
    expect(runningDuringB!.sequence).toBe(metaB.sequence);
  });

  it('skips load execution when disposed', async () => {
    let disposed = false;
    const queue = createLoadQueue({ isDisposed: () => disposed });
    const file = makeFile('a.parquetbundle');
    const loadFn = vi.fn(async () => {});

    disposed = true;
    const promise = queue.enqueueLoadFromFile(file, undefined, loadFn);
    queue.resolvePendingLoadFinalization(queue.getLoadMetaForFile(file)!.sequence);
    await promise;

    expect(loadFn).not.toHaveBeenCalled();
  });

  it('reuses existing meta for the same file', () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const file = makeFile('a.parquetbundle');

    const meta1 = queue.registerFileLoad(file, 'user');
    const meta2 = queue.getLoadMetaForFile(file);

    expect(meta2).toBe(meta1);
  });

  it('getLatestSequence reflects the highest registered sequence', () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    expect(queue.getLatestSequence()).toBe(0);

    queue.registerFileLoad(makeFile('a.parquetbundle'), 'user');
    expect(queue.getLatestSequence()).toBe(1);

    queue.registerFileLoad(makeFile('b.parquetbundle'), 'default');
    expect(queue.getLatestSequence()).toBe(2);
  });

  it('dispose resolves all pending finalizations', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const file = makeFile('a.parquetbundle');

    const promise = queue.enqueueLoadFromFile(file, undefined, async () => {});
    // Don't manually resolve — dispose should unblock it
    queue.dispose();

    // Should not hang
    await promise;
  });

  it('registers auto-source files as default kind', async () => {
    const queue = createLoadQueue({ isDisposed: () => false });
    const file = makeFile('data.parquetbundle');

    const promise = queue.enqueueLoadFromFile(file, { source: 'auto' }, async () => {});
    const meta = queue.getLoadMetaForFile(file)!;
    queue.resolvePendingLoadFinalization(meta.sequence);
    await promise;

    expect(meta.kind).toBe('default');
  });
});
