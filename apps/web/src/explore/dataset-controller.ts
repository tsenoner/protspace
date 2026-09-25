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
} from './notifications';
import { markLastLoadStatus, saveLastImportedFile } from './opfs-dataset-store';
import { createDataRenderer } from './data-renderer';
import { EXAMPLE_DATASETS, findExampleDataset } from './example-datasets';
import type { InteractionController } from './interaction-controller';
import type { LoadQueue } from './load-queue';
import { createPersistedDatasetController } from './persisted-dataset';
import type { PersistedLoadOutcome } from './persisted-dataset';
import { readTooltipAnnotations, writeTooltipAnnotations } from './tooltip-annotations-store';
import type { DatasetChangeSource } from './types';
import type { ViewController } from './view-controller';

const DEFAULT_EXAMPLE_ID = EXAMPLE_DATASETS[0].id;

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
  ): Promise<boolean>;
  /** Loads a known example without touching OPFS (a `?dataset=` deep link or Back/Forward). */
  loadExampleDataset(id: string): Promise<boolean>;
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
    registerFileLoad(file, kind, example) {
      return loadQueue.registerFileLoad(file, kind, example);
    },
    awaitLoadOutcome(sequence) {
      return loadQueue.awaitLoadOutcome(sequence);
    },
    setCurrentExampleId,
    setCurrentDatasetName,
  });

  // Reports which example (or no example) is now showing and why, so the URL
  // sync hook can decide whether/how to write `?dataset=`. Only successful
  // loads are reported.
  const datasetChangeSubscribers = new Set<
    (exampleId: string | null, source: DatasetChangeSource) => void
  >();
  const emitDatasetChange = (exampleId: string | null, source: DatasetChangeSource) => {
    datasetChangeSubscribers.forEach((callback) => callback(exampleId, source));
  };

  // Name, id and the dataset-change emit for a successful example load all
  // happen inside `handleDataLoaded` below, keyed on the example carried in
  // that load's metadata — never here — so a load that fails after this
  // resolves (a parse error) can never have already announced success. These
  // wrappers just forward the outcome, which is now the load's real result
  // (see persisted-dataset.ts `loadExampleDataset`), not a guess.
  const loadExampleDatasetAndClearPersistedFile = async (
    id: string,
    source: DatasetChangeSource = 'menu',
  ): Promise<boolean> =>
    persistedDatasetController.loadExampleDatasetAndClearPersistedFile(id, source);

  const loadExampleDataset = async (id: string): Promise<boolean> => {
    const entry = findExampleDataset(id);
    if (!entry) {
      return false;
    }
    return persistedDatasetController.loadExampleDataset(entry, 'url');
  };

  const loadDefaultDatasetAndClearPersistedFile = async (): Promise<void> => {
    await loadExampleDatasetAndClearPersistedFile(DEFAULT_EXAMPLE_ID, 'startup');
  };

  const loadPersistedOrDefaultDataset = async (): Promise<PersistedLoadOutcome> => {
    const outcome = await persistedDatasetController.loadPersistedOrDefaultDataset();
    if (outcome.kind === 'auto-loaded') {
      // The OPFS restore path (kind 'opfs') has no example metadata for
      // `handleDataLoaded` to key on, so it's reported here instead.
      emitDatasetChange(null, 'startup');
    }
    // 'default-loaded' means loadExampleDataset(DEFAULT_EXAMPLE, 'startup') ran
    // internally, which already emits through handleDataLoaded on success.
    return outcome;
  };

  const tryLoadPersistedAgain = async (file: File): Promise<void> => {
    await persistedDatasetController.tryLoadPersistedAgain(file);
    emitDatasetChange(null, 'startup');
  };

  let currentDatasetHash: string | null = null;
  viewController.subscribeToViewChanges((change) => {
    if (currentDatasetHash !== null) {
      writeTooltipAnnotations(currentDatasetHash, change.effective.tooltip);
    }
  });

  const handleDataLoaded = async (event: Event) => {
    let loadSequence: number | null = null;

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
      }

      const datasetHash = generateDatasetHash(data);
      const shouldClearPersistedState =
        loadMeta.kind === 'default' || (loadMeta.kind === 'user' && settings != null);

      legendElement.clearForNewDataset(datasetHash, shouldClearPersistedState);
      controlBar.clearForNewDataset(datasetHash, shouldClearPersistedState);

      await loadData(data);

      if (settings && loadMeta.kind !== 'opfs') {
        legendElement.setFileSettings(settings.legendSettings, datasetHash, true);
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
          settings.eatConfidenceThreshold !== undefined);

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
        if (loadMeta.kind === 'user') {
          emitDatasetChange(null, 'user');
        }
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
    } catch (error) {
      console.error('Failed to finalize loaded dataset state:', error);
    } finally {
      if (loadSequence !== null) {
        loadQueue.resolvePendingLoadFinalization(loadSequence);
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
    tryLoadPersistedAgain,
    supersedePendingExampleFetch() {
      persistedDatasetController.supersedePendingExampleFetch();
    },
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
  };
}

export type { PersistedLoadOutcome };
