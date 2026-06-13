import '@protspace/core'; // Registers all web components
import { startProductTour } from '../tour/product-tour';
import { bindControlBarEvents } from './control-bar-events';
import { createDatasetController } from './dataset-controller';
import { getElements, waitForElements } from './elements';
import { createExportHandler } from './export-handler';
import { createInteractionController } from './interaction-controller';
import { createLifecycle } from './lifecycle';
import {
  countFastaSequences,
  estimateEmbedSeconds,
  formatEmbeddingLabel,
} from './fasta-prep-estimate';
import { FastaPrepError, isFastaFile, prepareFastaBundle } from './fasta-prep-client';
import {
  COLAB_NOTEBOOK_URL,
  MAX_SEQUENCES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  MIN_SEQUENCES,
  PIPELINE_TIMEOUT_SECONDS,
} from './fasta-prep-limits';
import { createLoadQueue } from './load-queue';
import { createLoadingOverlayController } from './loading-overlay';
import { createPersistedLegendController } from './persisted-legend';
import { startInitialExploreLoad } from './startup';
import { NOOP_CONTROLLER, type ExploreController } from './types';
import { createViewController } from './view-controller';

const DEFAULT_DATASET_NAME = 'Demo dataset';

function addTrackedEventListener(
  lifecycle: ReturnType<typeof createLifecycle>,
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  lifecycle.addCleanup(() => target.removeEventListener(type, listener, options));
}

