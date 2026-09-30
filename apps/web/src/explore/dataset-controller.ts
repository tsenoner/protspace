import type {
  ProtspaceControlBar,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoadedEventDetail,
  DataErrorEventDetail,
  DataLoader as ProtspaceDataLoader,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import { DEFAULT_EAT_CONFIDENCE_THRESHOLD, generateDatasetHash } from '@protspace/utils';
import { notify } from '../lib/notify';
import {
  getDataLoadFailureNotification,
  getDatasetPersistenceFailureNotification,
} from './notifications';
import {
  clearLastImportedFile,
  markLastLoadStatus,
  saveLastImportedFile,
} from './opfs-dataset-store';
import { createDataRenderer } from './data-renderer';
import { DEFAULT_EXAMPLE_DATASET, findExampleDataset } from './example-datasets';
import type { ExampleDataset } from './example-datasets';
import type { InteractionController } from './interaction-controller';
import type { LoadQueue } from './load-queue';
import { progressAfterExampleDownload } from './loading-overlay';
import { createPersistedDatasetController } from './persisted-dataset';
import type {
  ExampleLoadCancel,
  ImportPreparation,
  PersistedLoadOutcome,
} from './persisted-dataset';
import { readTooltipAnnotations, writeTooltipAnnotations } from './tooltip-annotations-store';
import type {
  DatasetChangeSource,
  ExampleCancelResult,
  ExampleLoadOutcome,
  LoadMeta,
} from './types';
import { createEmptyExploreViewRequest } from './url-state';
import type { ViewController } from './view-controller';

interface DatasetControllerOptions {
  controlBar: ProtspaceControlBar;
  dataLoader: ProtspaceDataLoader;
  getIsDisposed: () => boolean;
  interactionController: InteractionController;
  legendElement: ProtspaceLegend;
  loadQueue: LoadQueue;
  overlayController: {
    update(show: boolean, progress?: number, message?: string, subMessage?: string): void;
    setCancelHandler(handler: (() => void) | null, label?: string): void;
  };
  plotElement: ProtspaceScatterplot;
  setCurrentExampleId(id: string | null): void;
  setCurrentDatasetName(name: string): void;
  structureViewer: ProtspaceStructureViewer;
  viewController: ViewController;
  /**
   * Called after the loading overlay's Cancel has aborted an example
   * download, under the new user epoch it took (`handleCancelledExampleLoad`
   * in startup.ts).
   */
  onExampleLoadCancelled?(cancel: ExampleLoadCancel): void;
}

export interface DatasetController {
  loadDefaultDatasetAndClearPersistedFile(): Promise<void>;
  loadExampleDatasetAndClearPersistedFile(
    id: string,
    source?: DatasetChangeSource,
  ): Promise<ExampleLoadOutcome>;
  /**
   * Loads a known example without touching OPFS (a `?dataset=` deep link or
   * Back/Forward), under `epoch` when given (see `beginUserRequest`).
   */
  loadExampleDataset(id: string, options?: { epoch?: number }): Promise<ExampleLoadOutcome>;
  /** The startup load without an example; app-initiated, under `epoch` when given. */
  loadPersistedOrDefaultDataset(options?: { epoch?: number }): Promise<PersistedLoadOutcome>;
  tryLoadPersistedAgain(file: File): Promise<void>;
  /**
   * Starts a user request: takes a new request epoch, which supersedes any
   * example load still in flight and aborts its download, and returns it.
   * Called for a user file import, for Back/Forward, and on teardown, so a
   * slower, now-stale load can never overwrite what the user asked for.
   */
  beginUserRequest(): number;
  /** The request epoch an app-initiated flow starting now runs under. */
  currentRequestEpoch(): number;
  /**
   * Starts the preparation step (a FASTA upload) of the user import that took
   * `epoch`: the next user request aborts it and takes its Cancel button over
   * (`beginImportPreparation` in persisted-dataset.ts).
   */
  beginImportPreparation(epoch: number): ImportPreparation;
  /** Whether any dataset has been rendered yet (false only before the first load succeeds). */
  hasDisplayedDataset(): boolean;
  /**
   * Cancels the example load in flight (only one started from `source`, when
   * given): supersedes it as a user request, aborts its download and
   * dismisses its overlay. One that has begun replacing the plot is
   * `'committed'` and finishes.
   */
  cancelPendingExampleLoad(options?: { source?: DatasetChangeSource }): ExampleCancelResult;
  subscribeToDatasetChanges(
    callback: (exampleId: string | null, source: DatasetChangeSource) => void,
  ): () => void;
  /**
   * Reports the Retry of a failed `?dataset=` download, for the URL sync hook
   * to re-request (`retryUrlExample` in persisted-dataset.ts).
   */
  subscribeToExampleRetries(callback: (exampleId: string) => void): () => void;
  handleLoadingStart(): void;
  handleLoadingProgress(event: Event): void;
  handleDataLoaded(event: Event): Promise<void>;
  handleDataError(event: Event): Promise<void>;
}

/**
 * Development aid: names every `defaultView` name the loaded bundle lacks. The
 * view then falls back to the bundle's first annotation or projection and
 * drops the missing tooltip names (see `resolveExploreView`).
 */
function warnOnMissingDefaultViewNames(entry: ExampleDataset, data: VisualizationData): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const annotations = new Set(Object.keys(data.annotations));
  const projections = new Set(data.projections.map((projection) => projection.name));
  const { annotation, projection, tooltip = [] } = entry.defaultView;
  const missing = [
    ...(annotations.has(annotation) ? [] : [`annotation "${annotation}"`]),
    ...(projections.has(projection) ? [] : [`projection "${projection}"`]),
    ...tooltip.filter((name) => !annotations.has(name)).map((name) => `tooltip "${name}"`),
  ];
  if (missing.length > 0) {
    console.warn(
      `Example "${entry.id}" defaultView names missing from its bundle: ${missing.join(', ')}`,
    );
  }
}

