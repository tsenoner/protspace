import type {
  LegendErrorEventDetail,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  StructureErrorEventDetail,
  StructureLoadEvent,
} from '@protspace/core';
import { getProteinAnnotationIndices } from '@protspace/utils';
import { notify } from '../lib/notify';
import { getLegendErrorNotification } from './notifications';
import { EatProvenanceResolver } from './eat-provenance';

interface InteractionControllerOptions {
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  selectedProteinElement: HTMLElement | null;
  structureViewer: ProtspaceStructureViewer;
}

export interface InteractionController {
  updateLegend(): void;
  updateSelectedProteinDisplay(proteinId: string | null): void;
  getSelectedProteins(): string[];
  handleSelectionChange(event: Event): void;
  handleProteinClick(event: Event): void;
  handlePlotDataChange(): void;
  handleLegendError(event: Event): void;
  handleStructureLoad(event: Event): void;
  handleStructureError(event: Event): void;
  handleStructureClose(event: Event): void;
  handleAnnotationChange(): void;
}

export function createInteractionController({
  legendElement,
  plotElement,
  selectedProteinElement,
  structureViewer,
}: InteractionControllerOptions): InteractionController {
  let selectedProteins: string[] = [];
  const eatProvenance = new EatProvenanceResolver();

  const updateSelectedProteinDisplay = (proteinId: string | null) => {
    if (!selectedProteinElement) {
      return;
    }

    if (proteinId) {
      selectedProteinElement.textContent = `Selected: ${proteinId}`;
      selectedProteinElement.style.color = '#3b82f6';
      return;
    }

    selectedProteinElement.textContent = 'No protein selected';
    selectedProteinElement.style.color = '#6b7280';
  };

  const updateLegend = () => {
    const currentAnnotation = plotElement.selectedAnnotation;
    const currentData = plotElement.getCurrentData();
    const annotationRows = currentData?.annotation_data?.[currentAnnotation];
    if (!currentAnnotation || !currentData || !currentData.annotations[currentAnnotation]) {
      return;
    }

    if (legendElement.autoSync && 'forceSync' in legendElement) {
      legendElement.forceSync();
      return;
    }

    if (legendElement.autoSync) {
      return;
    }

    legendElement.data = { annotations: currentData.annotations };
    legendElement.selectedAnnotation = currentAnnotation;
    legendElement.annotationValues = currentData.protein_ids.flatMap((_, index) => {
      const annotationIdxArray = annotationRows
        ? getProteinAnnotationIndices(annotationRows, index)
        : [];
      return annotationIdxArray.map((annotationIdx) => {
        return currentData.annotations[currentAnnotation].values[annotationIdx];
      });
    });
    legendElement.proteinIds = currentData.protein_ids;
  };

  return {
    updateLegend,
    updateSelectedProteinDisplay,
    getSelectedProteins() {
      return selectedProteins;
    },
    handleSelectionChange(event) {
      const customEvent = event as CustomEvent<{ proteinIds?: string[] }>;
      selectedProteins = Array.isArray(customEvent.detail.proteinIds)
        ? [...customEvent.detail.proteinIds]
        : [];

      if (selectedProteins.length > 0) {
        const lastSelected = selectedProteins[selectedProteins.length - 1];
        structureViewer.loadProtein(lastSelected);
        updateSelectedProteinDisplay(`${selectedProteins.length} proteins selected`);
        return;
      }

      updateSelectedProteinDisplay(null);
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
        plotElement.clearProvenanceConnectors();
        return;
      }

      const request = eatProvenance.resolve(
        data,
        annotation,
        proteinId,
        originalIndex,
        (candidateId, candidateIndex) =>
          plotElement.isProteinLegendEligible(candidateId, candidateIndex),
        (candidateIndex) => plotElement.isProteinInCurrentView(candidateIndex),
      );
      if (request) {
        plotElement.setProvenanceConnectors(request);
      } else {
        plotElement.clearProvenanceConnectors();
      }
    },
    handlePlotDataChange() {
      selectedProteins = plotElement.selectedProteinIds || [];
      updateLegend();
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
    handleStructureClose(event) {
      const customEvent = event as CustomEvent<{ proteinId?: string }>;
      console.log(
        `🔒 Structure viewer closed for protein: ${customEvent.detail.proteinId || 'none'}`,
      );
      console.log('Structure viewer should now be hidden');
      updateSelectedProteinDisplay(null);
    },
    handleAnnotationChange() {
      plotElement.clearProvenanceConnectors();
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
