import type {
  EatOverlayChangeDetail,
  ProtspaceEatPanel,
  ProtspaceLegend,
  ProtspaceScatterplot,
} from '@protspace/core';
import {
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  hasEatPredictions,
  hasEatPredictionsForAnnotation,
  isSameReliability,
  type VisualizationData,
} from '@protspace/utils';
import type { FilterController } from './filter-controller';
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
 * `data-change` and `annotation-change`, the context of the other filter conditions, and `active`
 * while the panel is on screen, so it computes only then. Publishes whether the panel can open for
 * the rail, the phone tab and the restore, and whether it is off its defaults (the rail dot).
 *
 * The panel's `eat-overlay-change` reaches the plot (Show) and the filter (the one reliability
 * condition); the legend's EAT note follows the panel's reliability filter. A locked Filter row's ✕
 * (`eat-reliability-reset`) resets the panel, or, for a base the panel does not show, that base's
 * condition alone.
 */
export function createEatPanelController({
  eatPanel,
  plotElement,
  legendElement,
  filterController,
  root,
  isPanelShown,
  subscribePanel,
}: {
  eatPanel: Pick<
    ProtspaceEatPanel,
    | 'data'
    | 'annotation'
    | 'context'
    | 'active'
    | 'reliability'
    | 'isAtDefaults'
    | 'resetForNewDataset'
    | 'reset'
    | 'addEventListener'
    | 'removeEventListener'
  >;
  plotElement: Pick<
    ProtspaceScatterplot,
    'data' | 'selectedAnnotation' | 'eatOverlayEnabled' | 'addEventListener' | 'removeEventListener'
  >;
  legendElement: Pick<ProtspaceLegend, 'eatReliability'>;
  filterController: Pick<FilterController, 'setEatReliability' | 'getContextMask'>;
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  isPanelShown(): boolean;
  subscribePanel(listener: () => void): () => void;
}): EatPanelController {
  const syncActive = () => {
    const shown = isPanelShown();
    if (eatPanel.active !== shown) eatPanel.active = shown;
  };

  /**
   * The panel's reliability, wherever it came from (its own controls, the Filter panel's Apply,
   * a reset), reaches the legend's note and the rail dot; the context follows the applied filter,
   * cached by the filter controller, so an unchanged one costs nothing.
   */
  const syncReliability = () => {
    const { reliability } = eatPanel;
    const shown = legendElement.eatReliability;
    if (!shown || !isSameReliability(shown, reliability))
      legendElement.eatReliability = reliability;
    const context = filterController.getContextMask();
    if (eatPanel.context !== context) eatPanel.context = context;
    setWorkbenchStatus({ eatAdjusted: !eatPanel.isAtDefaults });
  };

  const syncData = () => {
    const data = plotElement.data ?? null;
    const annotation = plotElement.selectedAnnotation;
    if (eatPanel.data !== data) eatPanel.data = data;
    if (eatPanel.annotation !== annotation) eatPanel.annotation = annotation;
    setWorkbenchStatus({
      eatAvailability: eatAvailabilityFor(data, annotation),
      eatAnnotationLabel: annotation
        ? annotationLabel(annotation, data?.annotations[annotation])
        : '',
    });
    syncReliability();
    // Whether the panel shows can depend on the availability just published.
    syncActive();
  };

  const onOverlayChange = (event: Event) => {
    const { enabled, reliability } = (event as CustomEvent<EatOverlayChangeDetail>).detail;
    if (plotElement.eatOverlayEnabled !== enabled) plotElement.eatOverlayEnabled = enabled;
    // The full state (mode and both bounds) reaches the query, which a lower bound alone cannot.
    filterController.setEatReliability(plotElement.selectedAnnotation, reliability);
    syncReliability();
  };

  const onReliabilityReset = (event: Event) => {
    const base = (event as CustomEvent<{ annotation?: string }>).detail?.annotation;
    if (!base || base === plotElement.selectedAnnotation) eatPanel.reset();
    else filterController.setEatReliability(base, DEFAULT_EAT_RELIABILITY);
  };

  plotElement.addEventListener('data-change', syncData);
  root.addEventListener('annotation-change', syncData);
  root.addEventListener('eat-reliability-reset', onReliabilityReset);
  eatPanel.addEventListener('eat-overlay-change', onOverlayChange);
  const unsubscribePanel = subscribePanel(syncActive);
  syncData();

  return {
    resetForNewDataset() {
      eatPanel.resetForNewDataset();
      syncReliability();
    },
    dispose() {
      plotElement.removeEventListener('data-change', syncData);
      root.removeEventListener('annotation-change', syncData);
      root.removeEventListener('eat-reliability-reset', onReliabilityReset);
      eatPanel.removeEventListener('eat-overlay-change', onOverlayChange);
      unsubscribePanel();
    },
  };
}
