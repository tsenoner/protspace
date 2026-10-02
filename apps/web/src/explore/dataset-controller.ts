import type {
  ProtspaceControlBar,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoadedEventDetail,
  DataErrorEventDetail,
  DataLoader as ProtspaceDataLoader,
} from '@protspace/core';
import { DEFAULT_EAT_CONFIDENCE_THRESHOLD, generateDatasetHash } from '@protspace/utils';
import { notify } from '../lib/notify';
import {
  getDataLoadFailureNotification,
  getDatasetPersistenceFailureNotification,
  getLegacyBundleFormatNotification,
} from './notifications';
import {
  clearLastImportedFile,
  markLastLoadStatus,
  saveLastImportedFile,
} from './opfs-dataset-store';
import { createDataRenderer } from './data-renderer';
import { DEFAULT_EXAMPLE_DATASET, findExampleDataset } from './example-datasets';
import type { InteractionController } from './interaction-controller';
import type { LoadQueue } from './load-queue';
import { createPersistedDatasetController } from './persisted-dataset';
import type { PersistedLoadOutcome } from './persisted-dataset';
import { readTooltipAnnotations, writeTooltipAnnotations } from './tooltip-annotations-store';
import type { DatasetChangeSource, ExampleLoadOutcome } from './types';
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
  };
  plotElement: ProtspaceScatterplot;
  setCurrentExampleId(id: string | null): void;
  setCurrentDatasetName(name: string): void;
  structureViewer: ProtspaceStructureViewer;
  viewController: ViewController;
}

export interface DatasetController {
  loadDefaultDatasetAndClearPersistedFile(): Promise<void>;
  loadExampleDatasetAndClearPersistedFile(
    id: string,
    source?: DatasetChangeSource,
  ): Promise<ExampleLoadOutcome>;
  /** Loads a known example without touching OPFS (a `?dataset=` deep link or Back/Forward). */
  loadExampleDataset(id: string): Promise<ExampleLoadOutcome>;
  loadPersistedOrDefaultDataset(): Promise<PersistedLoadOutcome>;
  tryLoadPersistedAgain(file: File): Promise<void>;
  /**
   * Invalidates any example fetch still in flight, without starting a new
   * load. Called before a user file import or OPFS restore begins, so a
   * slower, now-stale example fetch can never overwrite it once it resolves.
   */
  supersedePendingExampleFetch(): void;
  subscribeToDatasetChanges(
    callback: (exampleId: string | null, source: DatasetChangeSource) => void,
  ): () => void;
  handleLoadingStart(): void;
  handleLoadingProgress(event: Event): void;
  handleDataLoaded(event: Event): Promise<void>;
  handleDataError(event: Event): Promise<void>;
  /** Proteins the loaded file holds that the dataset leaves out (no projection places them). */
  getUnplacedProteinCount(): number;
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
}: DatasetControllerOptions): DatasetController {
  const loadData = createDataRenderer({
    controlBar,
    getIsDisposed,
    interactionController,
    legendElement,
    overlayController,
    plotElement,
    resolveInitialView: viewController.resolveLatestView,
    structureViewer,
  });

  const persistedDatasetController = createPersistedDatasetController({
    dataLoader,
    overlayController,
    registerFileLoad: loadQueue.registerFileLoad,
    awaitLoadOutcome: loadQueue.awaitLoadOutcome,
    setCurrentExampleId,
    setCurrentDatasetName,
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

  const loadExampleDataset = async (id: string): Promise<ExampleLoadOutcome> => {
    const entry = findExampleDataset(id);
    if (!entry) {
      return 'failed';
    }
    return persistedDatasetController.loadExampleDataset(entry, 'url');
  };

  const loadDefaultDatasetAndClearPersistedFile = async (): Promise<void> => {
    await loadExampleDatasetAndClearPersistedFile(DEFAULT_EXAMPLE_DATASET.id, 'startup');
  };

  const loadPersistedOrDefaultDataset = async (): Promise<PersistedLoadOutcome> => {
    const outcome = await persistedDatasetController.loadPersistedOrDefaultDataset();
    if (outcome.kind === 'recovery-required') {
      // Nothing loads while the recovery banner is up, so nothing reaches
      // `handleDataLoaded`: report "no example" here so a stale `?dataset=`
      // from a failed/unknown deep link is replace-deleted from the URL.
      emitDatasetChange(null, 'startup');
    }
    // 'auto-loaded' (OPFS) and 'default-loaded' (demo) report through
    // `handleDataLoaded` on success.
    return outcome;
  };

  let currentDatasetHash: string | null = null;
  let currentUnplacedProteinCount = 0;
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
      const {
        data,
        settings,
        source,
        file,
        bundleFormatVersion,
        unplacedProteinCount = 0,
      } = customEvent.detail;
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

      // An example load superseded by a newer menu/url/user request, before
      // or during `loadData`, must not label itself, emit, or touch the view:
      // the newer request owns the screen. The queue-level check above can't
      // see this (this load is still the running one), so it is checked here
      // and again after each await below.
      const isSupersededExampleLoad = () =>
        loadMeta.example != null &&
        !persistedDatasetController.isCurrentExampleRequest(loadMeta.example.requestId);

      if (isSupersededExampleLoad()) {
        return;
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
        if (isSupersededExampleLoad()) {
          return;
        }
      }

      const datasetHash = generateDatasetHash(data);
      const shouldClearPersistedState =
        loadMeta.kind === 'default' || (loadMeta.kind === 'user' && settings != null);

      legendElement.clearForNewDataset(datasetHash, shouldClearPersistedState);
      controlBar.clearForNewDataset(datasetHash, shouldClearPersistedState);

      await loadData(data);

      // Re-check: `loadData` can take long enough for a newer example
      // request to land while it was running (see the check above).
      if (isSupersededExampleLoad()) {
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
      currentUnplacedProteinCount = unplacedProteinCount;

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

      // Only for the user's own imports: a dataset the app serves itself never shows it,
      // whatever its format, since a visitor cannot convert it (they are all v3 anyway).
      if (
        loadMeta.kind === 'user' &&
        bundleFormatVersion !== undefined &&
        bundleFormatVersion < 3
      ) {
        notify.info(getLegacyBundleFormatNotification(bundleFormatVersion, unplacedProteinCount));
      }

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
      !persistedDatasetController.isCurrentExampleRequest(runningLoadMeta.example.requestId)
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

      await persistedDatasetController.recoverFromCorruptedPersistedDataset('could not be loaded');
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
    supersedePendingExampleFetch: persistedDatasetController.supersedePendingExampleFetch,
    subscribeToDatasetChanges(callback) {
      datasetChangeSubscribers.add(callback);
      return () => {
        datasetChangeSubscribers.delete(callback);
      };
    },
    handleLoadingStart() {
      console.log('Data loading started');
      overlayController.update(true, 5, 'Analyzing file structure...', 'Starting upload...');
    },
    handleLoadingProgress(event: Event) {
      const customEvent = event as CustomEvent<{ percentage?: number }>;
      const percentage = Number(customEvent.detail.percentage ?? 0);
      const visualProgress = Math.min(20, Math.max(5, percentage * 0.2));
      overlayController.update(true, visualProgress, 'Reading protein data...', 'Uploading...');
    },
    handleDataLoaded,
    handleDataError,
    getUnplacedProteinCount: () => currentUnplacedProteinCount,
  };
}

export type { PersistedLoadOutcome };
