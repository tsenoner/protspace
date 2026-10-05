import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildControllerOptions,
  dataErrorEvent,
  dataLoadedEvent,
} from './dataset-controller.fixtures';
import { EXAMPLE_DATASETS } from './example-datasets';
import { FastaPrepError } from './fasta-prep-client';
import { createLoadQueue } from './load-queue';
import type { LoadMeta } from './types';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  beginSaveImportedFile: vi.fn(),
  commitSave: vi.fn(),
  abortSave: vi.fn(),
  clearLastImportedFile: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
  clearCorruptedPersistedDataset: vi.fn(),
  recoverFromCorruptedPersistedDataset: vi.fn(),
  isCurrentRequest: vi.fn(() => true),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./data-renderer', () => ({
  createDataRenderer: () => mocks.loadData,
}));

vi.mock('./persisted-dataset', () => ({
  createPersistedDatasetController: () => ({
    beginUserRequest: vi.fn(() => 1),
    beginImportPreparation: vi.fn(),
    cancelPendingExampleLoad: vi.fn(() => 'none'),
    clearCorruptedPersistedDataset: mocks.clearCorruptedPersistedDataset,
    commitExampleLoad: vi.fn(),
    currentRequestEpoch: vi.fn(() => 0),
    isCurrentRequest: mocks.isCurrentRequest,
    loadExampleDataset: vi.fn(),
    loadPersistedOrDefaultDataset: vi.fn(),
    loadExampleDatasetAndClearPersistedFile: vi.fn(),
    recoverFromCorruptedPersistedDataset: mocks.recoverFromCorruptedPersistedDataset,
    tryLoadPersistedAgain: vi.fn(),
  }),
}));

vi.mock('./opfs-dataset-store', () => ({
  markLastLoadStatus: mocks.markLastLoadStatus,
  beginSaveImportedFile: mocks.beginSaveImportedFile,
  clearLastImportedFile: mocks.clearLastImportedFile,
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: (): string[] => [],
  writeTooltipAnnotations: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: { warning: mocks.warning, info: mocks.info, error: mocks.error },
}));

import { createDatasetController } from './dataset-controller';

const file = new File(['bundle'], 'import.parquetbundle');

/**
 * A controller whose queue runs `loadMeta`'s load (`runningLoadMeta` when given,
 * e.g. a newer one that makes `loadMeta`'s result stale) and has registered loads
 * up to `latestSequence`.
 */
function buildController(
  loadMeta: LoadMeta = { sequence: 3, kind: 'user' },
  {
    runningLoadMeta = loadMeta,
    latestSequence = 3,
  }: { runningLoadMeta?: LoadMeta | null; latestSequence?: number } = {},
) {
  const options = buildControllerOptions({
    loadQueue: {
      getLoadMetaForFile: () => loadMeta,
      getRunningLoadMeta: () => runningLoadMeta,
      getLatestSequence: () => latestSequence,
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
    },
  });

  return {
    controller: createDatasetController(options),
    options,
    overlayUpdate: options.overlayController.update,
  };
}

const loadedEvent = dataLoadedEvent({ settings: null, source: 'user', file });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markLastLoadStatus.mockResolvedValue(undefined);
  mocks.commitSave.mockResolvedValue(undefined);
  mocks.abortSave.mockResolvedValue(undefined);
  mocks.beginSaveImportedFile.mockReturnValue({
    commit: mocks.commitSave,
    abort: mocks.abortSave,
  });
  mocks.loadData.mockResolvedValue(undefined);
  // `clearAllMocks` keeps implementations, and a test may leave this returning false.
  mocks.isCurrentRequest.mockReturnValue(true);
});

