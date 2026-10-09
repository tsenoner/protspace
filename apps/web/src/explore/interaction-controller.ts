import type {
  LegendErrorEventDetail,
  ProtspaceLegend,
  ProtspaceScatterplot,
  StructureErrorEventDetail,
  StructureLoadEvent,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import { notify } from '../lib/notify';
import { getLegendErrorNotification } from './notifications';
import { EatProvenanceResolver } from './eat-provenance';

interface InteractionControllerOptions {
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  /** Asks for a protein's structure; the structure controller decides when it loads. */
  requestStructure(proteinId: string): void;
}

interface ActiveProvenanceClick {
  data: VisualizationData;
  annotation: string;
  proteinId: string;
  originalIndex: number;
}

export interface InteractionController {
  updateLegend(): void;
  getSelectedProteins(): string[];
  /** The selection changed: remember it and show its last protein's structure. */
  handleSelectionChange(proteinIds: readonly string[]): void;
  handleProteinClick(event: Event): void;
  handlePlotDataChange(): void;
  handleLegendError(event: Event): void;
  handleStructureLoad(event: Event): void;
  handleStructureError(event: Event): void;
  handleAnnotationChange(): void;
}

export function createInteractionController({
  legendElement,
  plotElement,
  requestStructure,
}: InteractionControllerOptions): InteractionController {
  let selectedProteins: string[] = [];
  let activeProvenanceClick: ActiveProvenanceClick | null = null;
  const eatProvenance = new EatProvenanceResolver();

  const resolveProvenanceClick = (click: ActiveProvenanceClick) =>
    eatProvenance.resolve(
      click.data,
      click.annotation,
      click.proteinId,
      click.originalIndex,
      (candidateId, candidateIndex) =>
        plotElement.isProteinLegendEligible(candidateId, candidateIndex),
      (candidateIndex) => plotElement.isProteinInCurrentView(candidateIndex),
    );

  const clearProvenance = () => {
    activeProvenanceClick = null;
    plotElement.clearProvenanceConnectors();
  };

  const updateLegend = () => {
    // Auto-sync is off only while a dataset loads (`data-renderer.ts`). The legend's own
    // sync controller follows the plot meanwhile, so there is nothing to push.
    if (!legendElement.autoSync) {
      return;
    }

    const currentAnnotation = plotElement.selectedAnnotation;
    const currentData = plotElement.getCurrentData();
    if (!currentAnnotation || !currentData || !currentData.annotations[currentAnnotation]) {
      return;
    }

    legendElement.forceSync();
  };

  return {
    updateLegend,
    getSelectedProteins() {
      return selectedProteins;
    },
    handleSelectionChange(proteinIds) {
      selectedProteins = [...proteinIds];

      if (selectedProteins.length > 0) {
        requestStructure(selectedProteins[selectedProteins.length - 1]);
      }
    },
    handleProteinClick(event) {
      const detail = (
        event as CustomEvent<{ proteinId?: string; point?: { originalIndex?: number } }>
      ).detail;
      const proteinId = detail?.proteinId;
      const originalIndex = detail?.point?.originalIndex;
      const data = plotElement.data;
      const annotation = plotElement.selectedAnnotation;
      if (
        !proteinId ||
        originalIndex === undefined ||
        !data ||
        !annotation ||
        !plotElement.eatOverlayEnabled
      ) {
        clearProvenance();
        return;
      }

      const click = {
        data,
        annotation,
        proteinId,
        originalIndex,
      };
      const request = resolveProvenanceClick(click);
      if (request) {
        activeProvenanceClick = click;
        plotElement.setProvenanceConnectors(request);
      } else {
        clearProvenance();
      }
    },
    handlePlotDataChange() {
      selectedProteins = plotElement.selectedProteinIds || [];
      updateLegend();
      const click = activeProvenanceClick;
      if (!click) return;
      if (
        !plotElement.hasActiveProvenanceConnectors() ||
        plotElement.data !== click.data ||
        plotElement.selectedAnnotation !== click.annotation ||
        !plotElement.eatOverlayEnabled
      ) {
        activeProvenanceClick = null;
        return;
      }

      const request = resolveProvenanceClick(click);
      if (request) {
        plotElement.setProvenanceConnectors(request);
      } else {
        clearProvenance();
      }
    },
    handleLegendError(event) {
      const customEvent = event as CustomEvent<LegendErrorEventDetail>;
      console.error('Legend error:', customEvent.detail);
      notify.error(getLegendErrorNotification(customEvent.detail));
    },
    handleStructureLoad(event) {
      const customEvent = event as StructureLoadEvent;
      if (customEvent.detail.status === 'loaded') {
        console.log(`✅ Structure loaded: ${customEvent.detail.proteinId}`);
      }
    },
    handleStructureError(event) {
      const customEvent = event as CustomEvent<StructureErrorEventDetail>;
      console.warn('Structure viewer error:', customEvent.detail);
    },
    handleAnnotationChange() {
      clearProvenance();
      // Synchronously clear the plot's hidden set for the newly selected
      // annotation. The core legend owns per-annotation visibility: it persists
      // hidden categories (saveSettings/loadSettings, keyed by datasetHash +
      // annotation) and restores them on its own (async, Lit-driven) update
      // cycle, which runs after this synchronous handler — so this reset is
      // intentionally overwritten and switching away and back restores the
      // previously hidden categories.
      plotElement.hiddenAnnotationValues = [];
      updateLegend();
    },
  };
}
