import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DEMO, TEST_EXAMPLE } from './example-catalog.fixtures';
import { resolveExampleUrl } from './example-url';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: notifyMock,
}));

vi.mock('./example-datasets', async (importOriginal) =>
  (await import('./example-catalog.fixtures')).withTestCatalog(await importOriginal()),
);

vi.mock('./opfs-dataset-store', () => ({
  StoredDatasetCorruptError: class StoredDatasetCorruptError extends Error {},
  clearLastImportedFile: vi.fn().mockResolvedValue(undefined),
  loadLastImportedFile: vi.fn().mockResolvedValue(null),
  markLastLoadStatus: vi.fn().mockResolvedValue(undefined),
  readLastLoadStatus: vi.fn().mockResolvedValue(null),
  restoreLastLoadStatus: vi.fn().mockResolvedValue(undefined),
}));

import { createLoadQueue } from './load-queue';
import {
  StoredDatasetCorruptError,
  clearLastImportedFile,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
  restoreLastLoadStatus,
} from './opfs-dataset-store';
import { EXAMPLE_DOWNLOAD_SHARE } from './loading-overlay';
import { createPersistedDatasetController } from './persisted-dataset';

const DEMO = TEST_DEMO;
const OTHER = TEST_EXAMPLE;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** A bundle download that succeeds: four bytes, streamed as a real fetch's body is. */
const okResponse = () => new Response(new ArrayBuffer(4));

/** The `AbortSignal` the `index`-th fetch was started with. */
function fetchSignal(fetchMock: ReturnType<typeof vi.fn>, index = 0): AbortSignal {
  return (fetchMock.mock.calls[index]?.[1] as RequestInit).signal as AbortSignal;
}

function createController({
  retryUrlExample,
  onExampleLoadCancelled,
}: {
  retryUrlExample?: (id: string) => void;
  onExampleLoadCancelled?: (cancel: { epoch: number; source: string }) => void;
} = {}) {
  const dataLoader = { loadFromFile: vi.fn().mockResolvedValue(undefined) };
  const overlayController = { update: vi.fn(), setCancelHandler: vi.fn() };
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
    retryUrlExample,
    onExampleLoadCancelled,
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
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, overlayController, loadQueue } = createController();

    const resultPromise = controller.loadExampleDataset(DEMO, 'menu');
    // The overlay must appear before the fetch resolves, not after.
    expect(overlayController.update).toHaveBeenCalledWith(
      true,
      0,
      `Downloading ${DEMO.label}…`,
      `0.0 / ${(DEMO.sizeBytes / 1e6).toFixed(1)} MB`,
    );

    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    loadQueue.resolveOutcome(1, true);

    const result = await resultPromise;

    expect(result).toBe('loaded');
    // Rooted at the app base so /explore/ (trailing slash) still finds it.
    expect(fetchMock).toHaveBeenCalledWith('/data.parquetbundle', {
      signal: expect.any(AbortSignal),
    });
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(
      expect.any(File),
      'default',
      { entry: DEMO, source: 'menu', replacesStoredImport: false },
      expect.any(Number),
    );
    expect(dataLoader.loadFromFile).toHaveBeenCalledWith(expect.any(File), { source: 'auto' });
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  // The bug this guards: loadFromFile never rejects on a parse error (it
  // dispatches data-error and resolves), so a naive "await then return true"
  // reports a corrupt bundle as a successful load. Driving the real
  // awaitLoadOutcome(false) — the same signal handleDataError sends — proves
  // the result is now the load's actual outcome, not a guess.
  it("resolves 'failed' and never sets name/id when the load reaches data-error (parse failure)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
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
      headers: new Headers(),
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
    let resolveA: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === resolveExampleUrl(DEMO.url)) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve(okResponse());
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
    resolveA(okResponse());

    expect(await resultA).toBe('superseded');
    expect(await resultB).toBe('loaded');

    // Only B ever registered a load or reached the data loader.
    expect(loadQueue.registerFileLoad).toHaveBeenCalledTimes(1);
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(
      expect.any(File),
      'default',
      { entry: OTHER, source: 'menu', replacesStoredImport: false },
      expect.any(Number),
    );
    expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1);
  });

  it('a superseded request never notifies or touches the overlay once its fetch settles', async () => {
    let resolveA: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === resolveExampleUrl(DEMO.url)) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve(okResponse());
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

/** A streamed response whose body yields `chunkSizes` bytes, chunk by chunk, each filled with its index. */
function streamedResponse(chunkSizes: number[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      chunkSizes.forEach((size, index) =>
        streamController.enqueue(new Uint8Array(size).fill(index)),
      );
      streamController.close();
    },
  });
  return new Response(stream, { headers });
}

