import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import { notify } from '../lib/notify';
import {
  DEFAULT_EXAMPLE_DATASET,
  findExampleDataset,
  formatMegabytes,
  type ExampleDataset,
} from './example-datasets';
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
import { EXAMPLE_DOWNLOAD_SHARE } from './loading-overlay';
import type { DatasetChangeSource, ExampleLoadOutcome } from './types';

/**
 * Reads a download's body chunk by chunk and reports the bytes received so
 * far. The stream yields decoded bytes, so callers measure them against the
 * decoded file size, never against `Content-Length`, which is the compressed
 * size when the response is gzip-encoded. The chunks become one `Blob`, with
 * no intermediate `ArrayBuffer` copy. Resolves `null`, having cancelled the
 * stream, as soon as `isCurrent` turns false.
 */
async function readDownload(
  response: Response,
  onProgress: (received: number) => void,
  isCurrent: () => boolean,
): Promise<Blob | null> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (!isCurrent()) {
      return null;
    }
    onProgress(buffer.byteLength);
    return new Blob([buffer]);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (!isCurrent()) {
      void reader.cancel().catch(() => {});
      return null;
    }
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    onProgress(received);
  }
  return new Blob(chunks);
}

export type PersistedLoadOutcome =
  | { kind: 'auto-loaded' }
  | { kind: 'default-loaded' }
  /**
   * A user request made after this app-initiated flow began took over: the
   * flow stopped before starting any load, and shows no banner or message.
   */
  | { kind: 'preempted' }
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
  /**
   * Retry for a failed `?dataset=` download (a deep link or Back/Forward):
   * the URL sync hook re-requests it, since only it knows which history entry
   * names the example. Without it, Retry loads the example directly.
   */
  retryUrlExample?(id: string): void;
}

