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

function sameColors(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [label, color] of a) if (b.get(label) !== color) return false;
  return true;
}

/** Protein id → index, per dataset, built on the first single selection. */
const proteinIndexes = new WeakMap<VisualizationData, ReadonlyMap<string, number>>();

function proteinIndexOf(data: VisualizationData, proteinId: string): number | null {
  let byId = proteinIndexes.get(data);
  if (!byId) {
    byId = new Map(data.protein_ids.map((id, index) => [id, index]));
    proteinIndexes.set(data, byId);
  }
  return byId.get(proteinId) ?? null;
}

interface EatPanelController {
  /** The selection changed: the card follows a single selected protein. */
  setSelection(proteinIds: readonly string[]): void;
  /** "Edit in EAT" on a locked row of `annotation`: Color by it unless it already is. */
  colorByBase(annotation: string | undefined): void;
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
 * condition alone. The breakdown's swatches follow the legend's colours, and the panel's
 * `eat-color-by` switches Color by through `pickAnnotation`. A drill-down list's
 * `eat-select-proteins` selects through `selectProteins`.
 *
 * The card follows a single selected protein (`setSelection`). Its Go to source selects the
 * source, draws the pair and fits both; its `lent its label` link draws a source's lines through
 * `traceProtein` without touching the selection.
 *
 * The Drawing switches (`eat-drawing-change`) reach the plot click's tracing through `setTracing`
 * and count toward the rail dot.
 */
export function createEatPanelController({
  eatPanel,
  plotElement,
  legendElement,
  filterController,
  root,
  isPanelShown,
  subscribePanel,
  pickAnnotation,
  selectProteins,
  requestStructure,
  traceProtein,
  setTracing,
}: {
  eatPanel: Pick<
    ProtspaceEatPanel,
    | 'data'
    | 'annotation'
    | 'context'
    | 'labelColors'
    | 'focusProtein'
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
    | 'data'
    | 'selectedAnnotation'
    | 'eatOverlayEnabled'
    | 'zoomToProteins'
    | 'addEventListener'
    | 'removeEventListener'
  >;
  legendElement: Pick<ProtspaceLegend, 'eatReliability'>;
  filterController: Pick<FilterController, 'setEatReliability' | 'getContextMask'>;
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  isPanelShown(): boolean;
  subscribePanel(listener: () => void): () => void;
  /** Make `annotation` the Color by annotation, as a pick in the view bar does. */
  pickAnnotation(annotation: string): void;
  /** Select exactly `ids`, one undo step; `zoom` fits them once they land. */
  selectProteins(ids: readonly string[], options: { zoom: boolean }): void;
  /** Show `proteinId` in the structure viewer. */
  requestStructure(proteinId: string): void;
  /** Draw `proteinId`'s provenance lines as a click does, without selecting it. */
  traceProtein(proteinId: string, originalIndex: number, mode?: 'auto' | 'source'): boolean;
  /** Trace source on click and Lines per source, for plot clicks. */
  setTracing(options: { trace: boolean; linesPerSource: number }): void;
}): EatPanelController {
  let selection: readonly string[] = [];

  /** The card's protein: the single selected one, by index in the current data. */
  const syncFocus = () => {
    const data = plotElement.data;
    const focus = data && selection.length === 1 ? proteinIndexOf(data, selection[0]) : null;
    if (eatPanel.focusProtein !== focus) eatPanel.focusProtein = focus;
  };

  /**
   * The context follows the applied filter while the panel is on screen; a hidden panel asks for
   * none, and gets the current one when it turns active.
   */
  const syncContext = () => {
    if (!eatPanel.active) return;
    const context = filterController.getContextMask();
    if (eatPanel.context !== context) eatPanel.context = context;
  };

  const syncActive = () => {
    const shown = isPanelShown();
    if (eatPanel.active !== shown) eatPanel.active = shown;
    syncContext();
  };

  /**
   * The panel's reliability, wherever it came from (its own controls, the Filter panel's Apply,
   * a reset), reaches the legend's note and the rail dot.
   */
  const syncReliability = () => {
    const { reliability } = eatPanel;
    const shown = legendElement.eatReliability;
    if (!shown || !isSameReliability(shown, reliability))
      legendElement.eatReliability = reliability;
    syncContext();
    setWorkbenchStatus({ eatAdjusted: !eatPanel.isAtDefaults });
  };

  const syncData = () => {
    const data = plotElement.data ?? null;
    const annotation = plotElement.selectedAnnotation;
    if (eatPanel.data !== data) eatPanel.data = data;
    if (eatPanel.annotation !== annotation) eatPanel.annotation = annotation;
    syncFocus();
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

  /**
   * The legend hands the plot its colour per label with every recolour. The event carries the
   * new mapping; the legend's own item list may not have caught up when it fires.
   */
  const syncColors = (event: Event) => {
    const { colorMapping } = (event as CustomEvent<{ colorMapping: Record<string, string> }>)
      .detail;
    const colors = new Map(Object.entries(colorMapping));
    if (!sameColors(eatPanel.labelColors, colors)) eatPanel.labelColors = colors;
  };

  const onColorBy = (event: Event) => {
    pickAnnotation((event as CustomEvent<{ annotation: string }>).detail.annotation);
  };

  /** A drill-down row selects its protein and shows its structure; Select all selects only. */
  const onSelectProteins = (event: Event) => {
    const { proteinIds, zoom } = (event as CustomEvent<{ proteinIds: string[]; zoom: boolean }>)
      .detail;
    selectProteins(proteinIds, { zoom });
    if (proteinIds.length === 1) requestStructure(proteinIds[0]);
  };

  /** Go to source: select the source (one undo step), keep the pair drawn, fit both. */
  const onGoToSource = (event: Event) => {
    const { targetId, targetIndex, sourceId } = (
      event as CustomEvent<{ targetId: string; targetIndex: number; sourceId: string }>
    ).detail;
    selectProteins([sourceId], { zoom: false });
    traceProtein(targetId, targetIndex);
    plotElement.zoomToProteins([targetId, sourceId]);
  };

  /** `lent its label to N`: the source's fan-out, as a click on it draws. */
  const onTraceSource = (event: Event) => {
    const { sourceId, sourceIndex } = (
      event as CustomEvent<{ sourceId: string; sourceIndex: number }>
    ).detail;
    traceProtein(sourceId, sourceIndex, 'source');
  };

  const onDrawingChange = (event: Event) => {
    const { trace, linesPerSource } = (
      event as CustomEvent<{ trace: boolean; linesPerSource: number }>
    ).detail;
    setTracing({ trace, linesPerSource });
    setWorkbenchStatus({ eatAdjusted: !eatPanel.isAtDefaults });
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
  plotElement.addEventListener('legend-colormapping-change', syncColors);
  root.addEventListener('annotation-change', syncData);
  root.addEventListener('eat-reliability-reset', onReliabilityReset);
  eatPanel.addEventListener('eat-overlay-change', onOverlayChange);
  eatPanel.addEventListener('eat-color-by', onColorBy);
  eatPanel.addEventListener('eat-select-proteins', onSelectProteins);
  eatPanel.addEventListener('eat-go-to-source', onGoToSource);
  eatPanel.addEventListener('eat-trace-source', onTraceSource);
  eatPanel.addEventListener('eat-drawing-change', onDrawingChange);
  const unsubscribePanel = subscribePanel(syncActive);
  syncData();

  return {
    setSelection(proteinIds) {
      selection = [...proteinIds];
      syncFocus();
    },
    colorByBase(annotation) {
      if (annotation && annotation !== plotElement.selectedAnnotation) pickAnnotation(annotation);
    },
    resetForNewDataset() {
      eatPanel.resetForNewDataset();
      syncReliability();
    },
    dispose() {
      plotElement.removeEventListener('data-change', syncData);
      plotElement.removeEventListener('legend-colormapping-change', syncColors);
      root.removeEventListener('annotation-change', syncData);
      root.removeEventListener('eat-reliability-reset', onReliabilityReset);
      eatPanel.removeEventListener('eat-overlay-change', onOverlayChange);
      eatPanel.removeEventListener('eat-color-by', onColorBy);
      eatPanel.removeEventListener('eat-select-proteins', onSelectProteins);
      eatPanel.removeEventListener('eat-go-to-source', onGoToSource);
      eatPanel.removeEventListener('eat-trace-source', onTraceSource);
      eatPanel.removeEventListener('eat-drawing-change', onDrawingChange);
      unsubscribePanel();
    },
  };
}
