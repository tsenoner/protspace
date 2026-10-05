import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import {
  TEST_DATA,
  buildControllerOptions,
  dataErrorEvent,
  dataLoadedEvent,
  recordDatasetChanges,
} from './dataset-controller.fixtures';
import { TEST_DEMO, TEST_EXAMPLE } from './example-catalog.fixtures';
import { progressAfterExampleDownload } from './loading-overlay';
import type { LoadMeta } from './types';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  rendererOverlay: null as null | { update: (...args: unknown[]) => void },
  persistedOptions: null as null | {
    retryUrlExample?: (id: string) => void;
    onExampleLoadCancelled?: (cancel: { epoch: number; source: string }) => void;
    overlayController?: unknown;
  },
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
  persisted: {
    loadExampleDatasetAndClearPersistedFile: vi.fn(),
    loadExampleDataset: vi.fn(),
    loadPersistedOrDefaultDataset: vi.fn(),
    tryLoadPersistedAgain: vi.fn(),
    clearCorruptedPersistedDataset: vi.fn(),
    recoverFromCorruptedPersistedDataset: vi.fn(),
    beginUserRequest: vi.fn(() => 1),
    currentRequestEpoch: vi.fn(() => 0),
    cancelPendingExampleLoad: vi.fn((): string => 'none'),
    commitExampleLoad: vi.fn(),
    beginImportPreparation: vi.fn(),
    // Defaults to "still current" so existing tests, which don't exercise
    // the superseded-during-decode path, render as before.
    isCurrentRequest: vi.fn(() => true),
  },
}));

vi.mock('./example-datasets', async (importOriginal) =>
  (await import('./example-catalog.fixtures')).withTestCatalog(await importOriginal()),
);

vi.mock('./data-renderer', () => ({
  createDataRenderer: (options: {
    overlayController: { update: (...args: unknown[]) => void };
  }) => {
    mocks.rendererOverlay = options.overlayController;
    return mocks.loadData;
  },
}));

vi.mock('./persisted-dataset', () => ({
  createPersistedDatasetController: (options: NonNullable<typeof mocks.persistedOptions>) => {
    mocks.persistedOptions = options;
    return mocks.persisted;
  },
}));

vi.mock('./opfs-dataset-store', () => ({
  markLastLoadStatus: mocks.markLastLoadStatus,
  saveLastImportedFile: vi.fn(),
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: (): string[] => [],
  writeTooltipAnnotations: vi.fn(),
}));

import { createDatasetController } from './dataset-controller';

const DEMO = TEST_DEMO;
const OTHER = TEST_EXAMPLE;

/** A load queue whose running load, and the load of any file, is `loadMeta`. */
const runningLoad = (loadMeta: LoadMeta) => ({
  getRunningLoadMeta: () => loadMeta,
  getLoadMetaForFile: () => loadMeta,
});

/** The load meta of an example load begun from `source`. */
function exampleMeta(source: 'menu' | 'url' | 'startup', entry = OTHER): LoadMeta {
  return { sequence: 1, kind: 'default', epoch: 1, example: { entry, source } };
}

