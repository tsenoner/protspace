import type {
  DensityLayerChangeDetail,
  ProtspaceAnnotationSelect,
  ProtspaceContoursMenu,
  ProtspaceProjectionMetadata,
  ProtspaceProjectionSelect,
  ProtspaceScatterplot,
} from '@protspace/core';
import {
  DENSITY_DEFAULT,
  isEatConfidenceAnnotation,
  type ProjectionStatisticRow,
  type VisualizationData,
} from '@protspace/utils';
import type { InitialView } from './explore-controls';
import type { InteractionController } from './interaction-controller';
import type { ViewPickers } from './view-controller';
import { setWorkbenchStatus } from './workbench-status';

/** Annotations shown only in the hover tooltip; Color by and the filter do not offer them. */
export const TOOLTIP_ONLY_ANNOTATIONS: ReadonlySet<string> = new Set([
  'gene_name',
  'protein_name',
  'uniprot_kb_id',
]);

/** Stable empty statistics: a fresh [] per data-change would re-render the annotation picker. */
const NO_STATISTICS: readonly ProjectionStatisticRow[] = [];

interface ViewBarControllerOptions {
  plotElement: ProtspaceScatterplot;
  projectionSelect: ProtspaceProjectionSelect;
  annotationSelect: ProtspaceAnnotationSelect;
  contoursMenu: ProtspaceContoursMenu;
  projectionMetadata: ProtspaceProjectionMetadata;
  interactionController: Pick<InteractionController, 'handleAnnotationChange'>;
  /**
   * Where the bubbling `annotation-change` is heard after the legend's own listener: the
   * document in the app. The legend registers there when it connects, before the runtime starts.
   */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** A pick changed the view (or an apply did; the view controller tells the two apart). */
  onUserChange(kind: 'projection' | 'annotation' | 'tooltip' | 'density'): void;
}

interface ViewBarController extends ViewPickers {
  /** A new dataset's first view: sets the pickers without dispatching anything. */
  showInitialView(view: InitialView): void;
  /** Drops picks still waiting for their commit. */
  resetForNewDataset(): void;
  dispose(): void;
}

/**
 * What the view bar offers for `data`: every projection, and Color by's annotations without the
 * tooltip-only and EAT-confidence columns. `capabilityData` (the plot's full data) says which
 * annotations carry EAT predictions; the shown data can be a subset without them.
 */
export function deriveViewOptions(
  data: VisualizationData,
  capabilityData: VisualizationData = data,
): { projections: string[]; annotations: string[]; eatAnnotations: string[] } {
  const projections = (data.projections ?? []).map((projection) => projection.name);
  const annotations = Object.keys(data.annotations ?? {}).filter(
    (key) =>
      !TOOLTIP_ONLY_ANNOTATIONS.has(key) && !isEatConfidenceAnnotation(data.annotations[key]),
  );
  const eatAnnotations = Object.entries(capabilityData.annotation_predicted ?? {})
    .filter(([, cells]) => cells.some(Boolean))
    .map(([annotation]) => annotation);
  return { projections, annotations, eatAnnotations };
}

/**
 * The view bar (design decision 9): keeps the pickers' options and the projection details in
 * step with the plot, and writes each pick to the plot. Every picker is heard on the element
 * itself, so the plot changes before the legend's document listener re-syncs from it.
 *
 * The pickers dispatch nothing when the user re-picks the value already checked. A host can still
 * apply the value the plot shows; the guards below then leave the plot alone.
 */
