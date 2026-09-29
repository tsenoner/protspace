import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  maybeRunWebglPerfSuite: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: notifyMock,
}));

vi.mock('../perf/webgl-perf-suite', () => ({
  maybeRunWebglPerfSuite: mocks.maybeRunWebglPerfSuite,
}));

vi.mock('./opfs-dataset-store', () => ({
  clearLastImportedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./recovery-banner', () => ({
  showRecoveryBanner: vi.fn(),
  dismissRecoveryBanner: vi.fn(),
}));

import {
  loadDatasetAfterNavigation,
  loadRequestedDatasetOrFallback,
  startInitialExploreLoad,
} from './startup';

const DEMO = EXAMPLE_DATASETS[0];

function createDatasetController() {
  return {
    loadDefaultDatasetAndClearPersistedFile: vi.fn().mockResolvedValue(undefined),
    loadExampleDatasetAndClearPersistedFile: vi.fn().mockResolvedValue('loaded'),
    loadExampleDataset: vi.fn().mockResolvedValue('loaded'),
    loadPersistedOrDefaultDataset: vi.fn().mockResolvedValue({ kind: 'default-loaded' }),
    tryLoadPersistedAgain: vi.fn().mockResolvedValue(undefined),
    beginUserRequest: vi.fn(() => 8),
    currentRequestEpoch: vi.fn(() => 5),
    subscribeToDatasetChanges: vi.fn(() => () => {}),
    handleLoadingStart: vi.fn(),
    handleLoadingProgress: vi.fn(),
    handleDataLoaded: vi.fn(),
    handleDataError: vi.fn(),
  };
}

describe('loadRequestedDatasetOrFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a known id via loadExampleDataset and never touches the persisted-or-default flow', async () => {
    const datasetController = createDatasetController();

    await loadRequestedDatasetOrFallback(datasetController as never, DEMO.id);

    // Without an explicit epoch it runs under the current one.
    expect(datasetController.loadExampleDataset).toHaveBeenCalledWith(DEMO.id, { epoch: 5 });
    expect(datasetController.loadPersistedOrDefaultDataset).not.toHaveBeenCalled();
    expect(notifyMock.warning).not.toHaveBeenCalled();
  });

  it('warns and falls back to the persisted-or-default flow for an unknown id', async () => {
    const datasetController = createDatasetController();

    await loadRequestedDatasetOrFallback(datasetController as never, 'not-a-real-id');

    expect(datasetController.loadExampleDataset).not.toHaveBeenCalled();
    expect(notifyMock.warning).toHaveBeenCalledTimes(1);
    expect(notifyMock.warning).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('example dataset') }),
    );
    expect(datasetController.loadPersistedOrDefaultDataset).toHaveBeenCalledTimes(1);
  });

  it('falls back to the persisted-or-default flow when a known id fails to load, without an extra warning', async () => {
    const datasetController = createDatasetController();
    datasetController.loadExampleDataset.mockResolvedValue('failed');

    await loadRequestedDatasetOrFallback(datasetController as never, DEMO.id, { epoch: 7 });

    expect(datasetController.loadExampleDataset).toHaveBeenCalledWith(DEMO.id, { epoch: 7 });
    // The loader itself already notified the failure (persisted-dataset.ts); the
    // fallback path here must not warn on top of that.
    expect(notifyMock.warning).not.toHaveBeenCalled();
    // The fallback runs under the same epoch, so it yields to a user request
    // made while the example was still loading.
    expect(datasetController.loadPersistedOrDefaultDataset).toHaveBeenCalledWith({ epoch: 7 });
  });

  it("never runs the fallback for a 'superseded' outcome: no toast, no fallback load, no warning", async () => {
    // Regression covered by example-datasets.spec.ts's "rapid Back past a
    // still-loading entry" case: a request abandoned because a newer one
    // started must do nothing further. Treating 'superseded' like 'failed'
    // here is what let a stale request run the persisted-or-default flow
    // (the demo) over whatever the newer request had already loaded.
    const datasetController = createDatasetController();
    datasetController.loadExampleDataset.mockResolvedValue('superseded');

    await loadRequestedDatasetOrFallback(datasetController as never, DEMO.id);

    expect(datasetController.loadExampleDataset).toHaveBeenCalledWith(DEMO.id, { epoch: 5 });
    expect(notifyMock.warning).not.toHaveBeenCalled();
    expect(datasetController.loadPersistedOrDefaultDataset).not.toHaveBeenCalled();
  });

  it('runs the normal persisted-or-default flow directly when no id is requested', async () => {
    const datasetController = createDatasetController();

    await loadRequestedDatasetOrFallback(datasetController as never, null);

    expect(datasetController.loadExampleDataset).not.toHaveBeenCalled();
    expect(notifyMock.warning).not.toHaveBeenCalled();
    expect(datasetController.loadPersistedOrDefaultDataset).toHaveBeenCalledTimes(1);
  });

  it('shows the recovery banner when the persisted-or-default flow requires it', async () => {
    const { showRecoveryBanner } = await import('./recovery-banner');
    const datasetController = createDatasetController();
    const file = new File(['x'], 'mine.parquetbundle');
    datasetController.loadPersistedOrDefaultDataset.mockResolvedValue({
      kind: 'recovery-required',
      file,
      failedAttempts: 2,
    });

    await loadRequestedDatasetOrFallback(datasetController as never, null);

    expect(showRecoveryBanner).toHaveBeenCalledTimes(1);
  });

  it("shows no recovery banner when a user request preempted the flow ('preempted')", async () => {
    const { showRecoveryBanner } = await import('./recovery-banner');
    const datasetController = createDatasetController();
    datasetController.loadPersistedOrDefaultDataset.mockResolvedValue({ kind: 'preempted' });

    await loadRequestedDatasetOrFallback(datasetController as never, null);

    expect(showRecoveryBanner).not.toHaveBeenCalled();
    expect(notifyMock.warning).not.toHaveBeenCalled();
  });

  it('a request without an id runs the startup flow under the epoch it was given', async () => {
    // A Back to an entry without `dataset=` passes a new user epoch, so the
    // pending example it supersedes can't win afterwards.
    const datasetController = createDatasetController();

    await loadRequestedDatasetOrFallback(datasetController as never, null, { epoch: 8 });

    expect(datasetController.loadPersistedOrDefaultDataset).toHaveBeenCalledWith({ epoch: 8 });
  });
});

