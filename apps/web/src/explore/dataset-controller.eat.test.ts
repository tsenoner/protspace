import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EAT_CONFIDENCE_THRESHOLD, type VisualizationData } from '@protspace/utils';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  readTooltipAnnotations: vi.fn(() => [] as string[]),
  resolvePendingLoadFinalization: vi.fn(),
  writeTooltipAnnotations: vi.fn(),
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
  saveLastImportedFile: vi.fn(),
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: mocks.readTooltipAnnotations,
  writeTooltipAnnotations: mocks.writeTooltipAnnotations,
}));

import { createDatasetController } from './dataset-controller';

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

type DatasetControllerOptions = Parameters<typeof createDatasetController>[0];

function createControllerHarness({
  getLatestViewRequest = () => createEmptyExploreViewRequest(),
  loadQueue: loadQueueOverrides = {},
}: {
  getLatestViewRequest?: () => ReturnType<typeof createEmptyExploreViewRequest>;
  loadQueue?: Partial<DatasetControllerOptions['loadQueue']>;
} = {}) {
  const controlBar = {
    clearForNewDataset: vi.fn(),
    hasFileSettings: false,
  };
  const legendElement = {
    clearForNewDataset: vi.fn(),
    setFileSettings: vi.fn(),
    applyEatSettings: vi.fn(),
  };
  const plotElement = {
    eatOverlayEnabled: true,
  };
  const viewController = {
    subscribeToViewChanges: vi.fn(() => () => {}),
    resolveLatestView: vi.fn(),
    getLatestViewRequest: vi.fn(getLatestViewRequest),
    applyLatestViewForDatasetLoad: vi.fn(),
    setRequestedView: vi.fn(),
  };
  const loadQueue = {
    registerFileLoad: vi.fn(),
    getLoadMetaForFile: vi.fn(),
    getRunningLoadMeta: () => null,
    getLatestSequence: () => 0,
    resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
    ...loadQueueOverrides,
  };
  const options = {
    controlBar,
    dataLoader: {},
    defaultDatasetName: 'default.parquetbundle',
    getIsDisposed: () => false,
    interactionController: {},
    legendElement,
    loadQueue,
    overlayController: { update: vi.fn() },
    plotElement,
    setCurrentDatasetIsDemo: vi.fn(),
    setCurrentDatasetName: vi.fn(),
    structureViewer: {},
    viewController,
  } as unknown as DatasetControllerOptions;

  return {
    controlBar,
    controller: createDatasetController(options),
    legendElement,
    plotElement,
    viewController,
  };
}

describe('dataset controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
    mocks.readTooltipAnnotations.mockReturnValue([]);
  });

  describe('EAT settings restore', () => {
    it('applies embedded EAT settings after an OPFS reload while retaining OPFS legend precedence', async () => {
      const { controlBar, controller, legendElement } = createControllerHarness({
        loadQueue: {
          getRunningLoadMeta: () => ({ sequence: 7, kind: 'opfs' as const }),
          getLatestSequence: () => 7,
        },
      });

      await controller.handleDataLoaded({
        detail: {
          data,
          settings: {
            legendSettings: { ec: { categories: {} } },
            exportOptions: {},
            eatOverlayEnabled: false,
            eatConfidenceThreshold: 0.75,
          },
          source: 'auto',
        },
      } as unknown as Event);

      expect(controlBar.clearForNewDataset).toHaveBeenCalledOnce();
      expect(legendElement.applyEatSettings).toHaveBeenCalledWith(false, 0.75);
      expect(controlBar.hasFileSettings).toBe(true);
      expect(legendElement.setFileSettings).not.toHaveBeenCalled();
      expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
      expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(7);

      await controller.handleDataLoaded({
        detail: {
          data,
          settings: {
            legendSettings: {},
            exportOptions: {},
            eatOverlayEnabled: true,
          },
          source: 'auto',
        },
      } as unknown as Event);
      expect(legendElement.applyEatSettings).toHaveBeenLastCalledWith(
        true,
        DEFAULT_EAT_CONFIDENCE_THRESHOLD,
      );
    });
  });

  describe('legend persistence lifecycle', () => {
    it('reuses dataset lifecycle across initial load, user import, and explicit reset', async () => {
      let latestViewRequest = createEmptyExploreViewRequest();
      const { controlBar, controller, legendElement, viewController } = createControllerHarness({
        getLatestViewRequest: () => latestViewRequest,
        loadQueue: {
          getLoadMetaForFile: vi.fn(() => ({ sequence: 1, kind: 'user' as const })),
        },
      });
      const defaultEventDetail = {
        data,
        settings: {
          legendSettings: {},
          exportOptions: {},
        },
        source: 'auto' as const,
      };
      const event = { detail: defaultEventDetail } as unknown as Event;

      await controller.handleDataLoaded(event);

      expect(legendElement.clearForNewDataset).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        false,
      );
      expect(controlBar.clearForNewDataset).toHaveBeenNthCalledWith(1, expect.any(String), false);
      expect(legendElement.setFileSettings).toHaveBeenNthCalledWith(
        1,
        {},
        expect.any(String),
        false,
      );

      latestViewRequest = {
        requested: { tooltip: ['stale-annotation'] },
        present: { annotation: false, projection: false, tooltip: true },
        normalize: { annotation: false, projection: false, tooltip: false },
      };
      await controller.handleDataLoaded({
        detail: {
          ...defaultEventDetail,
          source: 'user',
          file: { name: 'custom.parquetbundle' } as File,
        },
      } as unknown as Event);

      expect(legendElement.clearForNewDataset).toHaveBeenNthCalledWith(2, expect.any(String), true);
      expect(viewController.setRequestedView).toHaveBeenCalledWith({
        requested: { tooltip: undefined },
        present: { annotation: false, projection: false, tooltip: false },
        normalize: { annotation: false, projection: false, tooltip: true },
      });

      await controller.handleDataLoaded(event);

      expect(legendElement.clearForNewDataset).toHaveBeenNthCalledWith(3, expect.any(String), true);
      expect(controlBar.clearForNewDataset).toHaveBeenNthCalledWith(3, expect.any(String), true);
      expect(legendElement.setFileSettings).toHaveBeenNthCalledWith(
        3,
        {},
        expect.any(String),
        true,
      );
    });

    it('restores saved tooltip annotations on an automatic load with a silent URL', async () => {
      mocks.readTooltipAnnotations.mockReturnValue(['ec']);
      const { controller, viewController } = createControllerHarness();

      await controller.handleDataLoaded({
        detail: {
          data,
          settings: { legendSettings: {}, exportOptions: {} },
          source: 'auto',
        },
      } as unknown as Event);

      expect(viewController.setRequestedView).toHaveBeenCalledWith({
        requested: { tooltip: ['ec'] },
        present: { annotation: false, projection: false, tooltip: true },
        normalize: { annotation: false, projection: false, tooltip: false },
      });
    });
  });
});
