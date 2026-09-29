import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: notifyMock,
}));

vi.mock('./opfs-dataset-store', () => ({
  StoredDatasetCorruptError: class StoredDatasetCorruptError extends Error {},
  clearLastImportedFile: vi.fn().mockResolvedValue(undefined),
  loadLastImportedFile: vi.fn().mockResolvedValue(null),
  markLastLoadStatus: vi.fn().mockResolvedValue(undefined),
  readLastLoadStatus: vi.fn().mockResolvedValue(null),
}));

import { createLoadQueue } from './load-queue';
import {
  StoredDatasetCorruptError,
  clearLastImportedFile,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
} from './opfs-dataset-store';
import { createPersistedDatasetController } from './persisted-dataset';

const DEMO = EXAMPLE_DATASETS[0];
const OTHER = EXAMPLE_DATASETS[1];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const okResponse = () => ({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });

/** The `AbortSignal` the `index`-th fetch was started with. */
function fetchSignal(fetchMock: ReturnType<typeof vi.fn>, index = 0): AbortSignal {
  return (fetchMock.mock.calls[index]?.[1] as RequestInit).signal as AbortSignal;
}

function createController() {
  const dataLoader = { loadFromFile: vi.fn().mockResolvedValue(undefined) };
  const overlayController = { update: vi.fn() };
  const setCurrentExampleId = vi.fn();
  const setCurrentDatasetName = vi.fn();
  // The real queue, with `registerFileLoad` spied on. `resolveOutcome` settles
  // a load the way handleDataLoaded (`true`) / handleDataError (`false`) do.
  const realQueue = createLoadQueue({ isDisposed: () => false });
  const loadQueue = {
    registerFileLoad: vi.fn(realQueue.registerFileLoad),
    resolveOutcome: realQueue.resolvePendingLoadFinalization,
  };

  const controller = createPersistedDatasetController({
    dataLoader: dataLoader as never,
    overlayController,
    registerFileLoad: loadQueue.registerFileLoad,
    awaitLoadOutcome: realQueue.awaitLoadOutcome,
    setCurrentExampleId,
    setCurrentDatasetName,
  });

  return {
    controller,
    dataLoader,
    overlayController,
    loadQueue,
    setCurrentExampleId,
    setCurrentDatasetName,
  };
}

describe('loadExampleDataset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the downloading overlay before fetching, then fetches and loads the bundle', async () => {
    const arrayBuffer = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, overlayController, loadQueue } = createController();

    const resultPromise = controller.loadExampleDataset(DEMO, 'menu');
    // The overlay must appear before the fetch resolves, not after.
    expect(overlayController.update).toHaveBeenCalledWith(true, 0, `Downloading ${DEMO.label}…`);

    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    loadQueue.resolveOutcome(1, true);

    const result = await resultPromise;

    expect(result).toBe('loaded');
    expect(fetchMock).toHaveBeenCalledWith(DEMO.url, { signal: expect.any(AbortSignal) });
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(expect.any(File), 'default', {
      entry: DEMO,
      source: 'menu',
      requestId: expect.any(Number),
      replacesStoredImport: false,
    });
    expect(dataLoader.loadFromFile).toHaveBeenCalledWith(expect.any(File), { source: 'auto' });
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  // The bug this guards: loadFromFile never rejects on a parse error (it
  // dispatches data-error and resolves), so a naive "await then return true"
  // reports a corrupt bundle as a successful load. Driving the real
  // awaitLoadOutcome(false) — the same signal handleDataError sends — proves
  // the result is now the load's actual outcome, not a guess.
  it("resolves 'failed' and never sets name/id when the load reaches data-error (parse failure)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, setCurrentExampleId, setCurrentDatasetName, loadQueue } =
      createController();

    const resultPromise = controller.loadExampleDataset(DEMO, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    // Simulate handleDataError resolving this load's outcome as a failure.
    loadQueue.resolveOutcome(1, false);

    const result = await resultPromise;

    expect(result).toBe('failed');
    // persisted-dataset.ts itself never sets these for an example load — that
    // now happens only in dataset-controller's handleDataLoaded, on success.
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    // The parse-failure toast is handleDataError's job (kept as a single
    // toast); this layer must not add a second one.
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it("notifies, dismisses the overlay, and resolves 'failed' on an HTTP failure, without registering a load", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, overlayController, loadQueue } = createController();

    const result = await controller.loadExampleDataset(DEMO, 'menu');

    expect(result).toBe('failed');
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(overlayController.update).toHaveBeenCalledWith(false);
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
  });

  it("notifies and resolves 'failed' when the fetch itself rejects (network error)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { controller } = createController();

    const result = await controller.loadExampleDataset(DEMO, 'menu');

    expect(result).toBe('failed');
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });

  it('drops a superseded request: a slow fetch A resolves after a fast fetch B — only B loads', async () => {
    let resolveA: (value: {
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }) => void = () => {};
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === DEMO.url) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, loadQueue } = createController();

    // A (slow, demo) starts first but its fetch won't resolve yet.
    const resultA = controller.loadExampleDataset(DEMO, 'menu');
    // B (fast, other example) starts second and its fetch resolves immediately.
    const resultB = controller.loadExampleDataset(OTHER, 'menu');

    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    loadQueue.resolveOutcome(1, true);

    // Now let A's fetch resolve — it must see it's been superseded.
    resolveA({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });

    expect(await resultA).toBe('superseded');
    expect(await resultB).toBe('loaded');

    // Only B ever registered a load or reached the data loader.
    expect(loadQueue.registerFileLoad).toHaveBeenCalledTimes(1);
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(expect.any(File), 'default', {
      entry: OTHER,
      source: 'menu',
      requestId: expect.any(Number),
      replacesStoredImport: false,
    });
    expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1);
  });

  it('a superseded request never notifies or touches the overlay once its fetch settles', async () => {
    let resolveA: (value: {
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }) => void = () => {};
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === DEMO.url) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { controller, overlayController, dataLoader, loadQueue } = createController();

    const resultA = controller.loadExampleDataset(DEMO, 'menu');
    controller.loadExampleDataset(OTHER, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    loadQueue.resolveOutcome(1, true);

    overlayController.update.mockClear();
    // A's fetch rejects after being superseded — must not surface an error toast
    // or touch the overlay (B's overlay state must be left alone).
    resolveA(undefined as never);
    await expect(resultA).resolves.toBe('superseded');

    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(overlayController.update).not.toHaveBeenCalled();
  });
});

describe('loadExampleDatasetAndClearPersistedFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('warns and does nothing for an unknown id', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controller, dataLoader } = createController();

    const result = await controller.loadExampleDatasetAndClearPersistedFile(
      'not-a-real-id',
      'menu',
    );

    expect(result).toBe('failed');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not-a-real-id'));
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loads the requested example flagged to replace the stored import, without clearing it up front', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { clearLastImportedFile } = await import('./opfs-dataset-store');

    const { controller, dataLoader, loadQueue } = createController();

    const resultPromise = controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    loadQueue.resolveOutcome(1, true);

    expect(await resultPromise).toBe('loaded');
    // The clear happens in handleDataLoaded once the example has decoded
    // (covered end to end in example-dataset-load.test.ts), never before the
    // fetch — a failed download must not delete the import still on screen.
    expect(clearLastImportedFile).not.toHaveBeenCalled();
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(expect.any(File), 'default', {
      entry: OTHER,
      source: 'menu',
      requestId: expect.any(Number),
      replacesStoredImport: true,
    });
  });
});

describe('beginUserRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a pending example fetch and aborts its download (as a user import would)', async () => {
    const response = deferred<ReturnType<typeof okResponse>>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, loadQueue } = createController();

    const resultPromise = controller.loadExampleDataset(DEMO, 'menu');
    controller.beginUserRequest();
    expect(fetchSignal(fetchMock).aborted).toBe(true);
    response.resolve(okResponse());

    expect(await resultPromise).toBe('superseded');
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('an aborted download settles silently as superseded', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { controller, overlayController } = createController();

    const resultPromise = controller.loadExampleDataset(DEMO, 'menu');
    overlayController.update.mockClear();
    controller.beginUserRequest();

    expect(await resultPromise).toBe('superseded');
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(overlayController.update).not.toHaveBeenCalled();
  });
});