/** The download phase's overlay updates: `[progress, sub-message]`, while it downloads. */
function downloadUpdates(update: ReturnType<typeof vi.fn>): Array<[number, string]> {
  return update.mock.calls
    .filter(([show, , message]) => show === true && String(message).startsWith('Downloading '))
    .map(([, progress, , subMessage]) => [progress as number, subMessage as string]);
}

describe('example download progress', () => {
  const MB = 1_000_000;
  const DOWNLOAD_SHARE = EXAMPLE_DOWNLOAD_SHARE;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rises with the decoded bytes over the decoded size, never past it, despite a gzip-sized Content-Length', async () => {
    const entry = { ...OTHER, sizeBytes: 3 * MB };
    // Pages serves gzip: the header states the compressed size, well below
    // the 3 MB the stream yields. Measured against it, progress would pass 100 %.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(streamedResponse([MB, MB, MB], { 'content-length': String(2 * MB) })),
    );
    const { controller, dataLoader, overlayController, loadQueue } = createController();

    const result = controller.loadExampleDataset(entry, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    loadQueue.resolveOutcome(1, true);
    expect(await result).toBe('loaded');

    expect(downloadUpdates(overlayController.update)).toEqual([
      [0, '0.0 / 3.0 MB'],
      [(1 / 3) * DOWNLOAD_SHARE, '1.0 / 3.0 MB'],
      [(2 / 3) * DOWNLOAD_SHARE, '2.0 / 3.0 MB'],
      [DOWNLOAD_SHARE, '3.0 / 3.0 MB'],
    ]);
  });

  it('stays capped when the body outgrows the recorded size', async () => {
    const entry = { ...OTHER, sizeBytes: 2 * MB };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamedResponse([MB, MB, MB])));
    const { controller, dataLoader, overlayController, loadQueue } = createController();

    const result = controller.loadExampleDataset(entry, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    loadQueue.resolveOutcome(1, true);
    await result;

    const updates = downloadUpdates(overlayController.update);
    expect(Math.max(...updates.map(([progress]) => progress))).toBe(DOWNLOAD_SHARE);
    expect(updates[updates.length - 1]).toEqual([DOWNLOAD_SHARE, '2.0 / 2.0 MB']);
  });

  it('is aborted mid-stream by a newer request, and settles as superseded without another update', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new Uint8Array(MB));
          init.signal?.addEventListener('abort', () =>
            streamController.error(new DOMException('The operation was aborted.', 'AbortError')),
          );
        },
      });
      return Promise.resolve(new Response(body));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { controller, dataLoader, overlayController } = createController();

    const result = controller.loadExampleDataset({ ...OTHER, sizeBytes: 2 * MB }, 'menu');
    await vi.waitFor(() =>
      expect(downloadUpdates(overlayController.update)).toEqual([
        [0, '0.0 / 2.0 MB'],
        [DOWNLOAD_SHARE / 2, '1.0 / 2.0 MB'],
      ]),
    );
    overlayController.update.mockClear();
    controller.beginUserRequest();

    expect(await result).toBe('superseded');
    expect(fetchSignal(fetchMock).aborted).toBe(true);
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
    expect(overlayController.update).not.toHaveBeenCalled();
    expect(notifyMock.error).not.toHaveBeenCalled();
  });

  it('loads a File built from every streamed chunk', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamedResponse([3, 2])));
    const { controller, dataLoader, loadQueue } = createController();

    const result = controller.loadExampleDataset(OTHER, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    loadQueue.resolveOutcome(1, true);
    await result;

    const file = dataLoader.loadFromFile.mock.calls[0]?.[0] as File;
    expect(file.name).toBe(OTHER.url.split('/').pop());
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 0, 0, 1, 1]);
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
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
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
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(
      expect.any(File),
      'default',
      { entry: OTHER, source: 'menu', replacesStoredImport: true },
      expect.any(Number),
    );
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
    expect(fetchMock).toHaveBeenCalledWith(resolveExampleUrl(DEMO.url), expect.anything());
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
      expect.any(Number),
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
    expect(fetchMock).toHaveBeenCalledWith(resolveExampleUrl(OTHER.url), expect.anything());
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
    expect(fetchMock).toHaveBeenCalledWith(resolveExampleUrl(OTHER.url), expect.anything());
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
    expect(fetchMock).toHaveBeenCalledWith(resolveExampleUrl(DEMO.url), expect.anything());
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

    expect(controller.cancelPendingExampleLoad({ source: 'menu' })).toBe('cancelled');
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

    expect(controller.cancelPendingExampleLoad({ source: 'menu' })).toBe('none');
    expect(fetchSignal(fetchMock).aborted).toBe(false);
    expect(overlayController.update).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is loading, or once the load has settled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        headers: new Headers(),
        status: 500,
        statusText: 'Server Error',
      }),
    );
    const { controller, overlayController } = createController();

    expect(controller.cancelPendingExampleLoad()).toBe('none');
    expect(await controller.loadExampleDataset(OTHER, 'menu')).toBe('failed');
    overlayController.update.mockClear();
    const epoch = controller.currentRequestEpoch();

    expect(controller.cancelPendingExampleLoad()).toBe('none');
    expect(controller.currentRequestEpoch()).toBe(epoch);
    expect(overlayController.update).not.toHaveBeenCalled();
  });
});