function createController(
  loadQueueOverrides: Record<string, unknown> = {},
  extraOptions: Record<string, unknown> = {},
) {
  const options = buildControllerOptions({
    loadQueue: {
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
      ...loadQueueOverrides,
    },
    ...extraOptions,
  });

  return {
    controller: createDatasetController(options),
    viewController: options.viewController,
    overlayController: options.overlayController,
    setCurrentExampleId: options.setCurrentExampleId,
    setCurrentDatasetName: options.setCurrentDatasetName,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadData.mockResolvedValue(undefined);
  mocks.markLastLoadStatus.mockResolvedValue(undefined);
  // `clearAllMocks` keeps implementations, and a test may leave this returning false.
  mocks.persisted.isCurrentRequest.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startup outcomes and dataset-change emits (persisted-dataset mocked)', () => {
  it('loadDefaultDatasetAndClearPersistedFile loads the demo in place of the stored import', async () => {
    mocks.persisted.loadExampleDatasetAndClearPersistedFile.mockResolvedValue('loaded');
    const { controller } = createController();

    await controller.loadDefaultDatasetAndClearPersistedFile();

    expect(mocks.persisted.loadExampleDatasetAndClearPersistedFile).toHaveBeenCalledWith(
      DEMO,
      'startup',
    );
  });

  it.each([
    ['auto-loaded', 'the OPFS load'],
    ['default-loaded', 'that example load'],
  ])('does not emit for "%s": %s reports through handleDataLoaded', async (kind) => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind });
    const { controller } = createController();
    const changes = recordDatasetChanges(controller);

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([]);
  });

  it("emits (null, 'startup') when the persisted-or-default flow requires recovery", async () => {
    // No example is showing while the recovery banner is up (the persisted
    // file hasn't loaded), so a stale `?dataset=` from a failed/unknown deep
    // link must not linger in the URL either — this emit is what tells the
    // URL sync hook to replace-delete it.
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({
      kind: 'recovery-required',
      file: new File(['x'], 'mine.parquetbundle'),
      failedAttempts: 1,
    });
    const { controller, overlayController } = createController();
    const changes = recordDatasetChanges(controller);

    await controller.loadPersistedOrDefaultDataset({ epoch: 3 });

    expect(mocks.persisted.loadPersistedOrDefaultDataset).toHaveBeenCalledWith({ epoch: 3 });
    expect(changes).toEqual([[null, 'startup']]);
    // A Back to an entry without `dataset=` supersedes a pending example
    // whose "Downloading…" overlay would otherwise stay over the banner.
    expect(overlayController.update).toHaveBeenCalledWith(false);
  });

  it("names the recovery banner's file as the current dataset only when nothing is on screen", async () => {
    const recovery = {
      kind: 'recovery-required',
      file: new File(['x'], 'mine.parquetbundle'),
      failedAttempts: 1,
    };
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue(recovery);
    const { controller, setCurrentDatasetName, setCurrentExampleId } = createController(
      runningLoad(exampleMeta('url')),
    );

    await controller.loadPersistedOrDefaultDataset();
    expect(setCurrentDatasetName).toHaveBeenCalledWith('mine.parquetbundle');
    expect(setCurrentExampleId).toHaveBeenCalledWith(null);

    // A Back to an entry without `dataset=` while an example is shown: the
    // plot keeps showing that example, so it keeps its name.
    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'b.parquetbundle') }),
    );
    vi.mocked(setCurrentDatasetName).mockClear();
    vi.mocked(setCurrentExampleId).mockClear();
    await controller.loadPersistedOrDefaultDataset();
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
  });

  it('removes a stale `dataset=` when the demo standing in for it fails on an empty page, and only then', async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'default-failed' });
    const { controller } = createController(runningLoad(exampleMeta('url')));
    const changes = recordDatasetChanges(controller);

    await controller.loadPersistedOrDefaultDataset();
    expect(changes).toEqual([[null, 'startup']]);

    // With a dataset on screen the failed demo keeps it, and its entry.
    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'b.parquetbundle') }),
    );
    changes.length = 0;
    await controller.loadPersistedOrDefaultDataset();
    expect(changes).toEqual([]);
  });

  it("neither emits nor touches the overlay for 'preempted': the user request that took over reports itself", async () => {
    mocks.persisted.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'preempted' });
    const { controller, overlayController } = createController();
    const changes = recordDatasetChanges(controller);

    await controller.loadPersistedOrDefaultDataset();

    expect(changes).toEqual([]);
    expect(overlayController.update).not.toHaveBeenCalled();
  });

  it('emits "startup" with a null id when an OPFS restore finishes loading', async () => {
    const { controller } = createController(runningLoad({ sequence: 1, kind: 'opfs' }));
    const changes = recordDatasetChanges(controller);

    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'mine.parquetbundle') }),
    );

    expect(changes).toEqual([[null, 'startup']]);
  });

  it('emits "user" with a null id when a user file import finishes loading', async () => {
    const { controller } = createController();
    const changes = recordDatasetChanges(controller);

    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'mine.fasta'), source: 'user' }),
    );

    expect(changes).toEqual([[null, 'user']]);
  });

  it.each([
    ['beginUserRequest', [], 7],
    ['currentRequestEpoch', [], 7],
    ['cancelPendingExampleLoad', [{ source: 'menu' }], 'cancelled'],
  ] as const)('%s delegates to the persisted controller', (method, args, returned) => {
    const persisted = mocks.persisted[method] as Mock<(...args: unknown[]) => unknown>;
    persisted.mockReturnValueOnce(returned);
    const { controller } = createController();

    expect((controller[method] as (...args: unknown[]) => unknown)(...args)).toBe(returned);
    expect(persisted).toHaveBeenCalledWith(...args);
  });

  it('hasDisplayedDataset turns true only once a load has rendered, and a failed load keeps it', async () => {
    const { controller } = createController(runningLoad(exampleMeta('url')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(controller.hasDisplayedDataset()).toBe(false);
    await controller.handleDataError(dataErrorEvent());
    expect(controller.hasDisplayedDataset()).toBe(false);

    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'b.parquetbundle') }),
    );
    expect(controller.hasDisplayedDataset()).toBe(true);

    await controller.handleDataError(dataErrorEvent());
    expect(controller.hasDisplayedDataset()).toBe(true);
    errorSpy.mockRestore();
  });

  it('reports the Retry of a failed URL-driven example to its retry subscribers', () => {
    const { controller } = createController();
    const retries: string[] = [];
    const unsubscribe = controller.subscribeToExampleRetries((id) => retries.push(id));

    mocks.persistedOptions?.retryUrlExample?.(OTHER.id);
    unsubscribe();
    mocks.persistedOptions?.retryUrlExample?.(DEMO.id);

    expect(retries).toEqual([OTHER.id]);
  });

  it("hands the overlay and the cancel callback to the persisted controller, for the download's Cancel", () => {
    const onExampleLoadCancelled = vi.fn();
    const { overlayController } = createController({}, { onExampleLoadCancelled });

    expect(mocks.persistedOptions?.overlayController).toBe(overlayController);
    mocks.persistedOptions?.onExampleLoadCancelled?.({ epoch: 3, source: 'menu' });
    expect(onExampleLoadCancelled).toHaveBeenCalledWith({ epoch: 3, source: 'menu' });
  });

  it("maps an example's decode progress onto the bar left after its download", () => {
    const menuLoad = exampleMeta('menu');
    const example = createController({ getRunningLoadMeta: () => menuLoad });
    example.controller.handleLoadingStart();
    example.controller.handleLoadingProgress({ detail: { percentage: 100 } } as unknown as Event);
    expect(vi.mocked(example.overlayController.update).mock.calls.map((call) => call[1])).toEqual([
      progressAfterExampleDownload(5),
      progressAfterExampleDownload(20),
    ]);

    // A user import has no download phase: its bar keeps the loader's own scale.
    const user = createController();
    user.controller.handleLoadingStart();
    user.controller.handleLoadingProgress({ detail: { percentage: 100 } } as unknown as Event);
    expect(vi.mocked(user.overlayController.update).mock.calls.map((call) => call[1])).toEqual([
      5, 20,
    ]);
  });

  it('decode progress of a superseded (e.g. cancelled) example never brings the overlay back', () => {
    const loadMeta = exampleMeta('menu');
    const { controller, overlayController } = createController({
      getRunningLoadMeta: () => loadMeta,
    });
    mocks.persisted.isCurrentRequest.mockReturnValue(false);

    controller.handleLoadingStart();
    controller.handleLoadingProgress({ detail: { percentage: 50 } } as unknown as Event);
    expect(overlayController.update).not.toHaveBeenCalled();

    mocks.persisted.isCurrentRequest.mockReturnValue(true);
    controller.handleLoadingStart();
    controller.handleLoadingProgress({ detail: { percentage: 50 } } as unknown as Event);
    expect(overlayController.update).toHaveBeenCalledTimes(2);
  });

  it('the render of a superseded load leaves the overlay to the newer request', () => {
    const loadMeta = exampleMeta('menu');
    const { overlayController } = createController({ getRunningLoadMeta: () => loadMeta });
    const renderOverlay = mocks.rendererOverlay!;

    // A newer request (say a Back to another example, now downloading) owns
    // the overlay: neither a render step nor the render's final hide reaches it.
    mocks.persisted.isCurrentRequest.mockReturnValue(false);
    renderOverlay.update(true, 60, 'Organizing color categories...', 'Visualizing 1 proteins');
    renderOverlay.update(false);
    expect(overlayController.update).not.toHaveBeenCalled();

    mocks.persisted.isCurrentRequest.mockReturnValue(true);
    renderOverlay.update(false);
    expect(overlayController.update).toHaveBeenCalledWith(
      false,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("a superseded user import's parse failure is reported but leaves the overlay to the newer request", async () => {
    const loadMeta: LoadMeta = { sequence: 1, kind: 'user', epoch: 1 };
    const { controller, overlayController } = createController({
      getRunningLoadMeta: () => loadMeta,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.persisted.isCurrentRequest.mockReturnValue(false);

    await controller.handleDataError(dataErrorEvent());

    expect(overlayController.update).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(1, false);

    mocks.persisted.isCurrentRequest.mockReturnValue(true);
    await controller.handleDataError(dataErrorEvent());
    expect(overlayController.update).toHaveBeenCalledWith(false);
    errorSpy.mockRestore();
  });

  it('an OPFS restore that fails to parse recovers under the epoch it began with', async () => {
    // A menu click still downloading has taken a newer epoch; passing the
    // restore's own epoch lets the recovery clear the store without loading
    // the demo over the click.
    const loadMeta = { sequence: 1, kind: 'opfs' as const, epoch: 2 };
    const { controller } = createController({
      getRunningLoadMeta: () => loadMeta,
      getLatestSequence: () => 1,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await controller.handleDataError(dataErrorEvent());

    expect(mocks.persisted.recoverFromCorruptedPersistedDataset).toHaveBeenCalledWith(
      'could not be loaded',
      2,
    );
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(1, false);
    errorSpy.mockRestore();
  });

  it('unsubscribe stops further notifications', async () => {
    const { controller } = createController();
    const callback = vi.fn();
    const unsubscribe = controller.subscribeToDatasetChanges(callback);
    const changes = recordDatasetChanges(controller);
    unsubscribe();

    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'mine.parquetbundle'), source: 'user' }),
    );

    // The load did report a change, to the subscriber still listening.
    expect(changes).toEqual([[null, 'user']]);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('handleDataLoaded: example labeling keyed on load meta, not kind', () => {
  it('sets name/id and emits with the source carried in load meta, for an example load', async () => {
    const { controller, setCurrentExampleId, setCurrentDatasetName } = createController(
      runningLoad(exampleMeta('menu', DEMO)),
    );
    const changes = recordDatasetChanges(controller);

    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], 'demo.parquetbundle') }),
    );

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
    const loaded = dataLoadedEvent({ file: new File(['x'], '40K.parquetbundle') });
    mocks.persisted.isCurrentRequest.mockReturnValue(false);
    const { controller, viewController, setCurrentExampleId, setCurrentDatasetName } =
      createController(runningLoad(exampleMeta('url')));
    const changes = recordDatasetChanges(controller);

    await controller.handleDataLoaded(loaded);

    expect(mocks.persisted.isCurrentRequest).toHaveBeenCalledWith(1);
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
  // real decode. By then its data is on screen, so it is labelled and
  // reported as displayed; only the URL and the view request, which the
  // newer request owns, are left alone.
  it('labels a load superseded while loadData was awaiting as shown, but neither writes the URL nor applies the view', async () => {
    const loaded = dataLoadedEvent({ file: new File(['x'], '40K.parquetbundle') });
    mocks.persisted.isCurrentRequest
      .mockReturnValueOnce(true) // check before loadData: still current
      .mockReturnValueOnce(false); // check after loadData: superseded meanwhile
    const { controller, viewController, setCurrentExampleId, setCurrentDatasetName } =
      createController(runningLoad(exampleMeta('url')));
    const changes = recordDatasetChanges(controller);

    await controller.handleDataLoaded(loaded);

    expect(mocks.persisted.isCurrentRequest).toHaveBeenCalledTimes(2);
    expect(mocks.loadData).toHaveBeenCalledTimes(1);
    expect(setCurrentDatasetName).toHaveBeenCalledWith(OTHER.label);
    expect(setCurrentExampleId).toHaveBeenCalledWith(OTHER.id);
    expect(controller.hasDisplayedDataset()).toBe(true);
    expect(changes).toEqual([[OTHER.id, 'superseded']]);
    expect(viewController.applyLatestViewForDatasetLoad).not.toHaveBeenCalled();
    expect(viewController.setRequestedView).not.toHaveBeenCalled();
  });

  // Guards the exact regression the review flagged: the perf suite also
  // issues 'default'-kind loads (webgl-perf-suite.ts calls
  // dataLoader.loadFromFile(file, { source: 'auto' }) directly, without going
  // through persisted-dataset.ts), so `kind === 'default'` alone must never be
  // enough to label a load as an example.
  it('does not label a plain "default"-kind load (no example in meta) as an example', async () => {
    const { controller, setCurrentExampleId, setCurrentDatasetName } = createController(
      runningLoad({ sequence: 1, kind: 'default' }),
    );
    const changes = recordDatasetChanges(controller);

    await controller.handleDataLoaded(
      dataLoadedEvent({ file: new File(['x'], '573K_swissprot.parquetbundle') }),
    );

    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });
});

describe('handleDataLoaded: curated default view', () => {
  /** Runs one successful `handleDataLoaded` for `loadMeta` and returns the view-controller mock. */
  async function loadWith(loadMeta: LoadMeta, data: VisualizationData = TEST_DATA) {
    const { controller, viewController } = createController(runningLoad(loadMeta));
    await controller.handleDataLoaded(
      dataLoadedEvent({ data, file: new File(['x'], 'bundle.parquetbundle') }),
    );
    return viewController;
  }

  it('a menu load sets the example defaults and resets the request before loadData', async () => {
    const viewController = await loadWith(exampleMeta('menu'));

    expect(viewController.setDatasetDefaults).toHaveBeenCalledWith(OTHER.defaultView);
    expect(viewController.recordRequestedView).toHaveBeenCalledWith(
      createEmptyExploreViewRequest(),
    );
    const loadDataOrder = mocks.loadData.mock.invocationCallOrder[0];
    expect(viewController.setDatasetDefaults.mock.invocationCallOrder[0]).toBeLessThan(
      loadDataOrder,
    );
    expect(viewController.recordRequestedView.mock.invocationCallOrder[0]).toBeLessThan(
      loadDataOrder,
    );
  });

  it.each(['url', 'startup'] as const)(
    'a %s load sets the example defaults but keeps the recorded request',
    async (source) => {
      const viewController = await loadWith(exampleMeta(source));

      expect(viewController.setDatasetDefaults).toHaveBeenCalledWith(OTHER.defaultView);
      expect(viewController.setDatasetDefaults.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.loadData.mock.invocationCallOrder[0],
      );
      expect(viewController.recordRequestedView).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['user import', { sequence: 1, kind: 'user' as const }],
    ['OPFS restore', { sequence: 1, kind: 'opfs' as const }],
    ['perf load', { sequence: 1, kind: 'default' as const }],
  ])('a %s clears the defaults and keeps the recorded request', async (_label, loadMeta) => {
    const viewController = await loadWith(loadMeta);

    expect(viewController.setDatasetDefaults).toHaveBeenCalledWith(null);
    expect(viewController.recordRequestedView).not.toHaveBeenCalled();
  });

  it('a load superseded before render changes neither the defaults nor the request', async () => {
    mocks.persisted.isCurrentRequest.mockReturnValue(false);

    const viewController = await loadWith(exampleMeta('menu'));

    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(viewController.setDatasetDefaults).not.toHaveBeenCalled();
    expect(viewController.recordRequestedView).not.toHaveBeenCalled();
  });

  it('warns in development when the bundle lacks a defaultView name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await loadWith(exampleMeta('url', DEMO));

    const drift = warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('defaultView names missing'));
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain(`Example "${DEMO.id}"`);
    expect(drift[0]).toContain(`annotation "${DEMO.defaultView.annotation}"`);
    expect(drift[0]).toContain(`projection "${DEMO.defaultView.projection}"`);
  });

  it('does not warn when the bundle has every defaultView name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { annotation, projection, tooltip = [] } = DEMO.defaultView;
    const category = {
      kind: 'categorical' as const,
      values: ['a'],
      colors: ['#000'],
      shapes: ['circle'],
    };
    const matchingData: VisualizationData = {
      ...TEST_DATA,
      projections: [{ name: projection, dimension: 2, data: new Float32Array([0, 0]) }],
      annotations: Object.fromEntries([annotation, ...tooltip].map((name) => [name, category])),
      annotation_data: Object.fromEntries(
        [annotation, ...tooltip].map((name) => [name, new Int32Array([0])]),
      ),
    };

    await loadWith(exampleMeta('url', DEMO), matchingData);

    expect(
      warn.mock.calls.some(([message]) => String(message).includes('defaultView names missing')),
    ).toBe(false);
  });
});
