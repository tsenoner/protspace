import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  saveLastImportedFileMetadata: vi.fn(),
  saveLastImportedFileData: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
  warning: vi.fn(),
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
  saveLastImportedFileMetadata: mocks.saveLastImportedFileMetadata,
  saveLastImportedFileData: mocks.saveLastImportedFileData,
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: () => [],
  writeTooltipAnnotations: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: { warning: mocks.warning, error: vi.fn() },
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

function buildController() {
  const overlayController = { update: vi.fn() };
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
      getLoadMetaForFile: () => ({ sequence: 3, kind: 'user' as const }),
      getRunningLoadMeta: () => ({ sequence: 3, kind: 'user' as const }),
      getLatestSequence: () => 3,
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
    },
    overlayController,
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

  return { controller: createDatasetController(options), overlayController };
}

const loadedEvent = {
  detail: { data, settings: null, source: 'user', file },
} as unknown as Event;

describe('dataset controller OPFS persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
    mocks.saveLastImportedFileMetadata.mockResolvedValue(undefined);
    mocks.saveLastImportedFileData.mockResolvedValue(undefined);
  });

  /** Drain the microtask queue so every already-resolved await has run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('opens the pending window before the render and settles the byte copy after it', async () => {
    let finishRender = () => {};
    let finishCopy = () => {};
    mocks.loadData.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRender = () => resolve();
        }),
    );
    mocks.saveLastImportedFileData.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = () => resolve();
        }),
    );

    const { controller, overlayController } = buildController();
    const pending = controller.handleDataLoaded(loadedEvent);
    await flush();

    // The crash-recovery window is open before the render it has to survive: a tab that
    // dies here leaves a `pending` record naming this import, not the previous dataset's.
    expect(mocks.saveLastImportedFileMetadata).toHaveBeenCalledWith(file);
    expect(mocks.saveLastImportedFileMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadData.mock.invocationCallOrder[0],
    );
    // The byte copy is in flight rather than in front of first paint: the render started
    // even though the copy has not resolved, and there is no blocking overlay.
    expect(mocks.saveLastImportedFileData).toHaveBeenCalledWith(file);
    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(overlayController.update).not.toHaveBeenCalled();

    // ...and success is not reported over a half-copied file.
    finishRender();
    await flush();
    expect(mocks.markLastLoadStatus).not.toHaveBeenCalled();

    finishCopy();
    await pending;

    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3);
  });

  it('warns but still finishes the load when the byte copy fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadData.mockResolvedValue(undefined);
    mocks.saveLastImportedFileData.mockRejectedValue(new Error('quota exceeded'));

    const { controller } = buildController();
    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3);
    consoleError.mockRestore();
  });

  it('warns and still renders when the pending record cannot be written', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadData.mockResolvedValue(undefined);
    mocks.saveLastImportedFileMetadata.mockRejectedValue(new Error('quota exceeded'));

    const { controller } = buildController();
    await controller.handleDataLoaded(loadedEvent);

    // No recovery window, but the dataset still reaches the screen.
    expect(mocks.saveLastImportedFileData).not.toHaveBeenCalled();
    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3);
    consoleError.mockRestore();
  });
});
