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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { EXAMPLE_DATASETS } from './example-datasets';
import { createEmptyExploreViewRequest } from './url-state';

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

const DEMO = EXAMPLE_DATASETS[0];

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
  const loadQueue = createLoadQueue({ isDisposed: () => false });
  let controller!: DatasetController;
  const dataLoader = {
    loadFromFile: vi.fn((file: File, options?: { source?: 'user' | 'auto' }) =>
      loadQueue.enqueueLoadFromFile(file, options, (queuedFile) =>
        simulateOutcome(queuedFile, controller),
      ),
    ),
  };
  const viewController = {
    subscribeToViewChanges: vi.fn(() => () => {}),
    resolveLatestView: vi.fn(),
    getLatestViewRequest: vi.fn(() => createEmptyExploreViewRequest()),
    applyLatestViewForDatasetLoad: vi.fn(),
    setRequestedView: vi.fn(),
  };
  const setCurrentExampleId = vi.fn();
  const setCurrentDatasetName = vi.fn();

  controller = createDatasetController({
    controlBar: { clearForNewDataset: vi.fn(), hasFileSettings: false } as never,
    dataLoader: dataLoader as never,
    getIsDisposed: () => false,
    interactionController: {} as never,
    legendElement: {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(),
      applyEatSettings: vi.fn(),
    } as never,
    loadQueue,
    overlayController: { update: vi.fn() },
    plotElement: {} as never,
    setCurrentExampleId,
    setCurrentDatasetName,
    structureViewer: {} as never,
    viewController: viewController as never,
  });

  return { controller, dataLoader, setCurrentExampleId, setCurrentDatasetName };
}

describe('example load: real fetch + load-queue + handleDataLoaded/handleDataError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
  });

  it('a successful fetch and parse sets name/id and emits, keyed on the example in load meta', async () => {
    const { controller, setCurrentExampleId, setCurrentDatasetName } = createRealController(
      async (file, ctrl) => {
        await ctrl.handleDataLoaded({
          detail: { data, settings: null, source: 'auto', file },
        } as unknown as Event);
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      }),
    );

    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    const result = await controller.loadExampleDatasetAndClearPersistedFile(DEMO.id, 'menu');

    expect(result).toBe(true);
    expect(setCurrentDatasetName).toHaveBeenCalledWith(DEMO.label);
    expect(setCurrentExampleId).toHaveBeenCalledWith(DEMO.id);
    expect(changes).toEqual([[DEMO.id, 'menu']]);

    vi.unstubAllGlobals();
  });

  it('a parse failure (data-error after a successful fetch) leaves name/id/emit untouched and resolves false', async () => {
    const { controller, setCurrentExampleId, setCurrentDatasetName } = createRealController(
      async (_file, ctrl) => {
        await ctrl.handleDataError({
          detail: {
            message: 'Corrupt bundle',
            originalError: new Error('Corrupt bundle'),
          },
        } as unknown as Event);
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      }),
    );

    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    const result = await controller.loadExampleDatasetAndClearPersistedFile(DEMO.id, 'menu');

    expect(result).toBe(false);
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    // Exactly one toast: handleDataError's generic data-load-failure notice.
    // persisted-dataset.ts's own catch block is never reached because
    // dataLoader.loadFromFile resolved (it never throws on a parse error).
    expect(notifyMock.error).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('a deep-link load (?dataset=) that fails to parse also resolves false without emitting', async () => {
    const { controller } = createRealController(async (_file, ctrl) => {
      await ctrl.handleDataError({
        detail: { message: 'Corrupt bundle', originalError: new Error('Corrupt bundle') },
      } as unknown as Event);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
      }),
    );

    const changes: Array<[string | null, string]> = [];
    controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));

    const result = await controller.loadExampleDataset(DEMO.id);

    expect(result).toBe(false);
    expect(changes).toEqual([]);

    vi.unstubAllGlobals();
  });
});
