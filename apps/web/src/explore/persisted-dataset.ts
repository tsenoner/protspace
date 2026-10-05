import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import { notify } from '../lib/notify';
import {
  DEFAULT_EXAMPLE_DATASET,
  findExampleDataset,
  type ExampleDataset,
} from './example-datasets';
import { resolveExampleUrl } from './example-url';
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
import type { LoadQueue } from './load-queue';
import type { DatasetChangeSource, ExampleLoadOutcome } from './types';

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
  registerFileLoad: LoadQueue['registerFileLoad'];
  awaitLoadOutcome: LoadQueue['awaitLoadOutcome'];
  setCurrentExampleId(id: string | null): void;
  setCurrentDatasetName(name: string): void;
}

export function createPersistedDatasetController({
  dataLoader,
  overlayController,
  registerFileLoad,
  awaitLoadOutcome,
  setCurrentExampleId,
  setCurrentDatasetName,
}: PersistedDatasetOptions) {
  // Guards against overlapping example fetches (two menu/url requests, or a
  // user import/OPFS restore starting while one is in flight): each call to
  // `loadExampleDataset` — and each `supersedePendingExampleFetch` — bumps
  // this, and a request bails out as soon as it sees it's no longer current.
  let exampleRequestSequence = 0;
  const beginExampleRequest = (): number => {
    exampleRequestSequence += 1;
    return exampleRequestSequence;
  };
  const isCurrentExampleRequest = (requestId: number): boolean =>
    requestId === exampleRequestSequence;
  const supersedePendingExampleFetch = (): void => {
    beginExampleRequest();
  };

  const clearCorruptedPersistedDataset = async (context: string) => {
    try {
      await clearLastImportedFile();
    } catch (clearError) {
      console.warn('Failed to clear invalid persisted dataset:', clearError);
    }
    notify.warning(getCorruptedPersistedDatasetNotification(context));
  };

  const loadExampleDataset = async (
    entry: ExampleDataset,
    source: DatasetChangeSource,
    { replacesStoredImport = false }: { replacesStoredImport?: boolean } = {},
  ): Promise<ExampleLoadOutcome> => {
    const requestId = beginExampleRequest();
    overlayController.update(true, 0, `Downloading ${entry.label}…`);

    try {
      const response = await fetch(resolveExampleUrl(entry.url));
      if (!isCurrentExampleRequest(requestId)) {
        return 'superseded';
      }
      if (!response.ok) {
        throw new Error(`File not found: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      if (!isCurrentExampleRequest(requestId)) {
        return 'superseded';
      }

      const fileName = entry.url.split('/').pop() ?? entry.id;
      const file = new File([arrayBuffer], fileName, {
        type: 'application/octet-stream',
      });

      // Name/id/emit are set by `handleDataLoaded`, once the load has actually
      // finished decoding — never here, so a fetch that resolves after this
      // request was superseded (or whose bundle fails to parse) can never
      // overwrite what's currently shown. The request id travels with the
      // load meta so `handleDataLoaded` can tell a load superseded mid-decode
      // apart from one that's still current, and skip rendering it. The
      // stored import, when this load replaces it, is likewise cleared there
      // (see `ExampleLoadContext.replacesStoredImport`), not here.
      const loadMeta = registerFileLoad(file, 'default', {
        entry,
        source,
        requestId,
        replacesStoredImport,
      });
      const outcome = awaitLoadOutcome(loadMeta.sequence);
      await dataLoader.loadFromFile(file, { source: 'auto' });
      const success = await outcome;
      // A newer request may have superseded this one while it was decoding
      // (handleDataLoaded skips its own render for that case, but the
      // boolean it resolves with doesn't say why) — check again so a stale
      // decode is never reported as this call's own success or failure.
      if (!isCurrentExampleRequest(requestId)) {
        return 'superseded';
      }
      return success ? 'loaded' : 'failed';
    } catch (error) {
      if (!isCurrentExampleRequest(requestId)) {
        return 'superseded';
      }
      console.error(`Failed to load example dataset "${entry.id}":`, error);
      notify.error(getExampleLoadFailureNotification(entry, error));
      overlayController.update(false);
      return 'failed';
    }
  };

  const recoverFromCorruptedPersistedDataset = async (context: string) => {
    await clearCorruptedPersistedDataset(context);
    await loadExampleDataset(DEFAULT_EXAMPLE_DATASET, 'startup');
  };

  const loadPersistedFile = async (persistedFile: File): Promise<void> => {
    supersedePendingExampleFetch();
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
      await loadExampleDataset(DEFAULT_EXAMPLE_DATASET, 'startup');
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

  const loadExampleDatasetAndClearPersistedFile = async (
    id: string,
    source: DatasetChangeSource,
  ): Promise<ExampleLoadOutcome> => {
    const entry = findExampleDataset(id);
    if (!entry) {
      console.warn(`Unknown example dataset id: ${id}`);
      return 'failed';
    }

    // The stored import is cleared by `handleDataLoaded` once this example
    // has actually decoded, not up front: clearing before the fetch deleted
    // the import still on screen whenever the download or parse failed or
    // the request was superseded.
    return loadExampleDataset(entry, source, { replacesStoredImport: true });
  };

  return {
    clearCorruptedPersistedDataset,
    /**
     * Whether `requestId` (from an `ExampleLoadContext`) is still the most
     * recent example request. `handleDataLoaded` (dataset-controller.ts)
     * checks this before rendering an example load, so one superseded while
     * it was still decoding — a newer menu/url/user request started after
     * its fetch resolved but before this event fired — never renders,
     * emits, or touches the view.
     */
    isCurrentExampleRequest,
    loadExampleDataset,
    loadPersistedOrDefaultDataset,
    loadExampleDatasetAndClearPersistedFile,
    recoverFromCorruptedPersistedDataset,
    supersedePendingExampleFetch,
    tryLoadPersistedAgain,
  };
}