/** The handler of the overlay's Cancel button as last set, or null when there is none. */
function cancelButtonHandler(setCancelHandler: ReturnType<typeof vi.fn>): (() => void) | null {
  const calls = setCancelHandler.mock.calls;
  return (calls[calls.length - 1]?.[0] as (() => void) | null | undefined) ?? null;
}

describe('the Cancel button of an example download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A fetch that never answers, and rejects like a real one once its signal aborts. */
  const pendingFetch = () =>
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );

  it('is offered while a menu or URL download runs, labelled "Cancel download"', () => {
    vi.stubGlobal('fetch', pendingFetch());
    const { controller, overlayController } = createController();

    void controller.loadExampleDataset(OTHER, 'menu');
    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(
      expect.any(Function),
      'Cancel download',
    );

    void controller.loadExampleDataset(OTHER, 'url');
    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(
      expect.any(Function),
      'Cancel download',
    );
  });

  it('is not offered for the startup demo, which is what a cancel would fall back to', async () => {
    vi.stubGlobal('fetch', pendingFetch());
    const { controller, overlayController } = createController();

    void controller.loadPersistedOrDefaultDataset();
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(resolveExampleUrl(DEMO.url), expect.anything()),
    );

    expect(overlayController.setCancelHandler).not.toHaveBeenCalled();
  });

  it('aborts the download, hides the overlay, never loads or notifies, and reports the cancel', async () => {
    const fetchMock = pendingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onExampleLoadCancelled = vi.fn();
    const { controller, overlayController, loadQueue } = createController({
      onExampleLoadCancelled,
    });

    const result = controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    const cancel = cancelButtonHandler(overlayController.setCancelHandler);
    const epochBefore = controller.currentRequestEpoch();
    overlayController.update.mockClear();

    cancel?.();

    // A user request: it takes a new epoch, which the caller is told about.
    expect(controller.currentRequestEpoch()).toBe(epochBefore + 1);
    expect(fetchSignal(fetchMock).aborted).toBe(true);
    expect(overlayController.update).toHaveBeenCalledWith(false);
    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(null);
    expect(onExampleLoadCancelled).toHaveBeenCalledWith({
      epoch: epochBefore + 1,
      source: 'menu',
    });
    expect(await result).toBe('superseded');
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(notifyMock.warning).not.toHaveBeenCalled();
  });

  it('reports how the cancelled load began', async () => {
    vi.stubGlobal('fetch', pendingFetch());
    const onExampleLoadCancelled = vi.fn();
    const { controller, overlayController } = createController({ onExampleLoadCancelled });

    const result = controller.loadExampleDataset(OTHER, 'url');
    cancelButtonHandler(overlayController.setCancelHandler)?.();

    expect(onExampleLoadCancelled).toHaveBeenCalledWith(expect.objectContaining({ source: 'url' }));
    expect(await result).toBe('superseded');
  });

  it('goes as soon as decoding starts, before the load is registered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const { controller, dataLoader, overlayController, loadQueue } = createController();

    const result = controller.loadExampleDataset(OTHER, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());

    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(null);
    const cancelCalls = overlayController.setCancelHandler.mock.invocationCallOrder;
    const withdrawn = cancelCalls[cancelCalls.length - 1]!;
    expect(withdrawn).toBeLessThan(loadQueue.registerFileLoad.mock.invocationCallOrder[0]!);
    loadQueue.resolveOutcome(1, true);
    await result;
  });

  it('goes when the download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        headers: new Headers(),
        status: 500,
        statusText: 'Server Error',
      }),
    );
    const { controller, overlayController } = createController();

    expect(await controller.loadExampleDataset(OTHER, 'menu')).toBe('failed');
    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(null);
  });

  it('goes when a newer user request supersedes the download, and the stale button does nothing', async () => {
    const fetchMock = pendingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const onExampleLoadCancelled = vi.fn();
    const { controller, overlayController } = createController({ onExampleLoadCancelled });

    const result = controller.loadExampleDataset(OTHER, 'menu');
    const staleCancel = cancelButtonHandler(overlayController.setCancelHandler);
    const epoch = controller.beginUserRequest();

    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(null);
    expect(await result).toBe('superseded');
    staleCancel?.();
    expect(controller.currentRequestEpoch()).toBe(epoch);
    expect(onExampleLoadCancelled).not.toHaveBeenCalled();
  });

  it("never removes a newer download's button", async () => {
    vi.stubGlobal('fetch', pendingFetch());
    const { controller, overlayController } = createController();

    const first = controller.loadExampleDataset(OTHER, 'menu');
    void controller.loadExampleDataset(DEMO, 'menu');
    const newerCancel = cancelButtonHandler(overlayController.setCancelHandler);
    expect(newerCancel).not.toBeNull();

    // The first download settles as superseded after the second offered Cancel.
    expect(await first).toBe('superseded');
    expect(cancelButtonHandler(overlayController.setCancelHandler)).toBe(newerCancel);
  });
});

