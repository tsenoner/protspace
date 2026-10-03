/**
 * Integration coverage for the real fetch → load-queue → handleDataLoaded/
 * handleDataError round trip that persisted-dataset.ts and dataset-controller.ts
 * unit tests mock away piece by piece. `./persisted-dataset` and `./load-queue`
 * are deliberately NOT mocked here.
 *
 * The bug this guards: `DataLoader.loadFromFile` never rejects — a parse
 * failure dispatches `data-error` and resolves (packages/core/src/components/
 * data-loader/data-loader.ts). A caller that just awaits `loadFromFile` and
 * returns `true` reports a corrupt bundle as a successful load. Driving a real
 * `data-error` through the real load queue proves the whole pipeline now
 * reports failure correctly: the boolean result, the name/id, and the emit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildControllerOptions,
  dataErrorEvent,
  dataLoadedEvent,
  recordDatasetChanges,
} from './dataset-controller.fixtures';
import { TEST_DEMO } from './example-catalog.fixtures';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: notifyMock,
}));

vi.mock('./example-datasets', async (importOriginal) =>
  (await import('./example-catalog.fixtures')).withTestCatalog(await importOriginal()),
);

vi.mock('./data-renderer', () => ({
  createDataRenderer: () => mocks.loadData,
}));

vi.mock('./opfs-dataset-store', () => ({
  StoredDatasetCorruptError: class StoredDatasetCorruptError extends Error {},
  clearLastImportedFile: vi.fn().mockResolvedValue(undefined),
  loadLastImportedFile: vi.fn().mockResolvedValue(null),
  markLastLoadStatus: vi.fn().mockResolvedValue(undefined),
  readLastLoadStatus: vi.fn().mockResolvedValue(null),
  saveLastImportedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: () => [],
  writeTooltipAnnotations: vi.fn(),
}));

import { createDatasetController, type DatasetController } from './dataset-controller';
import { createLoadQueue } from './load-queue';
import {
  clearLastImportedFile,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
  saveLastImportedFile,
} from './opfs-dataset-store';

const DEMO = TEST_DEMO;

/**
 * Wires a real `LoadQueue` + real `createPersistedDatasetController` (via
 * `createDatasetController`) around a fake `DataLoader` whose `loadFromFile`
 * runs the load through the queue exactly as `runtime.ts` does, then reports
 * the outcome the way the real element would: `simulateOutcome` decides
 * whether to call `handleDataLoaded` or `handleDataError` on the resulting
 * controller — mirroring the `data-loaded`/`data-error` listeners runtime.ts
 * attaches to the real element.
 */
function createRealController(
  simulateOutcome: (file: File, controller: DatasetController) => Promise<void>,
) {
  let controller!: DatasetController;
  const loadQueue = createLoadQueue({
    isDisposed: () => false,
    skipLoad: (meta) => controller.isSkippableQueuedLoad(meta),
  });
  const dataLoader = {
    loadFromFile: vi.fn((file: File, options?: { source?: 'user' | 'auto' }) =>
      loadQueue.enqueueLoadFromFile(file, options, (queuedFile) =>
        simulateOutcome(queuedFile, controller),
      ),
    ),
  };
  const options = buildControllerOptions({ dataLoader, loadQueue });
  controller = createDatasetController(options);

  return {
    controller,
    dataLoader,
    loadQueue,
    setCurrentExampleId: options.setCurrentExampleId,
    setCurrentDatasetName: options.setCurrentDatasetName,
    overlayController: options.overlayController,
  };
}

/** Puts a fetch in place that answers every request with a four-byte bundle. */
const stubOkFetch = () =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ArrayBuffer(4))));

/** Decodes the queued file into `TEST_DATA`, as the data loader's `data-loaded` reports it. */
const loadSucceeds = async (file: File, ctrl: DatasetController) => {
  await ctrl.handleDataLoaded(dataLoadedEvent({ settings: null, file }));
};

/** Fails to parse the queued file, as the data loader's `data-error` reports it. */
const parseFails = async (_file: File, ctrl: DatasetController) => {
  await ctrl.handleDataError(dataErrorEvent());
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadData.mockResolvedValue(undefined);
});

