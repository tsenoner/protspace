import type {
  LegendErrorEventDetail,
  ProteinClickDetail,
  ProtspaceLegend,
  ProtspaceScatterplot,
  StructureErrorEventDetail,
  StructureLoadEvent,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import { notify } from '../lib/notify';
import { getLegendErrorNotification } from './notifications';
import { EatProvenanceResolver } from './eat-provenance';
import { undoEntrySize, type UndoEntry } from './undo-controller';
import { createUndoHistory, type UndoHistory } from './undo-history';

interface InteractionControllerOptions {
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  /** Asks for a protein's structure; the structure controller decides when it loads. */
  requestStructure(proteinId: string): void;
  /** Offers the selection's proteins to the structure, which picks the one to show. */
  showSelection(proteinIds: readonly string[]): void;
}

interface ActiveProvenanceClick {
  data: VisualizationData;
  annotation: string;
  proteinId: string;
  originalIndex: number;
  mode: 'auto' | 'source';
  /** The endpoint drawn with the highlight ring (Go to source's source). */
  focus?: string;
}

export interface InteractionController {
  /**
   * The undo history (design decision 13): selection, show-only and filter steps, as protein-id
   * arrays. The selection and filter controllers record and apply their own steps.
   */
  history: UndoHistory<UndoEntry>;
  updateLegend(): void;
  getSelectedProteins(): string[];
  /** The selection changed: remember it and offer it to the structure. */
  handleSelectionChange(proteinIds: readonly string[]): void;
  handleProteinClick(event: Event): void;
  /**
   * Draws `proteinId`'s provenance lines as a click on it does, without selecting it, and keeps
   * them across data changes. `'source'` draws its fan-out even when it is a prediction itself.
   * `focus` is the endpoint drawn with the highlight ring. Returns whether lines were requested.
   */
  traceProtein(
    proteinId: string,
    originalIndex: number,
    mode?: 'auto' | 'source',
    focus?: string,
  ): boolean;
  /**
   * The EAT panel's Drawing switches. `trace` off clears the drawn lines and a plot click only
   * selects; `traceProtein` still draws, since its callers are explicit. `linesPerSource` caps a
   * source's fan-out and redraws the active lines.
   */
  setTracing(options: { trace: boolean; linesPerSource: number }): void;
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
  showSelection,
}: InteractionControllerOptions): InteractionController {
  let selectedProteins: string[] = [];
  let activeProvenanceClick: ActiveProvenanceClick | null = null;
  let tracing = { trace: true, linesPerSource: 20 };
  const eatProvenance = new EatProvenanceResolver();
  const history = createUndoHistory<UndoEntry>({ size: undoEntrySize });

  const resolveProvenanceClick = (click: ActiveProvenanceClick) => {
    const request = eatProvenance.resolve(
      click.data,
      click.annotation,
      click.proteinId,
      click.originalIndex,
      (candidateId, candidateIndex) =>
        plotElement.isProteinLegendEligible(candidateId, candidateIndex),
      (candidateIndex) => plotElement.isProteinInCurrentView(candidateIndex),
      click.mode,
      tracing.linesPerSource,
    );
    return request && click.focus ? { ...request, focusProteinId: click.focus } : request;
  };

  const clearProvenance = () => {
    activeProvenanceClick = null;
    plotElement.clearProvenanceConnectors();
  };

  /** Resolves and draws `proteinId`'s lines, or clears them; whether lines were requested. */
  const trace = (
    proteinId: string,
    originalIndex: number,
    mode: 'auto' | 'source',
    focus?: string,
  ): boolean => {
    const data = plotElement.data;
    const annotation = plotElement.selectedAnnotation;
    if (!data || !annotation || !plotElement.eatOverlayEnabled) {
      clearProvenance();
      return false;
    }
    const click = { data, annotation, proteinId, originalIndex, mode, focus };
    const request = resolveProvenanceClick(click);
    if (!request) {
      clearProvenance();
      return false;
    }
    activeProvenanceClick = click;
    plotElement.setProvenanceConnectors(request);
    return true;
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
    history,
    updateLegend,
    getSelectedProteins() {
      return selectedProteins;
    },
    handleSelectionChange(proteinIds) {
      selectedProteins = [...proteinIds];
      showSelection(selectedProteins);
    },
    handleProteinClick(event) {
      const detail = (event as CustomEvent<Partial<ProteinClickDetail>>).detail;
      const proteinId = detail?.proteinId;
      // A plain click shows the clicked protein's structure, also one whose viewer was closed
      // or that the click deselected. It runs after the selection controller's listener, so it
      // wins over the selection's last protein.
      const keys = detail?.modifierKeys;
      if (proteinId && !keys?.ctrl && !keys?.meta && !keys?.shift) requestStructure(proteinId);
      const originalIndex = detail?.point?.originalIndex;
      if (!proteinId || originalIndex === undefined || !tracing.trace) {
        clearProvenance();
        return;
      }
      trace(proteinId, originalIndex, 'auto');
    },
    traceProtein(proteinId, originalIndex, mode = 'auto', focus) {
      return trace(proteinId, originalIndex, mode, focus);
    },
    setTracing(options) {
      const linesChanged = options.linesPerSource !== tracing.linesPerSource;
      tracing = { ...options };
      const click = activeProvenanceClick;
      if (!options.trace) clearProvenance();
      else if (linesChanged && click) {
        trace(click.proteinId, click.originalIndex, click.mode, click.focus);
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
