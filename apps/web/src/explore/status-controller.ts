import type { ProtspacePlotStatus, ProtspaceScatterplot, StatusChipKind } from '@protspace/core';
import type { WorkbenchStatus } from './workbench-status';

interface StatusControllerOptions {
  plotElement: ProtspaceScatterplot;
  plotStatus: ProtspacePlotStatus;
  getStatus(): WorkbenchStatus;
  subscribeStatus(listener: () => void): () => void;
  /** The filter chip's body: show the filter. */
  openFilter(): void;
  /** The filter chip's ✕. */
  clearFilter(): void;
  /** The hidden chip's body: show the legend. */
  openLegend(): void;
  /** The hidden chip's ✕. */
  showAllCategories(): void;
  /** The isolation chip's ✕. */
  resetIsolation(): void;
  /** The EAT dim chip's body: show the EAT panel. */
  openEat(): void;
  /** The EAT dim chip's ✕: the EAT panel back to its defaults. */
  resetEat(): void;
}

/**
 * The plot's status corner (design decision 13): feeds `protspace-plot-status` from the plot's
 * events and the status store, and runs its chip actions. The plot is never re-rendered for it,
 * and React never sees it.
 */
export function createStatusController({
  plotElement,
  plotStatus,
  getStatus,
  subscribeStatus,
  openFilter,
  clearFilter,
  openLegend,
  showAllCategories,
  resetIsolation,
  openEat,
  resetEat,
}: StatusControllerOptions): { dispose(): void } {
  const onViewStatus = (event: Event) => {
    const { count, zoomedIn } = (event as CustomEvent<{ count: number; zoomedIn: boolean }>).detail;
    plotStatus.count = count;
    plotStatus.zoomedIn = zoomedIn;
  };
  const onHiddenValues = (event: Event) => {
    plotStatus.hiddenCategories = (event as CustomEvent<{ count: number }>).detail.count;
  };
  const onIsolation = (event: Event) => {
    const { isolationHistory, dataSize } = (
      event as CustomEvent<{ isolationHistory: string[][]; dataSize: number }>
    ).detail;
    plotStatus.isolation = { steps: isolationHistory.length, size: dataSize };
  };
  const onIsolationReset = () => {
    plotStatus.isolation = null;
  };
  const syncFilter = () => {
    const status = getStatus();
    plotStatus.filterConditions = status.appliedFilterConditions;
    plotStatus.eatDim = status.eatDim;
  };
  const onOpen = (event: Event) => {
    const { kind } = (event as CustomEvent<{ kind: StatusChipKind }>).detail;
    if (kind === 'filter') openFilter();
    else if (kind === 'eat-dim') openEat();
    else if (kind === 'hidden') openLegend();
  };
  const onClear = (event: Event) => {
    const { kind } = (event as CustomEvent<{ kind: StatusChipKind }>).detail;
    if (kind === 'filter') clearFilter();
    else if (kind === 'eat-dim') resetEat();
    else if (kind === 'isolation') resetIsolation();
    else showAllCategories();
  };

  plotElement.addEventListener('view-status-change', onViewStatus);
  plotElement.addEventListener('hidden-values-change', onHiddenValues);
  plotElement.addEventListener('data-isolation', onIsolation);
  plotElement.addEventListener('data-isolation-reset', onIsolationReset);
  plotStatus.addEventListener('status-open', onOpen);
  plotStatus.addEventListener('status-clear', onClear);
  syncFilter();
  const unsubscribe = subscribeStatus(syncFilter);

  return {
    dispose() {
      plotElement.removeEventListener('view-status-change', onViewStatus);
      plotElement.removeEventListener('hidden-values-change', onHiddenValues);
      plotElement.removeEventListener('data-isolation', onIsolation);
      plotElement.removeEventListener('data-isolation-reset', onIsolationReset);
      plotStatus.removeEventListener('status-open', onOpen);
      plotStatus.removeEventListener('status-clear', onClear);
      unsubscribe();
    },
  };
}
