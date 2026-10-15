import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ScatterplotData, OtherItem } from '../types';
import {
  isMultilabelAnnotationDataCached,
  type NumericAnnotationDisplaySettingsMap,
  type ScatterplotConfig,
} from '@protspace/utils';
import type { LegendSortMode } from '../types';
import {
  isScatterplotElement,
  supportsHiddenValues,
  supportsOtherValues,
  supportsConfig,
  supportsIsolationMode,
  supportsIsolationHistory,
  type IScatterplotElement,
} from '../scatterplot-interface';
import { LEGEND_EVENTS } from '../config';
import { expandHiddenValues, buildZOrderMapping, buildColorShapeMappings } from '../legend-helpers';
import type { LegendItem } from '../types';
import type {
  LegendColorMappingChangeEvent,
  LegendZOrderChangeEvent,
} from '../legend-mapping-events';

/**
 * Same members in the same order.
 *
 * `hiddenAnnotationValues` and `otherAnnotationValues` are `@property({ type: Array })` on the
 * scatterplot, so Lit's default `hasChanged` compares them by reference: assigning a freshly
 * built array with identical contents is recorded as a change. Downstream that is not merely
 * wasted work. `_reconcileProvenanceConnectors` (scatter-plot.ts) reads a change to
 * `hiddenAnnotationValues` as "the user changed what is visible" and drops the EAT provenance
 * connectors, and `_visibilityModelKey` compares the same array by reference, so the whole
 * visibility model is rebuilt. Both must fire on a real edit and neither on a no-op resync.
 */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Maximum number of retries when looking for scatterplot element */
const MAX_DISCOVERY_RETRIES = 10;
/** Delay between retries in ms */
const DISCOVERY_RETRY_DELAY = 100;

/**
 * Callback interface for scatterplot sync events
 */
export interface ScatterplotSyncCallbacks {
  onDataChange: (
    data: ScatterplotData,
    selectedAnnotation: string,
    selectedProjectionName: string,
  ) => void;
  onAnnotationChange: (annotation: string) => void;
  getHiddenValues: () => string[];
  getOtherItems: () => OtherItem[];
  getLegendItems: () => LegendItem[];
  getOtherConcreteValues: () => string[];
  getNumericAnnotationSettings?: () => NumericAnnotationDisplaySettingsMap;
  getAnnotationSortModes?: () => Record<string, LegendSortMode>;
  getNumericManualOrderIds?: () => Record<string, string[]>;
}

/**
 * Reactive controller for managing scatterplot synchronization.
 * Handles all communication between the legend and scatterplot components.
 */
export class ScatterplotSyncController implements ReactiveController {
  private host: ReactiveControllerHost & Element;
  private callbacks: ScatterplotSyncCallbacks;

  private _scatterplotElement: IScatterplotElement | null = null;
  private _controlBarElement: Element | null = null;
  private _boundHandleDataChange: (e: Event) => void;
  private _boundHandleAnnotationChange: (e: Event) => void;
  private _boundHandleProjectionChange: () => void;
  private _discoveryRetryCount = 0;
  private _discoveryTimeoutId: number | null = null;
  private _mutationObserver: MutationObserver | null = null;

  scatterplotSelector: string = 'protspace-scatterplot';
  autoSync: boolean = true;
  autoHide: boolean = true;

  constructor(host: ReactiveControllerHost & Element, callbacks: ScatterplotSyncCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    host.addController(this);

    this._boundHandleDataChange = this._handleDataChange.bind(this);
    this._boundHandleAnnotationChange = this._handleAnnotationChange.bind(this);
    this._boundHandleProjectionChange = this._handleProjectionChange.bind(this);
  }