export function createPersistedDatasetController({
  dataLoader,
  overlayController,
  registerFileLoad,
  awaitLoadOutcome,
  setCurrentExampleId,
  setCurrentDatasetName,
  retryUrlExample,
}: PersistedDatasetOptions) {
  // Which request owns the screen (the "Request precedence" requirement in
  // openspec/specs/example-datasets). A user request (a menu choice,
  // Back/Forward, a file import, a recovery-banner button) takes a new epoch:
  // anything still pending under an older one recognizes itself as
  // superseded, and its download is aborted. An app-initiated flow (the
  // startup restore of the stored import, the startup demo, the recovery load
  // after a corrupt store, the fallback after a failed deep link) never takes
  // one: it runs under the epoch current when it began and stops before
  // starting any load once a user request has moved past it. So a user request
  // always beats an app-initiated load that began earlier, and among user
  // requests the newest wins.
  let requestEpoch = 0;
  let pendingDownload: AbortController | null = null;
  // The example load in flight (download and decode), for
  // `cancelPendingExampleLoad`.
  let pendingExample: { epoch: number; source: DatasetChangeSource } | null = null;
  const beginUserRequest = (): number => {
    requestEpoch += 1;
    pendingDownload?.abort();
    pendingDownload = null;
    return requestEpoch;
  };
  const currentRequestEpoch = (): number => requestEpoch;
  const isCurrentRequest = (epoch: number): boolean => epoch === requestEpoch;

  const clearStoredImport = async () => {
    try {
      await clearLastImportedFile();
    } catch (clearError) {
      console.warn('Failed to clear invalid persisted dataset:', clearError);
    }
  };

  const clearCorruptedPersistedDataset = async (context: string) => {
    await clearStoredImport();
    notify.warning(getCorruptedPersistedDatasetNotification(context));
  };

  /**
   * Downloads and loads an example. Without `epoch` this is a user request and
   * takes a new one; an app-initiated flow passes the epoch it began under and
   * gets `'superseded'` without any download once a user request has moved on.
   */
  const loadExampleDataset = async (
    entry: ExampleDataset,
    source: DatasetChangeSource,
    {
      replacesStoredImport = false,
      epoch,
    }: { replacesStoredImport?: boolean; epoch?: number } = {},
  ): Promise<ExampleLoadOutcome> => {
    const requestId = epoch ?? beginUserRequest();
    if (!isCurrentRequest(requestId)) {
      return 'superseded';
    }
    // Progress is the decoded bytes received over the entry's decoded size
    // (see `readDownload`), capped, with "12.3 / 44.9 MB" as the overlay's
    // sub-message. Only a change of that text updates the overlay, not every
    // chunk.
    const downloadMessage = `Downloading ${entry.label}…`;
    const totalLabel = formatMegabytes(entry.sizeBytes);
    let shownAmount = '';
    const showDownloadProgress = (received: number) => {
      const shown = Math.min(received, entry.sizeBytes);
      const amount = `${(shown / 1e6).toFixed(1)} / ${totalLabel}`;
      if (amount === shownAmount) {
        return;
      }
      shownAmount = amount;
      const fraction = entry.sizeBytes > 0 ? shown / entry.sizeBytes : 1;
      overlayController.update(true, fraction * EXAMPLE_DOWNLOAD_SHARE, downloadMessage, amount);
    };
    showDownloadProgress(0);
    const download = new AbortController();
    pendingDownload = download;
    const pending = { epoch: requestId, source };
    pendingExample = pending;

    try {
      const response = await fetch(entry.url, { signal: download.signal });
      if (!isCurrentRequest(requestId)) {
        return 'superseded';
      }
      if (!response.ok) {
        throw new Error(`File not found: ${response.status} ${response.statusText}`);
      }

      const body = await readDownload(response, showDownloadProgress, () =>
        isCurrentRequest(requestId),
      );
      if (!body || !isCurrentRequest(requestId)) {
        return 'superseded';
      }

      const fileName = entry.url.split('/').pop() ?? entry.id;
      const file = new File([body], fileName, {
        type: 'application/octet-stream',
      });

      // Name/id/emit are set by `handleDataLoaded`, once the load has actually
      // finished decoding — never here, so a fetch that resolves after this
      // request was superseded (or whose bundle fails to parse) can never
      // overwrite what's currently shown. The request epoch travels with the
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
      if (!isCurrentRequest(requestId)) {
        return 'superseded';
      }
      return success ? 'loaded' : 'failed';
    } catch (error) {
      // A superseded request's download is aborted, which lands here too.
      if (!isCurrentRequest(requestId)) {
        return 'superseded';
      }
      console.error(`Failed to load example dataset "${entry.id}":`, error);
      // Retry is a new user request: it repeats a menu choice (or a recovery
      // banner's "Load default") as it was, and hands a URL-driven load back
      // to the URL sync hook.
      const retry = () => {
        if (source === 'url' && retryUrlExample) {
          retryUrlExample(entry.id);
          return;
        }
        void loadExampleDataset(entry, source, { replacesStoredImport });
      };
      notify.error(getExampleLoadFailureNotification(entry, error, retry));
      overlayController.update(false);
      return 'failed';
    } finally {
      if (pendingDownload === download) {
        pendingDownload = null;
      }
      if (pendingExample === pending) {
        pendingExample = null;
      }
    }
  };

  /**
   * Cancels the example load still in flight, if it is current and, with
   * `source`, was started that way: a new user epoch supersedes it and aborts
   * its download, and the overlay it put up is dismissed. The load then
   * settles as `'superseded'`, with no notification, fallback, emit or URL
   * write. Resolves whether a load was cancelled.
   */
  const cancelPendingExampleLoad = ({ source }: { source?: DatasetChangeSource } = {}): boolean => {
    const pending = pendingExample;
    if (!pending || !isCurrentRequest(pending.epoch)) {
      return false;
    }
    if (source !== undefined && pending.source !== source) {
      return false;
    }
    beginUserRequest();
    overlayController.update(false);
    return true;
  };

  /**
   * Clears a stored import that could not be read or parsed and, unless a
   * user request has moved past `epoch` meanwhile, loads the demo in its
   * place. Resolves whether it started that load.
   */
  const recoverFromCorruptedPersistedDataset = async (
    context: string,
    epoch: number = currentRequestEpoch(),
  ): Promise<boolean> => {
    if (!isCurrentRequest(epoch)) {
      // The user already chose something else: clear the broken copy
      // without announcing a demo load that won't happen.
      await clearStoredImport();
      return false;
    }
    await clearCorruptedPersistedDataset(context);
    if (!isCurrentRequest(epoch)) {
      return false;
    }
    await loadExampleDataset(DEFAULT_EXAMPLE_DATASET, 'startup', { epoch });
    return true;
  };

  /** Resolves false, without loading, once a user request has moved past `epoch`. */
  const loadPersistedFile = async (persistedFile: File, epoch: number): Promise<boolean> => {
    if (!isCurrentRequest(epoch)) {
      return false;
    }
    await markLastLoadStatus('pending');
    if (!isCurrentRequest(epoch)) {
      return false;
    }
    registerFileLoad(persistedFile, 'opfs', undefined, epoch);
    setCurrentDatasetName(persistedFile.name);
    setCurrentExampleId(null);
    await dataLoader.loadFromFile(persistedFile, { source: 'auto' });
    return true;
  };

  /**
   * The startup load when no example is requested: restore the stored import,
   * or load the demo when there is none. App-initiated, so it runs under
   * `epoch` (by default the one current now) and resolves `'preempted'`,
   * without starting a load, as soon as a user request has moved past it.
   */
  const loadPersistedOrDefaultDataset = async ({
    epoch = currentRequestEpoch(),
  }: { epoch?: number } = {}): Promise<PersistedLoadOutcome> => {
    let persistedFile: File | null = null;
    try {
      persistedFile = await loadLastImportedFile();
    } catch (error) {
      console.error('Failed to restore persisted dataset:', error);
      if (error instanceof StoredDatasetCorruptError) {
        const recovered = await recoverFromCorruptedPersistedDataset(
          'in browser storage is corrupted',
          epoch,
        );
        return recovered ? { kind: 'default-loaded' } : { kind: 'preempted' };
      }
    }

    if (!isCurrentRequest(epoch)) {
      return { kind: 'preempted' };
    }

    if (!persistedFile) {
      const outcome = await loadExampleDataset(DEFAULT_EXAMPLE_DATASET, 'startup', { epoch });
      return outcome === 'superseded' ? { kind: 'preempted' } : { kind: 'default-loaded' };
    }

    const status = await readLastLoadStatus();
    if (!isCurrentRequest(epoch)) {
      return { kind: 'preempted' };
    }
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

    if (!(await loadPersistedFile(persistedFile, epoch))) {
      return { kind: 'preempted' };
    }
    return { kind: 'auto-loaded' };
  };

  /** The recovery banner's "Try again": a user request. */
  const tryLoadPersistedAgain = async (file: File): Promise<void> => {
    await loadPersistedFile(file, beginUserRequest());
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
    /** Takes a new request epoch for a user request (see `requestEpoch` above). */
    beginUserRequest,
    cancelPendingExampleLoad,
    clearCorruptedPersistedDataset,
    currentRequestEpoch,
    /**
     * Whether `epoch` (an `ExampleLoadContext.requestId`, or the epoch an
     * OPFS restore began under) is still the current request epoch.
     * `handleDataLoaded` (dataset-controller.ts) checks this before rendering
     * an example load, so one superseded while it was still decoding — a
     * newer user request made after its fetch resolved but before this event
     * fired — never renders, emits, or touches the view.
     */
    isCurrentRequest,
    loadExampleDataset,
    loadPersistedOrDefaultDataset,
    loadExampleDatasetAndClearPersistedFile,
    recoverFromCorruptedPersistedDataset,
    tryLoadPersistedAgain,
  };
}
