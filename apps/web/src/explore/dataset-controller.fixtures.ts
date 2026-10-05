/**
 * Shared setup for the unit tests of `createDatasetController`: a one-protein
 * dataset, the events the data loader dispatches for it, and the controller's
 * options with every collaborator a mock.
 *
 * Each test file keeps its own `vi.mock` calls (vitest hoists them per file)
 * and passes the mocks it asserts on through `buildControllerOptions`.
 */
import { vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type { DatasetController, createDatasetController } from './dataset-controller';
import type { DatasetChangeSource, LoadMeta } from './types';
import { createEmptyExploreViewRequest } from './url-state';

type DatasetControllerOptions = Parameters<typeof createDatasetController>[0];

/** One protein, one 2-D projection and one categorical annotation. */
export const TEST_DATA: VisualizationData = {
  protein_ids: ['P1'],
  projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0]) }],
  annotations: {
    ec: { kind: 'categorical', values: ['1.1.1.1'], colors: ['#000'], shapes: ['circle'] },
  },
  annotation_data: { ec: new Int32Array([0]) },
};

/** The `data-loaded` event for `TEST_DATA`, from an automatic load unless `detail` says otherwise. */
export function dataLoadedEvent(detail: Record<string, unknown> = {}): Event {
  return { detail: { data: TEST_DATA, source: 'auto', ...detail } } as unknown as Event;
}

/**
 * The `data-error` event of a bundle that fails to parse, unless `detail` says
 * otherwise (`{ originalError: undefined }` drops the error).
 */
export function dataErrorEvent(
  message = 'Corrupt bundle',
  detail: { originalError?: Error } = {},
): Event {
  return { detail: { message, originalError: new Error(message), ...detail } } as unknown as Event;
}

/**
 * Options for `createDatasetController`, with every collaborator a mock and a
 * user import running. An override replaces a whole option, except
 * `loadQueue`, whose entries replace the mock queue's methods one by one.
 */
export function buildControllerOptions(
  overrides: Record<string, unknown> & { loadQueue?: object } = {},
) {
  const { loadQueue, ...rest } = overrides;
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
      getRunningLoadMeta: (): LoadMeta | null => ({ sequence: 1, kind: 'user' }),
      getLatestSequence: () => 1,
      resolvePendingLoadFinalization: vi.fn(),
      ...loadQueue,
    },
    overlayController: { update: vi.fn(), setCancelHandler: vi.fn() },
    plotElement: {},
    setCurrentExampleId: vi.fn(),
    setCurrentDatasetName: vi.fn(),
    structureViewer: {},
    viewController: {
      subscribeToViewChanges: vi.fn(() => () => {}),
      resolveLatestView: vi.fn(),
      getLatestViewRequest: vi.fn(() => createEmptyExploreViewRequest()),
      applyLatestViewForDatasetLoad: vi.fn(),
      setRequestedView: vi.fn(),
      recordRequestedView: vi.fn(),
      setDatasetDefaults: vi.fn(),
    },
    ...rest,
  };
  return options as typeof options & DatasetControllerOptions;
}

/** The `[id, source]` pairs `controller` reports to its dataset-change subscribers from now on. */
export function recordDatasetChanges(
  controller: DatasetController,
): Array<[string | null, DatasetChangeSource]> {
  const changes: Array<[string | null, DatasetChangeSource]> = [];
  controller.subscribeToDatasetChanges((id, source) => changes.push([id, source]));
  return changes;
}
