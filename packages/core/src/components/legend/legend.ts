import { LitElement, html, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import {
  DEFAULT_CATEGORICAL_PALETTE_ID,
  isNumericAnnotation,
  annotationLabel,
  isPredictedAnnotation,
  getAnnotationMeta,
  type NumericAnnotationDisplaySettingsMap,
  type EatReliabilityState,
  type CategoryScore,
} from '@protspace/utils';
import type { AnnotationData, LegendSettingsMap } from '@protspace/utils';

// Configuration and styles
import { LEGEND_DEFAULTS, LEGEND_STYLES, LEGEND_VALUES, LEGEND_EVENTS } from './config';

import { legendStyles } from './legend.styles';
import '../common/info-popover';

// Controllers
import {
  ScatterplotSyncController,
  PersistenceController,
  DragController,
  LegendDataController,
  ItemActionsController,
  ReorderController,
  SettingsController,
} from './controllers';

// Processors and renderers
import { createProcessorContext, type LegendProcessorContext } from './legend-data-processor';
import {
  renderLegendHeader,
  renderSortMenu,
  type LegendHeaderHandlers,
  type LegendHeaderModel,
  type SortMenuModel,
} from './legend-header';
import { renderLegendRow, type LegendRowHandlers, type LegendRowView } from './legend-row';
import { LegendKeyboardController, renderLegendList, TruncatedNameTooltip } from './legend-list';
import { ColorPickerController } from './legend-color-picker';
import { LegendRowMenu } from './legend-row-menu';
import { OtherPopoverControl } from './legend-other-control';
import './legend-settings-popover';
import type { ProtspaceLegendSettingsPopover } from './legend-settings-popover';
import {
  deriveStripPoints,
  EMPTY_STRIP_POINTS,
  renderScoreStrips,
  type ScoreStripsHandlers,
  type ScoreStripsView,
  type StripPoints,
} from './legend-score-strips';

// Helpers
import {
  calculatePointSize,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  computeOtherConcreteValues,
} from './legend-helpers';
import { sortItemsForDisplay } from './legend-items-state';

import { createLegendErrorEventDetail } from './legend.events';

// Types
import type {
  LegendDataInput,
  LegendAnnotationData,
  LegendItem,
  LegendSortMode,
  OtherItem,
  LegendErrorEventDetail,
  LegendErrorSource,
} from './types';

/**
 * Legend component for displaying and interacting with annotation categories.
 *
 * @fires legend-item-click - When a legend item is clicked (toggled, isolated, extracted, or merged)
 * @fires legend-zorder-change - When the z-order of legend items changes
 * @fires legend-colormapping-change - When color/shape mappings change
 * @fires legend-customize - When the settings popover is opened
 * @fires legend-download - When download is requested
 * @fires legend-error - When an error occurs during data processing, persistence, or syncing
 * @fires eat-panel-open - When the EAT note's `EAT ›` link is clicked (bubbles, composed)
 *
 * @csspart container - The main legend container
 * @csspart row-handle - A row's reorder handle
 * @csspart row-menu - A row's "More actions" button
 *
 * @slot - Default slot for custom content
 */
@customElement('protspace-legend')
export class ProtspaceLegend extends LitElement {
  static styles = legendStyles;

  // ─────────────────────────────────────────────────────────────────
  // Public Properties (reflected to attributes where appropriate)
  // ─────────────────────────────────────────────────────────────────

  @property({ type: String }) annotationName = '';
  @property({ type: Object }) annotationData: LegendAnnotationData = { name: '', values: [] };
  /** One value per protein, in `proteinIds` order; read only when no data is synced. */
  @property({ type: Array }) annotationValues: (string | null)[] = [];
  @property({ type: Array }) proteinIds: string[] = [];
  @property({ type: Number, reflect: true }) maxVisibleValues: number =
    LEGEND_DEFAULTS.maxVisibleValues;
  @property({ type: Array }) selectedItems: string[] = [];
  @property({ type: Boolean, reflect: true }) isolationMode = false;
  @property({ type: Array }) isolationHistory: string[][] = [];
  @property({ type: Object }) data: LegendDataInput | null = null;
  @property({ type: String, reflect: true }) selectedAnnotation = '';
  @property({ type: Number, reflect: true }) shapeSize: number = LEGEND_DEFAULTS.symbolSize;

  @property({ type: String, attribute: 'scatterplot-selector' })
  scatterplotSelector: string = LEGEND_DEFAULTS.scatterplotSelector;

  /**
   * Off while the host drives the legend, as the app does during a dataset load. The legend
   * follows the scatterplot either way: its sync controller subscribes on connect. While off,
   * it counts in protein order, the order a host's per-protein `annotationValues` feed has.
   */
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;

  @property({ type: Boolean, attribute: 'auto-hide' })
  autoHide: boolean = true;

  /**
   * The EAT panel's reliability filter, for the one-line EAT note under the title
   * (`Includes 659 predicted · Filtered ≥ 50 %`); null or unconstrained says nothing about it.
   */
  @property({ attribute: false }) eatReliability: EatReliabilityState | null = null;

  // ─────────────────────────────────────────────────────────────────
  // Internal State
  // ─────────────────────────────────────────────────────────────────

  @state() private _statusMessage = '';
  /**
   * Category under the pointer, from a legend row or from a score strip. Read by
   * `_renderLegendItem` (the row's `legend-item-score-hover` class) and by `_renderScoreStrips`
   * (each strip's `highlighted` binding), so a hover in either place lights up both.
   */
  @state() private _hoveredCategory: string | null = null;

  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;

  // ─────────────────────────────────────────────────────────────────
  // Read and written by the legend's controllers (controllers/*); not public API.
  // ─────────────────────────────────────────────────────────────────

  @state() _legendItems: LegendItem[] = [];
  @state() _sortedLegendItems: LegendItem[] = [];
  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() _sortMenu: HTMLElement | null = null;
  /** The settings button while the settings popover is open under it (design decision 12). */
  @state() _settingsAnchor: HTMLElement | null = null;
  @query('protspace-legend-settings-popover')
  _settingsPopover?: ProtspaceLegendSettingsPopover;
  @state() _otherItems: OtherItem[] = [];
  @state() _hiddenValues: string[] = [];
  @state() _annotationSortModes: Record<string, LegendSortMode> = {};
  _preIsolationVisibleValues: Set<string> = new Set();
  /**
   * "Show duplicate counts and spread overlaps" for the selected annotation. Live state: the
   * stored record reads it, so an unrelated save never writes false over a stored true.
   */
  @state() _enableDuplicateStackUI = false;
  @state() _selectedPaletteId: string = DEFAULT_CATEGORICAL_PALETTE_ID;
  @state() _numericSettingsByAnnotation: NumericAnnotationDisplaySettingsMap = {};
  @state() _numericManualOrderIdsByAnnotation: Record<string, string[]> = {};
  /** Predictions of the selected annotation in the whole dataset while Show is on; else null. */
  @state() _eatPredicted: number | null = null;
  @state() _categoryScores: CategoryScore[] = [];
  /**
   * Whether the current annotation is one of the backend's auto-clustering membership
   * columns, whose separation scores are optimistic by construction. Derived alongside
   * `_categoryScores` because both need `statisticsRows`, which render time does not see.
   */
  @state() _clusterCaveat: string | null = null;
  /**
   * The annotation storage the legend counts from, captured on every scatterplot
   * data change. Counting straight out of it (`countFromStorage`) replaces the
   * flat `annotationValues` array, which cost one interned string per protein
   * and misaligned isolation filtering. `null` means "no synced storage": a host
   * that feeds the public `annotationValues` property instead.
   */
  _countSource: {
    colData: AnnotationData;
    values: (string | null)[];
    proteinCount: number;
  } | null = null;

  // Pending extract/merge values for next update cycle.
  // undefined = no pending operation, string = value to extract/merge (including '__NA__' for N/A)
  _pendingExtractValue: string | undefined = undefined;
  _pendingMergeValue: string | undefined = undefined;

  /**
   * Protein count of the whole dataset, taken with its hash in `updated()` from the same
   * unfiltered data, so a filter, an isolation or hidden categories never change it. It sets
   * the default shape size.
   */
  _datasetProteinCount = 0;

  /**
   * The selected annotation's own shape size from a bundle or browser storage, or null when it
   * holds a filler. Its persisted record keeps this, never the live size, so neither a picked
   * size nor the computed default is ever stored or exported as the annotation's own.
   */
  _annotationShapeSize: number | null = null;

  // Instance-specific processor context (avoids global state conflicts)
  _processorContext: LegendProcessorContext = createProcessorContext();

  _announceManualPromotionOnNextReorder = false;
  /**
   * The last press on a row: older Safari sends clicks with no pointer type, so a row click
   * (`ItemActionsController.rowClick`) takes it from here.
   */
  _lastRowPointerDown: { pointerType: string; time: number } | null = null;

  /** The selected annotation's display name, never its key (decision 15). */
  get _annotationDisplayName(): string {
    const name = this.selectedAnnotation;
    return name ? annotationLabel(name, this.data?.annotations?.[name] ?? this.annotationData) : '';
  }

  /** `autoSync` is off; its doc lists what that changes. */
  get _hostDriven(): boolean {
    return !this.autoSync;
  }

  get _currentSortMode(): LegendSortMode {
    return this._data.normalizeSortMode(
      this.selectedAnnotation,
      this._annotationSortModes[this.selectedAnnotation],
    );
  }

  /**
   * Get the set of currently visible values (from legend items, excluding "Other").
   * Used to preserve membership when sort mode changes.
   * N/A items use '__NA__' as their value.
   */
  get _visibleValues(): Set<string> {
    const visible = new Set<string>();

    // Collect visible values from current _legendItems (excluding "Other")
    if (this._legendItems.length > 0) {
      this._legendItems.forEach((item) => {
        if (item.value !== LEGEND_VALUES.OTHER) {
          visible.add(item.value);
        }
      });
    }

    // If visible is empty but we have pendingCategories, use those instead.
    // This handles the case where _legendItems only has "Other" during restore.
    if (visible.size === 0) {
      const pendingCategories = this._persistenceController.pendingCategories;
      if (Object.keys(pendingCategories).length > 0) {
        for (const key of Object.keys(pendingCategories)) {
          if (key !== LEGEND_VALUES.OTHER) {
            visible.add(key);
          }
        }
      }
    }

    return visible;
  }

  /**
   * The one entry to the item pass. `LegendDataController.updateItems` has no other caller, so
   * `perfCounters.legendUpdate` counts exactly these calls, the ones tests spy on and replace.
   */
  _updateLegendItems(): void {
    this._data.updateItems();
  }

  _isNumericAnnotation(): boolean {
    return isNumericAnnotation(this.annotationData);
  }

  _isCurrentAnnotationNumeric(): boolean {
    const sourceAnnotation =
      this._scatterplotController.scatterplot?.data?.annotations?.[this.selectedAnnotation];
    return isNumericAnnotation(sourceAnnotation) || this._isNumericAnnotation();
  }

  /** Closes the annotation's own overlays, landing their pending edits on it first. */
  _closeAnnotationOverlays(): void {
    this._settings.close();
    this._colorPicker.close();
  }

  _dispatchItemAction(value: string, action: 'toggle' | 'isolate' | 'extract'): void {
    this.dispatchEvent(createItemActionEvent(LEGEND_EVENTS.ITEM_CLICK, value, action));
  }

  _announceStatus(message: string): void {
    this._statusMessage = message;
    // Clear after announcement to allow repeated messages
    setTimeout(() => {
      this._statusMessage = '';
    }, 1000);
  }

  _dispatchError(message: string, source: LegendErrorSource, originalError?: Error): void {
    const detail: LegendErrorEventDetail = createLegendErrorEventDetail(message, source, {
      annotation: this.selectedAnnotation || undefined,
      originalError,
    });
    this.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.ERROR, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    console.error(`[protspace-legend] ${source}: ${message}`, originalError);
  }

  // ─────────────────────────────────────────────────────────────────
  // Controllers (a field without `private` is read by controllers/* or by tests; not public API)
  // ─────────────────────────────────────────────────────────────────

  /** The data pipeline (controllers/data-controller.ts); the callbacks below call it. */
  readonly _data = new LegendDataController(this);
  /** Row, Other and sort-menu actions (controllers/item-actions-controller.ts). */
  readonly _actions = new ItemActionsController(this);
  /** Keyboard reorder and what a drag commits (controllers/reorder-controller.ts). */
  readonly _reorder = new ReorderController(this);
  /** Settings popover, live edits, picker commits (controllers/settings-controller.ts). */
  readonly _settings = new SettingsController(this);

  _scatterplotController = new ScatterplotSyncController(this, {
    onDataChange: (data, annotation, projectionName) =>
      this._data.onDataChange(data, annotation, projectionName),
    onAnnotationChange: (annotation) => this._data.onAnnotationChange(annotation),
    getHiddenValues: () => this._hiddenValues,
    getOtherItems: () => this._otherItems,
    getLegendItems: () => this._legendItems,
    getOtherConcreteValues: () => computeOtherConcreteValues(this._otherItems),
    getAutoHide: () => this.autoHide,
    getNumericAnnotationSettings: () => this._numericSettingsByAnnotation,
    getAnnotationSortModes: () => this._annotationSortModes,
    getNumericManualOrderIds: () => this._numericManualOrderIdsByAnnotation,
  });

  _persistenceController = new PersistenceController(this, {
    onSettingsLoaded: (settings) => this._data.applyPersistedSettings(settings),
    getLegendItems: () => this._legendItems,
    getHiddenValues: () => this._hiddenValues,
    shouldPersistCategories: () => !this._isCurrentAnnotationNumeric(),
    shouldPersistCategoryEncodings: () => !this._isCurrentAnnotationNumeric(),
    isNumericAnnotation: () => this._isCurrentAnnotationNumeric(),
    getCurrentSettings: () => this._data.currentSettings(),
  });

  private _dragController = new DragController(this, {
    getLegendItems: () => this._legendItems,
    setLegendItems: (items) => this._reorder.setItemsFromDrag(items),
    onReorder: () => {
      this._scatterplotController.dispatchZOrderChange();
      this._persistenceController.saveSettings();
    },
    onMergeToOther: (value) => this._actions.mergeToOther(value),
    onSortModeChange: (mode) => this._reorder.onDragSortModeChange(mode),
    onDropComplete: (value) => this._actions.highlightDropped(value),
  });

  private _headerHandlers: LegendHeaderHandlers = {
    onSortMenu: (anchor) => {
      this._sortMenu = this._sortMenu ? null : anchor;
    },
    onSettings: (anchor) => this._settings.toggle(anchor),
    onTitlePointerEnter: (e) => {
      const title = e.currentTarget as HTMLElement;
      this._nameTooltip.hover(title, title);
    },
    onEatOpen: () =>
      this.dispatchEvent(new CustomEvent('eat-panel-open', { bubbles: true, composed: true })),
  };

  private _sortMenuHandlers: Parameters<typeof renderSortMenu>[1] = {
    onPick: (mode) => this._actions.applySortMode(mode),
    onReverse: () => this._actions.toggleOrderDirection(),
    onClose: () => {
      this._sortMenu = null;
    },
  };

  _colorPicker = new ColorPickerController(this, {
    getItem: (value) => this._legendItems.find((item) => item.value === value),
    preview: (value, color) => this._settings.previewColor(value, color),
    commitColor: (value, color) => this._settings.commitColor(value, color),
    commitShape: (value, shape) => this._settings.commitShape(value, shape),
    isMultilabel: () => this._isMultilabelAnnotation(),
  });

  _keyboard = new LegendKeyboardController(this, {
    getSortedItems: () => this._sortedLegendItems,
    canDrag: (item) => this._canDragLegendItem(item),
    toggle: (value) => this._actions.toggle(value),
    isolate: (value) => this._actions.isolate(value),
    snapshot: () => this._reorder.snapshot(),
    restore: (snapshot) => this._reorder.restore(snapshot),
    move: (value, direction) => this._reorder.move(value, direction),
    announce: (message) => this._announceStatus(message),
    annotationName: () => this._annotationDisplayName,
  });

  private _nameTooltip = new TruncatedNameTooltip(this);

  _rowMenu = new LegendRowMenu(this, {
    getItems: () => this._legendItems,
    isNumeric: () => this._isNumericAnnotation(),
    isolate: (value) => this._actions.isolate(value),
    customize: (value) => {
      // Found by its dataset rather than a selector: a value can hold any character.
      const row = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.legend-item') ?? [])].find(
        (each) => each.dataset.value === value,
      );
      // Opening is idempotent: chosen again for the row whose picker is open, it stays open.
      if (row) this._colorPicker.open(value, row);
    },
  });

  _otherPopover = new OtherPopoverControl(this, {
    getItems: () => this._otherItems,
    add: (value) => this._actions.extractFromOther(value),
    addAll: () => this._actions.extractAllFromOther(),
    focusFirstRow: () => this._keyboard.focusItem(0),
  });

  private _canDragLegendItem(item: LegendItem): boolean {
    return item.value !== LEGEND_VALUES.OTHER;
  }

  // ─────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────

  connectedCallback(): void {
    super.connectedCallback();
    this._scatterplotController.scatterplotSelector = this.scatterplotSelector;
  }

  updated(changedProperties: Map<string, unknown>): void {
    // Update dataset hash when protein IDs change.
    // Skip during isolation mode: isolation filters protein IDs to a subset,
    // which would produce a different hash and cause settings (maxVisibleValues,
    // sort order, z-order) to be reset to defaults. Keep the full dataset hash
    // so persisted settings are preserved across isolation transitions.
    if (
      (changedProperties.has('proteinIds') || changedProperties.has('data')) &&
      this.proteinIds.length > 0 &&
      !this.isolationMode
    ) {
      const sourceData = this._scatterplotController.scatterplot?.data;
      const sourceDataMatchesCurrentLegend =
        sourceData?.protein_ids !== undefined &&
        this._hasSameProteinIds(sourceData.protein_ids, this.proteinIds);
      // Hashed whole, EAT predictions included, as a host hashes the dataset for
      // `clearForNewDataset`, `setFileSettings` and `applyShapeSize`, so both use one key set.
      const unfilteredData = sourceDataMatchesCurrentLegend
        ? sourceData
        : { ...this.data, protein_ids: this.proteinIds };

      this._datasetProteinCount = unfilteredData.protein_ids.length;
      this._persistenceController.updateDatasetHash(unfilteredData);
    }

    // Handle data or annotation changes
    if (changedProperties.has('data') || changedProperties.has('selectedAnnotation')) {
      this._data.refreshAnnotationData();
      this._data.ensureSortModeDefaults();

      const annotationChanged = this._persistenceController.updateSelectedAnnotation(
        this.selectedAnnotation,
      );
      if (annotationChanged || !this._persistenceController.settingsLoaded) {
        // Clear legend items before loading settings so _visibleValues falls back to pendingCategories
        if (annotationChanged) {
          this._legendItems = [];
        }
        this._persistenceController.loadSettings();
      }

      this._data.syncNumericSettingsFromPersistence();
    }

    // An externally fed annotationValues array is the source of truth while it is
    // being fed, so it drops any storage captured by an earlier sync. Only a
    // non-empty assignment counts: Lit reports the declared `= []` initializer as a
    // change on the very first update, which would otherwise discard the storage the
    // sync just captured. Clearing is `clearAllState`'s job.
    if (changedProperties.has('annotationValues') && this.annotationValues.length > 0) {
      this._countSource = null;
    }

    // Update legend items when relevant properties change
    if (
      changedProperties.has('data') ||
      changedProperties.has('selectedAnnotation') ||
      changedProperties.has('annotationValues') ||
      changedProperties.has('proteinIds') ||
      changedProperties.has('maxVisibleValues') ||
      changedProperties.has('isolationMode') ||
      changedProperties.has('isolationHistory')
    ) {
      this._data.rebuildItems();
    }

    // Initialize Sortable when container becomes available
    // The controller handles preventing duplicate initialization
    if (this._legendItemsEl && this._sortedLegendItems.length > 0) {
      this._dragController.initialize(this._legendItemsEl, true);
    }
    this._otherPopover.updated();
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Force synchronization with scatterplot
   */
  public forceSync(): void {
    this._scatterplotController.forceSync();
  }

  /**
   * Get legend data for export (PNG/PDF)
   */
  public getLegendExportData(): {
    annotation: string;
    otherItemsCount: number;
    items: LegendItem[];
  } {
    return {
      annotation: this.annotationData.name || this.annotationName || 'Legend',
      otherItemsCount: this._otherItems.length,
      items: this._sortedLegendItems.map((i) => ({ ...i })),
    };
  }

  /**
   * Download legend as image
   */
  public async downloadAsImage(): Promise<void> {
    this.dispatchEvent(new CustomEvent(LEGEND_EVENTS.DOWNLOAD, { bubbles: true, composed: true }));
  }

  // ─────────────────────────────────────────────────────────────────
  // File-based Persistence (parquetbundle export/import)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all annotation settings for export to a parquetbundle.
   * Returns settings for all annotations that have been configured.
   *
   * @returns Record mapping annotation names to their persisted settings
   */
  public getAllPersistedSettings(): LegendSettingsMap {
    const annotationNames = Object.keys(this.data?.annotations ?? {});
    return this._persistenceController.getAllSettingsForExport(annotationNames);
  }

  /**
   * Set file-based settings loaded from a parquetbundle.
   * These will be applied when switching to annotations that have settings.
   * Also persists all settings to localStorage so they're available for future exports.
   *
   * @param settings - All annotation settings from the file, or null to clear
   * @param datasetHash - Optional dataset hash for localStorage keys (required when
   *                      the component's hash isn't yet computed from the new data)
   */
  public setFileSettings(
    settings: LegendSettingsMap | null,
    datasetHash?: string,
    clearExistingStorage: boolean = true,
  ): void {
    this._persistenceController.setFileSettings(settings, datasetHash, clearExistingStorage);

    // If current annotation has file settings, reload and apply them immediately
    if (settings?.[this.selectedAnnotation]) {
      this._persistenceController.loadSettings();
      // Clear stale legend items so _visibleValues falls back to _pendingCategories
      // (the file's category set). Without this, _visibleValues uses the default items
      // built during loadNewData(), which may have a different visible set than the file.
      this._legendItems = [];
      this._data.rebuildItems();
    }
  }

  /**
   * Clear all legend state in preparation for loading a new dataset.
   * This should be called before setting new data to ensure a clean slate.
   *
   * @param datasetHash - The hash of the NEW dataset (used to clear its localStorage entries)
   */
  public clearForNewDataset(datasetHash: string, clearPersistedState: boolean = true): void {
    // A value typed into the settings popover belongs to the dataset it was typed for.
    this._settings.close();
    // A colour still waiting for its delay lands on the dataset it was picked on, not the next one.
    this._colorPicker.close();

    // Reset visual encoding state
    this._processorContext.slotTracker.reset();

    // Clear legend items and related state
    this._legendItems = [];
    this._sortedLegendItems = [];
    this._otherItems = [];
    this._hiddenValues = [];

    // Clear persistence state for the new dataset
    this._persistenceController.clearForNewDataset(datasetHash, clearPersistedState);
    // The previous dataset's count and annotation size must not size the new one before
    // `updated()` takes its hash.
    this._datasetProteinCount = 0;
    this._annotationShapeSize = null;

    // Reset UI state
    this._enableDuplicateStackUI = false;
    this._sortMenu = null;
    this._otherPopover.close();
    this._selectedPaletteId = DEFAULT_CATEGORICAL_PALETTE_ID;
    this._numericSettingsByAnnotation = {};
    this._numericManualOrderIdsByAnnotation = {};
    this._eatPredicted = null;
    this._reorder.clear();

    // Reset isolation state
    this.isolationMode = false;
    this.isolationHistory = [];
    this._preIsolationVisibleValues = new Set();

    // Clear data properties
    this.data = null;
    this.selectedAnnotation = '';
    this.annotationData = { name: '', values: [] };
    this.annotationValues = [];
    this._countSource = null;
    this.proteinIds = [];

    this.requestUpdate();
  }

  /**
   * Check if file-based settings are currently loaded.
   */
  public get hasFileSettings(): boolean {
    return this._persistenceController.hasFileSettings;
  }

  /**
   * Check if file settings exist for a specific annotation.
   */
  public hasFileSettingsForAnnotation(annotation: string): boolean {
    return this._persistenceController.hasFileSettingsForAnnotation(annotation);
  }

  // ─────────────────────────────────────────────────────────────────
  // Data Handling
  // ─────────────────────────────────────────────────────────────────

  /**
   * Apply a bundle's dataset-level shape size. `datasetHash` is for when the
   * component's own hash is not computed from the new data yet.
   */
  public applyShapeSize(shapeSize: number, datasetHash?: string): void {
    const size = Math.min(shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
    this._persistenceController.saveShapeSize(size, datasetHash);
    this.shapeSize = size;
    this._scatterplotController.updateConfig({ pointSize: calculatePointSize(size) });
  }

  /**
   * The dataset-level shape size, or undefined while none has been picked (nor
   * applied from a bundle). A bundle writes only this, so a size merely seeded
   * from one annotation's settings is never promoted to every annotation.
   */
  public get pickedShapeSize(): number | undefined {
    return this._persistenceController.loadShapeSize() ?? undefined;
  }

  /**
   * Shows every category again: the status corner's "N categories hidden" ✕. Like the
   * double-click that restores the full set, it syncs the plot, stores the settings and announces
   * it, without a `legend-item-click`.
   */
  public showAllCategories(): void {
    if (this._hiddenValues.length === 0) return;
    this._legendItems = this._legendItems.map((item) =>
      item.isVisible ? item : { ...item, isVisible: true },
    );
    this._hiddenValues = [];
    this._announceStatus('All items shown');
    this._scatterplotController.syncHiddenValues();
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  private _isMultilabelAnnotation(): boolean {
    return this._scatterplotController.isMultilabelAnnotation(this.selectedAnnotation);
  }

  private _hasSameProteinIds(left: readonly string[], right: readonly string[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;

    return left.every((proteinId, index) => proteinId === right[index]);
  }

  // ─────────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────────

  render() {
    const activeName = this.annotationName || this.annotationData.name || '';
    const activeAnnotation = activeName
      ? (this.data?.annotations?.[activeName] ?? this.annotationData)
      : undefined;
    const title = activeName ? annotationLabel(activeName, activeAnnotation) : 'Legend';
    const predicted = activeName ? isPredictedAnnotation(activeName) : false;
    const meta = activeName ? getAnnotationMeta(activeName, activeAnnotation) : undefined;
    const hasDocs = !!meta && (meta.description.length > 0 || !!meta.docsUrl);
    const info =
      meta && hasDocs
        ? html`<protspace-info-popover
            .description=${meta.description}
            docs-url=${meta.docsUrl ?? ''}
            label=${title}
          ></protspace-info-popover>`
        : undefined;

    return html`
      <div class="legend-container" part="container">
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          ${this._statusMessage}
        </div>
        ${renderLegendHeader(this._headerModel(title, predicted, info), this._headerHandlers)}
        ${this._renderScoreStrips()}
        ${renderLegendList(this._sortedLegendItems, (item, index) =>
          this._renderLegendItem(item, index),
        )}
        ${this._colorPicker.render()} ${this._rowMenu.render()} ${this._nameTooltip.render()}
        ${this._renderSortMenu()} ${this._otherPopover.render()} ${this._settings.render(title)}
      </div>
    `;
  }

  private _headerModel(
    title: string,
    predicted: boolean,
    info: TemplateResult | undefined,
  ): LegendHeaderModel {
    return {
      title,
      predicted,
      info,
      sortMode: this._currentSortMode,
      isNumeric: this._isNumericAnnotation(),
      hasScores: this._categoryScores.length > 0,
      canSort: this._legendItems.length > 1,
      settingsOpen: this._settingsAnchor !== null,
      eat:
        this._eatPredicted === null
          ? undefined
          : { predicted: this._eatPredicted, reliability: this.eatReliability },
    };
  }

  private _renderSortMenu() {
    const model: SortMenuModel = {
      open: this._sortMenu !== null,
      anchor: this._sortMenu,
      sortMode: this._currentSortMode,
      isNumeric: this._isNumericAnnotation(),
      hasScores: this._categoryScores.length > 0,
    };
    return renderSortMenu(model, this._sortMenuHandlers);
  }

  private _setHoveredCategory(category: string | null): void {
    // Nothing reads the hover when there are no scores: `_renderScoreStrips` returns before
    // the `highlighted` binding and `_renderLegendItem` gates its class on the same emptiness.
    // Assigning null over null is a no-op for Lit, so a stats-less dataset stops re-rendering
    // the whole legend on every row the pointer crosses, while a stale highlight still clears
    // if the scores go away mid-hover.
    this._hoveredCategory = this._categoryScores.length === 0 ? null : category;
  }

  /**
   * Strip geometry, derived in `willUpdate` rather than in render: it depends only on the legend
   * items and the scores, while the most frequent cause of a legend re-render is a hover, which
   * changes neither. A plain field, not `@state`: it is computed before render from properties
   * that are already reactive, so making it reactive would only add a second update cycle.
   * Written in `willUpdate` and not `updated()` for the same reason -- after render it would
   * paint one cycle stale.
   */
  private _stripPoints: StripPoints = EMPTY_STRIP_POINTS;

  /**
   * A hover on a strip lights its row; a click on a dot toggles its category, but only one that
   * is a legend row: a category grouped under Other has no row to hide.
   */
  private _scoreStripHandlers: ScoreStripsHandlers = {
    onHover: (category) => this._setHoveredCategory(category),
    onToggle: (category) => {
      if (this._legendItems.some((item) => item.value === category)) {
        this._actions.toggle(category);
      }
    },
  };

  protected willUpdate(changedProperties: Map<string, unknown>): void {
    // One row has nothing to order: the sort button hides, so its menu closes too.
    if (this._sortMenu && this._legendItems.length <= 1) this._sortMenu = null;
    // Derived before render, so a change to the items renders the rows once, in their new order.
    if (changedProperties.has('_legendItems') || changedProperties.has('_categoryScores')) {
      this._sortedLegendItems = sortItemsForDisplay(
        this._legendItems,
        this._currentSortMode,
        this._categoryScores,
      );
      this._stripPoints = deriveStripPoints(this._legendItems, this._categoryScores);
    }
    // Rows render by position, so after a re-sort the menu's anchor would be another row's "⋯".
    if (changedProperties.has('_sortedLegendItems')) this._rowMenu.close();
    this._otherPopover.willUpdate(
      changedProperties.has('_otherItems'),
      changedProperties.has('selectedAnnotation'),
    );
    // Settings and the picker are the annotation's own: a new one closes them. The sync paths
    // flushed first; set from outside, an edit for the old annotation is dropped, not moved.
    if (changedProperties.has('selectedAnnotation')) {
      this._settingsPopover?.cancel();
      this._settingsAnchor = null;
      this._colorPicker.dismiss();
    }
  }

  private _renderScoreStrips() {
    const view: ScoreStripsView = {
      hasScores: this._categoryScores.length > 0,
      // Gated on the live filter/isolation state directly, which is the actual question -- the
      // scores themselves are read from the unsliced dataset (see `LegendDataController.onDataChange`)
      // and so stay available for sorting.
      filtered:
        this.isolationMode || Boolean(this._scatterplotController.scatterplot?.filtersActive),
      points: this._stripPoints,
      highlighted: this._hoveredCategory,
      clusterCaveat: this._clusterCaveat,
    };
    return renderScoreStrips(view, this._scoreStripHandlers);
  }

  private _renderLegendItem(item: LegendItem, sortedIndex: number) {
    const selected = isItemSelected(item, this.selectedItems);
    const picked = this._keyboard.pickedValue === item.value;
    const isOther = item.value === LEGEND_VALUES.OTHER;
    const classes = `${getItemClasses(item, selected, picked)}${
      this._categoryScores.length > 0 && item.value === this._hoveredCategory
        ? ' legend-item-score-hover'
        : ''
    }`;

    const view: LegendRowView = {
      classes,
      symbolSize: LEGEND_STYLES.legendDisplaySize,
      otherCount: isOther ? this._otherItems.length : undefined,
      tabbable: this._keyboard.isTabbable(item.value),
      draggable: this._canDragLegendItem(item),
      picked,
      hasMenu: !isOther,
      otherExpanded: isOther && this._otherPopover.isOpen,
    };
    const handlers: LegendRowHandlers = {
      onClick: (e: MouseEvent) => this._actions.rowClick(item.value, e),
      onDoubleClick: () => this._actions.rowDoubleClick(item.value),
      onKeyDown: (e: KeyboardEvent) => this._keyboard.onItemKeyDown(e, item, sortedIndex),
      onHandleKeyDown: (e: KeyboardEvent) => this._keyboard.onHandleKeyDown(e, item),
      onHover: (category) => this._setHoveredCategory(category),
      onFocus: () => {
        this._keyboard.focusValue = item.value;
      },
      onToggle: () => this._actions.toggle(item.value),
      onMenu: (e: MouseEvent) => this._rowMenu.toggle(item.value, e.currentTarget as HTMLElement),
      onViewOther: (e: Event) => this._otherPopover.toggle(e),
      onNamePointerEnter: this._nameTooltip.onNamePointerEnter,
      onPointerDown: (e: PointerEvent) => {
        this._lastRowPointerDown = { pointerType: e.pointerType, time: e.timeStamp };
        this._nameTooltip.onNamePointerDown(e);
      },
    };
    return renderLegendRow(item, view, handlers);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend': ProtspaceLegend;
  }
}
