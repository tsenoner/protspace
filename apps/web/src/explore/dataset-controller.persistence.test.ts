import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildControllerOptions,
  dataErrorEvent,
  dataLoadedEvent,
} from './dataset-controller.fixtures';
import { EXAMPLE_DATASETS } from './example-datasets';
import { FastaPrepError } from './fasta-prep-client';
import type { LoadMeta } from './types';

const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  markLastLoadStatus: vi.fn(),
  saveLastImportedFile: vi.fn(),
  clearLastImportedFile: vi.fn(),
  resolvePendingLoadFinalization: vi.fn(),
  recoverFromCorruptedPersistedDataset: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./data-renderer', () => ({
  createDataRenderer: () => mocks.loadData,
}));

vi.mock('./persisted-dataset', () => ({
  createPersistedDatasetController: () => ({
    beginUserRequest: vi.fn(() => 1),
    beginImportPreparation: vi.fn(),
    cancelPendingExampleLoad: vi.fn(() => 'none'),
    clearCorruptedPersistedDataset: vi.fn(),
    commitExampleLoad: vi.fn(),
    currentRequestEpoch: vi.fn(() => 0),
    isCurrentRequest: () => true,
    loadExampleDataset: vi.fn(),
    loadPersistedOrDefaultDataset: vi.fn(),
    loadExampleDatasetAndClearPersistedFile: vi.fn(),
    recoverFromCorruptedPersistedDataset: mocks.recoverFromCorruptedPersistedDataset,
    tryLoadPersistedAgain: vi.fn(),
  }),
}));

vi.mock('./opfs-dataset-store', () => ({
  markLastLoadStatus: mocks.markLastLoadStatus,
  saveLastImportedFile: mocks.saveLastImportedFile,
  clearLastImportedFile: mocks.clearLastImportedFile,
}));

vi.mock('./tooltip-annotations-store', () => ({
  readTooltipAnnotations: () => [],
  writeTooltipAnnotations: vi.fn(),
}));

vi.mock('../lib/notify', () => ({
  notify: { warning: mocks.warning, info: mocks.info, error: mocks.error },
}));

import { createDatasetController } from './dataset-controller';

const file = new File(['bundle'], 'import.parquetbundle');

function buildController(loadMeta: LoadMeta = { sequence: 3, kind: 'user' }) {
  const options = buildControllerOptions({
    loadQueue: {
      getLoadMetaForFile: () => loadMeta,
      getRunningLoadMeta: () => loadMeta,
      getLatestSequence: () => 3,
      resolvePendingLoadFinalization: mocks.resolvePendingLoadFinalization,
    },
  });

  return { controller: createDatasetController(options) };
}

const loadedEvent = dataLoadedEvent({ settings: null, source: 'user', file });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markLastLoadStatus.mockResolvedValue(undefined);
  mocks.saveLastImportedFile.mockResolvedValue(undefined);
  mocks.loadData.mockResolvedValue(undefined);
});