export async function initializeExploreRuntime(): Promise<ExploreController> {
  await waitForElements();

  const elements = getElements();
  if (!elements) {
    return NOOP_CONTROLLER;
  }

  const {
    controlBar,
    dataLoader,
    legendElement,
    plotElement,
    selectedProteinElement,
    structureViewer,
  } = elements;
  const lifecycle = createLifecycle();

  const setCurrentDatasetName = (name: string) => {
    controlBar.currentDatasetName = name;
  };

  const setCurrentDatasetIsDemo = (isDemo: boolean) => {
    controlBar.currentDatasetIsDemo = isDemo;
  };

  const overlayController = createLoadingOverlayController();
  lifecycle.addCleanup(() => overlayController.dispose());

  const loadQueue = createLoadQueue({
    isDisposed: lifecycle.isDisposed,
  });
  dataLoader.loadFromFileHandler = (file, options, next) =>
    loadQueue.enqueueLoadFromFile(file, options, async (queuedFile, queuedOptions) => {
      if (!isFastaFile(queuedFile)) {
        return next(queuedFile, queuedOptions);
      }

      // Advisory client-side pre-check: the backend remains the source of
      // truth, but failing fast here saves a wasted upload + a rate-limit token.
      if (queuedFile.size > MAX_UPLOAD_BYTES) {
        throw new FastaPrepError(
          `This FASTA file is larger than the ${MAX_UPLOAD_LABEL} upload limit. Trim it or split it into smaller batches.`,
          { code: 'FILE_TOO_LARGE' },
        );
      }

      const seqCount = await countFastaSequences(queuedFile).catch(() => 0);
      const estimateSeconds = estimateEmbedSeconds(seqCount);
      const embeddingLabel = formatEmbeddingLabel(seqCount);

      // Surface count-based limits early too (only when we actually counted).
      if (seqCount > MAX_SEQUENCES) {
        throw new FastaPrepError(
          `This FASTA has ${seqCount} sequences, more than the ${MAX_SEQUENCES} limit. Reduce it, or use the Colab notebook for larger datasets.`,
          { code: 'TOO_MANY_SEQUENCES' },
        );
      }
      if (seqCount > 0 && seqCount < MIN_SEQUENCES) {
        throw new FastaPrepError(
          `This FASTA has only ${seqCount} sequence${seqCount === 1 ? '' : 's'}; the prep backend needs at least ${MIN_SEQUENCES}.`,
          { code: 'EMPTY_FASTA' },
        );
      }

      // Only nudge toward Colab when the dataset is genuinely too large to run
      // here (the pre-check above already rejects strictly-over-limit files, so
      // this surfaces for borderline counts approaching the cap).
      const colabNote =
        seqCount >= MAX_SEQUENCES
          ? {
              text: 'Got a larger dataset?',
              href: COLAB_NOTEBOOK_URL,
              linkText: 'Open in Colab ↗',
            }
          : undefined;

      const abortController = new AbortController();
      overlayController.update(true, 5, 'Preparing FASTA…', 'Uploading…', colabNote);
      overlayController.setCancelHandler(() => abortController.abort());
      let lastProgress = 5;
      let creep = 0;

      // For large jobs the estimate sits close to the backend's hard timeout,
      // so a high creep cap would imply near-completion exactly when the server
      // might still time out. Cap lower for big jobs to keep the bar honest.
      const isLargeJob = seqCount > MAX_SEQUENCES / 2;
      const creepCap = isLargeJob ? 50 : 65;
      // Show the "still working" note once we pass the estimate, but never
      // later than ~80% of the hard timeout so it always appears before a
      // server-side timeout could land.
      const overdueThresholdSeconds = Math.min(estimateSeconds, PIPELINE_TIMEOUT_SECONDS * 0.8);

      const startCreep = () => {
        if (creep) return;
        const startedAt = performance.now();
        // Asymptotic curve toward the cap, scaled to the per-job estimate.
        // tau = estimate/2 (in ms) puts the bar partway up when the estimated
        // wall-clock elapses, so it always advances but slows as it approaches.
        const tau = Math.max(15_000, estimateSeconds * 500);
        const floor = 12;
        creep = window.setInterval(() => {
          const elapsed = performance.now() - startedAt;
          const target = floor + (creepCap - floor) * (1 - Math.exp(-elapsed / tau));
          lastProgress = Math.max(lastProgress, target);
          // Past the estimate the job is running long; tell the user it is
          // still working rather than implying it is nearly done.
          const overdue = elapsed > overdueThresholdSeconds * 1000;
          const subMessage = overdue
            ? 'Still working — large jobs can take a few minutes…'
            : embeddingLabel;
          overlayController.update(true, lastProgress, 'Preparing FASTA…', subMessage);
        }, 250);
      };

      const stopCreep = () => {
        if (creep) {
          window.clearInterval(creep);
          creep = 0;
        }
      };

      try {
        const bundleFile = await prepareFastaBundle(queuedFile, {
          baseUrl: import.meta.env.VITE_PREP_API_BASE ?? '',
          signal: abortController.signal,
          onProgress: (stage, payload) => {
            if (stage === 'queued') {
              const queuePos =
                typeof payload.queue_position === 'number' ? payload.queue_position : 0;
              if (queuePos > 0) {
                lastProgress = 5;
                overlayController.update(
                  true,
                  lastProgress,
                  'Preparing FASTA…',
                  `Position ${queuePos} in queue…`,
                );
              } else {
                lastProgress = 12;
                overlayController.update(true, lastProgress, 'Preparing FASTA…', embeddingLabel);
                startCreep();
              }
            } else if (stage === 'embedding' || stage === 'annotating') {
              lastProgress = Math.max(lastProgress, 12);
              overlayController.update(true, lastProgress, 'Preparing FASTA…', embeddingLabel);
              startCreep();
            } else if (stage === 'projecting') {
              stopCreep();
              lastProgress = 70;
              overlayController.update(true, lastProgress, 'Preparing FASTA…', 'Projecting…');
            } else if (stage === 'bundling') {
              lastProgress = 90;
              overlayController.update(true, lastProgress, 'Preparing FASTA…', 'Bundling…');
            }
          },
        });
        stopCreep();
        overlayController.setCancelHandler(null);
        return next(bundleFile, queuedOptions);
      } catch (error) {
        stopCreep();
        overlayController.setCancelHandler(null);
        overlayController.update(false, 0, '', '');
        throw error;
      }
    });
  lifecycle.addCleanup(() => {
    dataLoader.loadFromFileHandler = undefined;
    loadQueue.dispose();
  });

  const viewController = createViewController({
    plotElement,
    controlBar,
  });
  lifecycle.addCleanup(() => viewController.dispose());

  const persistedLegendController = createPersistedLegendController({
    plotElement,
  });

  const interactionController = createInteractionController({
    legendElement,
    plotElement,
    selectedProteinElement,
    structureViewer,
    clearPersistedLegendHiddenValues: persistedLegendController.clearPersistedLegendHiddenValues,
  });

  const datasetController = createDatasetController({
    controlBar,
    dataLoader,
    defaultDatasetName: DEFAULT_DATASET_NAME,
    getIsDisposed: lifecycle.isDisposed,
    interactionController,
    legendElement,
    loadQueue,
    overlayController,
    plotElement,
    structureViewer,
    setCurrentDatasetIsDemo,
    setCurrentDatasetName,
    viewController,
  });

  const handleExport = createExportHandler({
    controlBar,
    getSelectedProteins: interactionController.getSelectedProteins,
    legendElement,
    plotElement,
  });

  lifecycle.scheduleTimeout(() => {
    legendElement.autoSync = true;
    legendElement.autoHide = true;
  }, 100);

  addTrackedEventListener(
    lifecycle,
    controlBar,
    'protein-selection-change',
    interactionController.handleSelectionChange,
  );
  addTrackedEventListener(
    lifecycle,
    plotElement,
    'data-isolation',
    interactionController.updateLegend,
  );
  addTrackedEventListener(
    lifecycle,
    plotElement,
    'data-isolation-reset',
    interactionController.updateLegend,
  );
  addTrackedEventListener(
    lifecycle,
    legendElement,
    'legend-item-click',
    interactionController.handleLegendItemClick,
  );
  addTrackedEventListener(
    lifecycle,
    legendElement,
    'legend-error',
    interactionController.handleLegendError,
  );
  addTrackedEventListener(
    lifecycle,
    structureViewer,
    'structure-load',
    interactionController.handleStructureLoad,
  );
  addTrackedEventListener(
    lifecycle,
    structureViewer,
    'structure-error',
    interactionController.handleStructureError,
  );
  addTrackedEventListener(
    lifecycle,
    structureViewer,
    'structure-close',
    interactionController.handleStructureClose,
  );
  addTrackedEventListener(
    lifecycle,
    plotElement,
    'data-change',
    interactionController.handlePlotDataChange,
  );
  addTrackedEventListener(lifecycle, plotElement, 'file-dropped', (event: Event) => {
    const file = (event as CustomEvent<{ file?: File }>).detail.file;
    if (file) {
      void dataLoader.loadFromFile(file);
    }
  });
  bindControlBarEvents({
    addControlBarListener(type, listener, options) {
      addTrackedEventListener(lifecycle, controlBar, type, listener, options);
    },
    controlBar,
    datasetController,
    handleExport,
    interactionController,
    plotElement,
    viewController,
  });

  addTrackedEventListener(
    lifecycle,
    dataLoader,
    'data-loading-start',
    datasetController.handleLoadingStart,
  );
  addTrackedEventListener(
    lifecycle,
    dataLoader,
    'data-loading-progress',
    datasetController.handleLoadingProgress,
  );
  addTrackedEventListener(lifecycle, dataLoader, 'data-loaded', (event: Event) => {
    void datasetController.handleDataLoaded(event);
  });
  addTrackedEventListener(lifecycle, dataLoader, 'data-error', (event: Event) => {
    void datasetController.handleDataError(event);
  });
  addTrackedEventListener(
    lifecycle,
    dataLoader,
    'data-loaded',
    () => {
      lifecycle.scheduleTimeout(() => {
        startProductTour();
      }, 800);
    },
    { once: true },
  );

  addTrackedEventListener(lifecycle, plotElement, 'tour-start', () => {
    startProductTour({ force: true });
  });

  interactionController.updateLegend();

  void startInitialExploreLoad({ datasetController, plotElement, dataLoader });

  console.log('ProtSpace components loaded and connected!');
  console.log('Data will be loaded from OPFS when available, otherwise from data.parquetbundle');
  console.log('Use the control bar to change annotations and toggle selection modes!');

  return {
    setRequestedView(requested) {
      if (lifecycle.isDisposed()) {
        return;
      }

      viewController.setRequestedView(requested);
    },
    subscribeToViewChanges(callback) {
      return viewController.subscribeToViewChanges(callback);
    },
    dispose() {
      lifecycle.dispose();
    },
  };
}
