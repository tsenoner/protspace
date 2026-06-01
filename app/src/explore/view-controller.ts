import type { ProtspaceControlBar, ProtspaceScatterplot } from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import type {
  EffectiveExploreView,
  ExploreViewChangeSource,
  ExploreViewRequestState,
} from './view-state';
import {
  cloneExploreViewRequest,
  createEmptyExploreViewRequest,
  getResolvedExploreViewNormalization,
  resolveExploreView,
} from './url-state';
import type { ExploreViewChange } from './types';

interface ViewControllerOptions {
  plotElement: ProtspaceScatterplot;
  controlBar: ProtspaceControlBar;
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
  handleUserAnnotationChange(): void;
  handleUserProjectionChange(): void;
  handleUserTooltipAnnotationsChange(): void;
  subscribeToViewChanges(callback: (change: ExploreViewChange) => void): () => void;
  dispose(): void;
}

export function createViewController({
  plotElement,
  controlBar,
}: ViewControllerOptions): ViewController {
  let latestViewRequest = createEmptyExploreViewRequest();
  let activeViewChangeSource: ExploreViewChangeSource | null = null;
  let activeViewChangeResetFrame = 0;
  const subscribers = new Set<(change: ExploreViewChange) => void>();

  const emitViewChange = (change: ExploreViewChange) => {
    subscribers.forEach((callback) => callback(change));
  };

  const scheduleActiveViewChangeSourceReset = (source: ExploreViewChangeSource) => {
    if (activeViewChangeResetFrame) {
      cancelAnimationFrame(activeViewChangeResetFrame);
    }

    activeViewChangeResetFrame = requestAnimationFrame(() => {
      if (activeViewChangeSource === source) {
        activeViewChangeSource = null;
      }
      activeViewChangeResetFrame = 0;
    });
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
        : availableProjections.indexOf(controlBar.selectedProjection);
    const validControlBarProjection =
      controlBar.selectedProjection && availableProjections.includes(controlBar.selectedProjection)
        ? controlBar.selectedProjection
        : null;
    const projection =
      availableProjections[projectionIndex] ?? validControlBarProjection ?? availableProjections[0];
    const annotation =
      plotElement.selectedAnnotation &&
      availableAnnotations.includes(plotElement.selectedAnnotation)
        ? plotElement.selectedAnnotation
        : controlBar.selectedAnnotation &&
            availableAnnotations.includes(controlBar.selectedAnnotation)
          ? controlBar.selectedAnnotation
          : availableAnnotations[0];

    const rawTooltip = plotElement.tooltipAnnotations ?? controlBar.tooltipAnnotations ?? [];
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
    };
  };

  const selectProjection = (projection: string) => {
    controlBar.applyProjectionSelection(projection);
  };

  const selectAnnotation = (annotation: string) => {
    controlBar.applyAnnotationSelection(annotation);
  };

  const selectTooltipAnnotations = (tooltipAnnotations: string[]) => {
    controlBar.applyTooltipAnnotationsSelection?.(tooltipAnnotations);
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
      latestViewRequest.requested,
      availableAnnotations,
      availableProjections,
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
      latestViewRequest.requested,
      availableAnnotations,
      availableProjections,
    );

    if (!resolved) {
      return null;
    }

    const currentView = getCurrentEffectiveView(currentData);
    const effective = resolved.effective;
    const projectionChanged = currentView?.projection !== effective.projection;
    const annotationChanged = currentView?.annotation !== effective.annotation;
    const tooltipChanged = !arraysEqual(currentView?.tooltip ?? [], effective.tooltip);

    activeViewChangeSource = source;
    if (projectionChanged) {
      selectProjection(effective.projection);
    }
    if (annotationChanged) {
      selectAnnotation(effective.annotation);
    }
    if (tooltipChanged) {
      selectTooltipAnnotations(effective.tooltip);
    }
    scheduleActiveViewChangeSourceReset(source);

    emitViewChange({
      effective,
      source,
      normalize: getResolvedExploreViewNormalization(latestViewRequest, resolved),
    });

    return effective;
  };

  const emitCurrentUserViewChange = () => {
    if (activeViewChangeSource) {
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
    handleUserAnnotationChange() {
      emitCurrentUserViewChange();
    },
    handleUserProjectionChange() {
      emitCurrentUserViewChange();
    },
    handleUserTooltipAnnotationsChange() {
      emitCurrentUserViewChange();
    },
    subscribeToViewChanges(callback: (change: ExploreViewChange) => void) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    dispose() {
      if (activeViewChangeResetFrame) {
        cancelAnimationFrame(activeViewChangeResetFrame);
        activeViewChangeResetFrame = 0;
      }
      subscribers.clear();
    },
  };
}
