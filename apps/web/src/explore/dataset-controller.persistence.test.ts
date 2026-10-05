import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  saveLastImportedFile: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./data-renderer', () => ({
  createDataRenderer: () => mocks.loadData,
}));

vi.mock('./persisted-dataset', () => ({
  createPersistedDatasetController: () => ({
    loadDefaultDatasetAndClearPersistedFile: vi.fn(),
    loadPersistedOrDefaultDataset: vi.fn(),
    tryLoadPersistedAgain: vi.fn(),
    clearCorruptedPersistedDataset: vi.fn(),
    recoverFromCorruptedPersistedDataset: vi.fn(),
  }),
}));

vi.mock('./opfs-dataset-store', () => ({
  markLastLoadStatus: mocks.markLastLoadStatus,
  saveLastImportedFile: mocks.saveLastImportedFile,
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: (): string[] => [],
  writeTooltipAnnotations: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: { warning: mocks.warning, info: mocks.info, error: mocks.error },
}));

import { createDatasetController } from './dataset-controller';

const data: VisualizationData = {
  protein_ids: ['P1'],
  projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0]) }],
  annotations: {
    ec: { kind: 'categorical', values: ['1.1.1.1'], colors: ['#000'], shapes: ['circle'] },
  },
  annotation_data: { ec: new Int32Array([0]) },
};

const file = new File(['bundle'], 'import.parquetbundle');

function buildController(kind: 'user' | 'default' = 'user') {
  const options = {
    controlBar: { clearForNewDataset: vi.fn(), hasFileSettings: false },
    dataLoader: {},
    defaultDatasetName: 'default.parquetbundle',
    getIsDisposed: () => false,
    interactionController: {},
    legendElement: {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(),
      applyEatSettings: vi.fn(),
    },
    loadQueue: {
      registerFileLoad: vi.fn(),
      getLoadMetaForFile: () => ({ sequence: 3, kind }),
      getRunningLoadMeta: () => ({ sequence: 3, kind }),
      getLatestSequence: () => 3,
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
    },
    overlayController: { update: vi.fn() },
    plotElement: {},
    setCurrentDatasetIsDemo: vi.fn(),
    setCurrentDatasetName: vi.fn(),
    structureViewer: {},
    viewController: {
      subscribeToViewChanges: vi.fn(() => () => {}),
      resolveLatestView: vi.fn(),
      getLatestViewRequest: vi.fn(() => createEmptyExploreViewRequest()),
      applyLatestViewForDatasetLoad: vi.fn(),
      setRequestedView: vi.fn(),
    },
  } as unknown as Parameters<typeof createDatasetController>[0];

  return { controller: createDatasetController(options) };
}

const loadedEvent = {
  detail: { data, settings: null, source: 'user', file },
} as unknown as Event;

describe('dataset controller OPFS persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
    mocks.saveLastImportedFile.mockResolvedValue(undefined);
    mocks.loadData.mockResolvedValue(undefined);
  });

  /** Drain the microtask queue so every already-resolved await has run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('stores the imported bytes before the render starts', async () => {
    let finishSave = () => {};
    mocks.saveLastImportedFile.mockImplementation(
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
    expect(mocks.saveLastImportedFile).toHaveBeenCalledWith(file);
    expect(mocks.loadData).not.toHaveBeenCalled();

    finishSave();
    await pending;

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3);
  });

  it('warns and still renders when the bytes cannot be stored', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.saveLastImportedFile.mockRejectedValue(new Error('quota exceeded'));

    const { controller } = buildController();
    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3);
    consoleError.mockRestore();
  });
});

describe('dataset controller legacy bundle notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
    mocks.saveLastImportedFile.mockResolvedValue(undefined);
    mocks.loadData.mockResolvedValue(undefined);
  });

  const eventFor = (bundleFormatVersion: number | undefined, unplacedProteinCount?: number) =>
    ({
      detail: {
        data,
        settings: null,
        source: 'user',
        file,
        bundleFormatVersion,
        unplacedProteinCount,
      },
    }) as unknown as Event;

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
    const { controller } = buildController('default');
    await controller.handleDataLoaded(eventFor(1));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe('dataset controller load errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
  });

  it.each([
    ['an aborted load as a cancellation', new DOMException('Aborted', 'AbortError'), false],
    ['any other error as a failure', new Error('boom'), true],
    ['a missing original error as a failure', undefined, true],
  ])('treats %s', async (_label, originalError: Error | undefined, notified) => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = buildController();
    await controller.handleDataError({
      detail: { message: 'load failed', originalError },
    } as unknown as Event);

    expect(mocks.error).toHaveBeenCalledTimes(notified ? 1 : 0);
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });
});
