import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import { notify } from '../lib/notify';
import { DEFAULT_EXAMPLE_DATASET, formatMegabytes, type ExampleDataset } from './example-datasets';
import { fetchExampleBundle } from './example-fetch';
import {
  StoredDatasetCorruptError,
  clearLastImportedFile,
  loadLastImportedFile,
  markLastLoadStatus,
  readLastLoadStatus,
  restoreLastLoadStatus,
} from './opfs-dataset-store';
import {
  getCorruptedPersistedDatasetNotification,
  getExampleLoadFailureNotification,
} from './notifications';
import type { LoadQueue } from './load-queue';
import { EXAMPLE_DOWNLOAD_SHARE, type LoadingOverlayController } from './loading-overlay';
import type { DatasetChangeSource, ExampleCancelResult, ExampleLoadOutcome } from './types';

/**
 * Reads a download's body into a `Blob`, reporting the bytes received so far.
 * The stream yields decoded bytes, so callers measure them against the decoded
 * file size, never against `Content-Length`, which is the compressed size when
 * the response is gzip-encoded. The browser assembles the `Blob` itself, with
 * no copy of the chunks held in JS. Aborting the fetch's signal rejects it.
 */
function readDownload(response: Response, onProgress: (received: number) => void): Promise<Blob> {
  let received = 0;
  const counted = response.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onProgress(received);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(counted).blob();
}

export type PersistedLoadOutcome =
  | { kind: 'auto-loaded' }
  | { kind: 'default-loaded' }
  /** No import is stored, and the demo loaded in its place failed (its toast is shown). */
  | { kind: 'default-failed' }
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

/** An example download the user cancelled: the epoch the cancel took, and how the load began. */
export interface ExampleLoadCancel {
  epoch: number;
  source: DatasetChangeSource;
}

/**
 * The preparation step of a user import (a FASTA upload to the prep backend),
 * started with `beginImportPreparation`.
 */
export interface ImportPreparation {
  /** Aborted by the overlay's Cancel, and by the next user request. */
  signal: AbortSignal;
  /** Whether no newer user request has superseded the import. */
  isCurrent(): boolean;
  /** Removes the preparation's Cancel button, unless a newer request has put up its own. */
  settle(): void;
}

interface PersistedDatasetOptions {
  dataLoader: ProtspaceDataLoader;
  overlayController: Pick<LoadingOverlayController, 'update' | 'setCancelHandler'>;
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
  /**
   * Called after the loading overlay's Cancel has aborted an example download
   * (see `offerCancel`), so the caller can decide what the screen shows next.
   */
  onExampleLoadCancelled?(cancel: ExampleLoadCancel): void;
}

interface PendingExample {
  epoch: number;
  source: DatasetChangeSource;
  /** Aborts the download; the next user request does (`beginUserRequest`). */
  download: AbortController;
  /** Set once the load has begun replacing the plot (`commitExampleLoad`). */
  committed: boolean;
}

type LoadStatusSnapshot = Awaited<ReturnType<typeof readLastLoadStatus>>;

