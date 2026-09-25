import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { EXAMPLE_DATASETS } from './example-datasets';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
  persisted: {
    loadDefaultDatasetAndClearPersistedFile: vi.fn(),
    loadExampleDatasetAndClearPersistedFile: vi.fn(),
    loadExampleDataset: vi.fn(),
    loadPersistedOrDefaultDataset: vi.fn(),
    tryLoadPersistedAgain: vi.fn(),
    clearCorruptedPersistedDataset: vi.fn(),
    recoverFromCorruptedPersistedDataset: vi.fn(),
  },
}));

vi.mock('./data-renderer', () => ({
  createDataRenderer: () => mocks.loadData,
}));

vi.mock('./persisted-dataset', () => ({
  createPersistedDatasetController: () => mocks.persisted,
}));

vi.mock('./opfs-dataset-store', () => ({
  markLastLoadStatus: mocks.markLastLoadStatus,
  saveLastImportedFile: vi.fn(),
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: () => [],
  writeTooltipAnnotations: vi.fn(),
}));

import { createDatasetController } from './dataset-controller';

const DEMO = EXAMPLE_DATASETS[0];
const OTHER = EXAMPLE_DATASETS[1];

const data: VisualizationData = {
  protein_ids: ['P1'],
  projections: [
    {
      name: 'umap',
      dimension: 2,
      data: new Float32Array([0, 0]),
    },
  ],
  annotations: {
    ec: { kind: 'categorical', values: ['1.1.1.1'], colors: ['#000'], shapes: ['circle'] },
  },
  annotation_data: { ec: new Int32Array([0]) },
};

function createController() {
  const viewController = {
    subscribeToViewChanges: vi.fn(() => () => {}),
    resolveLatestView: vi.fn(),
    getLatestViewRequest: vi.fn(() => createEmptyExploreViewRequest()),
    applyLatestViewForDatasetLoad: vi.fn(),
    setRequestedView: vi.fn(),
  };
  const options = {
    controlBar: { clearForNewDataset: vi.fn(), hasFileSettings: false },
    dataLoader: {},
    getIsDisposed: () => false,
    interactionController: {},
    legendElement: {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(),
      applyEatSettings: vi.fn(),
    },
    loadQueue: {
      registerFileLoad: vi.fn(),
      getLoadMetaForFile: vi.fn(),
      getRunningLoadMeta: () => ({ sequence: 1, kind: 'user' as const }),
      getLatestSequence: () => 1,
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
    },
    overlayController: { update: vi.fn() },
    plotElement: {},
    setCurrentExampleId: vi.fn(),
    setCurrentDatasetName: vi.fn(),
    structureViewer: {},
    viewController,
  } as unknown as Parameters<typeof createDatasetController>[0];

  return { controller: createDatasetController(options), viewController };
}

describe('dataset change notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
  });

  it('emits "menu" on a successful menu-triggered load, tagged with the chosen id', async () => {
    mocks.persisted.loadExampleDatasetAndClearPersistedFile.mockResolvedValue(true);
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    const success = await controller.loadExampleDatasetAndClearPersistedFile(OTHER.id);

    expect(success).toBe(true);
    expect(changes).toEqual([[OTHER.id, 'menu']]);
  });

  it('does not emit when a menu-triggered load fails', async () => {
    mocks.persisted.loadExampleDatasetAndClearPersistedFile.mockResolvedValue(false);
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    const success = await controller.loadExampleDatasetAndClearPersistedFile(OTHER.id);

    expect(success).toBe(false);
    expect(changes).toEqual([]);
  });

  it('loadExampleDataset never clears OPFS and emits "url" on success', async () => {
    mocks.persisted.loadExampleDataset.mockResolvedValue(true);
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    const success = await controller.loadExampleDataset(DEMO.id);

    expect(success).toBe(true);
    expect(mocks.persisted.loadExampleDataset).toHaveBeenCalledWith(DEMO);
    expect(mocks.persisted.loadExampleDatasetAndClearPersistedFile).not.toHaveBeenCalled();
    expect(changes).toEqual([[DEMO.id, 'url']]);
  });

  it('loadExampleDataset returns false for an unknown id without calling the loader', async () => {
    const { controller } = createController();

    const success = await controller.loadExampleDataset('not-a-real-id');

    expect(success).toBe(false);
    expect(mocks.persisted.loadExampleDataset).not.toHaveBeenCalled();
  });

  it('emits "startup" with the demo id when the persisted-or-default flow loads the default', async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'default-loaded' });
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([[DEMO.id, 'startup']]);
  });

  it('emits "startup" with a null id when the persisted-or-default flow restores a stored file', async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'auto-loaded' });
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([[null, 'startup']]);
  });

  it('does not emit when the persisted-or-default flow requires recovery', async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({
      kind: 'recovery-required',
      file: new File(['x'], 'mine.parquetbundle'),
      failedAttempts: 1,
    });
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([]);
  });

  it('emits "user" with a null id when a user file import finishes loading', async () => {
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.handleDataLoaded({
      detail: {
        data,
        file: new File(['x'], 'mine.fasta'),
        source: 'user',
      },
    } as unknown as Event);

    expect(changes).toEqual([[null, 'user']]);
  });

  it('unsubscribe stops further notifications', async () => {
    mocks.persisted.loadExampleDataset.mockResolvedValue(true);
    const { controller } = createController();
    const callback = vi.fn();
    const unsubscribe = controller.subscribeToDatasetChanges(callback);
    unsubscribe();

    await controller.loadExampleDataset(DEMO.id);

    expect(callback).not.toHaveBeenCalled();
  });
});
