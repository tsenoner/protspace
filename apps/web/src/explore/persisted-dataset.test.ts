import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: notifyMock,
}));

vi.mock('./opfs-dataset-store', () => ({
  StoredDatasetCorruptError: class StoredDatasetCorruptError extends Error {},
  clearLastImportedFile: vi.fn().mockResolvedValue(undefined),
  loadLastImportedFile: vi.fn().mockResolvedValue(null),
  markLastLoadStatus: vi.fn().mockResolvedValue(undefined),
  readLastLoadStatus: vi.fn().mockResolvedValue(null),
}));

import { createPersistedDatasetController } from './persisted-dataset';

const DEMO = EXAMPLE_DATASETS[0];

function createController() {
  const dataLoader = { loadFromFile: vi.fn().mockResolvedValue(undefined) };
  const overlayController = { update: vi.fn() };
  const registerFileLoad = vi.fn();
  const setCurrentExampleId = vi.fn();
  const setCurrentDatasetName = vi.fn();

  const controller = createPersistedDatasetController({
    dataLoader: dataLoader as never,
    overlayController,
    registerFileLoad,
    setCurrentExampleId,
    setCurrentDatasetName,
  });

  return {
    controller,
    dataLoader,
    overlayController,
    registerFileLoad,
    setCurrentExampleId,
    setCurrentDatasetName,
  };
}

describe('loadExampleDataset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the bundle, loads it, and sets the dataset name/id on success', async () => {
    const arrayBuffer = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });
    vi.stubGlobal('fetch', fetchMock);

    const {
      controller,
      dataLoader,
      overlayController,
      registerFileLoad,
      setCurrentExampleId,
      setCurrentDatasetName,
    } = createController();

    const result = await controller.loadExampleDataset(DEMO);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(DEMO.url);
    expect(registerFileLoad).toHaveBeenCalledWith(expect.any(File), 'default');
    expect(setCurrentDatasetName).toHaveBeenCalledWith(DEMO.label);
    expect(setCurrentExampleId).toHaveBeenCalledWith(DEMO.id);
    expect(dataLoader.loadFromFile).toHaveBeenCalledWith(expect.any(File), { source: 'auto' });
    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(overlayController.update).not.toHaveBeenCalled();
  });

  it('notifies, dismisses the overlay, and returns false on an HTTP failure, without touching the current dataset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', fetchMock);

    const {
      controller,
      dataLoader,
      overlayController,
      registerFileLoad,
      setCurrentExampleId,
      setCurrentDatasetName,
    } = createController();

    const result = await controller.loadExampleDataset(DEMO);

    expect(result).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(overlayController.update).toHaveBeenCalledWith(false);
    expect(registerFileLoad).not.toHaveBeenCalled();
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
  });

  it('notifies and returns false when the fetch itself rejects (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { controller, setCurrentExampleId, setCurrentDatasetName } = createController();

    const result = await controller.loadExampleDataset(DEMO);

    expect(result).toBe(false);
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(setCurrentExampleId).not.toHaveBeenCalled();
  });
});

describe('loadExampleDatasetAndClearPersistedFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('warns and does nothing for an unknown id', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controller, dataLoader } = createController();

    await controller.loadExampleDatasetAndClearPersistedFile('not-a-real-id');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not-a-real-id'));
    expect(dataLoader.loadFromFile).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loads the demo example by default via loadDefaultDatasetAndClearPersistedFile', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { controller, setCurrentExampleId } = createController();

    await controller.loadDefaultDatasetAndClearPersistedFile();

    expect(setCurrentExampleId).toHaveBeenCalledWith(DEMO.id);
  });
});