export function createPersistedDatasetController({
  dataLoader,
  overlayController,
  registerFileLoad,
  awaitLoadOutcome,
  setCurrentExampleId,
  setCurrentDatasetName,
  retryUrlExample,
  onExampleLoadCancelled,
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
  // The preparation step of a user import still running (a FASTA upload),
  // which the next user request aborts like an example download.
  let pendingPreparation: AbortController | null = null;
  // The example load in flight (download and decode), whose download the next
  // user request aborts, for `cancelPendingExampleLoad`.
  let pendingExample: PendingExample | null = null;
  // The startup restore of the stored import while its load is in flight;
  // settles once that load has rendered, been skipped as superseded, or failed.
  let restoreInFlight: Promise<void> | null = null;
  // Whose Cancel button the loading overlay shows (an example download or an
  // import's preparation), if anyone's. The overlay has one Cancel slot.
  let cancelOwner: object | null = null;

  const offerOverlayCancel = (owner: object, handler: () => void, label?: string) => {
    cancelOwner = owner;
    overlayController.setCancelHandler(handler, label);
  };

  /** Removes the overlay's Cancel button, if `owner` (by default anyone) put it there. */
  const withdrawCancel = (owner?: object) => {
    if (cancelOwner === null || (owner !== undefined && cancelOwner !== owner)) {
      return;
    }
    cancelOwner = null;
    overlayController.setCancelHandler(null);
  };

  const beginUserRequest = (): number => {
    requestEpoch += 1;
    pendingExample?.download.abort();
    pendingPreparation?.abort();
    pendingPreparation = null;
    // Synchronously, so a request that puts up its own overlay button (a
    // FASTA import, another example) never has it cleared by this one.
    withdrawCancel();
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
    // sub-message. The overlay, a polite live region, updates only once both
    // that text and the whole percent downloaded have changed: at most a
    // hundred times per download, never per chunk.
    const downloadMessage = `Downloading ${entry.label}…`;
    const totalLabel = formatMegabytes(entry.sizeBytes);
    let shownAmount = '';
    let shownPercent = -1;
    const showDownloadProgress = (received: number) => {
      // A chunk read as a newer request aborts this download must not put
      // back the overlay that request (or a cancel) now owns.
      if (!isCurrentRequest(requestId)) {
        return;
      }
      const shown = Math.min(received, entry.sizeBytes);
      const fraction = entry.sizeBytes > 0 ? shown / entry.sizeBytes : 1;
      const percent = Math.floor(fraction * 100);
      const amount = `${(shown / 1e6).toFixed(1)} / ${totalLabel}`;
      if (amount === shownAmount || percent === shownPercent) {
        return;
      }
      shownAmount = amount;
      shownPercent = percent;
      overlayController.update(true, fraction * EXAMPLE_DOWNLOAD_SHARE, downloadMessage, amount);
    };
    showDownloadProgress(0);
    const pending: PendingExample = {
      epoch: requestId,
      source,
      download: new AbortController(),
      committed: false,
    };
    pendingExample = pending;
    // The startup demo, and the demo a recovery button loads, offer no
    // Cancel: they are the fallback a cancel would run.
    if (source !== 'startup') {
      offerCancel(pending);
    }

    try {
      const response = await fetchExampleBundle(entry, pending.download.signal);
      if (!isCurrentRequest(requestId)) {
        return 'superseded';
      }
      if (!response.ok) {
        throw new Error(`File not found: ${response.status} ${response.statusText}`);
      }

      const body = await readDownload(response, showDownloadProgress);
      if (!isCurrentRequest(requestId)) {
        return 'superseded';
      }

      // Decoding starts now, and the data loader cannot abort it, so the
      // Cancel button goes.
      withdrawCancel(pending);

      const fileName = entry.url.slice(entry.url.lastIndexOf('/') + 1);
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
      const loadMeta = registerFileLoad(
        file,
        'default',
        { entry, source, replacesStoredImport },
        requestId,
      );
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
      notify.error(getExampleLoadFailureNotification(entry, error, { source, onRetry: retry }));
      overlayController.update(false);
      return 'failed';
    } finally {
      withdrawCancel(pending);
      if (pendingExample === pending) {
        pendingExample = null;
      }
    }
  };

  /**
   * Puts a Cancel button on the loading overlay for `pending`'s download. It
   * is a user request: it cancels the download (`cancelPendingExampleLoad`),
   * with no notification, fallback or URL write here, then hands the new
   * epoch to `onExampleLoadCancelled`, which decides what the screen shows.
   */
  const offerCancel = (pending: PendingExample) => {
    offerOverlayCancel(
      pending,
      () => {
        if (pendingExample !== pending || cancelPendingExampleLoad() !== 'cancelled') {
          return;
        }
        onExampleLoadCancelled?.({ epoch: currentRequestEpoch(), source: pending.source });
      },
      'Cancel download',
    );
  };

  /**
   * Cancels the example load still in flight, if it is current and, with
   * `source`, was started that way: a new user epoch supersedes it and aborts
   * its download, and the overlay it put up is dismissed. The load then
   * settles as `'superseded'`, with no notification, fallback, emit or URL
   * write. A load that has begun replacing the stored import and the plot is
   * `'committed'` and left to finish: cancelling it then would leave its data
   * on screen under the previous dataset's name and URL.
   */
  const cancelPendingExampleLoad = ({
    source,
  }: { source?: DatasetChangeSource } = {}): ExampleCancelResult => {
    const pending = pendingExample;
    if (!pending || !isCurrentRequest(pending.epoch)) {
      return 'none';
    }
    if (source !== undefined && pending.source !== source) {
      return 'none';
    }
    if (pending.committed) {
      return 'committed';
    }
    beginUserRequest();
    overlayController.update(false);
    return 'cancelled';
  };

  /**
   * Marks the example load that took `epoch` as committed: it has decoded, is
   * still current, and `handleDataLoaded` is about to replace the stored
   * import and the plot with it. From here `cancelPendingExampleLoad` leaves
   * it alone; a newer user request still supersedes it.
   */
  const commitExampleLoad = (epoch: number) => {
    const pending = pendingExample;
    if (pending?.epoch !== epoch) {
      return;
    }
    pending.committed = true;
    withdrawCancel(pending);
  };

  /**
   * Starts the preparation step of the user import that took `epoch` (a FASTA
   * upload to the prep backend). The overlay's Cancel aborts it, and so does
   * the next user request, which also takes the Cancel button over: the newest
   * request owns the screen, and a preparation it superseded must not hold the
   * load queue for minutes. Already aborted when `epoch` is no longer current.
   */
  const beginImportPreparation = (epoch: number): ImportPreparation => {
    const preparation = new AbortController();
    const owner = {};
    if (isCurrentRequest(epoch)) {
      pendingPreparation = preparation;
      offerOverlayCancel(owner, () => preparation.abort());
    } else {
      preparation.abort();
    }
    return {
      signal: preparation.signal,
      isCurrent: () => isCurrentRequest(epoch),
      settle: () => {
        withdrawCancel(owner);
        if (pendingPreparation === preparation) {
          pendingPreparation = null;
        }
      },
    };
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

  /**
   * Restores the stored import under `epoch`. Resolves false, without loading,
   * once a user request has moved past it. `previousStatus` is the load status
   * the caller read before, if it did: a restore preempted after marking the
   * load pending puts that status back, since nothing was attempted.
   */
  const loadPersistedFile = async (
    persistedFile: File,
    epoch: number,
    previousStatus?: LoadStatusSnapshot,
  ): Promise<boolean> => {
    if (!isCurrentRequest(epoch)) {
      return false;
    }
    const before = previousStatus === undefined ? await readLastLoadStatus() : previousStatus;
    if (!isCurrentRequest(epoch)) {
      return false;
    }
    await markLastLoadStatus('pending');
    if (!isCurrentRequest(epoch)) {
      if (before) {
        try {
          await restoreLastLoadStatus(before);
        } catch (error) {
          console.warn('Failed to restore the stored import load status:', error);
        }
      }
      return false;
    }
    registerFileLoad(persistedFile, 'opfs', undefined, epoch);
    setCurrentDatasetName(persistedFile.name);
    setCurrentExampleId(null);
    const load = dataLoader.loadFromFile(persistedFile, { source: 'auto' });
    const settled = load.then(
      () => {},
      () => {},
    );
    restoreInFlight = settled;
    try {
      await load;
    } finally {
      if (restoreInFlight === settled) {
        restoreInFlight = null;
      }
    }
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
    // The startup restore may still be decoding, superseded by the user
    // request this flow now runs for (a Back to an example whose download
    // failed, say). Until it settles its stored status reads 'pending', which
    // would offer recovery for a file that loads fine. So wait for it:
    // superseded, it renders nothing but records its outcome, and the
    // restore below runs it again under this flow's epoch.
    if (restoreInFlight) {
      await restoreInFlight;
    }
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
      if (outcome === 'superseded') {
        return { kind: 'preempted' };
      }
      return outcome === 'failed' ? { kind: 'default-failed' } : { kind: 'default-loaded' };
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
      // The caller names the file as the current dataset when nothing else is
      // on screen (`loadPersistedOrDefaultDataset` in dataset-controller.ts).
      return {
        kind: 'recovery-required',
        file: persistedFile,
        lastError: status.lastError,
        failedAttempts: status.failedAttempts,
      };
    }

    if (!(await loadPersistedFile(persistedFile, epoch, status))) {
      return { kind: 'preempted' };
    }
    return { kind: 'auto-loaded' };
  };

  /** The recovery banner's "Try again": a user request. */
  const tryLoadPersistedAgain = async (file: File): Promise<void> => {
    await loadPersistedFile(file, beginUserRequest());
  };

  /**
   * Loads an example in place of the stored import (a menu choice, or the
   * recovery banner's "Load default"). The stored import is cleared by
   * `handleDataLoaded` once this example has actually decoded, not up front:
   * clearing before the fetch deleted the import still on screen whenever the
   * download or parse failed or the request was superseded.
   */
  const loadExampleDatasetAndClearPersistedFile = (
    entry: ExampleDataset,
    source: DatasetChangeSource,
  ): Promise<ExampleLoadOutcome> =>
    loadExampleDataset(entry, source, { replacesStoredImport: true });

  return {
    /** Takes a new request epoch for a user request (see `requestEpoch` above). */
    beginUserRequest,
    beginImportPreparation,
    cancelPendingExampleLoad,
    clearCorruptedPersistedDataset,
    commitExampleLoad,
    currentRequestEpoch,
    /**
     * Whether `epoch` (a load's `LoadMeta.epoch`) is still the current request
     * epoch. `handleDataLoaded` (dataset-controller.ts) checks this before
     * rendering a load, so one superseded while it was still decoding — a
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
