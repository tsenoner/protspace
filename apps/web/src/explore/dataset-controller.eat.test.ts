import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EAT_CONFIDENCE_THRESHOLD } from '@protspace/utils';
import { buildControllerOptions, dataLoadedEvent } from './dataset-controller.fixtures';
import type { LoadMeta } from './types';
import { createEmptyExploreViewRequest } from './url-state';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  readTooltipAnnotations: vi.fn((): string[] => []),
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
  readTooltipAnnotations: mocks.readTooltipAnnotations,
  writeTooltipAnnotations: vi.fn(),
}));

import { createDatasetController } from './dataset-controller';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadData.mockResolvedValue(undefined);
  mocks.markLastLoadStatus.mockResolvedValue(undefined);
  mocks.readTooltipAnnotations.mockReturnValue([]);
});

describe('dataset controller EAT settings restore', () => {
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

describe('dataset controller legend persistence lifecycle', () => {
  it('keeps saved settings on the first automatic load and clears them on later loads', async () => {
    let runningLoadMeta: LoadMeta = { sequence: 1, kind: 'default' };
    const empty = createEmptyExploreViewRequest();
    let latestViewRequest = empty;
    const legendElement = {
      clearForNewDataset: vi.fn(),
      setFileSettings: vi.fn(),
      applyShapeSize: vi.fn(),
      applyEatSettings: vi.fn(),
    };
    const options = buildControllerOptions({
      legendElement,
      loadQueue: {
        getRunningLoadMeta: () => runningLoadMeta,
        getLatestSequence: () => runningLoadMeta.sequence,
      },
    });
    options.viewController.getLatestViewRequest.mockImplementation(() => latestViewRequest);
    const { controlBar, viewController } = options;
    const controller = createDatasetController(options);
    const settings = { legendSettings: {}, exportOptions: {}, shapeSize: 12 };

    // Startup: the demo or an example opened by a reload or a projection link.
    await controller.handleDataLoaded(dataLoadedEvent({ settings }));

    expect(legendElement.clearForNewDataset).toHaveBeenLastCalledWith(expect.any(String), false);
    expect(controlBar.clearForNewDataset).toHaveBeenLastCalledWith(expect.any(String), false);
    expect(legendElement.setFileSettings).toHaveBeenLastCalledWith({}, expect.any(String), false);
    expect(legendElement.applyShapeSize).toHaveBeenLastCalledWith(12, expect.any(String), false);

    // A user import while the URL still carries the previous dataset's tooltip.
    runningLoadMeta = { sequence: 2, kind: 'user' };
    latestViewRequest = {
      requested: { tooltip: ['stale-annotation'] },
      present: { ...empty.present, tooltip: true },
      normalize: empty.normalize,
    };
    await controller.handleDataLoaded(dataLoadedEvent({ settings, source: 'user' }));

    expect(legendElement.clearForNewDataset).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(viewController.setRequestedView).toHaveBeenCalledWith({
      requested: { tooltip: undefined },
      present: empty.present,
      normalize: { ...empty.normalize, tooltip: true },
    });

    // Choosing the demo or an example from the Import menu once a dataset is shown.
    runningLoadMeta = { sequence: 3, kind: 'default' };
    await controller.handleDataLoaded(dataLoadedEvent({ settings }));

    expect(legendElement.clearForNewDataset).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(controlBar.clearForNewDataset).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(legendElement.setFileSettings).toHaveBeenLastCalledWith({}, expect.any(String), true);
    expect(legendElement.applyShapeSize).toHaveBeenLastCalledWith(12, expect.any(String), true);
  });

  it('restores the saved tooltip fields on an automatic load when the URL is silent', async () => {
    mocks.readTooltipAnnotations.mockReturnValue(['ec']);
    const options = buildControllerOptions({
      loadQueue: {
        getRunningLoadMeta: () => ({ sequence: 1, kind: 'default' }),
        getLatestSequence: () => 1,
      },
    });
    const controller = createDatasetController(options);

    await controller.handleDataLoaded(
      dataLoadedEvent({ settings: { legendSettings: {}, exportOptions: {} } }),
    );

    const empty = createEmptyExploreViewRequest();
    expect(options.viewController.setRequestedView).toHaveBeenCalledWith({
      requested: { tooltip: ['ec'] },
      present: { ...empty.present, tooltip: true },
      normalize: empty.normalize,
    });
  });
});