// In afterEach, not at the end of each test body: a failing assertion would
// otherwise skip the unstub and leak the fetch stub into the next test.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('example load: real fetch + load-queue + handleDataLoaded/handleDataError', () => {
  it('a successful fetch and parse sets name/id and emits, keyed on the example in load meta', async () => {
    const { controller, setCurrentExampleId, setCurrentDatasetName } =
      createRealController(loadSucceeds);
    stubOkFetch();

    const changes = recordDatasetChanges(controller);

    const result = await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu');

    expect(result).toBe('loaded');
    expect(setCurrentDatasetName).toHaveBeenCalledWith(DEMO.label);
    expect(setCurrentExampleId).toHaveBeenCalledWith(DEMO.id);
    expect(changes).toEqual([[DEMO.id, 'menu']]);
  });

  it("a parse failure (data-error after a successful fetch) leaves name/id/emit untouched and resolves 'failed'", async () => {
    const { controller, setCurrentExampleId, setCurrentDatasetName, overlayController } =
      createRealController(parseFails);
    stubOkFetch();

    const changes = recordDatasetChanges(controller);

    const result = await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu');

    expect(result).toBe('failed');
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    // Exactly one toast: handleDataError's generic data-load-failure notice.
    // persisted-dataset.ts's own catch block is never reached because
    // dataLoader.loadFromFile resolved (it never throws on a parse error).
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    // Neither loadData (success only) nor persisted-dataset.ts's fetch-catch
    // (network failure only) runs for this path, so handleDataError itself
    // must dismiss the overlay or the UI stays behind it.
    expect(overlayController.update).toHaveBeenCalledWith(false);
  });

  it("a deep-link load (?dataset=) that fails to parse also resolves 'failed' without emitting", async () => {
    const { controller } = createRealController(parseFails);
    stubOkFetch();

    const changes = recordDatasetChanges(controller);

    const result = await controller.loadExampleDataset(DEMO, 'url');

    expect(result).toBe('failed');
    expect(changes).toEqual([]);
  });
});

describe('example load: the stored import is replaced only once the example has decoded', () => {
  it('a successful menu choice clears the stored import', async () => {
    const { controller } = createRealController(loadSucceeds);
    stubOkFetch();

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe('loaded');
    expect(clearLastImportedFile).toHaveBeenCalledTimes(1);
  });

  it('a menu choice whose download fails keeps the stored import', async () => {
    const { controller } = createRealController(loadSucceeds);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: 'Server Error' })),
    );

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe('failed');
    expect(clearLastImportedFile).not.toHaveBeenCalled();
  });

  it('a menu choice whose bundle fails to parse keeps the stored import', async () => {
    const { controller } = createRealController(parseFails);
    stubOkFetch();

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe('failed');
    expect(clearLastImportedFile).not.toHaveBeenCalled();
  });

  it('a menu choice superseded before it renders keeps the stored import', async () => {
    const { controller } = createRealController(async (file, ctrl) => {
      // A newer request (a user import, another menu choice) lands while
      // this one is still decoding.
      ctrl.beginUserRequest();
      await loadSucceeds(file, ctrl);
    });
    stubOkFetch();

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe(
      'superseded',
    );
    expect(clearLastImportedFile).not.toHaveBeenCalled();
  });

  it('a deep-link load never clears the stored import', async () => {
    const { controller } = createRealController(loadSucceeds);
    stubOkFetch();

    expect(await controller.loadExampleDataset(DEMO, 'url')).toBe('loaded');
    expect(clearLastImportedFile).not.toHaveBeenCalled();
  });

  it('a menu choice superseded while it waits for the queue is never decoded', async () => {
    let releaseBusy!: () => void;
    const busyGate = new Promise<void>((resolve) => {
      releaseBusy = resolve;
    });
    const decoded: string[] = [];
    const { controller, dataLoader, loadQueue } = createRealController(async (file, ctrl) => {
      decoded.push(file.name);
      if (file.name === 'busy.parquetbundle') {
        await busyGate;
        loadQueue.resolvePendingLoadFinalization(
          loadQueue.getLoadMetaForFile(file)!.sequence,
          true,
        );
        return;
      }
      await loadSucceeds(file, ctrl);
    });
    stubOkFetch();

    // Another load holds the queue while the example downloads.
    const busy = dataLoader.loadFromFile(new File(['x'], 'busy.parquetbundle'), {
      source: 'auto',
    });
    const choice = controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu');
    await vi.waitFor(() => expect(loadQueue.getLatestSequence()).toBe(2));
    controller.beginUserRequest();
    releaseBusy();
    await busy;

    expect(await choice).toBe('superseded');
    expect(decoded).toEqual(['busy.parquetbundle']);
    expect(clearLastImportedFile).not.toHaveBeenCalled();
  });

  it('a superseded example whose bundle fails to parse is abandoned silently', async () => {
    const { controller, overlayController } = createRealController(async (file, ctrl) => {
      ctrl.beginUserRequest();
      await parseFails(file, ctrl);
    });
    stubOkFetch();

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe(
      'superseded',
    );
    // No toast, and the overlay the newer request owns is left alone.
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(overlayController.update).not.toHaveBeenCalledWith(false);
  });
});