describe('loadDatasetAfterNavigation (Back/Forward after the first load)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('begins a user request before loading the named example under it', async () => {
    const datasetController = createDatasetController();

    await loadDatasetAfterNavigation(datasetController as never, DEMO.id);

    expect(datasetController.loadExampleDataset).toHaveBeenCalledWith(DEMO.id, { epoch: 8 });
    expect(datasetController.beginUserRequest.mock.invocationCallOrder[0]).toBeLessThan(
      datasetController.loadExampleDataset.mock.invocationCallOrder[0],
    );
  });

  it('Back to an entry without dataset= begins a user request before the startup flow', async () => {
    const datasetController = createDatasetController();

    await loadDatasetAfterNavigation(datasetController as never, null);

    expect(datasetController.loadPersistedOrDefaultDataset).toHaveBeenCalledWith({ epoch: 8 });
    expect(datasetController.beginUserRequest.mock.invocationCallOrder[0]).toBeLessThan(
      datasetController.loadPersistedOrDefaultDataset.mock.invocationCallOrder[0],
    );
  });
});

describe('startInitialExploreLoad', () => {
  const dataLoader = {} as never;
  const plotElement = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers to the perf-suite override and never touches the dataset controller when it handles the load', async () => {
    mocks.maybeRunWebglPerfSuite.mockResolvedValue(true);
    const datasetController = createDatasetController();

    await startInitialExploreLoad({
      dataLoader,
      datasetController: datasetController as never,
      plotElement,
      requestedExampleId: DEMO.id,
    });

    expect(datasetController.loadExampleDataset).not.toHaveBeenCalled();
    expect(datasetController.loadPersistedOrDefaultDataset).not.toHaveBeenCalled();
  });

  it('loads the requested example when the perf suite does not handle the load', async () => {
    mocks.maybeRunWebglPerfSuite.mockResolvedValue(false);
    const datasetController = createDatasetController();

    await startInitialExploreLoad({
      dataLoader,
      datasetController: datasetController as never,
      plotElement,
      requestedExampleId: DEMO.id,
    });

    expect(datasetController.loadExampleDataset).toHaveBeenCalledWith(DEMO.id, { epoch: 5 });
  });

  it('runs the normal flow under the epoch captured before the perf check', async () => {
    const datasetController = createDatasetController();
    // A user request lands while the perf check is still running: the
    // startup flow must keep the epoch it began with, so it yields.
    mocks.maybeRunWebglPerfSuite.mockImplementation(async () => {
      datasetController.currentRequestEpoch.mockReturnValue(6);
      return false;
    });

    await startInitialExploreLoad({
      dataLoader,
      datasetController: datasetController as never,
      plotElement,
      requestedExampleId: null,
    });

    expect(datasetController.loadPersistedOrDefaultDataset).toHaveBeenCalledWith({ epoch: 5 });
    expect(datasetController.beginUserRequest).not.toHaveBeenCalled();
  });
});
