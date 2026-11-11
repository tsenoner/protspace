import type { ProtspaceScatterplot } from '@protspace/core';
import { DENSITY_DEFAULT, type DensityLayerMode, type VisualizationData } from '@protspace/utils';
import type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewDefaults,
  ExploreViewRequestState,
} from './view-state';
import {
  cloneExploreViewRequest,
  createEmptyExploreViewRequest,
  createExploreViewRequestFromView,
  getResolvedExploreViewNormalization,
  resolveExploreView,
} from './url-state';
import type { ExploreViewChange } from './types';

/**
 * The view bar's pickers as the view controller drives them (the view-bar controller). Each
 * `apply*Selection` changes the plot at once and dispatches its change event synchronously,
 * which the app routes back here as a user change; `applyDensityLayerSelection` dispatches nothing.
 */
export interface ViewPickers {
  readonly selectedProjection: string;
  readonly selectedAnnotation: string;
  readonly tooltipAnnotations: readonly string[];
  applyProjectionSelection(projection: string): void;
  applyAnnotationSelection(annotation: string): void;
  applyTooltipAnnotationsSelection(names: string[]): void;
  applyDensityLayerSelection(mode: DensityLayerMode): void;
}

interface ViewControllerOptions {
  plotElement: ProtspaceScatterplot;
  pickers: ViewPickers;
}

export interface ViewController {
  getCurrentEffectiveView(dataOverride?: VisualizationData): EffectiveExploreView | null;
  getLatestViewRequest(): ExploreViewRequestState;
  resolveLatestView(dataOverride?: VisualizationData): EffectiveExploreView | null;
  applyViewSelection(
    viewRequest: ExploreViewRequestState,
    source: ExploreViewChangeSource,
    dataOverride?: VisualizationData,
  ): EffectiveExploreView | null;
  applyLatestViewForDatasetLoad(dataOverride?: VisualizationData): EffectiveExploreView | null;
  setRequestedView(viewRequest: ExploreViewRequestState): void;
  /**
   * Stores `viewRequest` as the latest request WITHOUT resolving or applying
   * it. Used when a dataset switch is also pending (Back/Forward changing
   * both `dataset` and a view param at once): resolving here would run
   * against whichever dataset is still on screen, normalize against its
   * annotations/projections, and write that normalization over the URL
   * entry the switch is headed to. `applyLatestViewForDatasetLoad` resolves
   * the recorded request against the new dataset once it's loaded.
   */
  recordRequestedView(viewRequest: ExploreViewRequestState): void;
  /**
   * Records the view on screen as the latest request, as a URL naming it
   * would. After a failed Back/Forward the recorded request still holds the
   * failed entry's parameters; this drops them, so a later file import or
   * load doesn't inherit them.
   */
  recordCurrentView(): void;
  /**
   * Sets the loaded dataset's own landing view (an example's curated
   * `defaultView`), which fills whatever the view request leaves unset (see
   * `resolveExploreView`); `null` for a dataset without one. Both resolve
   * paths use it, so Back to a bare entry of the same dataset, which never
   * reloads, also lands on the curated view.
   */
  setDatasetDefaults(defaults: ExploreViewDefaults | null): void;
  handleUserAnnotationChange(): void;
  handleUserProjectionChange(): void;
  handleUserTooltipAnnotationsChange(): void;
  handleUserDensityLayerChange(): void;
  subscribeToViewChanges(callback: (change: ExploreViewChange) => void): () => void;
  dispose(): void;
}