describe('a load a newer user request supersedes after it has started', () => {
  afterEach(() => {
    vi.mocked(loadLastImportedFile).mockReset().mockResolvedValue(null);
    vi.mocked(readLastLoadStatus).mockReset().mockResolvedValue(null);
  });

  const lastStatusMark = () => {
    const { calls } = vi.mocked(markLastLoadStatus).mock;
    return calls[calls.length - 1];
  };

  it('a menu example that has begun rendering is committed: a view-only Back leaves it to finish', async () => {
    let cancelDuringRender: string | undefined;
    const { controller } = createRealController(async (file, ctrl) => {
      mocks.loadData.mockImplementationOnce(async () => {
        // A Back that only changes the view lands while the plot is swapping.
        cancelDuringRender = ctrl.cancelPendingExampleLoad({ source: 'menu' });
      });
      await loadSucceeds(file, ctrl);
    });
    stubOkFetch();
    const changes = recordDatasetChanges(controller);

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe('loaded');
    expect(cancelDuringRender).toBe('committed');
    expect(changes).toEqual([[DEMO.id, 'menu']]);
    expect(clearLastImportedFile).toHaveBeenCalledTimes(1);
  });

  it('a menu example still decoding is cancelled by a Back, and nothing of it lands', async () => {
    const { controller } = createRealController(async (file, ctrl) => {
      expect(ctrl.cancelPendingExampleLoad({ source: 'menu' })).toBe('cancelled');
      await loadSucceeds(file, ctrl);
    });
    stubOkFetch();
    const changes = recordDatasetChanges(controller);

    expect(await controller.loadExampleDatasetAndClearPersistedFile(DEMO, 'menu')).toBe(
      'superseded',
    );
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(clearLastImportedFile).not.toHaveBeenCalled();
  });

  it('the startup restore superseded mid-decode renders and emits nothing, and records its success', async () => {
    const stored = new File(['x'], 'mine.parquetbundle');
    vi.mocked(loadLastImportedFile).mockResolvedValue(stored);
    vi.mocked(readLastLoadStatus).mockResolvedValue({ status: 'success', failedAttempts: 0 });
    const { controller } = createRealController(async (file, ctrl) => {
      // A Back/Forward to an example entry lands while the restore decodes.
      ctrl.beginUserRequest();
      await loadSucceeds(file, ctrl);
    });
    const changes = recordDatasetChanges(controller);

    expect(await controller.loadPersistedOrDefaultDataset()).toEqual({ kind: 'auto-loaded' });
    expect(mocks.loadData).not.toHaveBeenCalled();
    // No (null, 'startup') emit, which would remove `dataset=` from the entry
    // the user went to.
    expect(changes).toEqual([]);
    expect(controller.hasDisplayedDataset()).toBe(false);
    // Not left 'pending', which would offer recovery for a file that loads.
    expect(lastStatusMark()).toEqual(['success']);
  });

  it('the startup restore superseded while it renders emits nothing and records its success', async () => {
    const stored = new File(['x'], 'mine.parquetbundle');
    vi.mocked(loadLastImportedFile).mockResolvedValue(stored);
    vi.mocked(readLastLoadStatus).mockResolvedValue({ status: 'success', failedAttempts: 0 });
    const { controller } = createRealController(async (file, ctrl) => {
      mocks.loadData.mockImplementationOnce(async () => {
        ctrl.beginUserRequest();
      });
      await loadSucceeds(file, ctrl);
    });
    const changes = recordDatasetChanges(controller);

    await controller.loadPersistedOrDefaultDataset();
    expect(changes).toEqual([]);
    expect(lastStatusMark()).toEqual(['success']);
  });

  it('a user import superseded while it decodes is neither saved, shown nor reported', async () => {
    const { controller, dataLoader, loadQueue } = createRealController(async (file, ctrl) => {
      ctrl.beginUserRequest();
      await ctrl.handleDataLoaded(dataLoadedEvent({ settings: null, source: 'user', file }));
    });
    const changes = recordDatasetChanges(controller);

    const file = new File(['x'], 'mine.parquetbundle');
    // As runtime.ts's load handler does for a user import.
    loadQueue.registerFileLoad(file, 'user', undefined, controller.beginUserRequest());
    await dataLoader.loadFromFile(file, { source: 'user' });

    expect(saveLastImportedFile).not.toHaveBeenCalled();
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it('a user import that stays current is saved, shown and reported', async () => {
    const { controller, dataLoader, loadQueue } = createRealController(async (file, ctrl) => {
      await ctrl.handleDataLoaded(dataLoadedEvent({ settings: null, source: 'user', file }));
    });
    const changes = recordDatasetChanges(controller);

    const file = new File(['x'], 'mine.parquetbundle');
    loadQueue.registerFileLoad(file, 'user', undefined, controller.beginUserRequest());
    await dataLoader.loadFromFile(file, { source: 'user' });

    expect(saveLastImportedFile).toHaveBeenCalledWith(file);
    expect(mocks.loadData).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([[null, 'user']]);
  });
});