describe('request precedence: a user request beats a startup load that began earlier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the demo at startup when nothing preempts it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { controller, dataLoader, loadQueue } = createController();

    const startup = controller.loadPersistedOrDefaultDataset();
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    loadQueue.resolveOutcome(1, true);

    expect(await startup).toEqual({ kind: 'default-loaded' });
    expect(fetchMock).toHaveBeenCalledWith(DEMO.url, expect.anything());
  });

  it('a menu choice made while startup reads the stored import wins, and the import is not restored', async () => {
    const read = deferred<File | null>();
    vi.mocked(loadLastImportedFile).mockImplementationOnce(() => read.promise);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const { controller, dataLoader, loadQueue } = createController();

    const startup = controller.loadPersistedOrDefaultDataset();
    const click = controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    read.resolve(new File(['x'], 'mine.parquetbundle'));

    expect(await startup).toEqual({ kind: 'preempted' });
    loadQueue.resolveOutcome(1, true);
    expect(await click).toBe('loaded');
    // Only the click registered a load; the stored import was never marked
    // pending, read for its status, or restored over the click.
    expect(loadQueue.registerFileLoad).toHaveBeenCalledTimes(1);
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(
      expect.any(File),
      'default',
      expect.objectContaining({ entry: OTHER, source: 'menu' }),
    );
    expect(markLastLoadStatus).not.toHaveBeenCalled();
    expect(readLastLoadStatus).not.toHaveBeenCalled();
  });

  it('with no stored import, a menu choice made first is the only example fetched', async () => {
    const read = deferred<File | null>();
    vi.mocked(loadLastImportedFile).mockImplementationOnce(() => read.promise);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { controller, dataLoader, loadQueue } = createController();

    const startup = controller.loadPersistedOrDefaultDataset();
    const click = controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    read.resolve(null);

    expect(await startup).toEqual({ kind: 'preempted' });
    loadQueue.resolveOutcome(1, true);
    expect(await click).toBe('loaded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(OTHER.url, expect.anything());
  });

  it('a click during the stored-status read preempts the recovery banner', async () => {
    const status = deferred<{ status: 'error'; failedAttempts: number } | null>();
    vi.mocked(loadLastImportedFile).mockResolvedValueOnce(new File(['x'], 'mine.parquetbundle'));
    vi.mocked(readLastLoadStatus).mockImplementationOnce(() => status.promise as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const { controller, setCurrentDatasetName } = createController();

    const startup = controller.loadPersistedOrDefaultDataset();
    await vi.waitFor(() => expect(readLastLoadStatus).toHaveBeenCalled());
    void controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    status.resolve({ status: 'error', failedAttempts: 1 });

    expect(await startup).toEqual({ kind: 'preempted' });
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
  });

  it('a corrupt stored import found after a click is cleared without loading the demo', async () => {
    const read = deferred<File | null>();
    vi.mocked(loadLastImportedFile).mockImplementationOnce(() => read.promise);
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = createController();

    const startup = controller.loadPersistedOrDefaultDataset();
    void controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    read.reject(new StoredDatasetCorruptError('corrupt'));

    expect(await startup).toEqual({ kind: 'preempted' });
    errorSpy.mockRestore();
    expect(clearLastImportedFile).toHaveBeenCalledTimes(1);
    // No "loaded the default demo instead" notice for a load that never runs.
    expect(notifyMock.warning).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(OTHER.url, expect.anything());
  });

  it('recovery under a stale epoch only clears the store', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { controller } = createController();

    const restoreEpoch = controller.currentRequestEpoch();
    controller.beginUserRequest();

    expect(
      await controller.recoverFromCorruptedPersistedDataset('could not be loaded', restoreEpoch),
    ).toBe(false);
    expect(clearLastImportedFile).toHaveBeenCalledTimes(1);
    expect(notifyMock.warning).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recovery under the current epoch clears the store, says so, and loads the demo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { controller, dataLoader, loadQueue } = createController();

    const recovery = controller.recoverFromCorruptedPersistedDataset('could not be loaded');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    loadQueue.resolveOutcome(1, true);

    expect(await recovery).toBe(true);
    expect(clearLastImportedFile).toHaveBeenCalledTimes(1);
    expect(notifyMock.warning).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(DEMO.url, expect.anything());
  });

  it("the recovery banner's retry is a user request: it supersedes a pending example", async () => {
    const response = deferred<ReturnType<typeof okResponse>>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { controller, loadQueue } = createController();
    const file = new File(['x'], 'mine.parquetbundle');

    const pending = controller.loadExampleDataset(DEMO, 'url');
    await controller.tryLoadPersistedAgain(file);
    response.resolve(okResponse());

    expect(await pending).toBe('superseded');
    expect(fetchSignal(fetchMock).aborted).toBe(true);
    expect(markLastLoadStatus).toHaveBeenCalledWith('pending');
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(
      file,
      'opfs',
      undefined,
      controller.currentRequestEpoch(),
    );
  });
});

describe('cancelPendingExampleLoad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels a pending menu load: aborts the download, hides the overlay, and never registers a load', async () => {
    const response = deferred<ReturnType<typeof okResponse>>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { controller, overlayController, loadQueue } = createController();

    const pending = controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    overlayController.update.mockClear();

    expect(controller.cancelPendingExampleLoad({ source: 'menu' })).toBe(true);
    expect(fetchSignal(fetchMock).aborted).toBe(true);
    expect(overlayController.update).toHaveBeenCalledWith(false);
    response.resolve(okResponse());

    expect(await pending).toBe('superseded');
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('leaves a pending URL-driven load alone when asked to cancel only a menu load', async () => {
    const response = deferred<ReturnType<typeof okResponse>>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { controller, overlayController } = createController();

    void controller.loadExampleDataset(OTHER, 'url');
    overlayController.update.mockClear();

    expect(controller.cancelPendingExampleLoad({ source: 'menu' })).toBe(false);
    expect(fetchSignal(fetchMock).aborted).toBe(false);
    expect(overlayController.update).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is loading, or once the load has settled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }),
    );
    const { controller, overlayController } = createController();

    expect(controller.cancelPendingExampleLoad()).toBe(false);
    expect(await controller.loadExampleDataset(OTHER, 'menu')).toBe('failed');
    overlayController.update.mockClear();
    const epoch = controller.currentRequestEpoch();

    expect(controller.cancelPendingExampleLoad()).toBe(false);
    expect(controller.currentRequestEpoch()).toBe(epoch);
    expect(overlayController.update).not.toHaveBeenCalled();
  });
});