describe('Retry on a failed example download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const failThenSucceed = () =>
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        headers: new Headers(),
        status: 500,
        statusText: 'Server Error',
      })
      .mockResolvedValue(okResponse());

  /** The Retry action of the most recent error toast. */
  const retryAction = () => {
    const { calls } = notifyMock.error.mock;
    const options = calls[calls.length - 1]?.[0] as {
      action: { label: string; onClick: () => void };
      secondaryAction: { label: string };
    };
    expect(options.action.label).toBe('Retry');
    expect(options.secondaryAction.label).toBe('Report this');
    return options.action.onClick;
  };

  it('repeats a failed menu choice as it was, replacing the stored import', async () => {
    const fetchMock = failThenSucceed();
    vi.stubGlobal('fetch', fetchMock);
    const { controller, dataLoader, loadQueue } = createController();

    expect(await controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu')).toBe(
      'failed',
    );
    retryAction()();
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(
      expect.any(File),
      'default',
      expect.objectContaining({ entry: OTHER, source: 'menu', replacesStoredImport: true }),
      expect.any(Number),
    );
  });

  it('hands a failed URL-driven load back to the URL sync hook', async () => {
    const fetchMock = failThenSucceed();
    vi.stubGlobal('fetch', fetchMock);
    const retryUrlExample = vi.fn();
    const { controller } = createController({ retryUrlExample });

    expect(await controller.loadExampleDataset(OTHER, 'url')).toBe('failed');
    retryAction()();

    expect(retryUrlExample).toHaveBeenCalledWith(OTHER.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('an example that has begun replacing the plot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('can no longer be cancelled once committed, but a newer user request still supersedes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const { controller, dataLoader, loadQueue, overlayController } = createController();

    const result = controller.loadExampleDatasetAndClearPersistedFile(OTHER.id, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    const loadEpoch = loadQueue.registerFileLoad.mock.calls[0]![3] as number;
    // Still decoding: a Back/Forward cancels it.
    expect(controller.isCurrentRequest(loadEpoch)).toBe(true);

    controller.commitExampleLoad(loadEpoch);
    const epoch = controller.currentRequestEpoch();
    overlayController.update.mockClear();

    expect(controller.cancelPendingExampleLoad({ source: 'menu' })).toBe('committed');
    expect(controller.currentRequestEpoch()).toBe(epoch);
    expect(overlayController.update).not.toHaveBeenCalled();

    loadQueue.resolveOutcome(1, true);
    expect(await result).toBe('loaded');
    // Settled: nothing is left to cancel.
    expect(controller.cancelPendingExampleLoad()).toBe('none');
  });

  it("ignores a commit for another request's load", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const { controller, dataLoader, loadQueue } = createController();

    const result = controller.loadExampleDataset(OTHER, 'menu');
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalled());
    controller.commitExampleLoad(-1);

    expect(controller.cancelPendingExampleLoad()).toBe('cancelled');
    loadQueue.resolveOutcome(1, true);
    expect(await result).toBe('superseded');
  });
});

