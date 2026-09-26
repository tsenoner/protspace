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
    supersedePendingExampleFetch: vi.fn(),
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

function createController(loadQueueOverrides: Record<string, unknown> = {}) {
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
      awaitLoadOutcome: vi.fn(),
      getLoadMetaForFile: vi.fn(),
      getRunningLoadMeta: () => ({ sequence: 1, kind: 'user' as const }),
      getLatestSequence: () => 1,
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
      ...loadQueueOverrides,
    },
    overlayController: { update: vi.fn() },
    plotElement: {},
    setCurrentExampleId: vi.fn(),
    setCurrentDatasetName: vi.fn(),
    structureViewer: {},
    viewController,
  } as unknown as Parameters<typeof createDatasetController>[0];

  return {
    controller: createDatasetController(options),
    viewController,
    setCurrentExampleId: options.setCurrentExampleId,
    setCurrentDatasetName: options.setCurrentDatasetName,
  };
}

describe('example/OPFS/user wrapper forwarding (persisted-dataset mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
  });

  // The emit for a successful example load now happens inside handleDataLoaded
  // (see the "handleDataLoaded" describe block below), keyed on the example
  // carried in load meta — not here. These wrappers just forward the id/source
  // to persisted-dataset.ts and return its real outcome.
  it('loadExampleDatasetAndClearPersistedFile forwards id and source, defaulting source to "menu"', async () => {
    mocks.persisted.loadExampleDatasetAndClearPersistedFile.mockResolvedValue('loaded');
    const { controller } = createController();

    const outcome = await controller.loadExampleDatasetAndClearPersistedFile(OTHER.id);

    expect(outcome).toBe('loaded');
    expect(mocks.persisted.loadExampleDatasetAndClearPersistedFile).toHaveBeenCalledWith(
      OTHER.id,
      'menu',
    );
  });

  it("forwards the real outcome ('failed') when the persisted controller reports failure", async () => {
    mocks.persisted.loadExampleDatasetAndClearPersistedFile.mockResolvedValue('failed');
    const { controller } = createController();

    const outcome = await controller.loadExampleDatasetAndClearPersistedFile(OTHER.id);

    expect(outcome).toBe('failed');
  });

  it("forwards 'superseded' without treating it as a failure", async () => {
    mocks.persisted.loadExampleDatasetAndClearPersistedFile.mockResolvedValue('superseded');
    const { controller } = createController();

    const outcome = await controller.loadExampleDatasetAndClearPersistedFile(OTHER.id);

    expect(outcome).toBe('superseded');
  });

  it('loadExampleDataset never clears OPFS and forwards with source "url"', async () => {
    mocks.persisted.loadExampleDataset.mockResolvedValue('loaded');
    const { controller } = createController();

    const outcome = await controller.loadExampleDataset(DEMO.id);

    expect(outcome).toBe('loaded');
    expect(mocks.persisted.loadExampleDataset).toHaveBeenCalledWith(DEMO, 'url');
    expect(mocks.persisted.loadExampleDatasetAndClearPersistedFile).not.toHaveBeenCalled();
  });

  it("loadExampleDataset resolves 'failed' for an unknown id without calling the loader", async () => {
    const { controller } = createController();

    const outcome = await controller.loadExampleDataset('not-a-real-id');

    expect(outcome).toBe('failed');
    expect(mocks.persisted.loadExampleDataset).not.toHaveBeenCalled();
  });

  it('emits "startup" with a null id when the persisted-or-default flow restores a stored file (OPFS)', async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'auto-loaded' });
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([[null, 'startup']]);
  });

  it('does not emit for "default-loaded": that example load reports through handleDataLoaded internally', async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'default-loaded' });
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([]);
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

  it('tryLoadPersistedAgain emits "startup" with a null id', async () => {
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.tryLoadPersistedAgain(new File(['x'], 'mine.parquetbundle'));

    expect(changes).toEqual([[null, 'startup']]);
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

  it('supersedePendingExampleFetch delegates to the persisted controller', () => {
    const { controller } = createController();

    controller.supersedePendingExampleFetch();

    expect(mocks.persisted.supersedePendingExampleFetch).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further notifications', async () => {
    mocks.persisted.loadExampleDataset.mockResolvedValue('loaded');
    const { controller } = createController();
    const callback = vi.fn();
    const unsubscribe = controller.subscribeToDatasetChanges(callback);
    unsubscribe();

    await controller.loadExampleDataset(DEMO.id);

    expect(callback).not.toHaveBeenCalled();
  });
});

describe('handleDataLoaded: example labeling keyed on load meta, not kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
  });

  it('sets name/id and emits with the source carried in load meta, for an example load', async () => {
    const file = new File(['x'], 'demo.parquetbundle');
    const loadMeta = {
      sequence: 1,
      kind: 'default' as const,
      example: { entry: DEMO, source: 'menu' as const },
    };
    const { controller, setCurrentExampleId, setCurrentDatasetName } = createController({
      getRunningLoadMeta: () => loadMeta,
      getLoadMetaForFile: () => loadMeta,
    });
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.handleDataLoaded({
      detail: { data, file, source: 'auto' },
    } as unknown as Event);

    expect(setCurrentDatasetName).toHaveBeenCalledWith(DEMO.label);
    expect(setCurrentExampleId).toHaveBeenCalledWith(DEMO.id);
    expect(changes).toEqual([[DEMO.id, 'menu']]);
  });

  // Guards the exact regression the review flagged: the perf suite also
  // issues 'default'-kind loads (webgl-perf-suite.ts calls
  // dataLoader.loadFromFile(file, { source: 'auto' }) directly, without going
  // through persisted-dataset.ts), so `kind === 'default'` alone must never be
  // enough to label a load as an example.
  it('does not label a plain "default"-kind load (no example in meta) as an example', async () => {
    const file = new File(['x'], '573K_swissprot.parquetbundle');
    const loadMeta = { sequence: 1, kind: 'default' as const };
    const { controller, setCurrentExampleId, setCurrentDatasetName } = createController({
      getRunningLoadMeta: () => loadMeta,
      getLoadMetaForFile: () => loadMeta,
    });
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.handleDataLoaded({
      detail: { data, file, source: 'auto' },
    } as unknown as Event);

    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });
});