export function createViewBarController({
  plotElement,
  projectionSelect,
  annotationSelect,
  contoursMenu,
  projectionMetadata,
  interactionController,
  root,
  onUserChange,
}: ViewBarControllerOptions): ViewBarController {
  /** The projection details show what the plot shows; the plot no longer renders them. */
  const syncProjectionDetails = () => {
    const data = plotElement.data;
    projectionMetadata.projection = data?.projections[plotElement.selectedProjectionIndex] ?? null;
    projectionMetadata.statisticsRows = data?.statisticsRows;
    projectionMetadata.selectedAnnotation = plotElement.selectedAnnotation;
    projectionMetadata.annotationDefinitions = data?.annotations ?? {};
    projectionMetadata.viewIsSubset = plotElement.filtersActive || plotElement.isIsolationMode();
  };

  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: VisualizationData | null }>).detail?.data;
    if (!data) return;
    const options = deriveViewOptions(data, plotElement.data ?? data);
    projectionSelect.projections = options.projections;
    annotationSelect.annotations = options.annotations;
    annotationSelect.eatAnnotations = options.eatAnnotations;
    // The materialized (full) data, so the badges describe the dataset, not an isolated subset.
    const materialized = plotElement.getMaterializedData() ?? plotElement.getCurrentData();
    annotationSelect.annotationDefinitions = materialized?.annotations ?? {};
    annotationSelect.statisticsRows = materialized?.statisticsRows ?? NO_STATISTICS;
    // A dataset without the current choice falls back to its first projection and annotation.
    if (!options.projections.includes(projectionSelect.selectedProjection)) {
      projectionSelect.selectedProjection = options.projections[0] ?? '';
    }
    if (!options.annotations.includes(annotationSelect.selectedAnnotation)) {
      annotationSelect.selectedAnnotation = options.annotations[0] ?? '';
    }
    annotationSelect.selectedProjection = projectionSelect.selectedProjection;
    syncProjectionDetails();
  };

  const onProjectionChange = (event: Event) => {
    const { projection } = (event as CustomEvent<{ projection: string }>).detail;
    const projections = plotElement.data?.projections ?? [];
    const current = projections[plotElement.selectedProjectionIndex]?.name;
    if (projection === current) return;
    const index = projections.findIndex((p) => p.name === projection);
    if (index !== -1) plotElement.selectedProjectionIndex = index;
    // Statistics are scored per projection.
    annotationSelect.selectedProjection = projection;
    syncProjectionDetails();
    onUserChange('projection');
  };

  /** On the picker: the plot changes before the legend's document listener re-syncs from it. */
  const onAnnotationPicked = (event: Event) => {
    const { annotation } = (event as CustomEvent<{ annotation: string }>).detail;
    if (annotation === plotElement.selectedAnnotation) return;
    plotElement.selectedAnnotation = annotation;
    syncProjectionDetails();
  };

  /**
   * On the document, after the legend's listener, as the control bar's app listener ran: clear
   * the provenance connectors and the plot's hidden values, re-sync the legend, then report.
   */
  const onAnnotationChanged = () => {
    interactionController.handleAnnotationChange();
    onUserChange('annotation');
  };

  const onTooltipChange = (event: Event) => {
    const { tooltipAnnotations } = (event as CustomEvent<{ tooltipAnnotations: string[] }>).detail;
    plotElement.tooltipAnnotations = [...tooltipAnnotations];
    onUserChange('tooltip');
  };

  const onDensityChange = (event: Event) => {
    const { densityLayer } = (event as CustomEvent<DensityLayerChangeDetail>).detail;
    setWorkbenchStatus({ densityLayer });
    const current = plotElement.config?.densityLayer ?? DENSITY_DEFAULT;
    if (densityLayer === current) return;
    plotElement.config = { ...(plotElement.config ?? {}), densityLayer };
    onUserChange('density');
  };

  plotElement.addEventListener('data-change', onDataChange);
  projectionSelect.addEventListener('projection-change', onProjectionChange);
  annotationSelect.addEventListener('annotation-change', onAnnotationPicked);
  annotationSelect.addEventListener('tooltip-annotations-change', onTooltipChange);
  contoursMenu.addEventListener('density-layer-change', onDensityChange);
  root.addEventListener('annotation-change', onAnnotationChanged);

  return {
    get selectedProjection() {
      return projectionSelect.selectedProjection;
    },
    get selectedAnnotation() {
      return annotationSelect.selectedAnnotation;
    },
    get tooltipAnnotations() {
      return annotationSelect.tooltipAnnotations;
    },
    applyProjectionSelection(projection) {
      projectionSelect.applySelection(projection);
    },
    applyAnnotationSelection(annotation) {
      annotationSelect.applySelection(annotation);
    },
    applyTooltipAnnotationsSelection(names) {
      annotationSelect.applyTooltipSelection(names);
    },
    applyDensityLayerSelection(mode) {
      contoursMenu.applySelection(mode);
      setWorkbenchStatus({ densityLayer: mode });
    },
    showInitialView(view) {
      projectionSelect.selectedProjection = view.projection;
      annotationSelect.selectedProjection = view.projection;
      annotationSelect.selectedAnnotation = view.annotation;
      annotationSelect.tooltipAnnotations = [...view.tooltip];
      syncProjectionDetails();
      // A dataset keeps the contour mode; the More menu reads it from the status.
      setWorkbenchStatus({ densityLayer: contoursMenu.densityLayer });
    },
    resetForNewDataset() {
      projectionSelect.cancelPending();
      annotationSelect.cancelPending();
      contoursMenu.cancelPending();
    },
    dispose() {
      plotElement.removeEventListener('data-change', onDataChange);
      projectionSelect.removeEventListener('projection-change', onProjectionChange);
      annotationSelect.removeEventListener('annotation-change', onAnnotationPicked);
      annotationSelect.removeEventListener('tooltip-annotations-change', onTooltipChange);
      contoursMenu.removeEventListener('density-layer-change', onDensityChange);
      root.removeEventListener('annotation-change', onAnnotationChanged);
    },
  };
}
