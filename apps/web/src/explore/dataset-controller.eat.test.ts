import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EAT_CONFIDENCE_THRESHOLD } from '@protspace/utils';
import { buildControllerOptions, dataLoadedEvent } from './dataset-controller.fixtures';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
}));

vi.mock('./data-renderer', () => ({
  createDataRenderer: () => mocks.loadData,
}));

vi.mock('./persisted-dataset', () => ({
  createPersistedDatasetController: () => ({
    loadExampleDatasetAndClearPersistedFile: vi.fn(),
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
  readTooltipAnnotations: (): string[] => [],
  writeTooltipAnnotations: vi.fn(),
}));

import { createDatasetController } from './dataset-controller';

describe('dataset controller EAT settings restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue(undefined);
    mocks.markLastLoadStatus.mockResolvedValue(undefined);
  });

  it('applies embedded EAT settings after an OPFS reload while retaining OPFS legend precedence', async () => {
    const controlBar = {
      clearForNewDataset: vi.fn(),
      hasFileSettings: false,
    };
    const legendElement = {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(),
      applyEatSettings: vi.fn(),
    };
    const options = buildControllerOptions({
      controlBar,
      legendElement,
      plotElement: { eatOverlayEnabled: true },
      loadQueue: {
        getRunningLoadMeta: () => ({ sequence: 7, kind: 'opfs' }),
        getLatestSequence: () => 7,
      },
    });
    const controller = createDatasetController(options);

    await controller.handleDataLoaded(
      dataLoadedEvent({
        settings: {
          legendSettings: { ec: { categories: {} } },
          exportOptions: {},
          eatOverlayEnabled: false,
          eatConfidenceThreshold: 0.75,
        },
      }),
    );

    expect(controlBar.clearForNewDataset).toHaveBeenCalledOnce();
    expect(legendElement.applyEatSettings).toHaveBeenCalledWith(false, 0.75);
    expect(controlBar.hasFileSettings).toBe(true);
    expect(legendElement.setFileSettings).not.toHaveBeenCalled();
    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(options.loadQueue.resolvePendingLoadFinalization).toHaveBeenCalledWith(7, true);

    await controller.handleDataLoaded(
      dataLoadedEvent({
        settings: {
          legendSettings: {},
          exportOptions: {},
          eatOverlayEnabled: true,
        },
      }),
    );
    expect(legendElement.applyEatSettings).toHaveBeenLastCalledWith(
      true,
      DEFAULT_EAT_CONFIDENCE_THRESHOLD,
    );
  });

  it('applies a bundle shape size after the legend settings of a user import', async () => {
    const controlBar = { clearForNewDataset: vi.fn(), hasFileSettings: false };
    const calls: string[] = [];
    const legendElement = {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(() => calls.push('setFileSettings')),
      applyShapeSize: vi.fn((size: number, hash: string) =>
        calls.push(`applyShapeSize:${size}:${typeof hash}`),
      ),
      applyEatSettings: vi.fn(),
    };
    const controller = createDatasetController(
      buildControllerOptions({
        controlBar,
        legendElement,
        plotElement: { eatOverlayEnabled: true },
        loadQueue: {
          getRunningLoadMeta: () => ({ sequence: 3, kind: 'user' }),
          getLatestSequence: () => 3,
        },
      }),
    );

    await controller.handleDataLoaded(
      dataLoadedEvent({
        settings: { legendSettings: {}, exportOptions: {}, shapeSize: 12 },
        source: 'user',
      }),
    );

    expect(calls).toEqual(['setFileSettings', 'applyShapeSize:12:string']);
    expect(controlBar.hasFileSettings).toBe(true);
  });
});
