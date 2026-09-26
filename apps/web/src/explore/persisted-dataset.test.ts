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

import { createPersistedDatasetController } from './persisted-dataset';

const DEMO = EXAMPLE_DATASETS[0];
const OTHER = EXAMPLE_DATASETS[1];

/**
 * A fake load queue's registerFileLoad/awaitLoadOutcome pair, wired the way
 * dataset-controller.ts wires the real load-queue.ts: each registered file
 * gets an incrementing sequence, and its outcome is whatever the test tells
 * `resolveOutcome` to settle it as (mirroring handleDataLoaded resolving
 * `true`, handleDataError resolving `false`).
 */
function createFakeLoadQueue() {
  let sequence = 0;
  const outcomes = new Map<number, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();

  const registerFileLoad = vi.fn((_file: File, kind: string, example?: unknown) => {
    sequence += 1;
    const meta = { sequence, kind, example };
    let resolve: (v: boolean) => void = () => {};
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    outcomes.set(sequence, { promise, resolve });
    return meta;
  });

  const awaitLoadOutcome = vi.fn((seq: number) => outcomes.get(seq)!.promise);

  const resolveOutcome = (seq: number, success: boolean) => outcomes.get(seq)!.resolve(success);

  return { registerFileLoad, awaitLoadOutcome, resolveOutcome };
}

function createController() {
  const dataLoader = { loadFromFile: vi.fn().mockResolvedValue(undefined) };
  const overlayController = { update: vi.fn() };
  const setCurrentExampleId = vi.fn();
  const setCurrentDatasetName = vi.fn();
  const loadQueue = createFakeLoadQueue();

  const controller = createPersistedDatasetController({
    dataLoader: dataLoader as never,
    overlayController,
    registerFileLoad: loadQueue.registerFileLoad as never,
    awaitLoadOutcome: loadQueue.awaitLoadOutcome,
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
    expect(fetchMock).toHaveBeenCalledWith(DEMO.url);
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(expect.any(File), 'default', {
      entry: DEMO,
      source: 'menu',
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

  it('clears the persisted file and loads the requested example', async () => {
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
    expect(clearLastImportedFile).toHaveBeenCalled();
    expect(loadQueue.registerFileLoad).toHaveBeenCalledWith(expect.any(File), 'default', {
      entry: OTHER,
      source: 'menu',
    });
  });
});

describe('supersedePendingExampleFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a pending example fetch once called directly (as a user import or OPFS load would trigger)', async () => {
    let resolveFetch: (value: {
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { controller, dataLoader, loadQueue } = createController();

    const resultPromise = controller.loadExampleDataset(DEMO, 'menu');
    controller.supersedePendingExampleFetch();
    resolveFetch({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });

    expect(await resultPromise).toBe('superseded');
    expect(loadQueue.registerFileLoad).not.toHaveBeenCalled();
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
  });
});