describe('dataset controller OPFS persistence', () => {
  /** Drain the microtask queue so every already-resolved await has run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('stores the imported bytes before the render starts', async () => {
    let finishSave = () => {};
    mocks.commitSave.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = () => resolve();
        }),
    );

    const { controller } = buildController();
    const pending = controller.handleDataLoaded(loadedEvent);
    await flush();

    // The recovery banner offers the file again after a crash during the render, so the
    // bytes must already be in OPFS when the render begins.
    expect(mocks.beginSaveImportedFile).toHaveBeenCalledWith(file);
    expect(mocks.commitSave).toHaveBeenCalledOnce();
    expect(mocks.loadData).not.toHaveBeenCalled();

    finishSave();
    await pending;

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
  });

  it('warns and still renders when the bytes cannot be stored', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.commitSave.mockRejectedValue(new Error('quota exceeded'));

    const { controller } = buildController();
    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
    consoleError.mockRestore();
  });
});

describe('dataset controller OPFS copy during the load', () => {
  it('starts the copy with the load and keeps it once the file loads', async () => {
    const { controller } = buildController();
    let loaded: Promise<void> = Promise.resolve();
    await controller.saveWhileLoading(file, async () => {
      expect(mocks.beginSaveImportedFile).toHaveBeenCalledWith(file);
      loaded = controller.handleDataLoaded(loadedEvent);
    });
    await loaded;

    expect(mocks.beginSaveImportedFile).toHaveBeenCalledOnce();
    expect(mocks.commitSave).toHaveBeenCalledOnce();
    expect(mocks.abortSave).not.toHaveBeenCalled();
  });

  it('drops the copy when the file fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = buildController();
    await controller.saveWhileLoading(file, async () => {
      void controller.handleDataError(dataErrorEvent('bad bundle'));
    });

    expect(mocks.abortSave).toHaveBeenCalledOnce();
    expect(mocks.commitSave).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('drops a copy that no load result took', async () => {
    const { controller } = buildController();
    await controller.saveWhileLoading(file, async () => {});

    expect(mocks.abortSave).toHaveBeenCalledOnce();
    expect(mocks.commitSave).not.toHaveBeenCalled();
  });

  it('drops the copy of an import a newer request superseded', async () => {
    mocks.isCurrentRequest.mockReturnValue(false);
    const { controller } = buildController({ sequence: 3, kind: 'user', epoch: 1 });
    let loaded: Promise<void> = Promise.resolve();
    await controller.saveWhileLoading(file, async () => {
      loaded = controller.handleDataLoaded(loadedEvent);
    });
    await loaded;

    expect(mocks.abortSave).toHaveBeenCalledOnce();
    expect(mocks.commitSave).not.toHaveBeenCalled();
  });

  it('copies nothing for a load that is not a user import', async () => {
    const { controller } = buildController({ sequence: 3, kind: 'default' });
    await controller.saveWhileLoading(file, async () => {});

    expect(mocks.beginSaveImportedFile).not.toHaveBeenCalled();
  });
});

describe('dataset controller load failures and the stored import', () => {
  beforeEach(() => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  // A user import is written to OPFS only once it has decoded (`handleDataLoaded`
  // saves it before the render), so one that fails before that never replaced the
  // stored import: what OPFS holds is still the previous import, which loaded fine.
  it('a user import that fails to decode leaves the stored import as it was', async () => {
    // This is also how a FASTA import ends whose prepared bundle fails to decode:
    // the error comes while its load is still running, like a bundle's.
    const { controller } = buildController({ sequence: 3, kind: 'user', epoch: 1 });

    await controller.handleDataError(dataErrorEvent('Invalid parquet bundle'));

    // Flagging the stored import would make the next visit offer recovery for a
    // dataset that loads fine, instead of restoring it.
    expect(mocks.markLastLoadStatus).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
  });

  it('a FASTA import whose preparation fails leaves the stored import as it was', async () => {
    const loadQueue = createLoadQueue({ isDisposed: () => false });
    const controller = createDatasetController(buildControllerOptions({ loadQueue }));
    const fasta = new File(['>P1\nMKV\n'], 'query.fasta');
    loadQueue.registerFileLoad(fasta, 'user', undefined, 1);
    const prepError = new FastaPrepError('The embedding service is currently unavailable.', {
      code: 'BIOCENTRAL_UNAVAILABLE',
    });

    // The preparation runs inside the load's queue slot (`runtime.ts`), so its
    // error ends that slot before the data loader reports it: as in
    // `DataLoader.loadFromFile`, the error event follows the rejected load.
    // With nothing queued behind it, no load is running by then; a load queued
    // behind it would already have taken the slot.
    let runningLoadAtError: LoadMeta | null | undefined;
    await loadQueue
      .enqueueLoadFromFile(fasta, undefined, () => Promise.reject(prepError))
      .catch(async (error: Error) => {
        runningLoadAtError = loadQueue.getRunningLoadMeta();
        await controller.handleDataError(dataErrorEvent(error.message, { originalError: error }));
      });

    expect(runningLoadAtError).toBeNull();
    expect(mocks.markLastLoadStatus).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('a user import that decoded but failed to render stays stored as unfinished', async () => {
    // Saved before its render, the new import has replaced the old one in OPFS, so
    // it is the one the next visit must offer to recover: it keeps the 'pending'
    // status the save wrote, never 'success'.
    mocks.loadData.mockRejectedValue(new Error('WebGL context lost'));
    const { controller } = buildController({ sequence: 3, kind: 'user', epoch: 1 });

    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.beginSaveImportedFile).toHaveBeenCalledWith(file);
    expect(mocks.commitSave).toHaveBeenCalledOnce();
    expect(mocks.markLastLoadStatus).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
  });
});

describe('dataset controller legacy bundle notice', () => {
  const eventFor = (bundleFormatVersion: number | undefined, unplacedProteinCount?: number) =>
    dataLoadedEvent({
      settings: null,
      source: 'user',
      file,
      bundleFormatVersion,
      unplacedProteinCount,
    });

  it('points a user who imported a v2 bundle to re-export and protspace convert', async () => {
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(2));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledOnce();
    const [notice] = mocks.info.mock.calls[0];
    expect(notice.description).toMatch(/5\.0\.0/);
    expect(notice.description).toMatch(/export it again/);
    expect(notice.description).toMatch(/protspace convert/);
  });

  it('sends a v2 bundle holding proteins without coordinates to protspace convert only', async () => {
    // An export from the app holds the proteins it shows, so it would drop these three.
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(2, 3));

    const [notice] = mocks.info.mock.calls[0];
    expect(notice.description).toMatch(/protspace convert/);
    expect(notice.description).toMatch(/3 proteins without coordinates/);
    expect(notice.description).toMatch(/an export from here leaves out/);
    expect(notice.description).not.toMatch(/export it again/);
    expect(controller.getUnplacedProteinCount()).toBe(3);
  });

  it('remembers how many proteins each loaded file holds without coordinates', async () => {
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(3, 2));
    expect(controller.getUnplacedProteinCount()).toBe(2);
    await controller.handleDataLoaded(eventFor(3));
    expect(controller.getUnplacedProteinCount()).toBe(0);
  });

  it.each([
    ['a v3 bundle', 3],
    ['a plain parquet file', undefined],
  ])('stays quiet for %s', async (_label, version) => {
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(version));

    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('stays quiet for a dataset the app serves itself, even a legacy one', async () => {
    const { controller } = buildController({ sequence: 3, kind: 'default' });
    await controller.handleDataLoaded(eventFor(1));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('stays quiet for an example chosen from the menu, even a legacy one', async () => {
    // An example load is 'default' kind and carries its catalog entry; a visitor cannot
    // convert a file the app serves, so its format is never theirs to fix.
    const { controller } = buildController({
      sequence: 3,
      kind: 'default',
      epoch: 1,
      example: { entry: EXAMPLE_DATASETS[1], source: 'menu', replacesStoredImport: true },
    });
    await controller.handleDataLoaded(eventFor(2));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
  });
});

describe('dataset controller load errors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // Restore even when an assertion fails, so a red row cannot silence later tests' console.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['an aborted load as a cancellation', new DOMException('Aborted', 'AbortError'), false],
    ['any other error as a failure', new Error('boom'), true],
    ['a missing original error as a failure', undefined, true],
  ])('treats %s', async (_label, originalError: Error | undefined, notified) => {
    const { controller } = buildController();
    await controller.handleDataError(dataErrorEvent('load failed', { originalError }));

    expect(mocks.error).toHaveBeenCalledTimes(notified ? 1 : 0);
  });
});

describe('dataset controller loading overlay', () => {
  // The controller, not the renderer, takes the overlay down: once the whole load has
  // settled, and only for the load that owns it.
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Drain the microtask queue so every already-resolved await has run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const opfsRestore: LoadMeta = { sequence: 3, kind: 'opfs', epoch: 1 };
  const lastCall = (fn: { mock: { invocationCallOrder: number[] } }) =>
    fn.mock.invocationCallOrder[fn.mock.invocationCallOrder.length - 1];

  /** A promise and the function that resolves it. */
  const deferred = () => {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = () => done();
    });
    return { promise, resolve };
  };

  it('stays up through the render and the post-load work, and is dismissed before the next load may start', async () => {
    const render = deferred();
    const status = deferred();
    mocks.loadData.mockReturnValue(render.promise);
    mocks.markLastLoadStatus.mockReturnValue(status.promise);
    const { controller, overlayUpdate, options } = buildController();
    const pending = controller.handleDataLoaded(loadedEvent);

    // A small dataset used to lose its overlay here, before anything was drawn.
    await flush();
    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(overlayUpdate).not.toHaveBeenCalledWith(false);

    render.resolve();
    await flush();
    expect(options.viewController.applyLatestViewForDatasetLoad).toHaveBeenCalledOnce();
    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(overlayUpdate).not.toHaveBeenCalledWith(false);

    status.resolve();
    await pending;
    expect(overlayUpdate).toHaveBeenLastCalledWith(false);
    expect(lastCall(overlayUpdate)).toBeLessThan(
      mocks.resolvePendingLoadFinalization.mock.invocationCallOrder[0],
    );
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
  });

  it('is dismissed when the render returns nothing', async () => {
    mocks.loadData.mockResolvedValue(null);
    const { controller, overlayUpdate } = buildController({ sequence: 3, kind: 'default' });
    await controller.handleDataLoaded(dataLoadedEvent());

    expect(overlayUpdate).toHaveBeenLastCalledWith(false);
  });

  it('is dismissed when the post-load work throws', async () => {
    mocks.loadData.mockRejectedValue(new Error('render failed'));
    const { controller, overlayUpdate } = buildController();
    await controller.handleDataLoaded(loadedEvent);

    // The import showed "Saving imported dataset..."; it must not stay up.
    expect(overlayUpdate).toHaveBeenLastCalledWith(false);
    expect(lastCall(overlayUpdate)).toBeLessThan(
      mocks.resolvePendingLoadFinalization.mock.invocationCallOrder[0],
    );
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
  });

  it('is dismissed when the load fails before its ownership is known', async () => {
    const options = buildControllerOptions({
      loadQueue: {
        getLoadMetaForFile: (): LoadMeta => {
          throw new Error('queue bookkeeping failed');
        },
      },
    });
    await createDatasetController(options).handleDataLoaded(loadedEvent);

    expect(options.overlayController.update).toHaveBeenLastCalledWith(false);
  });

  it('is left to the running load when a stale result arrives', async () => {
    // The file belongs to load 3, but load 4 is running and owns the overlay.
    const { controller, overlayUpdate } = buildController(
      { sequence: 3, kind: 'user' },
      { runningLoadMeta: { sequence: 4, kind: 'user' } },
    );
    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(overlayUpdate).not.toHaveBeenCalled();
  });

  it('is left to the newer request when the load was superseded before it rendered', async () => {
    // A newer user request (an example still downloading, say) shows its own progress.
    mocks.isCurrentRequest.mockReturnValue(false);
    const { controller, overlayUpdate } = buildController({ sequence: 3, kind: 'user', epoch: 1 });
    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(overlayUpdate).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
  });

  it('is left to the newer request when the load is superseded while it renders', async () => {
    mocks.loadData.mockImplementation(async () => {
      mocks.isCurrentRequest.mockReturnValue(false);
    });
    const { controller, overlayUpdate } = buildController({ sequence: 3, kind: 'user', epoch: 1 });
    await controller.handleDataLoaded(loadedEvent);

    // The dataset is on screen all the same, but the overlay is the newer request's.
    expect(overlayUpdate).not.toHaveBeenCalledWith(false);
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
  });

  it('is left to the newer request when a superseded load fails while it renders', async () => {
    mocks.loadData.mockImplementation(async () => {
      mocks.isCurrentRequest.mockReturnValue(false);
      throw new Error('render failed');
    });
    const { controller, overlayUpdate } = buildController({ sequence: 3, kind: 'user', epoch: 1 });
    await controller.handleDataLoaded(loadedEvent);

    expect(overlayUpdate).not.toHaveBeenCalledWith(false);
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
  });

  it('is dismissed before a failed stored import releases the queue to a newer load', async () => {
    const { controller, overlayUpdate } = buildController(opfsRestore, { latestSequence: 4 });
    await controller.handleDataError(dataErrorEvent('corrupt'));

    expect(overlayUpdate).toHaveBeenCalledWith(false);
    expect(lastCall(overlayUpdate)).toBeLessThan(
      mocks.resolvePendingLoadFinalization.mock.invocationCallOrder[0],
    );
    expect(mocks.clearCorruptedPersistedDataset).toHaveBeenCalled();
    expect(mocks.recoverFromCorruptedPersistedDataset).not.toHaveBeenCalled();
  });

  it("stays up over a failed stored import a newer user request superseded: it is that request's", async () => {
    mocks.isCurrentRequest.mockReturnValue(false);
    const { controller, overlayUpdate } = buildController(opfsRestore, { latestSequence: 4 });
    await controller.handleDataError(dataErrorEvent('corrupt'));

    expect(overlayUpdate).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
  });

  it('stays up over a failed stored import until the demo that replaces it settles', async () => {
    // Nothing is queued behind the restore: the demo shows its download on the overlay
    // and takes it down itself.
    const { controller, overlayUpdate } = buildController(opfsRestore);
    await controller.handleDataError(dataErrorEvent('corrupt'));

    expect(overlayUpdate).not.toHaveBeenCalled();
    expect(mocks.recoverFromCorruptedPersistedDataset).toHaveBeenCalledWith(
      'could not be loaded',
      1,
    );
  });
});
