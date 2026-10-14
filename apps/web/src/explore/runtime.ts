import '@protspace/core'; // Registers all web components
import type { RendererDegradedDetail } from '@protspace/core';
import { onEscapeFallback } from '@protspace/core';
import type { EatReliabilityState } from '@protspace/utils';
import { isMacOrIos } from '@protspace/utils';
import { notify } from '../lib/notify';
import {
  getClearStoredDataConfirm,
  getFilterRemovedNotification,
  getRendererDegradedNotification,
} from './notifications';
import { startProductTour } from '../tour/product-tour';
import { createDatasetController } from './dataset-controller';
import { confirmAction } from './confirm-dialog';
import { getElements, waitForElements } from './elements';
import { createExportHandler } from './export-handler';
import type { ExploreControls } from './explore-controls';
import { createFilterController } from './filter-controller';
import { bindImportMenu } from './import-controller';
import { createInteractionController } from './interaction-controller';
import { focusFilterTitle, getLayout, openPanel, subscribeLayout } from './layout-state';
import { getLayoutMode, subscribeLayoutMode } from './layout-mode';
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
import { EXAMPLE_DATASETS, EXAMPLES_DOCS_URL, toExampleDatasetSummary } from './example-datasets';
import { createLoadQueue } from './load-queue';
import {
  LOADING_COPY,
  createLoadFocusReturn,
  createLoadingOverlayController,
  type LoadingOverlayController,
} from './loading-overlay';
import { loadLastImportedFile, readStoredImportSummary } from './opfs-dataset-store';
import { createSelectionController } from './selection-controller';
import { createStatusController } from './status-controller';
import { createStructureController } from './structure-controller';
import { createUndoController, type UndoEntry } from './undo-controller';
import {
  handleCancelledExampleLoad,
  loadDatasetAfterNavigation,
  startInitialExploreLoad,
} from './startup';
import { NOOP_CONTROLLER, type ExploreController } from './types';
import { createViewBarController } from './view-bar-controller';
import { createViewController } from './view-controller';
import {
  createDatasetNamePublisher,
  datasetPhaseFor,
  getWorkbenchStatus,
  setWorkbenchStatus,
  subscribeWorkbenchStatus,
} from './workbench-status';

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
    dataLoader,
    exportMenu,
    importMenu,
    legendElement,
    plotElement,
    queryBuilder,
    structureViewer,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    plotTools,
    selectionBar,
    plotStatus,
    proteinSearch,
  } = elements;
  const lifecycle = createLifecycle();

  // What the structure viewer shows and when: a protein loads only where it can be seen.
  const structureController = createStructureController({
    viewer: structureViewer,
    plotElement,
    layoutMode: { get: getLayoutMode, subscribe: subscribeLayoutMode },
  });
  lifecycle.addCleanup(() => structureController.dispose());

  importMenu.exampleDatasets = EXAMPLE_DATASETS.map(toExampleDatasetSummary);
  importMenu.examplesDocsUrl = EXAMPLES_DOCS_URL;

  // The app bar names the dataset on screen and its size.
  const publishDatasetName = createDatasetNamePublisher(() => plotElement.data);
  // What is on screen, for the Import menu's "Last file" (hidden while that file shows).
  let currentDatasetName = '';
  let currentExampleId: string | null = null;
  const setCurrentDatasetName = (name: string) => {
    currentDatasetName = name;
    publishDatasetName(name);
  };

  const setCurrentExampleId = (id: string | null) => {
    currentExampleId = id;
    importMenu.currentExampleId = id;
  };

  // A remounted page starts from an empty app bar, and no empty state, until its own first load.
  lifecycle.addCleanup(() =>
    setWorkbenchStatus({ datasetName: null, proteinCount: null, datasetPhase: 'starting' }),
  );

  // What the plot area shows (workbench-status.ts): the overlay while a load runs, the plot once a
  // dataset is on screen, the empty state once startup has ended with nothing to show.
  let overlayShown = false;
  let startupSettled = false;
  const syncDatasetPhase = () => {
    if (lifecycle.isDisposed()) return;
    setWorkbenchStatus({
      datasetPhase: datasetPhaseFor({
        overlayShown,
        // `datasetController` is declared below; this runs only once a load has begun.
        displayed: datasetController.hasDisplayedDataset(),
        startupSettled,
      }),
    });
  };
  const loadingOverlay = createLoadingOverlayController();
  // When the control focused before the load is gone, the dataset button, which names the result.
  const focusReturn = createLoadFocusReturn(() =>
    document.querySelector<HTMLElement>('[data-workbench="dataset"]'),
  );
  const overlayController: LoadingOverlayController = {
    update(show, progress, message, subMessage, note) {
      if (show && !overlayShown) focusReturn.remember();
      loadingOverlay.update(show, progress, message, subMessage, note);
      if (show !== overlayShown) {
        overlayShown = show;
        syncDatasetPhase();
        if (!show) focusReturn.restore();
      }
    },
    setCancelHandler: (handler, label) => loadingOverlay.setCancelHandler(handler, label),
    dispose() {
      overlayShown = false;
      loadingOverlay.dispose();
    },
  };
  lifecycle.addCleanup(() => overlayController.dispose());

  const loadQueue = createLoadQueue({
    isDisposed: lifecycle.isDisposed,
    // `datasetController` is declared below; the queue asks only once a load
    // comes off it, after this synchronous setup has finished.
    skipLoad: (meta) => datasetController.isSkippableQueuedLoad(meta),
  });
  dataLoader.loadFromFileHandler = (file, options, next) => {
    // A non-'auto' load is a user import: a user request, which supersedes
    // any load still in flight and any startup load not yet started. Its load
    // is tagged with the epoch it took, so a newer user request made while it
    // prepares or decodes supersedes it in turn (`handleDataLoaded`).
    // `datasetController` is declared below; this handler only runs on a
    // later load, after this synchronous setup has finished.
    let epoch = datasetController.currentRequestEpoch();
    if (options?.source !== 'auto') {
      epoch = datasetController.beginUserRequest();
      loadQueue.registerFileLoad(file, 'user', undefined, epoch);
    }
    return loadQueue.enqueueLoadFromFile(file, options, async (queuedFile, queuedOptions) => {
      const loadBundle = (bundle: File) =>
        datasetController.saveWhileLoading(bundle, () => next(bundle, queuedOptions));
      if (!isFastaFile(queuedFile)) {
        return loadBundle(queuedFile);
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
          { code: 'TOO_FEW_SEQUENCES' },
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

      // The upload's Cancel aborts it, and so does a newer user request (a
      // Back/Forward, say), which owns the screen from then on: a superseded
      // preparation settles its queue slot as failed and touches neither the
      // overlay nor the queue again.
      const preparation = datasetController.beginImportPreparation(epoch);
      const abandonIfSuperseded = (): boolean => {
        if (preparation.isCurrent()) {
          return false;
        }
        preparation.settle();
        const meta = loadQueue.getLoadMetaForFile(queuedFile);
        if (meta) {
          loadQueue.resolvePendingLoadFinalization(meta.sequence, false);
        }
        return true;
      };
      if (abandonIfSuperseded()) {
        return;
      }
      // The title stays "Preparing FASTA…"; the line under the bar says what the server is doing.
      const showProgress = (progress: number, detail: string) => {
        if (preparation.isCurrent()) {
          overlayController.update(true, progress, detail, LOADING_COPY.fastaTitle);
        }
      };
      overlayController.update(
        true,
        5,
        LOADING_COPY.fastaUploading,
        LOADING_COPY.fastaTitle,
        colabNote,
      );
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
          showProgress(lastProgress, subMessage);
        }, 250);
      };

      const stopCreep = () => {
        if (creep) {
          window.clearInterval(creep);
          creep = 0;
        }
      };

      let bundleFile: File;
      try {
        bundleFile = await prepareFastaBundle(queuedFile, {
          baseUrl: import.meta.env.VITE_PREP_API_BASE ?? '',
          signal: preparation.signal,
          onProgress: (stage, payload) => {
            if (stage === 'queued') {
              const queuePos =
                typeof payload.queue_position === 'number' ? payload.queue_position : 0;
              if (queuePos > 0) {
                lastProgress = 5;
                showProgress(lastProgress, `Position ${queuePos} in queue…`);
              } else {
                lastProgress = 12;
                showProgress(lastProgress, embeddingLabel);
                startCreep();
              }
            } else if (stage === 'embedding' || stage === 'annotating') {
              lastProgress = Math.max(lastProgress, 12);
              showProgress(lastProgress, embeddingLabel);
              startCreep();
            } else if (stage === 'projecting') {
              stopCreep();
              lastProgress = 70;
              showProgress(lastProgress, 'Projecting…');
            } else if (stage === 'bundling') {
              lastProgress = 90;
              showProgress(lastProgress, 'Bundling…');
            }
          },
        });
      } catch (error) {
        // Aborted by the newer request, which owns the overlay: no toast.
        if (abandonIfSuperseded()) {
          return;
        }
        preparation.settle();
        overlayController.update(false, 0, '', '');
        throw error;
      } finally {
        stopCreep();
      }
      if (abandonIfSuperseded()) {
        return;
      }
      preparation.settle();
      return loadBundle(bundleFile);
    });
  };
  lifecycle.addCleanup(() => {
    dataLoader.loadFromFileHandler = undefined;
    loadQueue.dispose();
  });

  const interactionController = createInteractionController({
    legendElement,
    plotElement,
    requestStructure: (proteinId) => structureController.request(proteinId),
    showSelection: (proteinIds) => structureController.select(proteinIds),
  });

  const selectionController = createSelectionController({
    plotElement,
    plotTools,
    selectionBar,
    proteinSearch,
    interactionController,
    history: interactionController.history,
    registerEscape: onEscapeFallback,
    notify,
  });
  lifecycle.addCleanup(() => selectionController.dispose());

  // Before the filter controller: both hear annotation-change on the document, and the filter's
  // reliability mirror runs last, as the control bar's did.
  const viewBarController = createViewBarController({
    plotElement,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    interactionController,
    root: document,
    onUserChange(kind) {
      if (kind === 'projection') viewController.handleUserProjectionChange();
      else if (kind === 'annotation') viewController.handleUserAnnotationChange();
      else if (kind === 'tooltip') viewController.handleUserTooltipAnnotationsChange();
      else viewController.handleUserDensityLayerChange();
    },
  });
  lifecycle.addCleanup(() => viewBarController.dispose());

  const viewController = createViewController({
    plotElement,
    pickers: viewBarController,
  });
  lifecycle.addCleanup(() => viewController.dispose());

  // The Filter panel counts only while it is on screen: open on the desktop sidebar's Filter
  // panel; below 951 px whenever Filter is the chosen panel, except in a folded phone panel,
  // which shows only its header.
  const isFilterPanelShown = () => {
    const { panel, sidebarOpen, panelFolded } = getLayout();
    if (panel !== 'filter') return false;
    const mode = getLayoutMode();
    if (mode === 'desktop') return sidebarOpen;
    return mode !== 'phone' || !panelFolded;
  };
  // "Filter removed" with Undo (decisions 13 and 15): the toast is a shortcut to the history step
  // it names, and goes as soon as a newer step would make its Undo take back something else.
  let stopWatchingFilterUndo: (() => void) | null = null;
  const offerFilterUndo = (entry: UndoEntry) => {
    stopWatchingFilterUndo?.();
    const { history } = interactionController;
    let unsubscribe: () => void = () => {};
    // Ends this toast's watch only: an older toast that closes late must not end a newer one's.
    const stop = () => {
      unsubscribe();
      if (stopWatchingFilterUndo === stop) stopWatchingFilterUndo = null;
    };
    const toast = notify.undoable({
      ...getFilterRemovedNotification(),
      onUndo: () => {
        stop();
        undoController.undoEntry(entry);
      },
      // Dismissed or timed out: the watcher goes with the toast.
      onClose: stop,
    });
    unsubscribe = history.subscribe(() => {
      if (history.peekUndo() === entry) return;
      stop();
      toast.dismiss();
    });
    stopWatchingFilterUndo = stop;
  };
  lifecycle.addCleanup(() => stopWatchingFilterUndo?.());
  const filterController = createFilterController({
    plotElement,
    legendElement,
    queryBuilder,
    root: document,
    isPanelShown: isFilterPanelShown,
    subscribePanel(listener) {
      const unsubscribe = subscribeLayout(listener);
      const unsubscribeMode = subscribeLayoutMode(listener);
      return () => {
        unsubscribe();
        unsubscribeMode();
      };
    },
    // Apply, Reset and the chip's ✕ are undo steps; the EAT slider is not (it reports nothing).
    onFilterCommitted(commit) {
      const entry: UndoEntry = { kind: 'filter', ...commit };
      interactionController.history.record(entry);
      // Apply needs no toast: the chip and the count show it. A removal offers Undo.
      if (commit.cause !== 'apply') offerFilterUndo(entry);
    },
  });
  lifecycle.addCleanup(() => filterController.dispose());
  const statusController = createStatusController({
    plotElement,
    plotStatus,
    getStatus: getWorkbenchStatus,
    subscribeStatus: subscribeWorkbenchStatus,
    // The chip leads where the view bar's Filter does, focus included: the heading, then the draft.
    openFilter: () => {
      openPanel('filter');
      requestAnimationFrame(focusFilterTitle);
    },
    clearFilter: () => filterController.clear(),
    openLegend: () => openPanel('legend'),
    showAllCategories: () => legendElement.showAllCategories(),
    resetIsolation: () => selectionController.resetIsolation(),
  });
  lifecycle.addCleanup(() => statusController.dispose());
  // Clear and Show only these hide the bar they were pressed in. Show only these hands focus to
  // the isolation chip that takes its place, Clear to the tool strip.
  selectionBar.returnFocus = (action) => {
    if (action === 'isolate' && plotStatus.focusChip('isolation')) return;
    plotTools.focusTool();
  };
  lifecycle.addCleanup(() => {
    selectionBar.returnFocus = null;
  });

  // ⌘Z / Ctrl+Z, ⇧ to redo (design decision 13): each controller applies the steps it recorded.
  const undoController = createUndoController({
    history: interactionController.history,
    root: document,
    isMac: isMacOrIos,
    // A modal or a load owns the keys. The figure editor's dialog lives in its element's shadow
    // root, where `ps-dialog[open]` cannot see it, so the element itself counts while it is in the
    // page; during a load, an undo would act on the dataset being replaced.
    isModalOpen: () =>
      getWorkbenchStatus().datasetPhase === 'loading' ||
      document.querySelector('dialog[open], ps-dialog[open], protspace-publish-modal') !== null,
    apply(entry, direction) {
      if (entry.kind === 'filter') {
        filterController.restore(direction === 'undo' ? entry.before : entry.after);
      } else {
        selectionController.applyHistory(entry, direction);
      }
    },
  });
  lifecycle.addCleanup(() => undoController.dispose());

  // The dataset pipeline's one seam to the controls (explore-controls.ts).
  const controls: ExploreControls = {
    resetForNewDataset() {
      // The steps name proteins of the dataset that is going away.
      interactionController.history.clear();
      selectionController.resetForNewDataset();
      viewBarController.resetForNewDataset();
      exportMenu.reset();
      filterController.resetForNewDataset();
    },
    setHasFileSettings(value) {
      exportMenu.hasFileSettings = value;
    },
    showInitialView(view) {
      viewBarController.showInitialView(view);
      filterController.setSelectedAnnotation(view.annotation);
    },
    clearStructure() {
      structureController.clear();
    },
  };

  // The recovery banner's "Clear stored data" and "Load default" delete the stored import: ask
  // first.
  const confirmClear = (fileName: string, action: 'clear' | 'load-default') =>
    confirmAction(getClearStoredDataConfirm(fileName, action));
  const datasetController = createDatasetController({
    controls,
    dataLoader,
    getIsDisposed: lifecycle.isDisposed,
    interactionController,
    legendElement,
    loadQueue,
    overlayController,
    plotElement,
    setCurrentExampleId,
    setCurrentDatasetName,
    viewController,
    onExampleLoadCancelled(cancel) {
      if (lifecycle.isDisposed()) {
        return;
      }
      handleCancelledExampleLoad(datasetController, viewController, cancel, confirmClear)
        .catch((error: unknown) => {
          console.error('Startup load after a cancelled download failed:', error);
        })
        .finally(syncDatasetPhase);
    },
  });
  // An example fetch/decode still in flight when the page is torn down (a
  // route change, a remount) would otherwise resolve on a disposed runtime:
  // superseding it here means it recognizes itself as stale and does
  // nothing once it does resolve, rather than trying to render onto
  // elements that are gone.
  lifecycle.addCleanup(() => {
    datasetController.beginUserRequest();
  });

  createExportHandler({
    exportMenu,
    listen(type, listener) {
      addTrackedEventListener(lifecycle, exportMenu, type, listener);
    },
    getSelectedProteins: interactionController.getSelectedProteins,
    getUnplacedProteinCount: datasetController.getUnplacedProteinCount,
    legendElement,
    plotElement,
    notify,
  });

  addTrackedEventListener(
    lifecycle,
    plotElement,
    'protein-click',
    interactionController.handleProteinClick,
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
    'legend-error',
    interactionController.handleLegendError,
  );
  // The legend's reliability control drives the shared `EAT_confidence >= x or N/A` filter
  // condition; the filter controller moves the control back when the query changes (#6b).
  addTrackedEventListener(lifecycle, legendElement, 'eat-overlay-change', (event: Event) => {
    // The full state (mode + both bounds) reaches the query: the scalar threshold alone cannot
    // express "hide above" or "keep between".
    const { reliability } = (
      event as CustomEvent<{
        enabled: boolean;
        confidenceThreshold: number;
        reliability: EatReliabilityState;
      }>
    ).detail;
    filterController.setEatReliability(legendElement.selectedAnnotation, reliability);
  });
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
    plotElement,
    'data-change',
    interactionController.handlePlotDataChange,
  );
  // The renderer reports capability reductions (device texture limits, a refused
  // GPU allocation, the gamma fallback) that were previously silent or
  // console-only. Latched once per reason in the renderer, deduped again here.
  addTrackedEventListener(lifecycle, plotElement, 'renderer-degraded', (event: Event) => {
    const detail = (event as CustomEvent<RendererDegradedDetail>).detail;
    notify.warning(getRendererDegradedNotification(detail));
  });
  // The shell's drop handler (use-file-drop.ts) dispatches dropped files on the data loader.
  addTrackedEventListener(lifecycle, dataLoader, 'file-dropped', (event: Event) => {
    const file = (event as CustomEvent<{ file?: File }>).detail.file;
    if (file) {
      void dataLoader.loadFromFile(file);
    }
  });
  const importMenuBinding = bindImportMenu({
    listen(type, listener) {
      addTrackedEventListener(lifecycle, importMenu, type, listener);
    },
    importMenu,
    dataLoader,
    datasetController,
    readSummary: readStoredImportSummary,
    loadLastFile: loadLastImportedFile,
    subscribeToDatasetChanges: (callback) => datasetController.subscribeToDatasetChanges(callback),
    getCurrentExampleId: () => currentExampleId,
    getShownName: () => currentDatasetName,
    warn: (title) => notify.warning({ title }),
  });
  lifecycle.addCleanup(() => importMenuBinding.dispose());

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
    void datasetController.handleDataLoaded(event).finally(syncDatasetPhase);
  });
  addTrackedEventListener(lifecycle, dataLoader, 'data-error', (event: Event) => {
    void datasetController.handleDataError(event).finally(syncDatasetPhase);
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

  interactionController.updateLegend();

  // Startup is not kicked off here: it waits for the URL sync hook's
  // `attachController` to call `setRequestedDataset` with the initial
  // `?dataset=` param, so the very first load already knows which example (if
  // any) to show instead of loading the demo/stored import and then swapping.
  let hasStartedInitialDatasetLoad = false;

  console.log('ProtSpace components loaded and connected!');
  console.log('Use the view bar to change the view and the plot tools to select proteins.');

  return {
    setRequestedView(requested) {
      if (lifecycle.isDisposed()) {
        return;
      }

      viewController.setRequestedView(requested);
    },
    recordRequestedView(requested) {
      if (lifecycle.isDisposed()) {
        return;
      }

      viewController.recordRequestedView(requested);
    },
    subscribeToViewChanges(callback) {
      return viewController.subscribeToViewChanges(callback);
    },
    setRequestedDataset(exampleId) {
      if (lifecycle.isDisposed()) {
        return Promise.resolve();
      }

      let request: Promise<void>;
      if (!hasStartedInitialDatasetLoad) {
        hasStartedInitialDatasetLoad = true;
        request = startInitialExploreLoad({
          dataLoader,
          datasetController,
          plotElement,
          requestedExampleId: exampleId,
          confirmClear,
        });
      } else {
        request = loadDatasetAfterNavigation(
          datasetController,
          viewController,
          exampleId,
          confirmClear,
        );
      }
      // The URL sync hook only waits for this to settle; a failure has
      // already been reported to the user by the load itself.
      return request
        .catch((error: unknown) => {
          console.error('Dataset request failed:', error);
        })
        .finally(() => {
          // Startup has ended: with nothing on screen now, the plot invites a drop.
          startupSettled = true;
          syncDatasetPhase();
        });
    },
    cancelPendingMenuLoad() {
      if (lifecycle.isDisposed()) {
        return 'none';
      }

      return datasetController.cancelPendingExampleLoad({ source: 'menu' });
    },
    subscribeToDatasetChanges(callback) {
      return datasetController.subscribeToDatasetChanges(callback);
    },
    subscribeToExampleRetries(callback) {
      return datasetController.subscribeToExampleRetries(callback);
    },
    dispose() {
      lifecycle.dispose();
    },
  };
}