describe("a user import's preparation step (a FASTA upload)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers the overlay's Cancel, which aborts it", () => {
    const { controller, overlayController } = createController();

    const preparation = controller.beginImportPreparation(controller.beginUserRequest());
    expect(preparation.isCurrent()).toBe(true);
    cancelButtonHandler(overlayController.setCancelHandler)?.();

    expect(preparation.signal.aborted).toBe(true);
    // A user's own cancel is not a new request: the import still owns the screen.
    expect(preparation.isCurrent()).toBe(true);
  });

  it('is aborted by the next user request, which takes its Cancel button over', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const { controller, overlayController } = createController();

    const preparation = controller.beginImportPreparation(controller.beginUserRequest());
    void controller.loadExampleDataset(OTHER, 'url');

    expect(preparation.signal.aborted).toBe(true);
    expect(preparation.isCurrent()).toBe(false);
    const exampleCancel = cancelButtonHandler(overlayController.setCancelHandler);
    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(
      expect.any(Function),
      'Cancel download',
    );

    // Settling later never removes the example's button.
    preparation.settle();
    expect(cancelButtonHandler(overlayController.setCancelHandler)).toBe(exampleCancel);
  });

  it('settles by removing its own Cancel button', () => {
    const { controller, overlayController } = createController();

    const preparation = controller.beginImportPreparation(controller.beginUserRequest());
    preparation.settle();

    expect(overlayController.setCancelHandler).toHaveBeenLastCalledWith(null);
    // The next user request has nothing left to abort.
    controller.beginUserRequest();
    expect(preparation.signal.aborted).toBe(false);
  });

  it('starts aborted, with no Cancel button, when its import is already superseded', () => {
    const { controller, overlayController } = createController();

    const epoch = controller.beginUserRequest();
    controller.beginUserRequest();
    const preparation = controller.beginImportPreparation(epoch);

    expect(preparation.signal.aborted).toBe(true);
    expect(preparation.isCurrent()).toBe(false);
    expect(overlayController.setCancelHandler).not.toHaveBeenCalled();
  });
});

