import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import { notify } from '../lib/notify';
import {
  StoredDatasetCorruptError,
  clearLastImportedFile,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
} from './opfs-dataset-store';
import { getCorruptedPersistedDatasetNotification } from './notifications';
import type { DatasetLoadKind } from './types';

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
  defaultDatasetName: string;
  registerFileLoad(file: File, kind: DatasetLoadKind): void;
  setCurrentDatasetIsDemo(isDemo: boolean): void;
  setCurrentDatasetName(name: string): void;
}

export function createPersistedDatasetController({
  dataLoader,
  defaultDatasetName,
  registerFileLoad,
  setCurrentDatasetIsDemo,
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

  const loadDefaultDataset = async () => {
    try {
      setCurrentDatasetName(defaultDatasetName);
      setCurrentDatasetIsDemo(true);
      console.log('Loading data from data.parquetbundle...');

      const response = await fetch('./data.parquetbundle');
      if (!response.ok) {
        throw new Error(`File not found: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const file = new File([arrayBuffer], 'data.parquetbundle', {
        type: 'application/octet-stream',
      });

      console.log(`File loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      registerFileLoad(file, 'default');
      await dataLoader.loadFromFile(file, { source: 'auto' });
    } catch (error) {
      console.error('Failed to load data from file:', error);
      console.log('Make sure data.parquetbundle exists in the public directory');
      console.log(
        'Alternative: You can drag and drop the data.parquetbundle file onto the data loader component',
      );

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Auto-load failed: ${errorMessage}`);
      console.log(
        'The data loader is ready for drag-and-drop. Simply drag the data.parquetbundle file onto the component.',
      );
    }
  };

  const recoverFromCorruptedPersistedDataset = async (context: string) => {
    await clearCorruptedPersistedDataset(context);
    await loadDefaultDataset();
  };

  const loadPersistedFile = async (persistedFile: File): Promise<void> => {
    await markLastLoadStatus('pending');
    registerFileLoad(persistedFile, 'opfs');
    setCurrentDatasetName(persistedFile.name);
    setCurrentDatasetIsDemo(false);
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
      await loadDefaultDataset();
      return { kind: 'default-loaded' };
    }

    const status = await readLastLoadStatus();
    if (status?.status === 'pending' || status?.status === 'error') {
      console.log(
        `Persisted dataset has unresolved status (${status.status}). ` +
          'Showing recovery banner instead of auto-loading.',
      );
      setCurrentDatasetName(persistedFile.name);
      setCurrentDatasetIsDemo(false);
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

  const loadDefaultDatasetAndClearPersistedFile = async () => {
    try {
      await clearLastImportedFile();
    } catch (error) {
      console.warn('Failed to clear persisted dataset before loading the default dataset:', error);
    }
    await loadDefaultDataset();
  };

  return {
    clearCorruptedPersistedDataset,
    loadDefaultDataset,
    loadPersistedOrDefaultDataset,
    loadDefaultDatasetAndClearPersistedFile,
    recoverFromCorruptedPersistedDataset,
    tryLoadPersistedAgain,
  };
}
