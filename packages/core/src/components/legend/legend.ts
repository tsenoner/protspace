import { LitElement, html, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  isNumericAnnotation,
  normalizeNumericPaletteId,
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  isPredictedAnnotation,
  getAnnotationMeta,
  type NumericAnnotationDisplaySettingsMap,
  type EatReliabilityState,
  type CategoryScore,
} from '@protspace/utils';
import type { AnnotationData, LegendSettingsMap } from '@protspace/utils';

// Configuration and styles
import { LEGEND_DEFAULTS, LEGEND_STYLES, LEGEND_VALUES, LEGEND_EVENTS } from './config';

import type { PointShape } from '@protspace/utils';
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
  defaultShapeSize,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  computeOtherConcreteValues,
} from './legend-helpers';
import type { EatPopulationCounts } from './eat-population-counts';
import {
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  sortItemsForDisplay,
} from './legend-items-state';

import { createLegendErrorEventDetail } from './legend.events';
import {
  EatReliabilityController,
  renderEatSection,
  type EatControlsOptions,
  type EatOverlayChangeDetail,
} from './legend-eat-controls';

// Types
import type {
  LegendDataInput,
  LegendAnnotationData,
  LegendItem,
  LegendSortMode,
  OtherItem,
  PersistedCategoryData,
  LegendErrorEventDetail,
  LegendErrorSource,
  LegendDisplaySettings,
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
   * it counts in protein order, the order a host's per-protein `annotationValues` feed has, and
   * leaves the EAT overlay switch for the host to apply to the plot.
   */
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;

  @property({ type: Boolean, attribute: 'auto-hide' })
  autoHide: boolean = true;

  // ─────────────────────────────────────────────────────────────────
  // Internal State
  // ─────────────────────────────────────────────────────────────────

  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() private _sortMenu: HTMLElement | null = null;
  /** The settings button while the settings popover is open under it (design decision 12). */
  @state() private _settingsAnchor: HTMLElement | null = null;
  @state() private _statusMessage = '';
  /**
   * Category under the pointer, from a legend row or from a score strip. Read by
   * `_renderLegendItem` (the row's `legend-item-score-hover` class) and by `_renderScoreStrips`
   * (each strip's `highlighted` binding), so a hover in either place lights up both.
   */
  @state() private _hoveredCategory: string | null = null;

  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;

  @query('protspace-legend-settings-popover')
  private _settingsPopover?: ProtspaceLegendSettingsPopover;

  // ─────────────────────────────────────────────────────────────────
  // Read and written by the legend's controllers (controllers/*); not public API.
  // ─────────────────────────────────────────────────────────────────

  @state() _legendItems: LegendItem[] = [];
  @state() _sortedLegendItems: LegendItem[] = [];
  @state() _otherItems: OtherItem[] = [];
  @state() _hiddenValues: string[] = [];
  @state() _annotationSortModes: Record<string, LegendSortMode> = {};
  _preIsolationVisibleValues: Set<string> = new Set();
  /**
   * "Show duplicate counts and spread overlaps" for the selected annotation. Live state: the
   * stored record reads it, so an unrelated save never writes false over a stored true.
   */
  @state() _enableDuplicateStackUI = false;
  @state() _selectedPaletteId = 'kellys';
  @state() _numericSettingsByAnnotation: NumericAnnotationDisplaySettingsMap = {};
  @state() _numericManualOrderIdsByAnnotation: Record<string, string[]> = {};
  @state() _eatCounts: EatPopulationCounts | null = null;
  @state() _categoryScores: CategoryScore[] = [];
  /**
   * Whether the current annotation is one of the backend's auto-clustering membership
   * columns, whose separation scores are optimistic by construction. Derived alongside
   * `_categoryScores` because both need `statisticsRows`, which render time does not see.
   */
  @state() _isClusterAnnotation = false;
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
    this._closeSettings();
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
  // Controllers (a field without `private` is read by controllers/* too; not public API)
  // ─────────────────────────────────────────────────────────────────

  /** The data pipeline (controllers/data-controller.ts); the callbacks below call it. */
  readonly _data = new LegendDataController(this);
  /** Row, Other and sort-menu actions (controllers/item-actions-controller.ts). */
  readonly _actions = new ItemActionsController(this);
  /** Keyboard reorder and what a drag commits (controllers/reorder-controller.ts). */
  readonly _reorder = new ReorderController(this);

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
    onSettings: (anchor) => this._openSettings(anchor),
    onTitlePointerEnter: (e) => {
      const title = e.currentTarget as HTMLElement;
      this._nameTooltip.hover(title, title);
    },
  };

  private _sortMenuHandlers: Parameters<typeof renderSortMenu>[1] = {
    onPick: (mode) => this._actions.applySortMode(mode),
    onReverse: () => this._actions.toggleOrderDirection(),
    onClose: () => {
      this._sortMenu = null;
    },
  };

  private _colorPicker = new ColorPickerController(this, {
    getItem: (value) => this._legendItems.find((item) => item.value === value),
    preview: (value, color) => this._previewColor(value, color),
    commitColor: (value, color) => this._handleColorChange(value, color),
    commitShape: (value, shape) => this._handleShapeChange(value, shape),
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

  private _rowMenu = new LegendRowMenu(this, {
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

  _eatControls = new EatReliabilityController(this, {
    getScatterplot: () => this._scatterplotController.scatterplot,
    isHostDriven: () => this._hostDriven,
    getAnnotation: () => this.selectedAnnotation,
    getAnnotationDefinition: () => this.data?.annotations?.[this.selectedAnnotation],
    emit: (detail: EatOverlayChangeDetail) =>
      this.dispatchEvent(
        new CustomEvent<EatOverlayChangeDetail>('eat-overlay-change', {
          detail,
          bubbles: true,
          composed: true,
        }),
      ),
  } satisfies EatControlsOptions);

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
      // Predictions included, as the app and the decode worker hash it.
      const unfilteredData = sourceDataMatchesCurrentLegend
        ? {
            protein_ids: sourceData.protein_ids,
            annotations: sourceData.annotations,
            numeric_annotation_data: sourceData.numeric_annotation_data,
            annotation_predicted: sourceData.annotation_predicted,
          }
        : {
            protein_ids: this.proteinIds,
            annotations: this.data?.annotations,
            numeric_annotation_data: this.data?.numeric_annotation_data,
            annotation_predicted: this.data?.annotation_predicted,
          };

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
    this._closeSettings();
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
    this._selectedPaletteId = 'kellys';
    this._numericSettingsByAnnotation = {};
    this._numericManualOrderIdsByAnnotation = {};
    this._eatCounts = null;
    this._eatControls.mirrorOverlayEnabled(true);
    // Reset the whole reliability position, not just the lower bound, and drop a drag left
    // in flight (its debounced commit would emit the reset position against the NEW
    // dataset, after the seed has already run). A bundle restores the threshold only, so a
    // mode left over from the previous dataset would reinterpret it: "hide below 60%" saved
    // in this bundle would load as "hide above <the previous dataset's upper bound>" — the
    // opposite filter.
    this._eatControls.mirror(DEFAULT_EAT_RELIABILITY);
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
   * Reliability slider position (0…1). The slider no longer dims points itself;
   * it drives the shared `EAT_confidence >= x or N/A` query filter via the control
   * bar. Exposed so bundle export can persist the saved slider position (#6b).
   */
  public get reliabilityThreshold(): number {
    return this._eatControls.reliability.min;
  }

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
   * Bundle restore: the saved overlay switch plus the saved reliability position, which
   * reopens on "Hide below" at the saved value (`EatReliabilityController.applySettings`).
   */
  public applyEatSettings(enabled: boolean, threshold: number): void {
    this._eatControls.applySettings(enabled, threshold);
  }

  /** The reliability filter as the filter controller models it: a mode plus bounds. */
  public get reliabilityState(): EatReliabilityState {
    return this._eatControls.reliability;
  }

  /**
   * Reverse mirror: set the control's position from the query filter WITHOUT re-emitting
   * `eat-overlay-change`, cancelling a pending drag commit first (#6b, #380).
   */
  public setReliabilityState(state: EatReliabilityState): void {
    this._eatControls.mirror(state);
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
  // Settings Popover
  // ─────────────────────────────────────────────────────────────────

  /** The header's settings button: opens the settings popover under it, or closes it. */
  private _openSettings(anchor: HTMLElement): void {
    if (this._settingsAnchor) {
      this._closeSettings();
      return;
    }
    // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
    this._reorder.clear();
    this._colorPicker.close();
    this._rowMenu.close();
    this._sortMenu = null;
    this._otherPopover.close();
    this._settingsAnchor = anchor;
    this.dispatchEvent(new CustomEvent(LEGEND_EVENTS.CUSTOMIZE, { bubbles: true, composed: true }));
  }

  private _closeSettings(): void {
    if (!this._settingsAnchor) return;
    // A value typed but not yet committed is kept, not lost with the popover.
    this._settingsPopover?.flush();
    this._settingsAnchor = null;
  }

  /**
   * Applies one edit from the settings popover at once (design decision 12), then runs the tail
   * the dialog's Save ran, once: the items, the plot and the stored record follow.
   */
  private _applyDisplaySettings(patch: Partial<LegendDisplaySettings>): void {
    const annotation = this.selectedAnnotation;
    const current = this._numericSettingsByAnnotation[annotation];
    const numeric = this._isCurrentAnnotationNumeric()
      ? {
          binCount: current?.binCount ?? this.maxVisibleValues,
          strategy: current?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
          paletteId: normalizeNumericPaletteId(current?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID),
          reverseGradient: current?.reverseGradient ?? false,
        }
      : null;

    if (patch.maxVisibleValues !== undefined) {
      this.maxVisibleValues = patch.maxVisibleValues;
      if (numeric) numeric.binCount = patch.maxVisibleValues;
    }
    if (patch.shapeSize !== undefined) {
      if (patch.shapeSize === null) {
        // An emptied size field returns the dataset to its default, as Reset does for the size.
        this._data.clearShapeSize();
      } else {
        const size = Math.min(patch.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
        if (size !== this.shapeSize) {
          this._persistenceController.saveShapeSize(size);
          this.shapeSize = size;
        }
      }
    }
    if (patch.paletteId !== undefined) {
      if (numeric) {
        numeric.paletteId = normalizeNumericPaletteId(patch.paletteId);
        this._selectedPaletteId = numeric.paletteId;
      } else {
        this._selectedPaletteId = normalizeCategoricalPaletteId(patch.paletteId);
        this._legendItems = applyPaletteColors(this._legendItems, this._selectedPaletteId);
        // Ahead of the update below, which keeps stored colours over palette ones.
        this._syncLegendColorsToPersistence();
      }
    }
    if (numeric && patch.numericStrategy !== undefined) numeric.strategy = patch.numericStrategy;
    if (numeric && patch.reverseGradient !== undefined) {
      numeric.reverseGradient = patch.reverseGradient;
    }
    if (patch.enableDuplicateStackUI !== undefined) {
      this._enableDuplicateStackUI = patch.enableDuplicateStackUI;
    }
    if (numeric) {
      this._numericSettingsByAnnotation = {
        ...this._numericSettingsByAnnotation,
        [annotation]: numeric,
      };
    }

    this._updateLegendItems();
    this._syncLegendColorsToPersistence();
    this._scatterplotController.syncHiddenValues();
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.shapeSize),
      enableDuplicateStackUI: this._enableDuplicateStackUI,
    });
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  /** Reset from the popover: today's scope, and the popover stays open on the defaults. */
  private async _resetSettingsKeepingOpen(): Promise<void> {
    this._handleSettingsReset();
    await this.updateComplete;
    const popover = this._settingsPopover;
    // Closed meanwhile, or removed with the legend: there is nothing to focus.
    if (!popover || this._settingsAnchor === null || !this.isConnected) return;
    await popover.updateComplete;
    // Reset disables itself once nothing is stored; focus moves to the palette, not the body.
    popover.focusFirst();
  }

  /** Something to reset: a record stored for the annotation, or a size picked for the dataset. */
  private _canResetSettings(): boolean {
    return (
      this._persistenceController.hasPersistedSettings() ||
      this._persistenceController.loadShapeSize() !== null
    );
  }

  /**
   * The size the size field shows: the live one, capped at the field's bound, or null while it
   * is the dataset's default, which the empty field stands for (its placeholder names it).
   */
  private _fieldShapeSize(): number | null {
    // The storage read last: this runs at every legend render, the popover closed or not.
    const isDefault =
      this._annotationShapeSize === null &&
      this.shapeSize === defaultShapeSize(this._datasetProteinCount) &&
      this._persistenceController.loadShapeSize() === null;
    return isDefault ? null : Math.min(this.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
  }

  /**
   * The popover's view of the live state; there is no draft. A fresh object at each render is
   * fine: the popover's `settings` compares field by field, so an unchanged one re-renders nothing.
   */
  private _displaySettings(isNumeric: boolean): LegendDisplaySettings {
    const numeric = this._numericSettingsByAnnotation[this.selectedAnnotation];
    return {
      maxVisibleValues: this.maxVisibleValues,
      shapeSize: this._fieldShapeSize(),
      enableDuplicateStackUI: this._enableDuplicateStackUI,
      paletteId: isNumeric
        ? normalizeNumericPaletteId(numeric?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID)
        : normalizeCategoricalPaletteId(this._selectedPaletteId),
      numericStrategy: numeric?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
      reverseGradient: numeric?.reverseGradient ?? false,
    };
  }

  /**
   * The settings popover, rendered once as the last child of `.legend-container` and never keyed:
   * it flushes a pending edit when removed, so a remount would send a stale `settings-change`.
   */
  private _renderSettingsPopover(label: string) {
    const open = this._settingsAnchor !== null;
    const isNumeric = this._isCurrentAnnotationNumeric();
    return html`<protspace-legend-settings-popover
      .anchor=${this._settingsAnchor}
      .open=${open}
      .settings=${this._displaySettings(isNumeric)}
      .numeric=${isNumeric}
      .defaultShapeSize=${defaultShapeSize(this._datasetProteinCount)}
      .logBinningAvailable=${this.annotationData.numericMetadata?.logSupported ?? true}
      .canReset=${open && this._canResetSettings()}
      .annotationLabel=${label}
      @settings-change=${(event: CustomEvent<Partial<LegendDisplaySettings>>) =>
        this._applyDisplaySettings(event.detail)}
      @settings-reset=${() => void this._resetSettingsKeepingOpen()}
      @ps-open=${() => this._settingsPopover?.focusFirst()}
      @ps-close=${() => {
        this._settingsAnchor = null;
      }}
    ></protspace-legend-settings-popover>`;
  }

  private _handleColorChange(value: string, newColor: string): void {
    // Update the color immediately
    this._legendItems = this._legendItems.map((item) =>
      item.value === value ? { ...item, color: newColor } : item,
    );

    // Sync to persistence
    this._syncLegendColorsToPersistence();

    // Update scatterplot and save (color-only change, no z-order change)
    this._scatterplotController.dispatchColorMappingChange(true);
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  /**
   * Shows a colour while it is dragged: the row repaints now, the plot when the edit commits. The
   * item is changed in place, as before the split, so a drag does not re-sort the list or
   * re-derive the score strips on every tick.
   */
  private _previewColor(value: string, color: string): void {
    const item = this._legendItems.find((i) => i.value === value);
    if (!item) return;
    item.color = color;
    this.requestUpdate();
  }

  private _handleShapeChange(value: string, newShape: PointShape): void {
    // Update the shape immediately
    this._legendItems = this._legendItems.map((item) =>
      item.value === value ? { ...item, shape: newShape } : item,
    );

    // Sync to persistence
    this._syncLegendColorsToPersistence();

    // Update scatterplot and save (shape change, no z-order change)
    this._scatterplotController.dispatchColorMappingChange(true);
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  private _handleSettingsReset(): void {
    // Remove localStorage and clear pending categories
    this._persistenceController.removeSettings();
    this._persistenceController.clearPendingCategories();

    // Reset all settings to defaults. The shape size is the dataset's, so it is cleared for every
    // annotation rather than stored, and the default from the protein count applies again.
    this.maxVisibleValues = LEGEND_DEFAULTS.maxVisibleValues;
    this._data.clearShapeSize();
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();

    this._selectedPaletteId = isNumericAnnotation ? DEFAULT_NUMERIC_PALETTE_ID : 'kellys';
    if (isNumericAnnotation) {
      this._numericSettingsByAnnotation = {
        ...this._numericSettingsByAnnotation,
        [this.selectedAnnotation]: {
          binCount: LEGEND_DEFAULTS.maxVisibleValues,
          strategy: DEFAULT_NUMERIC_STRATEGY,
          paletteId: DEFAULT_NUMERIC_PALETTE_ID,
          reverseGradient: false,
        },
      };
      this._data.setNumericManualOrderIds(this.selectedAnnotation, undefined);
    }

    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: isNumericAnnotation
        ? 'alpha-asc'
        : getDefaultSortMode(this.selectedAnnotation),
    };

    this._hiddenValues = [];
    this._enableDuplicateStackUI = false;

    // Reset slot tracker so colors are reassigned from scratch
    this._processorContext.slotTracker.reset();

    // Clear legend items so processor creates fresh ones with default colors
    this._legendItems = [];

    this._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.shapeSize),
      enableDuplicateStackUI: this._enableDuplicateStackUI,
    });

    this._updateLegendItems();
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchColorMappingChange();
    this.requestUpdate();
  }

  private _syncLegendColorsToPersistence(): void {
    const categories: Record<string, PersistedCategoryData> = {};
    const persistVisualEncodings = !this._isCurrentAnnotationNumeric();
    this._legendItems.forEach((item) => {
      if (item.value !== LEGEND_VALUES.OTHER) {
        categories[item.value] = {
          zOrder: item.zOrder,
          color: persistVisualEncodings ? item.color : '',
          shape: persistVisualEncodings ? item.shape : '',
        };
      }
    });
    this._persistenceController.setPendingCategories(categories);
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
        ${this._data.hasSelectedEatAnnotation()
          ? renderEatSection(this._eatControls, { counts: this._eatCounts })
          : ''}
        ${this._renderScoreStrips()}
        ${renderLegendList(this._sortedLegendItems, (item, index) =>
          this._renderLegendItem(item, index),
        )}
        ${this._colorPicker.render()} ${this._rowMenu.render()} ${this._nameTooltip.render()}
        ${this._renderSortMenu()} ${this._otherPopover.render()}
        ${this._renderSettingsPopover(title)}
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
      clusterCaveat: this._isClusterAnnotation,
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
