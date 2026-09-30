import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: { error: mocks.error, warning: mocks.warning },
}));

vi.mock('./opfs-dataset-store', () => ({
  StoredDatasetCorruptError: class extends Error {},
  clearLastImportedFile: vi.fn(),
  loadLastImportedFile: vi.fn(),
  markLastLoadStatus: vi.fn(),
  readLastLoadStatus: vi.fn(),
}));

import { createPersistedDatasetController } from './persisted-dataset';

describe('loadDefaultDataset when the demo bundle cannot be fetched', () => {
  const setCurrentDatasetIsDemo = vi.fn();
  const setCurrentDatasetName = vi.fn();
  const loadFromFile = vi.fn();
  const registerFileLoad = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leaves the current dataset as it was and tells the user', async () => {
    const controller = createPersistedDatasetController({
      dataLoader: { loadFromFile } as never,
      registerFileLoad,
      setCurrentDatasetIsDemo,
      setCurrentDatasetName,
    });

    await controller.loadDefaultDataset();

    expect(setCurrentDatasetIsDemo).not.toHaveBeenCalled();
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(loadFromFile).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/data.parquetbundle');
    expect(registerFileLoad).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls[0]?.[0]).toMatchObject({
      title: 'Could not load the demo dataset',
      description: expect.stringContaining('404'),
    });
  });
});
