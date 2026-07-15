import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EAT_CONFIDENCE_THRESHOLD, type VisualizationData } from '@protspace/utils';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
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
  readTooltipAnnotations: () => [],
  writeTooltipAnnotations: vi.fn(),
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

describe('dataset controller EAT settings restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
  });

  it('applies embedded EAT settings after an OPFS reload while retaining OPFS legend precedence', async () => {
    const controlBar = {
      clearForNewDataset: vi.fn(),
      applyEatSettings: vi.fn(),
      hasFileSettings: false,
    };
    const legendElement = {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(),
    };
    const plotElement = {
      eatOverlayEnabled: true,
      eatConfidenceThreshold: 0.5,
    };
    const viewController = {
      subscribeToViewChanges: vi.fn(() => () => {}),
      resolveLatestView: vi.fn(),
      getLatestViewRequest: vi.fn(() => createEmptyExploreViewRequest()),
      applyLatestViewForDatasetLoad: vi.fn(),
      setRequestedView: vi.fn(),
    };
    const options = {
      controlBar,
      dataLoader: {},
      defaultDatasetName: 'default.parquetbundle',
      getIsDisposed: () => false,
      interactionController: {},
      legendElement,
      loadQueue: {
        registerFileLoad: vi.fn(),
        getLoadMetaForFile: vi.fn(),
        getRunningLoadMeta: () => ({ sequence: 7, kind: 'opfs' as const }),
        getLatestSequence: () => 7,
        resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
      },
      overlayController: { update: vi.fn() },
      plotElement,
      setCurrentDatasetIsDemo: vi.fn(),
      setCurrentDatasetName: vi.fn(),
      structureViewer: {},
      viewController,
    } as unknown as Parameters<typeof createDatasetController>[0];
    const controller = createDatasetController(options);

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
    expect(controlBar.applyEatSettings).toHaveBeenCalledWith(false, 0.75);
    expect(plotElement.eatOverlayEnabled).toBe(false);
    expect(plotElement.eatConfidenceThreshold).toBe(0.75);
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
    expect(controlBar.applyEatSettings).toHaveBeenLastCalledWith(
      true,
      DEFAULT_EAT_CONFIDENCE_THRESHOLD,
    );
    expect(plotElement.eatConfidenceThreshold).toBe(DEFAULT_EAT_CONFIDENCE_THRESHOLD);
  });
});