export function createViewController({
  plotElement,
  pickers,
}: ViewControllerOptions): ViewController {
  let latestViewRequest = createEmptyExploreViewRequest();
  let datasetDefaults: ExploreViewDefaults = {};
  let isApplyingView = false;
  const subscribers = new Set<(change: ExploreViewChange) => void>();

  const emitViewChange = (change: ExploreViewChange) => {
    subscribers.forEach((callback) => callback(change));
  };

  const getViewOptions = (data: VisualizationData | undefined) => ({
    availableAnnotations: Object.keys(data?.annotations ?? {}),
    availableProjections: data?.projections?.map((projection) => projection.name) ?? [],
  });

  const getCurrentEffectiveView = (
    dataOverride?: VisualizationData,
  ): EffectiveExploreView | null => {
    const currentData = dataOverride ?? plotElement.getCurrentData?.();
    const { availableAnnotations, availableProjections } = getViewOptions(currentData);

    if (availableAnnotations.length === 0 || availableProjections.length === 0) {
      return null;
    }

    const projectionIndex =
      typeof plotElement.selectedProjectionIndex === 'number'
        ? plotElement.selectedProjectionIndex
        : availableProjections.indexOf(pickers.selectedProjection);
    const validPickerProjection =
      pickers.selectedProjection && availableProjections.includes(pickers.selectedProjection)
        ? pickers.selectedProjection
        : null;
    const projection =
      availableProjections[projectionIndex] ?? validPickerProjection ?? availableProjections[0];
    const annotation =
      plotElement.selectedAnnotation &&
      availableAnnotations.includes(plotElement.selectedAnnotation)
        ? plotElement.selectedAnnotation
        : pickers.selectedAnnotation && availableAnnotations.includes(pickers.selectedAnnotation)
          ? pickers.selectedAnnotation
          : availableAnnotations[0];

    const rawTooltip = plotElement.tooltipAnnotations ?? pickers.tooltipAnnotations ?? [];
    const tooltipSeen = new Set<string>();
    const tooltip: string[] = [];
    for (const name of rawTooltip) {
      if (name === annotation) continue;
      if (!availableAnnotations.includes(name)) continue;
      if (tooltipSeen.has(name)) continue;
      tooltipSeen.add(name);
      tooltip.push(name);
    }

    return {
      annotation,
      projection,
      tooltip,
      density: plotElement.config?.densityLayer ?? DENSITY_DEFAULT,
    };
  };

  const selectProjection = (projection: string) => {
    pickers.applyProjectionSelection(projection);
  };

  const selectAnnotation = (annotation: string) => {
    pickers.applyAnnotationSelection(annotation);
  };

  const selectTooltipAnnotations = (tooltipAnnotations: string[]) => {
    pickers.applyTooltipAnnotationsSelection(tooltipAnnotations);
  };

  const selectDensityLayer = (density: DensityLayerMode) => {
    pickers.applyDensityLayerSelection(density);
    plotElement.config = { ...(plotElement.config ?? {}), densityLayer: density };
  };

  const arraysEqual = (a: readonly string[], b: readonly string[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  const resolveLatestView = (dataOverride?: VisualizationData) => {
    const currentData = dataOverride ?? plotElement.getCurrentData?.();
    const { availableAnnotations, availableProjections } = getViewOptions(currentData);
    const resolved = resolveExploreView(
      latestViewRequest,
      availableAnnotations,
      availableProjections,
      datasetDefaults,
    );
    return resolved?.effective ?? null;
  };

  const applyViewSelection = (
    viewRequest: ExploreViewRequestState,
    source: ExploreViewChangeSource,
    dataOverride?: VisualizationData,
  ): EffectiveExploreView | null => {
    latestViewRequest = cloneExploreViewRequest(viewRequest);

    const currentData = dataOverride ?? plotElement.getCurrentData?.();
    const { availableAnnotations, availableProjections } = getViewOptions(currentData);
    const resolved = resolveExploreView(
      latestViewRequest,
      availableAnnotations,
      availableProjections,
      datasetDefaults,
    );

    if (!resolved) {
      return null;
    }

    const currentView = getCurrentEffectiveView(currentData);
    const effective = resolved.effective;
    const projectionChanged = currentView?.projection !== effective.projection;
    const annotationChanged = currentView?.annotation !== effective.annotation;
    const tooltipChanged = !arraysEqual(currentView?.tooltip ?? [], effective.tooltip);
    const densityChanged = currentView?.density !== effective.density;

    // The pickers dispatch their change events synchronously from these
    // apply* calls, and the app routes them back here as user changes. Guard
    // only that synchronous window: anything arriving later is a real user
    // interaction, not an echo of what we just applied.
    const wasApplyingView = isApplyingView;
    isApplyingView = true;
    try {
      if (projectionChanged) {
        selectProjection(effective.projection);
      }
      if (annotationChanged) {
        selectAnnotation(effective.annotation);
      }
      if (tooltipChanged) {
        selectTooltipAnnotations(effective.tooltip);
      }
      if (densityChanged) {
        selectDensityLayer(effective.density);
      }
    } finally {
      isApplyingView = wasApplyingView;
    }

    emitViewChange({
      effective,
      source,
      normalize: getResolvedExploreViewNormalization(latestViewRequest, resolved),
    });

    return effective;
  };

  const emitCurrentUserViewChange = () => {
    if (isApplyingView) {
      return;
    }

    const effective = getCurrentEffectiveView();
    if (!effective) {
      return;
    }

    emitViewChange({
      effective,
      source: 'user',
      normalize: {
        annotation: false,
        projection: false,
        tooltip: false,
        density: false,
      },
    });
  };

  return {
    getCurrentEffectiveView,
    getLatestViewRequest: () => cloneExploreViewRequest(latestViewRequest),
    resolveLatestView,
    applyLatestViewForDatasetLoad(dataOverride?: VisualizationData) {
      return applyViewSelection(latestViewRequest, 'dataset-load', dataOverride);
    },
    applyViewSelection,
    setRequestedView(viewRequest: ExploreViewRequestState) {
      latestViewRequest = cloneExploreViewRequest(viewRequest);
      applyViewSelection(latestViewRequest, 'url');
    },
    recordRequestedView(viewRequest: ExploreViewRequestState) {
      latestViewRequest = cloneExploreViewRequest(viewRequest);
    },
    recordCurrentView() {
      const effective = getCurrentEffectiveView();
      latestViewRequest = effective
        ? createExploreViewRequestFromView(effective)
        : createEmptyExploreViewRequest();
    },
    setDatasetDefaults(defaults: ExploreViewDefaults | null) {
      datasetDefaults = defaults ?? {};
    },
    handleUserAnnotationChange() {
      emitCurrentUserViewChange();
    },
    handleUserProjectionChange() {
      emitCurrentUserViewChange();
    },
    handleUserTooltipAnnotationsChange() {
      emitCurrentUserViewChange();
    },
    handleUserDensityLayerChange() {
      emitCurrentUserViewChange();
    },
    subscribeToViewChanges(callback: (change: ExploreViewChange) => void) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    dispose() {
      subscribers.clear();
    },
  };
}
