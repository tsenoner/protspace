import type { ProtspaceEatPanel, ProtspaceScatterplot } from '@protspace/core';
import {
  annotationLabel,
  hasEatPredictions,
  hasEatPredictionsForAnnotation,
  type VisualizationData,
} from '@protspace/utils';
import { setWorkbenchStatus, type EatAvailability } from './workbench-status';

/**
 * Whether the EAT panel can open for `annotation`: it has predictions, another annotation does
 * (the panel opens on its empty state, the rail item is disabled), or none does. Stops at the
 * first predicted cell, so it never builds the panel's index.
 */
export function eatAvailabilityFor(
  data: VisualizationData | null,
  annotation: string,
): EatAvailability {
  if (!hasEatPredictions(data)) return { kind: 'dataset' };
  if (hasEatPredictionsForAnnotation(data, annotation)) return { kind: 'available' };
  return {
    kind: 'annotation',
    annotationLabel: annotationLabel(annotation, data?.annotations[annotation]),
  };
}

interface EatPanelController {
  resetForNewDataset(): void;
  dispose(): void;
}

/**
 * Feeds the EAT panel (`#myEatPanel`) from the plot: its data and Color by annotation on every
 * `data-change` and `annotation-change`, and `active` while the panel is on screen, so it computes
 * only then. Publishes whether the panel can open for the rail, the phone tab and the restore.
 */
export function createEatPanelController({
  eatPanel,
  plotElement,
  root,
  isPanelShown,
  subscribePanel,
}: {
  eatPanel: Pick<ProtspaceEatPanel, 'data' | 'annotation' | 'active' | 'resetForNewDataset'>;
  plotElement: Pick<
    ProtspaceScatterplot,
    'data' | 'selectedAnnotation' | 'addEventListener' | 'removeEventListener'
  >;
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  isPanelShown(): boolean;
  subscribePanel(listener: () => void): () => void;
}): EatPanelController {
  const syncActive = () => {
    const shown = isPanelShown();
    if (eatPanel.active !== shown) eatPanel.active = shown;
  };

  const syncData = () => {
    const data = plotElement.data ?? null;
    const annotation = plotElement.selectedAnnotation;
    if (eatPanel.data !== data) eatPanel.data = data;
    if (eatPanel.annotation !== annotation) eatPanel.annotation = annotation;
    setWorkbenchStatus({ eatAvailability: eatAvailabilityFor(data, annotation) });
    // Whether the panel shows can depend on the availability just published.
    syncActive();
  };

  plotElement.addEventListener('data-change', syncData);
  root.addEventListener('annotation-change', syncData);
  const unsubscribePanel = subscribePanel(syncActive);
  syncData();

  return {
    resetForNewDataset() {
      eatPanel.resetForNewDataset();
    },
    dispose() {
      plotElement.removeEventListener('data-change', syncData);
      root.removeEventListener('annotation-change', syncData);
      unsubscribePanel();
    },
  };
}
