import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import { notify } from '../lib/notify';
import { EXAMPLE_DATASETS, findExampleDataset, type ExampleDataset } from './example-datasets';
import {
  StoredDatasetCorruptError,
  clearLastImportedFile,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
} from './opfs-dataset-store';
import {
  getCorruptedPersistedDatasetNotification,
  getExampleLoadFailureNotification,
} from './notifications';
import type { DatasetLoadKind } from './types';

const DEFAULT_EXAMPLE = EXAMPLE_DATASETS[0];

export type PersistedLoadOutcome =
  | { kind: 'auto-loaded' }
  | { kind: 'default-loaded' }
  | {
      kind: 'recovery-required';
      file: File;
      lastError?: string;
      failedAttempts: number;
    };

interface PersistedDatasetOptions {
  dataLoader: ProtspaceDataLoader;
  overlayController: {
    update(show: boolean, progress?: number, message?: string, subMessage?: string): void;
  };
  registerFileLoad(file: File, kind: DatasetLoadKind): void;
  setCurrentExampleId(id: string | null): void;
  setCurrentDatasetName(name: string): void;
}

export function createPersistedDatasetController({
  dataLoader,
  overlayController,
  registerFileLoad,
  setCurrentExampleId,
  setCurrentDatasetName,
}: PersistedDatasetOptions) {
  const clearCorruptedPersistedDataset = async (context: string) => {
    try {
      await clearLastImportedFile();
    } catch (clearError) {
      console.warn('Failed to clear invalid persisted dataset:', clearError);
    }
    notify.warning(getCorruptedPersistedDatasetNotification(context));
  };

  const loadExampleDataset = async (entry: ExampleDataset): Promise<boolean> => {
    try {
      const response = await fetch(entry.url);
      if (!response.ok) {
        throw new Error(`File not found: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const fileName = entry.url.split('/').pop() ?? entry.id;
      const file = new File([arrayBuffer], fileName, {
        type: 'application/octet-stream',
      });

      registerFileLoad(file, 'default');
      // Set the name/id only once the fetch has actually succeeded, so a failed
      // load below never overwrites what's currently shown.
      setCurrentDatasetName(entry.label);
      setCurrentExampleId(entry.id);
      await dataLoader.loadFromFile(file, { source: 'auto' });
      return true;
    } catch (error) {
      console.error(`Failed to load example dataset "${entry.id}":`, error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      notify.error(getExampleLoadFailureNotification(entry, message));
      overlayController.update(false);
      return false;
    }
  };

  const recoverFromCorruptedPersistedDataset = async (context: string) => {
    await clearCorruptedPersistedDataset(context);
    await loadExampleDataset(DEFAULT_EXAMPLE);
  };

  const loadPersistedFile = async (persistedFile: File): Promise<void> => {
    await markLastLoadStatus('pending');
    registerFileLoad(persistedFile, 'opfs');
    setCurrentDatasetName(persistedFile.name);
    setCurrentExampleId(null);
    await dataLoader.loadFromFile(persistedFile, { source: 'auto' });
  };

  const loadPersistedOrDefaultDataset = async (): Promise<PersistedLoadOutcome> => {
    let persistedFile: File | null = null;
    try {
      persistedFile = await loadLastImportedFile();
    } catch (error) {
      console.error('Failed to restore persisted dataset:', error);
      if (error instanceof StoredDatasetCorruptError) {
        await recoverFromCorruptedPersistedDataset('in browser storage is corrupted');
        return { kind: 'default-loaded' };
      }
    }

    if (!persistedFile) {
      await loadExampleDataset(DEFAULT_EXAMPLE);
      return { kind: 'default-loaded' };
    }

    const status = await readLastLoadStatus();
    if (status?.status === 'pending' || status?.status === 'error') {
      console.log(
        `Persisted dataset has unresolved status (${status.status}). ` +
          'Showing recovery banner instead of auto-loading.',
      );
      setCurrentDatasetName(persistedFile.name);
      setCurrentExampleId(null);
      return {
        kind: 'recovery-required',
        file: persistedFile,
        lastError: status.lastError,
        failedAttempts: status.failedAttempts,
      };
    }

    await loadPersistedFile(persistedFile);
    return { kind: 'auto-loaded' };
  };

  const tryLoadPersistedAgain = async (file: File): Promise<void> => {
    await loadPersistedFile(file);
  };

  const loadExampleDatasetAndClearPersistedFile = async (id: string): Promise<boolean> => {
    const entry = findExampleDataset(id);
    if (!entry) {
      console.warn(`Unknown example dataset id: ${id}`);
      return false;
    }

    try {
      await clearLastImportedFile();
    } catch (error) {
      console.warn('Failed to clear persisted dataset before loading example dataset:', error);
    }
    return loadExampleDataset(entry);
  };

  const loadDefaultDatasetAndClearPersistedFile = (): Promise<boolean> =>
    loadExampleDatasetAndClearPersistedFile(DEFAULT_EXAMPLE.id);

  return {
    clearCorruptedPersistedDataset,
    loadExampleDataset,
    loadPersistedOrDefaultDataset,
    loadExampleDatasetAndClearPersistedFile,
    loadDefaultDatasetAndClearPersistedFile,
    recoverFromCorruptedPersistedDataset,
    tryLoadPersistedAgain,
  };
}
