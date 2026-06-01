import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ScatterplotData, OtherItem } from '../types';
import type { NumericAnnotationDisplaySettingsMap } from '@protspace/utils';
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

/** Maximum number of retries when looking for scatterplot element */
const MAX_DISCOVERY_RETRIES = 10;
/** Delay between retries in ms */
const DISCOVERY_RETRY_DELAY = 100;

/**
 * Callback interface for scatterplot sync events
 */
export interface ScatterplotSyncCallbacks {
  onDataChange: (data: ScatterplotData, selectedAnnotation: string) => void;
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

    return (
      Array.isArray(annotationData) &&
      annotationData.some((data) => Array.isArray(data) && data.length > 1)
    );
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
      this._scatterplotElement.hiddenAnnotationValues = [...expandedHidden];
    }

    if (supportsOtherValues(this._scatterplotElement)) {
      this._scatterplotElement.otherAnnotationValues = this.callbacks.getOtherConcreteValues();
    }
  }

  /**
   * Sync other annotation values to scatterplot
   */
  syncOtherValues(): void {
    if (!this._scatterplotElement || !supportsOtherValues(this._scatterplotElement)) return;

    this._scatterplotElement.otherAnnotationValues = this.callbacks.getOtherConcreteValues();
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
  updateConfig(updates: Record<string, unknown>): void {
    if (!this._scatterplotElement || !supportsConfig(this._scatterplotElement)) return;

    const currentConfig = this._scatterplotElement.config || {};
    const hasChanges = Object.entries(updates).some(([key, value]) => currentConfig[key] !== value);
    if (!hasChanges) return;

    this._scatterplotElement.config = { ...currentConfig, ...updates };
  }

  /**
   * Dispatch z-order change event
   */
  dispatchZOrderChange(): void {
    const zOrderMapping = buildZOrderMapping(this.callbacks.getLegendItems());

    const event = new CustomEvent(LEGEND_EVENTS.ZORDER_CHANGE, {
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

    const event = new CustomEvent(LEGEND_EVENTS.COLORMAPPING_CHANGE, {
      detail: { colorMapping, shapeMapping, colorOnly },
      bubbles: !this._scatterplotElement,
    });

    if (this._scatterplotElement) {
      this._scatterplotElement.dispatchEvent(event);
    } else {
      this.host.dispatchEvent(event);
    }
  }

  /**
   * Get isolation mode state from scatterplot
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

  private _handleDataChange(event: Event): void {
    const customEvent = event as CustomEvent;
    const { data } = customEvent.detail;

    if (data && this._scatterplotElement) {
      const selectedAnnotation = this._scatterplotElement.selectedAnnotation;

      if (selectedAnnotation) {
        this.callbacks.onDataChange(data, selectedAnnotation);
      }
    }
  }

  private _handleAnnotationChange(event: Event): void {
    const customEvent = event as CustomEvent;
    const { annotation } = customEvent.detail;
    this.callbacks.onAnnotationChange(annotation);
  }

  private _syncWithScatterplot(): void {
    if (!this._scatterplotElement) return;

    const currentData = this._scatterplotElement.getCurrentData();
    const selectedAnnotation = this._scatterplotElement.selectedAnnotation;

    if (!currentData || !selectedAnnotation) return;

    this.syncNumericAnnotationSettings();
    this.callbacks.onDataChange(currentData, selectedAnnotation);
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
    }
  }
}
