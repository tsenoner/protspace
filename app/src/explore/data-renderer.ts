import type {
  ProtspaceControlBar,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import type { InteractionController } from './interaction-controller';
import type { EffectiveExploreView } from './view-state';

interface DataRendererOptions {
  controlBar: ProtspaceControlBar;
  getIsDisposed: () => boolean;
  interactionController: InteractionController;
  legendElement: ProtspaceLegend;
  overlayController: {
    update(show: boolean, progress?: number, message?: string, subMessage?: string): void;
  };
  plotElement: ProtspaceScatterplot;
  resolveInitialView(data: VisualizationData): EffectiveExploreView | null;
  structureViewer: ProtspaceStructureViewer;
}

interface ResolvedInitialView {
  annotation: string;
  projectionIndex: number;
  projectionName: string;
  tooltip: string[];
}

function resolveRenderableView(
  newData: VisualizationData,
  initialView?: EffectiveExploreView | null,
): ResolvedInitialView {
  const projectionName = initialView?.projection ?? newData.projections[0]?.name ?? '';
  const projectionIndex = Math.max(
    0,
    newData.projections.findIndex((projection) => projection.name === projectionName),
  );
  const firstAnnotationKey = Object.keys(newData.annotations)[0] || '';
  const annotation = initialView?.annotation ?? firstAnnotationKey;

  const availableAnnotations = new Set(Object.keys(newData.annotations));
  const seenTooltip = new Set<string>();
  const tooltip: string[] = [];
  for (const name of initialView?.tooltip ?? []) {
    if (name === annotation) continue;
    if (!availableAnnotations.has(name)) continue;
    if (seenTooltip.has(name)) continue;
    seenTooltip.add(name);
    tooltip.push(name);
  }

  return {
    annotation,
    projectionIndex,
    projectionName,
    tooltip,
  };
}

function updateOverlayForStep(
  overlayController: DataRendererOptions['overlayController'],
  isLargeDataset: boolean,
  progress: number,
  message: string,
  subMessage: string,
) {
  if (!isLargeDataset) {
    return;
  }

  overlayController.update(true, progress, message, subMessage);
}

function applyPlotState(
  plotElement: ProtspaceScatterplot,
  newData: VisualizationData,
  initialView: ResolvedInitialView,
) {
  const previousData = plotElement.data;
  plotElement.clearIsolationState();
  plotElement.data = newData;
  plotElement.selectedProjectionIndex = initialView.projectionIndex;
  plotElement.selectedAnnotation = initialView.annotation;
  plotElement.tooltipAnnotations = [...initialView.tooltip];
  plotElement.selectedProteinIds = [];
  plotElement.selectionMode = false;
  plotElement.hiddenAnnotationValues = [];
  plotElement.requestUpdate('data', previousData);
}

function applyControlBarState(controlBar: ProtspaceControlBar, initialView: ResolvedInitialView) {
  controlBar.selectedProjection = initialView.projectionName;
  controlBar.selectedAnnotation = initialView.annotation;
  controlBar.tooltipAnnotations = [...initialView.tooltip];
  controlBar.selectionMode = false;
  controlBar.selectedProteinsCount = 0;
  controlBar.requestUpdate();
}

async function syncLegendState(
  legendElement: ProtspaceLegend,
  interactionController: InteractionController,
  isLargeDataset: boolean,
) {
  await new Promise<void>((resolve) => {
    setTimeout(
      () => {
        legendElement.autoSync = true;
        legendElement.autoHide = true;
        interactionController.updateLegend();
        resolve();
      },
      isLargeDataset ? 30 : 20,
    );
  });
}

export function createDataRenderer({
  controlBar,
  getIsDisposed,
  interactionController,
  legendElement,
  overlayController,
  plotElement,
  resolveInitialView,
  structureViewer,
}: DataRendererOptions) {
  const yieldToBrowser = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  return async function loadData(newData: VisualizationData): Promise<EffectiveExploreView | null> {
    if (getIsDisposed()) {
      return null;
    }

    console.log('Loading new data:', newData);
    const startTime = performance.now();
    const dataSize = newData.protein_ids.length;
    const isLargeDataset = dataSize > 1000;
    const initialView = resolveInitialView(newData);
    const resolvedInitialView = resolveRenderableView(newData, initialView);

    console.log('Dataset analysis:', {
      size: dataSize.toLocaleString(),
      willUseProgressiveLoading: isLargeDataset,
    });

    if (isLargeDataset) {
      console.log(
        `Large dataset detected (${dataSize.toLocaleString()} proteins) - using optimized loading pipeline`,
      );
      updateOverlayForStep(
        overlayController,
        true,
        20,
        'Preparing visualization...',
        `Found ${dataSize.toLocaleString()} proteins`,
      );
    } else {
      overlayController.update(false);
    }

    try {
      updateOverlayForStep(
        overlayController,
        isLargeDataset,
        20,
        'Rendering scatterplot points...',
        `Visualizing ${dataSize.toLocaleString()} proteins`,
      );

      await yieldToBrowser();

      console.log('Updating scatterplot with new data...');
      controlBar.autoSync = false;
      legendElement.autoSync = false;

      applyPlotState(plotElement, newData, resolvedInitialView);
      applyControlBarState(controlBar, resolvedInitialView);

      updateOverlayForStep(
        overlayController,
        isLargeDataset,
        40,
        'Configuring controls and filters...',
        `Visualizing ${dataSize.toLocaleString()} proteins`,
      );

      await yieldToBrowser();
      await yieldToBrowser();

      controlBar.autoSync = true;

      updateOverlayForStep(
        overlayController,
        isLargeDataset,
        60,
        'Organizing color categories...',
        `Visualizing ${dataSize.toLocaleString()} proteins`,
      );

      await yieldToBrowser();
      await syncLegendState(legendElement, interactionController, isLargeDataset);

      updateOverlayForStep(
        overlayController,
        isLargeDataset,
        95,
        'Finalizing view...',
        `Visualizing ${dataSize.toLocaleString()} proteins`,
      );

      await yieldToBrowser();

      if (structureViewer.style.display !== 'none') {
        structureViewer.style.display = 'none';
      }

      interactionController.updateSelectedProteinDisplay(null);

      updateOverlayForStep(
        overlayController,
        isLargeDataset,
        100,
        'Ready to explore!',
        `Visualizing ${dataSize.toLocaleString()} proteins`,
      );

      if (isLargeDataset) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      if (getIsDisposed()) {
        return null;
      }

      const loadingTime = performance.now() - startTime;
      console.log('Data loading completed:', {
        proteins: newData.protein_ids.length.toLocaleString(),
        loadingTime: `${Math.round(loadingTime)}ms`,
      });

      return {
        annotation: resolvedInitialView.annotation,
        projection: resolvedInitialView.projectionName,
        tooltip: [...resolvedInitialView.tooltip],
      };
    } finally {
      if (isLargeDataset && !getIsDisposed()) {
        overlayController.update(false);
      }
    }
  };
}