  hostConnected(): void {
    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  hostDisconnected(): void {
    this._cleanup();
  }

  /**
   * Get the current scatterplot element
   */
  get scatterplot(): IScatterplotElement | null {
    return this._scatterplotElement;
  }

  /**
   * Check if the current annotation is multilabel
   */
  isMultilabelAnnotation(selectedAnnotation: string): boolean {
    const currentData = this._scatterplotElement?.getCurrentData?.();
    const annotationData = currentData?.annotation_data?.[selectedAnnotation];

    // Cached: this runs from `_renderColorPicker`, i.e. on every legend re-render
    // while the picker is open, and dense storage makes the uncached form an O(N)
    // sweep over 573K proteins for an answer that cannot change without the
    // storage object changing.
    return annotationData ? isMultilabelAnnotationDataCached(annotationData) : false;
  }

  /**
   * Force synchronization with scatterplot
   */
  forceSync(): void {
    this._syncWithScatterplot();
  }

  /**
   * Sync hidden values to scatterplot
   */
  syncHiddenValues(): void {
    if (!this.autoHide || !this._scatterplotElement) return;

    if (supportsHiddenValues(this._scatterplotElement)) {
      const expandedHidden = expandHiddenValues(
        this.callbacks.getHiddenValues(),
        this.callbacks.getOtherItems(),
      );
      if (!sameOrder(this._scatterplotElement.hiddenAnnotationValues ?? [], expandedHidden)) {
        this._scatterplotElement.hiddenAnnotationValues = [...expandedHidden];
      }
    }

    if (supportsOtherValues(this._scatterplotElement)) {
      const otherValues = this.callbacks.getOtherConcreteValues();
      if (!sameOrder(this._scatterplotElement.otherAnnotationValues ?? [], otherValues)) {
        this._scatterplotElement.otherAnnotationValues = otherValues;
      }
    }
  }

  /**
   * Sync other annotation values to scatterplot
   */
  syncOtherValues(): void {
    if (!this._scatterplotElement || !supportsOtherValues(this._scatterplotElement)) return;

    const otherValues = this.callbacks.getOtherConcreteValues();
    if (!sameOrder(this._scatterplotElement.otherAnnotationValues ?? [], otherValues)) {
      this._scatterplotElement.otherAnnotationValues = otherValues;
    }
  }

  syncNumericAnnotationSettings(): void {
    if (!this._scatterplotElement) return;
    const numericAnnotationSettings = this.callbacks.getNumericAnnotationSettings?.() ?? {};
    const annotationSortModes = this.callbacks.getAnnotationSortModes?.() ?? {};
    const numericManualOrderIdsByAnnotation = this.callbacks.getNumericManualOrderIds?.() ?? {};

    if (this._scatterplotElement.numericAnnotationSettings !== numericAnnotationSettings) {
      this._scatterplotElement.numericAnnotationSettings = numericAnnotationSettings;
    }
    if (this._scatterplotElement.annotationSortModes !== annotationSortModes) {
      this._scatterplotElement.annotationSortModes = annotationSortModes;
    }
    if (
      this._scatterplotElement.numericManualOrderIdsByAnnotation !==
      numericManualOrderIdsByAnnotation
    ) {
      this._scatterplotElement.numericManualOrderIdsByAnnotation =
        numericManualOrderIdsByAnnotation;
    }
  }

  /**
   * Update scatterplot config
   */
  updateConfig(updates: Partial<ScatterplotConfig>): void {
    if (!this._scatterplotElement || !supportsConfig(this._scatterplotElement)) return;

    const currentConfig = this._scatterplotElement.config || {};
    const hasChanges = Object.entries(updates).some(
      ([key, value]) => (currentConfig as Record<string, unknown>)[key] !== value,
    );
    if (!hasChanges) return;

    this._scatterplotElement.config = { ...currentConfig, ...updates };
  }

  /**
   * Dispatch z-order change event
   */
  dispatchZOrderChange(): void {
    const zOrderMapping = buildZOrderMapping(this.callbacks.getLegendItems());

    const event: LegendZOrderChangeEvent = new CustomEvent(LEGEND_EVENTS.ZORDER_CHANGE, {
      detail: { zOrderMapping },
      bubbles: !this._scatterplotElement,
    });

    if (this._scatterplotElement) {
      this._scatterplotElement.dispatchEvent(event);
    } else {
      this.host.dispatchEvent(event);
    }
  }

  /**
   * Dispatch color/shape mapping change event
   * @param colorOnly - If true, indicates only colors changed (not z-order), allowing optimization
   */
  dispatchColorMappingChange(colorOnly: boolean = false): void {
    const { colorMapping, shapeMapping } = buildColorShapeMappings(this.callbacks.getLegendItems());

    const event: LegendColorMappingChangeEvent = new CustomEvent(
      LEGEND_EVENTS.COLORMAPPING_CHANGE,
      {
        detail: { colorMapping, shapeMapping, colorOnly },
        bubbles: !this._scatterplotElement,
      },
    );

    if (this._scatterplotElement) {
      this._scatterplotElement.dispatchEvent(event);
    } else {
      this.host.dispatchEvent(event);
    }
  }

  /**
   * Get the legend's constrained-view state from the scatterplot.
   *
   * Both manual isolation AND an active query filter are constrained views: the
   * plot shows a kept subset of proteins. The legend treats them identically —
   * counts reflect the kept set while the visible-category structure is preserved
   * (see legend `_handleScatterplotDataChange` / `processLegendItems`). So an active
   * query filter is reported here as `isolationMode: true` with the kept id set
   * appended as an extra history layer; when isolation is ALSO active the layers
   * intersect, matching the plot's own combined cull. This does NOT couple the
   * scatterplot's own isolation state to filtering — it only shapes the legend view.
   */
  getIsolationState(): { isolationMode: boolean; isolationHistory: string[][] } {
    if (!this._scatterplotElement) {
      return { isolationMode: false, isolationHistory: [] };
    }

    const isolationMode = supportsIsolationMode(this._scatterplotElement)
      ? this._scatterplotElement.isIsolationMode()
      : false;

    const isolationHistory = supportsIsolationHistory(this._scatterplotElement)
      ? this._scatterplotElement.getIsolationHistory()
      : [];

    if (this._scatterplotElement.filtersActive) {
      const filteredProteinIds = this._scatterplotElement.filteredProteinIds ?? [];
      return { isolationMode: true, isolationHistory: [...isolationHistory, filteredProteinIds] };
    }

    return { isolationMode, isolationHistory };
  }

  private _setupAutoSync(): void {
    // Try to find element immediately
    if (this._tryDiscoverScatterplot()) {
      return;
    }

    // If not found, set up retry mechanism with MutationObserver as backup
    this._setupDiscoveryObserver();
    this._scheduleDiscoveryRetry();
  }

  private _tryDiscoverScatterplot(): boolean {
    const element = document.querySelector(this.scatterplotSelector);
    if (element && isScatterplotElement(element)) {
      this._onScatterplotDiscovered(element);
      return true;
    }
    return false;
  }

  private _onScatterplotDiscovered(element: IScatterplotElement): void {
    // Clean up discovery mechanisms
    this._cleanupDiscovery();

    this._scatterplotElement = element;
    element.addEventListener(LEGEND_EVENTS.DATA_CHANGE, this._boundHandleDataChange);
    const escapedSelector =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(this.scatterplotSelector)
        : this.scatterplotSelector.replace(/["\\]/g, '\\$&');

    const root = this.host.getRootNode();
    const queryRoot = root instanceof ShadowRoot || root instanceof Document ? root : document;
    const matchingControlBar = queryRoot.querySelector(
      `protspace-control-bar[scatterplot-selector="${escapedSelector}"]`,
    );
    const controlBars = Array.from(queryRoot.querySelectorAll('protspace-control-bar'));
    this._controlBarElement =
      matchingControlBar ?? (controlBars.length === 1 ? controlBars[0] : null);
    if (this._controlBarElement) {
      this._controlBarElement.addEventListener(
        LEGEND_EVENTS.ANNOTATION_CHANGE,
        this._boundHandleAnnotationChange,
      );
      this._controlBarElement.addEventListener(
        LEGEND_EVENTS.PROJECTION_CHANGE,
        this._boundHandleProjectionChange,
      );
    }

    this._syncWithScatterplot();
  }

  private _setupDiscoveryObserver(): void {
    // Use MutationObserver to detect when scatterplot is added to DOM
    this._mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            // Check if the added node is the scatterplot or contains it
            if (node.matches(this.scatterplotSelector) && isScatterplotElement(node)) {
              this._onScatterplotDiscovered(node);
              return;
            }
            const found = node.querySelector(this.scatterplotSelector);
            if (found && isScatterplotElement(found)) {
              this._onScatterplotDiscovered(found);
              return;
            }
          }
        }
      }
    });

    this._mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private _scheduleDiscoveryRetry(): void {
    if (this._discoveryRetryCount >= MAX_DISCOVERY_RETRIES) {
      this._cleanupDiscovery();
      return;
    }

    this._discoveryTimeoutId = window.setTimeout(() => {
      this._discoveryRetryCount++;
      if (!this._tryDiscoverScatterplot()) {
        this._scheduleDiscoveryRetry();
      }
    }, DISCOVERY_RETRY_DELAY);
  }

  private _cleanupDiscovery(): void {
    if (this._discoveryTimeoutId !== null) {
      clearTimeout(this._discoveryTimeoutId);
      this._discoveryTimeoutId = null;
    }
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    this._discoveryRetryCount = 0;
  }

  /**
   * Name of the projection the scatterplot is showing. Statistics are scored per
   * projection, so the legend needs the name, but the scatterplot tracks position.
   * Returns '' when the index is out of range, which reads downstream as "no scores".
   */
  private _selectedProjectionName(data: ScatterplotData): string {
    const index = this._scatterplotElement?.selectedProjectionIndex ?? 0;
    return data.projections?.[index]?.name ?? '';
  }

  private _handleDataChange(event: Event): void {
    const customEvent = event as CustomEvent;
    const { data } = customEvent.detail;

    if (data && this._scatterplotElement) {
      const selectedAnnotation = this._scatterplotElement.selectedAnnotation;

      if (selectedAnnotation) {
        this.callbacks.onDataChange(data, selectedAnnotation, this._selectedProjectionName(data));
      }
    }
  }

  private _handleAnnotationChange(event: Event): void {
    const customEvent = event as CustomEvent;
    const { annotation } = customEvent.detail;
    this.callbacks.onAnnotationChange(annotation);
  }

  /**
   * Silhouette and Davies-Bouldin are scored per projection, but switching the
   * projection alone changes neither `data` nor `filteredProteinIds`/`filtersActive`,
   * so the scatterplot's own `data-change` dispatch (its geometry-inputs guard) never
   * fires for it. Re-run the sync explicitly so the strips track the new projection
   * instead of continuing to show the previous one.
   */
  private _handleProjectionChange(): void {
    this._syncWithScatterplot();
  }

  private _syncWithScatterplot(): void {
    if (!this._scatterplotElement) return;

    const currentData = this._scatterplotElement.getCurrentData();
    const selectedAnnotation = this._scatterplotElement.selectedAnnotation;

    if (!currentData || !selectedAnnotation) return;

    this.syncNumericAnnotationSettings();
    this.callbacks.onDataChange(
      currentData,
      selectedAnnotation,
      this._selectedProjectionName(currentData),
    );
  }

  private _cleanup(): void {
    // Clean up discovery mechanisms
    this._cleanupDiscovery();

    // Clean up event listeners
    if (this._scatterplotElement) {
      this._scatterplotElement.removeEventListener(
        LEGEND_EVENTS.DATA_CHANGE,
        this._boundHandleDataChange,
      );
    }
    if (this._controlBarElement) {
      this._controlBarElement.removeEventListener(
        LEGEND_EVENTS.ANNOTATION_CHANGE,
        this._boundHandleAnnotationChange,
      );
      this._controlBarElement.removeEventListener(
        LEGEND_EVENTS.PROJECTION_CHANGE,
        this._boundHandleProjectionChange,
      );
    }
  }
}