export function createDatasetController({
  controlBar,
  dataLoader,
  getIsDisposed,
  interactionController,
  legendElement,
  loadQueue,
  overlayController,
  plotElement,
  setCurrentExampleId,
  setCurrentDatasetName,
  structureViewer,
  viewController,
  onExampleLoadCancelled,
}: DatasetControllerOptions): DatasetController {
  // An example's download fills the first part of the loading bar
  // (persisted-dataset.ts). Its decode and render phases report 0–100 of
  // their own, mapped onto the rest, so the bar never runs backwards.
  const phaseOverlayController: Pick<DatasetControllerOptions['overlayController'], 'update'> = {
    update(show, progress, message, subMessage) {
      const afterDownload =
        show && progress !== undefined && loadQueue.getRunningLoadMeta()?.example != null;
      overlayController.update(
        show,
        afterDownload ? progressAfterExampleDownload(progress) : progress,
        message,
        subMessage,
      );
    },
  };

  const loadData = createDataRenderer({
    controlBar,
    getIsDisposed,
    interactionController,
    legendElement,
    overlayController: phaseOverlayController,
    plotElement,
    resolveInitialView: viewController.resolveLatestView,
    structureViewer,
  });

  const exampleRetrySubscribers = new Set<(exampleId: string) => void>();
  const persistedDatasetController = createPersistedDatasetController({
    dataLoader,
    overlayController,
    registerFileLoad: loadQueue.registerFileLoad,
    awaitLoadOutcome: loadQueue.awaitLoadOutcome,
    setCurrentExampleId,
    setCurrentDatasetName,
    retryUrlExample(exampleId) {
      exampleRetrySubscribers.forEach((callback) => callback(exampleId));
    },
    onExampleLoadCancelled,
  });

  // Reports which example (or no example) is now showing and why, so the URL
  // sync hook can decide whether/how to write `?dataset=`. Only successful
  // loads are reported, plus a 'recovery-required' startup (nothing showing).
  const datasetChangeSubscribers = new Set<
    (exampleId: string | null, source: DatasetChangeSource) => void
  >();
  const emitDatasetChange = (exampleId: string | null, source: DatasetChangeSource) => {
    datasetChangeSubscribers.forEach((callback) => callback(exampleId, source));
  };

  // Name, id and the dataset-change emit for a successful example load happen
  // in `handleDataLoaded`, keyed on the example in load meta, so a load that
  // later fails to parse never announces success.
  const loadExampleDatasetAndClearPersistedFile = async (
    id: string,
    source: DatasetChangeSource = 'menu',
  ): Promise<ExampleLoadOutcome> =>
    persistedDatasetController.loadExampleDatasetAndClearPersistedFile(id, source);

  const loadExampleDataset = async (
    id: string,
    { epoch }: { epoch?: number } = {},
  ): Promise<ExampleLoadOutcome> => {
    const entry = findExampleDataset(id);
    if (!entry) {
      return 'failed';
    }
    return persistedDatasetController.loadExampleDataset(entry, 'url', { epoch });
  };

  const loadDefaultDatasetAndClearPersistedFile = async (): Promise<void> => {
    await loadExampleDatasetAndClearPersistedFile(DEFAULT_EXAMPLE_DATASET.id, 'startup');
  };

  const loadPersistedOrDefaultDataset = async (
    options: { epoch?: number } = {},
  ): Promise<PersistedLoadOutcome> => {
    const outcome = await persistedDatasetController.loadPersistedOrDefaultDataset(options);
    if (outcome.kind === 'recovery-required') {
      // Nothing loads while the recovery banner is up, so nothing reaches
      // `handleDataLoaded`: report "no example" here so a stale `?dataset=`
      // from a failed/unknown deep link is replace-deleted from the URL. And
      // dismiss the overlay of an example load this request superseded (a
      // Back to an entry without `dataset=`), which would otherwise stay up.
      overlayController.update(false);
      emitDatasetChange(null, 'startup');
    }
    // 'auto-loaded' (OPFS) and 'default-loaded' (demo) report through
    // `handleDataLoaded` on success; 'preempted' means a user request took
    // over, and that request reports its own outcome.
    return outcome;
  };

  /**
   * Whether a newer user request has superseded `meta`'s load: an example
   * load (by the epoch in its example context), an OPFS restore or a user
   * import (by the epoch it began under). Loads without an epoch (the perf
   * suite's) are never superseded.
   */
  const isLoadSuperseded = (meta: LoadMeta | null | undefined): boolean => {
    const epoch = meta?.example?.requestId ?? meta?.epoch;
    return epoch !== undefined && !persistedDatasetController.isCurrentRequest(epoch);
  };

  let currentDatasetHash: string | null = null;
  viewController.subscribeToViewChanges((change) => {
    if (currentDatasetHash !== null) {
      writeTooltipAnnotations(currentDatasetHash, change.effective.tooltip);
    }
  });

  const handleDataLoaded = async (event: Event) => {
    let loadSequence: number | null = null;
    // True only once this load has fully rendered; a stale/superseded or
    // throwing load resolves its pending finalization as a failure.
    let success = false;

    try {
      const customEvent = event as CustomEvent<DataLoadedEventDetail>;
      const { data, settings, source, file } = customEvent.detail;
      const runningLoadMeta = loadQueue.getRunningLoadMeta();
      const loadMeta = (file ? loadQueue.getLoadMetaForFile(file) : undefined) ??
        runningLoadMeta ?? {
          sequence: 0,
          kind: source === 'auto' ? 'default' : 'user',
        };
      loadSequence = loadMeta.sequence;

      if (runningLoadMeta && loadMeta.sequence !== runningLoadMeta.sequence) {
        console.log('Ignoring stale data load result:', {
          source,
          fileName: file?.name ?? null,
          loadKind: loadMeta.kind,
        });
        return;
      }

      // A load superseded by a newer user request, before or during `loadData`,
      // must not label itself, emit, save, or touch the view: the newer
      // request owns the screen, and its own load renders over this one or
      // its fallback runs. That covers example loads, and also the startup
      // restore of the stored import and a user import, whose emit would
      // otherwise remove `dataset=` from the entry a Back/Forward went to. The
      // queue-level check above can't see this (this load is still the
      // running one), so it is checked here and again after each await below.
      const isSuperseded = () => isLoadSuperseded(loadMeta);
      const skipSupersededLoad = async () => {
        if (loadMeta.kind !== 'opfs') {
          return;
        }
        // The stored import decoded fine; only a newer request kept it off
        // screen. Record that, so no 'pending' status is left behind to offer
        // recovery for it, and a later startup load restores it.
        try {
          await markLastLoadStatus('success');
        } catch (statusError) {
          console.warn('Failed to update OPFS load status to success:', statusError);
        }
      };

      if (isSuperseded()) {
        await skipSupersededLoad();
        return;
      }
      if (loadMeta.example) {
        // From here the example replaces the stored import and the plot, so
        // it can no longer be cancelled (a Back/Forward that only changes the
        // view leaves it to finish); a newer user request still supersedes it.
        persistedDatasetController.commitExampleLoad(loadMeta.example.requestId);
      }

      if (loadMeta.kind === 'user' && file) {
        overlayController.update(
          true,
          20,
          'Saving imported dataset...',
          'Preparing reload support...',
        );
        try {
          await saveLastImportedFile(file);
        } catch (error) {
          console.error('Failed to persist imported dataset in OPFS:', error);
          notify.warning(getDatasetPersistenceFailureNotification(error));
        }
        if (isSuperseded()) {
          return;
        }
      } else if (loadMeta.example?.replacesStoredImport) {
        // A menu choice replaces the stored import only now that the example
        // has downloaded, decoded and is still current — never before the
        // fetch, which deleted the import still on screen whenever the
        // download or parse failed or the request was superseded. Running
        // inside this load's queue slot also orders it after the save of any
        // user import queued ahead of it, so the last choice is what sticks.
        try {
          await clearLastImportedFile();
        } catch (error) {
          console.warn('Failed to clear persisted dataset before showing example dataset:', error);
        }
        if (isSuperseded()) {
          return;
        }
      }

      const datasetHash = generateDatasetHash(data);
      const shouldClearPersistedState =
        loadMeta.kind === 'default' || (loadMeta.kind === 'user' && settings != null);

      legendElement.clearForNewDataset(datasetHash, shouldClearPersistedState);
      controlBar.clearForNewDataset(datasetHash, shouldClearPersistedState);

      // The dataset's own landing view fills whatever the view request leaves
      // unset. Set for every load (null for user imports, OPFS restores and
      // perf loads) before `loadData`, which resolves the initial view.
      viewController.setDatasetDefaults(loadMeta.example?.entry.defaultView ?? null);
      if (loadMeta.example) {
        warnOnMissingDefaultViewNames(loadMeta.example.entry, data);
      }
      if (loadMeta.example?.source === 'menu') {
        // A menu choice opens the example on its curated view, contours Off.
        // The recorded request still holds the previous dataset's annotation,
        // projection, tooltip and contour mode, which would otherwise carry
        // over wherever the names also exist in this bundle;
        // `getDatasetSearchParamsUpdate` drops the same parameters from the
        // pushed URL. Reset only here, for a load
        // that decoded and is still current, so a failed or superseded menu
        // choice leaves the request, the plot and the URL as they were.
        viewController.recordRequestedView(createEmptyExploreViewRequest());
      }

      await loadData(data);

      // Re-check: `loadData` can take long enough for a newer user request
      // to land while it was running (see the check above).
      if (isSuperseded()) {
        await skipSupersededLoad();
        return;
      }

      if (settings && loadMeta.kind !== 'opfs') {
        legendElement.setFileSettings(settings.legendSettings, datasetHash, true);
        if (settings.shapeSize !== undefined) {
          legendElement.applyShapeSize(settings.shapeSize, datasetHash);
        }
      }
      if (settings) {
        const eatOverlayEnabled = settings.eatOverlayEnabled ?? true;
        const eatConfidenceThreshold =
          settings.eatConfidenceThreshold ?? DEFAULT_EAT_CONFIDENCE_THRESHOLD;
        legendElement.applyEatSettings(eatOverlayEnabled, eatConfidenceThreshold);
      }

      controlBar.hasFileSettings =
        settings != null &&
        (Object.keys(settings.legendSettings).length > 0 ||
          settings.eatOverlayEnabled !== undefined ||
          settings.eatConfidenceThreshold !== undefined ||
          settings.shapeSize !== undefined);

      // An example load carries its entry in load meta (set by
      // persisted-dataset.ts's `loadExampleDataset`), so it's identified by
      // that, not by `kind === 'default'` — the perf suite also issues
      // 'default'-kind loads and must never be labelled as an example.
      if (loadMeta.example) {
        setCurrentDatasetName(loadMeta.example.entry.label);
        setCurrentExampleId(loadMeta.example.entry.id);
        emitDatasetChange(loadMeta.example.entry.id, loadMeta.example.source);
      } else if ((loadMeta.kind === 'user' || loadMeta.kind === 'opfs') && file) {
        setCurrentDatasetName(file.name);
        setCurrentExampleId(null);
        emitDatasetChange(null, loadMeta.kind === 'user' ? 'user' : 'startup');
      }

      // Must be set before the restore block so that any view-change emitted by
      // setRequestedView below is persisted under the new dataset's key, not the
      // previous dataset's key.
      const hadPreviousDataset = currentDatasetHash !== null;
      currentDatasetHash = datasetHash;

      const latestRequest = viewController.getLatestViewRequest();
      // A first-ever load (no previous dataset) that happens to be a user file drop
      // is NOT a stale-URL situation — there is no previous dataset whose tooltip
      // param could be carried over — so honor the URL like annotation/projection do.
      const isUserImport = loadMeta.kind === 'user' && hadPreviousDataset;

      // Read the persisted tooltip set once; used in both branches below.
      const savedTooltip = readTooltipAnnotations(datasetHash);

      if (isUserImport) {
        // The URL may still carry a tooltip= param that was set for the PREVIOUSLY
        // loaded dataset (A). That param is stale for the newly imported dataset (B)
        // and must be ignored. We always restore B's own persisted tooltip set and,
        // when the URL had a stale tooltip param, we force a URL rewrite so the URL
        // reflects B's state rather than A's.
        //
        // Only emit a view change when there is something to do:
        //   - saved has entries (need to restore them), OR
        //   - URL had a stale param (need to erase it from the URL).
        const staleUrlHadTooltip = latestRequest.present.tooltip;
        if (savedTooltip.length > 0 || staleUrlHadTooltip) {
          viewController.setRequestedView({
            ...latestRequest,
            requested: {
              ...latestRequest.requested,
              tooltip: savedTooltip.length > 0 ? savedTooltip : undefined,
            },
            present: {
              ...latestRequest.present,
              tooltip: savedTooltip.length > 0,
            },
            normalize: {
              ...latestRequest.normalize,
              // Setting normalize.tooltip=true forces the URL-sync handler to
              // rewrite (or delete) the tooltip param so the URL matches B's
              // effective tooltip instead of carrying A's stale value.
              // This is needed for both the "saved non-empty" case (case 1, sets
              // tooltip=<saved>) and the "saved empty" case (case 2, removes the
              // param). When the URL had no stale param and saved is non-empty
              // (case 3), this stays false so the URL is left silent as expected.
              tooltip: staleUrlHadTooltip || latestRequest.normalize.tooltip,
            },
          });
        }
      } else {
        // Default load ('default') or OPFS restore ('opfs'): the URL tooltip param
        // is authoritative. Only restore the persisted set when the URL is silent.
        // Examples never have one (their saved state was wiped above), so a
        // menu choice, whose request was reset above, lands on the curated view.
        if (!latestRequest.present.tooltip) {
          if (savedTooltip.length > 0) {
            viewController.setRequestedView({
              ...latestRequest,
              requested: {
                ...latestRequest.requested,
                tooltip: savedTooltip,
              },
              present: {
                ...latestRequest.present,
                tooltip: true,
              },
            });
          }
        }
      }

      viewController.applyLatestViewForDatasetLoad(data);

      try {
        if (loadMeta.kind === 'user' || loadMeta.kind === 'opfs') {
          await markLastLoadStatus('success');
        }
      } catch (statusError) {
        console.warn('Failed to update OPFS load status to success:', statusError);
      }

      success = true;
    } catch (error) {
      console.error('Failed to finalize loaded dataset state:', error);
    } finally {
      if (loadSequence !== null) {
        loadQueue.resolvePendingLoadFinalization(loadSequence, success);
      }
    }
  };

  // A load superseded while it decodes (a newer user request, or a cancel)
  // still reports decode progress. It must not put the overlay back up: a
  // cancel has dismissed it, and a newer request owns it.
  const isRunningLoadSuperseded = (): boolean => isLoadSuperseded(loadQueue.getRunningLoadMeta());

  const handleDataError = async (event: Event) => {
    const customEvent = event as CustomEvent<DataErrorEventDetail>;
    const runningLoadMeta = loadQueue.getRunningLoadMeta();
    const loadSequence = runningLoadMeta?.sequence ?? null;

    if (customEvent.detail.originalError?.name === 'AbortError') {
      console.log('Data load cancelled by user');
      if (loadSequence !== null) {
        loadQueue.resolvePendingLoadFinalization(loadSequence, false);
      }
      return;
    }

    // A superseded example request is abandoned silently (see the
    // openspec/specs/example-datasets "A request is superseded" scenario): its
    // parse failure must not toast, and must not dismiss the overlay that the
    // newer request — possibly still downloading — now owns.
    if (
      runningLoadMeta?.example &&
      !persistedDatasetController.isCurrentRequest(runningLoadMeta.example.requestId)
    ) {
      console.warn(
        `Ignoring load error for superseded example "${runningLoadMeta.example.entry.id}":`,
        customEvent.detail.message,
      );
      if (loadSequence !== null) {
        loadQueue.resolvePendingLoadFinalization(loadSequence, false);
      }
      return;
    }

    console.error('❌ Data loading error:', customEvent.detail.message);

    if (runningLoadMeta?.kind === 'user' || runningLoadMeta?.kind === 'opfs') {
      try {
        const message = customEvent.detail.message ?? 'Unknown load error';
        await markLastLoadStatus('error', { error: message });
      } catch (statusError) {
        console.warn('Failed to update OPFS load status to error:', statusError);
      }
    }

    if (runningLoadMeta?.kind === 'opfs') {
      if (loadSequence !== null) {
        loadQueue.resolvePendingLoadFinalization(loadSequence, false);
      }

      if (loadSequence !== null && loadQueue.getLatestSequence() > loadSequence) {
        await persistedDatasetController.clearCorruptedPersistedDataset('could not be loaded');
        return;
      }

      // Loads the demo only if no user request has moved past the epoch the
      // restore began under (a menu click still downloading, say); otherwise
      // it just clears the broken copy.
      await persistedDatasetController.recoverFromCorruptedPersistedDataset(
        'could not be loaded',
        runningLoadMeta.epoch,
      );
      return;
    }

    // 'user' and 'default' (including example loads) both reach here on a load that fetched fine but
    // failed to parse. Neither loadData (data-renderer.ts, success only) nor
    // the fetch-catch branch in persisted-dataset.ts (network failure only)
    // runs for this path, so nothing else dismisses the loading overlay —
    // without this, the UI stays behind it, unusable, until reload.
    overlayController.update(false);
    notify.error(getDataLoadFailureNotification(customEvent.detail));

    if (loadSequence !== null) {
      loadQueue.resolvePendingLoadFinalization(loadSequence, false);
    }
  };

  return {
    loadDefaultDatasetAndClearPersistedFile,
    loadExampleDatasetAndClearPersistedFile,
    loadExampleDataset,
    loadPersistedOrDefaultDataset,
    tryLoadPersistedAgain: persistedDatasetController.tryLoadPersistedAgain,
    beginUserRequest: persistedDatasetController.beginUserRequest,
    beginImportPreparation: persistedDatasetController.beginImportPreparation,
    currentRequestEpoch: persistedDatasetController.currentRequestEpoch,
    cancelPendingExampleLoad: persistedDatasetController.cancelPendingExampleLoad,
    hasDisplayedDataset: () => currentDatasetHash !== null,
    subscribeToDatasetChanges(callback) {
      datasetChangeSubscribers.add(callback);
      return () => {
        datasetChangeSubscribers.delete(callback);
      };
    },
    subscribeToExampleRetries(callback) {
      exampleRetrySubscribers.add(callback);
      return () => {
        exampleRetrySubscribers.delete(callback);
      };
    },
    handleLoadingStart() {
      if (isRunningLoadSuperseded()) {
        return;
      }
      console.log('Data loading started');
      phaseOverlayController.update(true, 5, 'Analyzing file structure...', 'Starting upload...');
    },
    handleLoadingProgress(event: Event) {
      if (isRunningLoadSuperseded()) {
        return;
      }
      const customEvent = event as CustomEvent<{ percentage?: number }>;
      const percentage = Number(customEvent.detail.percentage ?? 0);
      const visualProgress = Math.min(20, Math.max(5, percentage * 0.2));
      phaseOverlayController.update(
        true,
        visualProgress,
        'Reading protein data...',
        'Uploading...',
      );
    },
    handleDataLoaded,
    handleDataError,
  };
}

export type { ExampleLoadCancel, PersistedLoadOutcome };
