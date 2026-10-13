import {
  AfterPaintCommit,
  ESCAPE_ORDER,
  type BrushSelectionDetail,
  type PlotTool,
  type ProteinClickDetail,
  type ProtspacePlotTools,
  type ProtspaceProteinSearch,
  type ProtspaceScatterplot,
  type ProtspaceSelectionBar,
} from '@protspace/core';
import type { notify as Notify } from '../lib/notify';
import type { InteractionController } from './interaction-controller';
import {
  getSelectionCopiedNotification,
  getSelectionCopyFailedNotification,
  getSelectionDisabledNotification,
} from './notifications';
import type { UndoEntry } from './undo-controller';
import type { UndoHistory } from './undo-history';

/** Adds `proteinId` to the selection, or removes it when it is already there. */
export function toggleProteinSelection(
  proteinId: string,
  currentSelection: readonly string[],
): string[] {
  const currentSet = new Set(currentSelection);
  if (currentSet.has(proteinId)) {
    currentSet.delete(proteinId);
  } else {
    currentSet.add(proteinId);
  }
  return Array.from(currentSet);
}

/**
 * Merges a brush or lasso into the selection. With `newAreDistinct` (no id repeats in
 * `newSelections`) the new ids skip the set: ~0.3 s for the 782K ids of a lasso at 5M points.
 */
export function mergeProteinSelections(
  currentSelection: readonly string[],
  newSelections: readonly string[],
  newAreDistinct = false,
): string[] {
  if (!newAreDistinct) {
    const merged = new Set(currentSelection);
    newSelections.forEach((id) => merged.add(id));
    return Array.from(merged);
  }
  if (currentSelection.length === 0) return newSelections.slice();
  const current = new Set(currentSelection);
  const merged = Array.from(current);
  for (const id of newSelections) if (!current.has(id)) merged.push(id);
  return merged;
}

interface SelectionControllerOptions {
  plotElement: ProtspaceScatterplot;
  plotTools: ProtspacePlotTools;
  /** The bar at the bottom of the plot: the count, Show only these, Zoom to them, Copy IDs, Clear. */
  selectionBar: ProtspaceSelectionBar;
  /** The interaction controller's undo history: selection and show-only steps are recorded here. */
  history: UndoHistory<UndoEntry>;
  proteinSearch: ProtspaceProteinSearch;
  interactionController: Pick<InteractionController, 'handleSelectionChange'>;
  /**
   * Registers an Escape fallback (`onEscapeFallback` from `@protspace/core` in the app): run with
   * no layer open, after the plot's EAT connectors; returns its release.
   */
  registerEscape(order: number, handle: (event: KeyboardEvent) => boolean): () => void;
  /** The app's toasts (`notify`): Copy IDs confirms, selection mode turning itself off warns. */
  notify: Pick<typeof Notify, 'success' | 'warning' | 'error'>;
}

interface SelectionController {
  /** A new dataset: drop a search pick still waiting and return the tool strip to Move. */
  resetForNewDataset(): void;
  /** Leaves isolation: the status corner's ✕ on the isolation chip. */
  resetIsolation(): void;
  /** Undoes or redoes a selection or isolation step this controller recorded. */
  applyHistory(entry: Exclude<UndoEntry, { kind: 'filter' }>, direction: 'undo' | 'redo'): void;
  dispose(): void;
}

/**
 * The selection (design decision 9, moved from the control bar): plot clicks and brushes, the
 * search box's picks, the selection bar, the plot tools, isolation and its two Escape steps (the
 * selection, then the tool). Every change lands through one commit, which writes the plot, the
 * search box and the tools, then tells the app.
 */
