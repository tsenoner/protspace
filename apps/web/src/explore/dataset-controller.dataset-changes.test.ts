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
    // Defaults to "still current" so existing tests, which don't exercise
    // the superseded-during-decode path, render as before.
    isCurrentExampleRequest: vi.fn(() => true),
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

  it("emits (null, 'startup') when the persisted-or-default flow requires recovery", async () => {
    // No example is showing while the recovery banner is up (the persisted
    // file hasn't loaded), so a stale `?dataset=` from a failed/unknown deep
    // link must not linger in the URL either — this emit is what tells the
    // URL sync hook to replace-delete it. Previously a separate
    // `reportDatasetChange` method, called from `startup.ts`, did this; now
    // `loadPersistedOrDefaultDataset` itself emits for this outcome, the
    // same way it already does for 'auto-loaded'.
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({
      kind: 'recovery-required',
      file: new File(['x'], 'mine.parquetbundle'),
      failedAttempts: 1,
    });
    const { controller } = createController();
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([[null, 'startup']]);
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
      example: { entry: DEMO, source: 'menu' as const, requestId: 1 },
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

  // Fix 2's repro: a Back to a 5K entry starts loading 40K, and a second
  // Back (~150ms later, while 40K is still decoding) starts loading 5K
  // again. 40K's request is no longer current by the time its decode
  // finishes, so it must never render, emit, or set name/id — otherwise it
  // is briefly shown under `dataset=5K`, and can even win the race and leave
  // the wrong dataset/annotation on screen.
  it('skips render/emit entirely for an example load superseded during decode', async () => {
    const file = new File(['x'], '40K.parquetbundle');
    const loadMeta = {
      sequence: 1,
      kind: 'default' as const,
      example: { entry: OTHER, source: 'url' as const, requestId: 1 },
    };
    mocks.persisted.isCurrentExampleRequest.mockReturnValue(false);
    const { controller, viewController, setCurrentExampleId, setCurrentDatasetName } =
      createController({
        getRunningLoadMeta: () => loadMeta,
        getLoadMetaForFile: () => loadMeta,
      });
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.handleDataLoaded({
      detail: { data, file, source: 'auto' },
    } as unknown as Event);

    expect(mocks.persisted.isCurrentExampleRequest).toHaveBeenCalledWith(1);
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(viewController.applyLatestViewForDatasetLoad).not.toHaveBeenCalled();
    // Still finalizes the pending load (so `awaitLoadOutcome` never hangs),
    // as a non-success — this load never actually finished.
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(1, false);
  });

  // Narrower than the case above: the request is still current when this
  // function starts (so it proceeds into `loadData`), and only becomes
  // superseded WHILE `loadData` is awaiting — the realistic timing for a
  // real decode, which is what let the e2e repro (rapid Back landing mid-
  // decode) through a single up-front check alone.
  it('re-checks after loadData and skips labeling/emit/view-apply if superseded while it was awaiting', async () => {
    const file = new File(['x'], '40K.parquetbundle');
    const loadMeta = {
      sequence: 1,
      kind: 'default' as const,
      example: { entry: OTHER, source: 'url' as const, requestId: 1 },
    };
    mocks.persisted.isCurrentExampleRequest
      .mockReturnValueOnce(true) // check before loadData: still current
      .mockReturnValueOnce(false); // check after loadData: superseded meanwhile
    const { controller, viewController, setCurrentExampleId, setCurrentDatasetName } =
      createController({
        getRunningLoadMeta: () => loadMeta,
        getLoadMetaForFile: () => loadMeta,
      });
    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    await controller.handleDataLoaded({
      detail: { data, file, source: 'auto' },
    } as unknown as Event);

    expect(mocks.persisted.isCurrentExampleRequest).toHaveBeenCalledTimes(2);
    // loadData DID run (the request was current when it started)...
    expect(mocks.loadData).toHaveBeenCalledTimes(1);
    // ...but nothing after it did, since it was superseded by the time it
    // resolved.
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(viewController.applyLatestViewForDatasetLoad).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(1, false);
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