describe('the startup restore and the requests that supersede it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the previous status back when preempted while marking the load pending', async () => {
    const previous = { status: 'success' as const, failedAttempts: 0 };
    const marking = deferred<void>();
    vi.mocked(loadLastImportedFile).mockResolvedValueOnce(new File(['x'], 'mine.parquetbundle'));
    vi.mocked(readLastLoadStatus).mockResolvedValueOnce(previous);
    vi.mocked(markLastLoadStatus).mockImplementationOnce(() => marking.promise);
    const { controller, dataLoader, loadQueue } = createController();

    const startup = controller.loadPersistedOrDefaultDataset();
    await vi.waitFor(() => expect(markLastLoadStatus).toHaveBeenCalledWith('pending'));
    controller.beginUserRequest();
    marking.resolve();

    expect(await startup).toEqual({ kind: 'preempted' });
    expect(restoreLastLoadStatus).toHaveBeenCalledWith(previous);
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
  });

  it('waits for a superseded restore still in flight before reading the stored status', async () => {
    const file = new File(['x'], 'mine.parquetbundle');
    vi.mocked(loadLastImportedFile).mockResolvedValue(file);
    vi.mocked(readLastLoadStatus).mockResolvedValue({ status: 'success', failedAttempts: 0 });
    const { controller, dataLoader } = createController();
    const firstLoad = deferred<void>();
    dataLoader.loadFromFile.mockImplementationOnce(() => firstLoad.promise);

    void controller.loadPersistedOrDefaultDataset();
    await vi.waitFor(() => expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(1));
    // A Back/Forward (to an example that then fails, say) runs the startup
    // load again under its own epoch while the first restore still decodes.
    const epoch = controller.beginUserRequest();
    const fallback = controller.loadPersistedOrDefaultDataset({ epoch });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadLastImportedFile).toHaveBeenCalledTimes(1);

    // The superseded restore settles (handleDataLoaded skipped it and recorded
    // its success), and only then is the stored status read again.
    firstLoad.resolve();
    expect(await fallback).toEqual({ kind: 'auto-loaded' });
    expect(loadLastImportedFile).toHaveBeenCalledTimes(2);
    expect(dataLoader.loadFromFile).toHaveBeenCalledTimes(2);
    vi.mocked(loadLastImportedFile).mockReset().mockResolvedValue(null);
    vi.mocked(readLastLoadStatus).mockReset().mockResolvedValue(null);
  });

  it('reports a failed startup demo as default-failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        headers: new Headers(),
        status: 500,
        statusText: 'Server Error',
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = createController();

    expect(await controller.loadPersistedOrDefaultDataset()).toEqual({ kind: 'default-failed' });
    errorSpy.mockRestore();
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
  });
});

// Ported from main's (#478) `loadDefaultDataset` test: the startup demo is now
// `loadExampleDataset(DEFAULT_EXAMPLE_DATASET, 'startup')`, reached through
// `loadPersistedOrDefaultDataset` when there is no stored import.
describe('startup demo when its bundle cannot be fetched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the current dataset as it was and tells the user', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller, dataLoader, loadQueue, setCurrentExampleId, setCurrentDatasetName } =
      createController();

    const outcome = await controller.loadPersistedOrDefaultDataset();

    expect(outcome).toEqual({ kind: 'default-failed' });
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/data.parquetbundle', expect.anything());
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(notifyMock.error.mock.calls[0]?.[0]).toMatchObject({
      title: `Couldn't load "${DEMO.label}".`,
      description: expect.stringContaining('404'),
    });
    errorSpy.mockRestore();
  });
});