export function createSelectionController({
  plotElement,
  plotTools,
  selectionBar,
  history,
  proteinSearch,
  interactionController,
  registerEscape,
  notify,
}: SelectionControllerOptions): SelectionController {
  /** The selection the search box and the tools show, a search pick still waiting included. */
  let selected: string[] = [];
  let tool: PlotTool = 'pan';
  // A search pick or Clear re-stages every point: the box and the tools show it in the frame of
  // the input, and the plot takes it after that frame is painted. A newer pick replaces one
  // still waiting, and a selection committed at once drops it.
  const commit = new AfterPaintCommit();
  /** The waiting or landing commit's `afterLand`; a newer commit replaces it. */
  let pendingAfterLand: (() => void) | undefined;

  const show = (ids: string[]) => {
    selected = ids;
    proteinSearch.selectedProteinIds = ids;
    selectionBar.selectedCount = ids.length;
  };

  const commitSelection = (
    ids: string[],
    {
      afterPaint = false,
      record = true,
      afterLand,
    }: {
      afterPaint?: boolean;
      record?: boolean;
      /**
       * Runs once the selection has landed on the plot, after the paint for an afterPaint
       * commit; a newer commit that replaces a waiting one drops it.
       */
      afterLand?: () => void;
    } = {},
  ) => {
    // One undo step per change, recorded at commit time with the arrays as they are: every
    // caller hands over a fresh array, and nothing mutates one afterwards.
    if (record && ids !== selected && (ids.length > 0 || selected.length > 0)) {
      history.record({ kind: 'selection', before: selected, after: ids });
    }
    pendingAfterLand = afterLand;
    const land = () => {
      show(ids);
      plotElement.selectedProteinIds = [...ids];
      interactionController.handleSelectionChange(ids);
      const then = pendingAfterLand;
      pendingAfterLand = undefined;
      then?.();
    };
    if (afterPaint) {
      show(ids);
      commit.schedule(land);
    } else {
      commit.cancel();
      land();
    }
  };

  const setTool = (next: PlotTool) => {
    tool = next;
    plotTools.tool = next;
    plotElement.selectionMode = next !== 'pan';
    if (next !== 'pan') plotElement.selectionTool = next;
  };

  const onProteinClick = (event: Event) => {
    const { proteinId, modifierKeys } = (event as CustomEvent<ProteinClickDetail>).detail;
    if (!proteinId) return;
    // A selection tool or ⌘/Ctrl toggles; a plain click selects just this protein, or nothing
    // when it already is the only one.
    if (tool !== 'pan' || modifierKeys?.ctrl || modifierKeys?.meta) {
      commitSelection(toggleProteinSelection(proteinId, selected));
    } else {
      const isOnlySelected = selected.length === 1 && selected[0] === proteinId;
      commitSelection(isOnlySelected ? [] : [proteinId]);
    }
  };

  const onBrushSelection = (event: Event) => {
    const detail = (event as CustomEvent<BrushSelectionDetail>).detail;
    const ids = Array.isArray(detail?.proteinIds) ? detail.proteinIds : [];
    commitSelection(
      tool !== 'pan'
        ? mergeProteinSelections(selected, ids, detail?.idsUnique === true)
        : ids.slice(),
    );
  };

  const onSearchSelectionChange = (event: Event) => {
    commitSelection([...(event as CustomEvent<{ proteinIds: string[] }>).detail.proteinIds]);
  };

  const onSearchAdd = (event: Event) => {
    const { proteinId } = (event as CustomEvent<{ proteinId: string }>).detail;
    if (!proteinId || selected.includes(proteinId)) return;
    commitSelection([...selected, proteinId], {
      afterPaint: true,
      // One protein asked for by name: bring it into view (decision 15). A protein the filter,
      // an isolation or a hidden category keeps out of view stays selected, and the search says
      // why nothing moved.
      afterLand: () => {
        if (!plotElement.zoomToProteins([proteinId])) proteinSearch.reportNotInView(proteinId);
      },
    });
  };

  const onSearchRemove = (event: Event) => {
    const { proteinId } = (event as CustomEvent<{ proteinId: string }>).detail;
    if (!proteinId || !selected.includes(proteinId)) return;
    commitSelection(
      selected.filter((id) => id !== proteinId),
      { afterPaint: true },
    );
  };

  const onSearchAddMultiple = (event: Event) => {
    const { proteinIds } = (event as CustomEvent<{ proteinIds: string[] }>).detail;
    if (!proteinIds || proteinIds.length === 0) return;
    const current = new Set(selected);
    const added = proteinIds.filter((id) => !current.has(id));
    if (added.length === 0) return;
    // A pasted list never zooms: the selection bar's "Zoom to them" does that on request.
    commitSelection([...selected, ...added], { afterPaint: true });
  };

  const onToolChange = (event: Event) => {
    setTool((event as CustomEvent<{ tool: PlotTool }>).detail.tool);
  };

  const onFitView = () => plotElement.resetZoom();

  const onClear = () => commitSelection([], { afterPaint: true });

  const onIsolate = () => {
    // Isolation reads the plot's selection: land a search pick still waiting first.
    commit.flush();
    const selectionBefore = selected;
    const steps = plotElement.getIsolationHistory().length;
    plotElement.isolateSelection();
    const layers = plotElement.getIsolationHistory();
    if (layers.length > steps) {
      history.record({ kind: 'isolate', layer: layers[layers.length - 1], selectionBefore });
    }
  };

  /** Isolates one recorded layer again, as Show only these did. */
  const isolateLayer = (layer: readonly string[]) => {
    plotElement.selectedProteinIds = [...layer];
    plotElement.isolateSelection();
  };

  const resetIsolation = ({ record = true } = {}) => {
    const layers = plotElement.getIsolationHistory();
    const selectionBefore = selected;
    plotElement.resetIsolation();
    if (record && layers.length > 0) {
      history.record({ kind: 'reset-isolation', layers, selectionBefore });
    }
  };

  const applyHistory = (
    entry: Exclude<UndoEntry, { kind: 'filter' }>,
    direction: 'undo' | 'redo',
  ) => {
    // A search pick still waiting lands first, so the step applies to what the user sees.
    commit.flush();
    // History entries hold arrays nothing mutates; the commit only reads them.
    const restore = (ids: readonly string[]) => commitSelection(ids as string[], { record: false });
    if (entry.kind === 'selection') {
      restore(direction === 'undo' ? entry.before : entry.after);
    } else if (entry.kind === 'isolate') {
      if (direction === 'undo') {
        plotElement.popIsolation();
        restore(entry.selectionBefore);
      } else {
        isolateLayer(entry.layer);
      }
    } else if (direction === 'undo') {
      for (const layer of entry.layers) isolateLayer(layer);
      restore(entry.selectionBefore);
    } else {
      resetIsolation({ record: false });
    }
  };

  const onZoomToSelection = () => {
    // Zoom to what the bar counts: land a search pick still waiting first, without its own
    // single-protein zoom, which this one replaces.
    pendingAfterLand = undefined;
    commit.flush();
    plotElement.zoomToProteins(selected);
  };

  const onCopySelection = () => {
    const ids = selected;
    if (ids.length === 0) return;
    // Through a promise: in a page that is not a secure context `navigator.clipboard` is missing.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(ids.join('\n')))
      .then(
        () => notify.success(getSelectionCopiedNotification(ids.length)),
        () => notify.error(getSelectionCopyFailedNotification()),
      );
  };

  /** The plot isolated or reset: it emptied its own selection, so only the display follows. */
  const onIsolation = (event: Event) => {
    show([]);
    // An undo can widen the subset again: with two proteins or more, selection works.
    if (((event as CustomEvent<{ dataSize?: number }>).detail?.dataSize ?? 0) > 1) {
      plotTools.selectionDisabled = false;
      selectionBar.canIsolate = true;
    }
  };

  const onIsolationReset = () => {
    show([]);
    // Back to the full data: selection works again.
    plotTools.selectionDisabled = false;
    selectionBar.canIsolate = true;
  };

  const onAutoDisableSelection = (event: Event) => {
    const { reason, dataSize } = (event as CustomEvent<{ reason: string; dataSize: number }>)
      .detail;
    setTool('pan');
    if (reason === 'insufficient-data' && dataSize <= 1) {
      plotTools.selectionDisabled = true;
      selectionBar.canIsolate = false;
    }
    notify.warning(getSelectionDisabledNotification({ reason, dataSize }));
  };

  /** The search box offers the proteins in view; the tools show the plot's selection. */
  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: { protein_ids?: string[] } | null }>).detail?.data;
    if (!data) return;
    proteinSearch.availableProteinIds = Array.isArray(data.protein_ids) ? data.protein_ids : [];
    show(Array.isArray(plotElement.selectedProteinIds) ? plotElement.selectedProteinIds : []);
  };

  // Escape (decision 11), after the top layer and the plot's EAT connectors: one step per press.
  const releaseSelectionEscape = registerEscape(ESCAPE_ORDER.selection, () => {
    if (selected.length === 0) return false;
    commitSelection([], { afterPaint: true });
    return true;
  });
  const releaseToolEscape = registerEscape(ESCAPE_ORDER.tool, () => {
    if (tool === 'pan') return false;
    setTool('pan');
    return true;
  });

  plotElement.addEventListener('protein-click', onProteinClick);
  plotElement.addEventListener('brush-selection', onBrushSelection);
  plotElement.addEventListener('data-change', onDataChange);
  plotElement.addEventListener('data-isolation', onIsolation);
  plotElement.addEventListener('data-isolation-reset', onIsolationReset);
  plotElement.addEventListener('auto-disable-selection', onAutoDisableSelection);
  proteinSearch.addEventListener('selection-change', onSearchSelectionChange);
  proteinSearch.addEventListener('add-selection', onSearchAdd);
  proteinSearch.addEventListener('add-selection-multiple', onSearchAddMultiple);
  proteinSearch.addEventListener('remove-selection', onSearchRemove);
  plotTools.addEventListener('plot-tool-change', onToolChange);
  plotTools.addEventListener('fit-view', onFitView);
  selectionBar.addEventListener('clear-selections', onClear);
  selectionBar.addEventListener('isolate-data', onIsolate);
  selectionBar.addEventListener('zoom-to-selection', onZoomToSelection);
  selectionBar.addEventListener('copy-selection', onCopySelection);

  return {
    resetForNewDataset() {
      commit.cancel();
      show([]);
      // The tool strip only: the data renderer resets the plot's own selection mode with its data.
      tool = 'pan';
      plotTools.tool = 'pan';
    },
    resetIsolation() {
      resetIsolation();
    },
    applyHistory,
    dispose() {
      commit.cancel();
      plotElement.removeEventListener('protein-click', onProteinClick);
      plotElement.removeEventListener('brush-selection', onBrushSelection);
      plotElement.removeEventListener('data-change', onDataChange);
      plotElement.removeEventListener('data-isolation', onIsolation);
      plotElement.removeEventListener('data-isolation-reset', onIsolationReset);
      plotElement.removeEventListener('auto-disable-selection', onAutoDisableSelection);
      proteinSearch.removeEventListener('selection-change', onSearchSelectionChange);
      proteinSearch.removeEventListener('add-selection', onSearchAdd);
      proteinSearch.removeEventListener('add-selection-multiple', onSearchAddMultiple);
      proteinSearch.removeEventListener('remove-selection', onSearchRemove);
      plotTools.removeEventListener('plot-tool-change', onToolChange);
      plotTools.removeEventListener('fit-view', onFitView);
      selectionBar.removeEventListener('clear-selections', onClear);
      selectionBar.removeEventListener('isolate-data', onIsolate);
      selectionBar.removeEventListener('zoom-to-selection', onZoomToSelection);
      selectionBar.removeEventListener('copy-selection', onCopySelection);
      releaseSelectionEscape();
      releaseToolEscape();
    },
  };
}
