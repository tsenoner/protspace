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

// The demo fetch is the one load in the app that can fail without any file
// being involved (404, offline, a trailing-slash route resolving
// ./data.parquetbundle to the SPA fallback). Flagging the current dataset as the
// demo BEFORE that fetch succeeds is what disabled "Load demo dataset" with
// nothing else visibly happening: the plot kept the old data, the header said
// "Demo dataset", the button greyed out, and the failure went to the console.
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

    // On success handleDataLoaded sets both from the load's own metadata, so
    // this path must not touch them at all.
    expect(setCurrentDatasetIsDemo).not.toHaveBeenCalled();
    expect(setCurrentDatasetName).not.toHaveBeenCalled();
    expect(loadFromFile).not.toHaveBeenCalled();
    expect(registerFileLoad).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls[0]?.[0]).toMatchObject({
      title: 'Could not load the demo dataset',
      description: expect.stringContaining('404'),
    });
  });
});
