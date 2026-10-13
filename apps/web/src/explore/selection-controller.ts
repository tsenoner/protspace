import {
  AfterPaintCommit,
  ESCAPE_ORDER,
  type BrushSelectionDetail,
  type PlotTool,
  type ProteinClickDetail,
  type ProtspacePlotTools,
  type ProtspaceProteinSearch,
  type ProtspaceScatterplot,
} from '@protspace/core';
import type { NotifyOptions } from '../lib/notify';
import type { InteractionController } from './interaction-controller';
import { getSelectionDisabledNotification } from './notifications';

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
  proteinSearch: ProtspaceProteinSearch;
  interactionController: Pick<InteractionController, 'handleSelectionChange'>;
  /**
   * Registers an Escape fallback (`onEscapeFallback` from `@protspace/core` in the app): run with
   * no layer open, after the plot's EAT connectors; returns its release.
   */
  registerEscape(order: number, handle: (event: KeyboardEvent) => boolean): () => void;
  /** Shows a warning toast: `notify.warning` in the app. */
  warn(options: NotifyOptions): void;
}

interface SelectionController {
  /** A new dataset: drop a search pick still waiting and return the tool strip to Move. */
  resetForNewDataset(): void;
  dispose(): void;
}

/**
 * The selection (design decision 9, moved from the control bar): plot clicks and brushes, the
 * search box's picks, the plot tools, isolation and its two Escape steps (the selection, then the tool). Every change lands through
 * one commit, which writes the plot, the search box and the tools, then tells the app.
 */
export function createSelectionController({
  plotElement,
  plotTools,
  proteinSearch,
  interactionController,
  registerEscape,
  warn,
}: SelectionControllerOptions): SelectionController {
  /** The selection the search box and the tools show, a search pick still waiting included. */
  let selected: string[] = [];
  let tool: PlotTool = 'pan';
  // A search pick or Clear re-stages every point: the box and the tools show it in the frame of
  // the input, and the plot takes it after that frame is painted. A newer pick replaces one
  // still waiting, and a selection committed at once drops it.
  const commit = new AfterPaintCommit();

  const show = (ids: string[]) => {
    selected = ids;
    proteinSearch.selectedProteinIds = ids;
    plotTools.selectedCount = ids.length;
  };

  const commitSelection = (ids: string[], { afterPaint = false } = {}) => {
    const land = () => {
      show(ids);
      plotElement.selectedProteinIds = [...ids];
      interactionController.handleSelectionChange(ids);
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
    commitSelection([...selected, proteinId], { afterPaint: true });
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
    plotElement.isolateSelection();
  };

  const onResetIsolation = () => {
    plotElement.resetIsolation();
    plotTools.isolated = false;
  };

  /** The plot isolated or reset: it emptied its own selection, so only the display follows. */
  const onIsolation = (event: Event) => {
    plotTools.isolated = (event as CustomEvent<{ isolationMode: boolean }>).detail.isolationMode;
    show([]);
  };

  const onIsolationReset = (event: Event) => {
    plotTools.isolated = (event as CustomEvent<{ isolationMode: boolean }>).detail.isolationMode;
    show([]);
    // Back to the full data: selection works again.
    plotTools.selectionDisabled = false;
  };

  const onAutoDisableSelection = (event: Event) => {
    const { reason, dataSize } = (event as CustomEvent<{ reason: string; dataSize: number }>)
      .detail;
    setTool('pan');
    if (reason === 'insufficient-data' && dataSize <= 1) plotTools.selectionDisabled = true;
    warn(getSelectionDisabledNotification({ reason, dataSize }));
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
  plotTools.addEventListener('clear-selections', onClear);
  plotTools.addEventListener('isolate-data', onIsolate);
  plotTools.addEventListener('reset-isolation', onResetIsolation);

  return {
    resetForNewDataset() {
      commit.cancel();
      show([]);
      // The tool strip only: the data renderer resets the plot's own selection mode with its data.
      tool = 'pan';
      plotTools.tool = 'pan';
    },
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
      plotTools.removeEventListener('clear-selections', onClear);
      plotTools.removeEventListener('isolate-data', onIsolate);
      plotTools.removeEventListener('reset-isolation', onResetIsolation);
      releaseSelectionEscape();
      releaseToolEscape();
    },
  };
}