describe('dataset controller OPFS persistence', () => {
  /** Drain the microtask queue so every already-resolved await has run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('stores the imported bytes before the render starts', async () => {
    let finishSave = () => {};
    mocks.saveLastImportedFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = () => resolve();
        }),
    );

    const { controller } = buildController();
    const pending = controller.handleDataLoaded(loadedEvent);
    await flush();

    // The recovery banner offers the file again after a crash during the render, so the
    // bytes must already be in OPFS when the render begins.
    expect(mocks.saveLastImportedFile).toHaveBeenCalledWith(file);
    expect(mocks.loadData).not.toHaveBeenCalled();

    finishSave();
    await pending;

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('success');
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
  });

  it('warns and still renders when the bytes cannot be stored', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.saveLastImportedFile.mockRejectedValue(new Error('quota exceeded'));

    const { controller } = buildController();
    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
    consoleError.mockRestore();
  });
});

describe('dataset controller load failures and the stored import', () => {
  // A user import is written to OPFS only once it has decoded (`handleDataLoaded`
  // saves it before the render), so one that fails before that never replaced the
  // stored import: what OPFS holds is still the previous import, which loaded fine.
  it.each([
    ['a bundle that fails to parse', dataErrorEvent('Invalid parquet bundle')],
    [
      'a FASTA whose preparation the backend rejects',
      {
        detail: {
          message: 'The embedding service is currently unavailable.',
          originalError: new FastaPrepError('The embedding service is currently unavailable.', {
            code: 'BIOCENTRAL_UNAVAILABLE',
          }),
        },
      } as unknown as Event,
    ],
  ])('%s leaves the stored import as it was', async (_label, errorEvent) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = buildController({ sequence: 3, kind: 'user', epoch: 1 });

    await controller.handleDataError(errorEvent);

    // Flagging the stored import would make the next visit offer recovery for a
    // dataset that loads fine, instead of restoring it.
    expect(mocks.markLastLoadStatus).not.toHaveBeenCalled();
    expect(mocks.saveLastImportedFile).not.toHaveBeenCalled();
    expect(mocks.clearLastImportedFile).not.toHaveBeenCalled();
    expect(mocks.recoverFromCorruptedPersistedDataset).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
    consoleError.mockRestore();
  });

  it('a restore of the stored import that fails to parse flags it as failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { controller } = buildController({ sequence: 3, kind: 'opfs', epoch: 0 });

    await controller.handleDataError(dataErrorEvent('Invalid parquet bundle'));

    expect(mocks.markLastLoadStatus).toHaveBeenCalledWith('error', {
      error: 'Invalid parquet bundle',
    });
    expect(mocks.recoverFromCorruptedPersistedDataset).toHaveBeenCalledWith(
      'could not be loaded',
      0,
    );
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
    consoleError.mockRestore();
  });

  it('a user import that decoded but failed to render stays stored as unfinished', async () => {
    // Saved before its render, the new import has replaced the old one in OPFS, so
    // it is the one the next visit must offer to recover: it keeps the 'pending'
    // status the save wrote, never 'success'.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadData.mockRejectedValue(new Error('WebGL context lost'));
    const { controller } = buildController({ sequence: 3, kind: 'user', epoch: 1 });

    await controller.handleDataLoaded(loadedEvent);

    expect(mocks.saveLastImportedFile).toHaveBeenCalledWith(file);
    expect(mocks.markLastLoadStatus).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, false);
    consoleError.mockRestore();
  });
});

describe('dataset controller legacy bundle notice', () => {
  const eventFor = (bundleFormatVersion: number | undefined, unplacedProteinCount?: number) =>
    dataLoadedEvent({
      settings: null,
      source: 'user',
      file,
      bundleFormatVersion,
      unplacedProteinCount,
    });

  it('points a user who imported a v2 bundle to re-export and protspace convert', async () => {
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(2));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledOnce();
    const [notice] = mocks.info.mock.calls[0];
    expect(notice.description).toMatch(/5\.0\.0/);
    expect(notice.description).toMatch(/export it again/);
    expect(notice.description).toMatch(/protspace convert/);
  });

  it('sends a v2 bundle holding proteins without coordinates to protspace convert only', async () => {
    // An export from the app holds the proteins it shows, so it would drop these three.
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(2, 3));

    const [notice] = mocks.info.mock.calls[0];
    expect(notice.description).toMatch(/protspace convert/);
    expect(notice.description).toMatch(/3 proteins without coordinates/);
    expect(notice.description).toMatch(/an export from here leaves out/);
    expect(notice.description).not.toMatch(/export it again/);
    expect(controller.getUnplacedProteinCount()).toBe(3);
  });

  it('remembers how many proteins each loaded file holds without coordinates', async () => {
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(3, 2));
    expect(controller.getUnplacedProteinCount()).toBe(2);
    await controller.handleDataLoaded(eventFor(3));
    expect(controller.getUnplacedProteinCount()).toBe(0);
  });

  it.each([
    ['a v3 bundle', 3],
    ['a plain parquet file', undefined],
  ])('stays quiet for %s', async (_label, version) => {
    const { controller } = buildController();
    await controller.handleDataLoaded(eventFor(version));

    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('stays quiet for a dataset the app serves itself, even a legacy one', async () => {
    const { controller } = buildController({ sequence: 3, kind: 'default' });
    await controller.handleDataLoaded(eventFor(1));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('stays quiet for an example chosen from the menu, even a legacy one', async () => {
    // An example load is 'default' kind and carries its catalog entry; a visitor cannot
    // convert a file the app serves, so its format is never theirs to fix.
    const { controller } = buildController({
      sequence: 3,
      kind: 'default',
      epoch: 1,
      example: { entry: EXAMPLE_DATASETS[1], source: 'menu', replacesStoredImport: true },
    });
    await controller.handleDataLoaded(eventFor(2));

    expect(mocks.loadData).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.resolvePendingLoadFinalization).toHaveBeenCalledWith(3, true);
  });
});
