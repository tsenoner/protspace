import { LitElement, html, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { perfCounters } from '../../utils/perf-counters';
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  getNumericBinLabelMap,
  getNumericBinLowerBoundMap,
  getOrderedNumericBinIds,
  isNumericAnnotation,
  materializeNumericAnnotation,
  normalizeNumericPaletteId,
  resolveNumericAnnotationDisplaySettings,
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  hasEatPredictionsForAnnotation,
  isPredictedAnnotation,
  getAnnotationMeta,
  annotationCategoryScores,
  isAutoClusterColumn,
  type NumericBinningStrategy,
  type NumericAnnotationDisplaySettingsMap,
  type EatReliabilityState,
  type CategoryScore,
} from '@protspace/utils';
import type { AnnotationData, LegendSettingsMap } from '@protspace/utils';

// Configuration and styles
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  LEGEND_EVENTS,
  toDisplayValue,
  toInternalValue,
} from './config';

import type { PointShape } from '@protspace/utils';
import { legendStyles } from './legend.styles';
import '../common/info-popover';

// Controllers
import { ScatterplotSyncController, PersistenceController, DragController } from './controllers';

// Processors and renderers
import {
  LegendDataProcessor,
  createProcessorContext,
  type LegendProcessorContext,
} from './legend-data-processor';
import {
  renderLegendHeader,
  renderSortMenu,
  type LegendHeaderHandlers,
  type LegendHeaderModel,
  type SortMenuModel,
} from './legend-header';
import { renderLegendRow, type LegendRowHandlers, type LegendRowView } from './legend-row';
import {
  LegendKeyboardController,
  renderLegendList,
  TruncatedNameTooltip,
  type LegendReorderSnapshot,
} from './legend-list';
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
  valueToKey,
  calculatePointSize,
  defaultShapeSize,
  SHAPE_SIZE_FILLER,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  updateItemsVisibility,
  isolateItem,
  isSecondClickOfDouble,
  isolationBase,
  type FirstClick,
  computeOtherConcreteValues,
} from './legend-helpers';
import { computeEatPopulationCounts, type EatPopulationCounts } from './eat-population-counts';
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  displayedOrder,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  reorderByValues,
  resolvePersistedSettings,
  reverseKeepingOtherLast,
  reverseSortMode,
  sortItemsForDisplay,
  type ResolvedLegendSettings,
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
  ScatterplotData,
  LegendPersistedSettings,
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

  @state() private _legendItems: LegendItem[] = [];
  @state() private _sortedLegendItems: LegendItem[] = [];
  @state() private _otherItems: OtherItem[] = [];
  @state() private _hiddenValues: string[] = [];
  @state() private _annotationSortModes: Record<string, LegendSortMode> = {};
  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() private _sortMenu: HTMLElement | null = null;
  private _preIsolationVisibleValues: Set<string> = new Set();
  /** The settings button while the settings popover is open under it (design decision 12). */
  @state() private _settingsAnchor: HTMLElement | null = null;
  /**
   * "Show duplicate counts and spread overlaps" for the selected annotation. Live state: the
   * stored record reads it, so an unrelated save never writes false over a stored true.
   */
  @state() private _enableDuplicateStackUI = false;
  @state() private _statusMessage = '';
  @state() private _selectedPaletteId = 'kellys';
  @state() private _numericSettingsByAnnotation: NumericAnnotationDisplaySettingsMap = {};
  @state() private _numericManualOrderIdsByAnnotation: Record<string, string[]> = {};
  @state() private _eatCounts: EatPopulationCounts | null = null;
  @state() private _categoryScores: CategoryScore[] = [];
  /**
   * Whether the current annotation is one of the backend's auto-clustering membership
   * columns, whose separation scores are optimistic by construction. Derived alongside
   * `_categoryScores` because both need `statisticsRows`, which render time does not see.
   */
  @state() private _isClusterAnnotation = false;
  /**
   * Category under the pointer, from a legend row or from a score strip. Read by
   * `_renderLegendItem` (the row's `legend-item-score-hover` class) and by `_renderScoreStrips`
   * (each strip's `highlighted` binding), so a hover in either place lights up both.
   */
  @state() private _hoveredCategory: string | null = null;
  /**
   * The annotation storage the legend counts from, captured on every scatterplot
   * data change. Counting straight out of it (`countFromStorage`) replaces the
   * flat `annotationValues` array, which cost one interned string per protein
   * and misaligned isolation filtering. `null` means "no synced storage": a host
   * that feeds the public `annotationValues` property instead.
   */
  private _countSource: {
    colData: AnnotationData;
    values: (string | null)[];
    proteinCount: number;
  } | null = null;
  private _announceManualPromotionOnNextReorder = false;

  // Pending extract/merge values for next update cycle.
  // undefined = no pending operation, string = value to extract/merge (including '__NA__' for N/A)
  private _pendingExtractValue: string | undefined = undefined;
  private _pendingMergeValue: string | undefined = undefined;

  /**
   * Protein count of the whole dataset, taken with its hash in `updated()` from the same
   * unfiltered data, so a filter, an isolation or hidden categories never change it. It sets
   * the default shape size.
   */
  private _datasetProteinCount = 0;

  /**
   * The selected annotation's own shape size from a bundle or browser storage, or null when it
   * holds a filler. Its persisted record keeps this, never the live size, so neither a picked
   * size nor the computed default is ever stored or exported as the annotation's own.
   */
  private _annotationShapeSize: number | null = null;

  // Kept until its dblclick arrives, which isolates from `isolationBase`.
  private _firstClick: FirstClick | null = null;

  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;

  @query('protspace-legend-settings-popover')
  private _settingsPopover?: ProtspaceLegendSettingsPopover;

  // Instance-specific processor context (avoids global state conflicts)
  private _processorContext: LegendProcessorContext = createProcessorContext();

  // ─────────────────────────────────────────────────────────────────
  // Controllers
  // ─────────────────────────────────────────────────────────────────

  private _scatterplotController = new ScatterplotSyncController(this, {
    onDataChange: (data, annotation, projectionName) =>
      this._handleScatterplotDataChange(data, annotation, projectionName),
    onAnnotationChange: (annotation) => this._handleAnnotationChange(annotation),
    getHiddenValues: () => this._hiddenValues,
    getOtherItems: () => this._otherItems,
    getLegendItems: () => this._legendItems,
    getOtherConcreteValues: () => computeOtherConcreteValues(this._otherItems),
    getAutoHide: () => this.autoHide,
    getNumericAnnotationSettings: () => this._numericSettingsByAnnotation,
    getAnnotationSortModes: () => this._annotationSortModes,
    getNumericManualOrderIds: () => this._numericManualOrderIdsByAnnotation,
  });

  private _persistenceController = new PersistenceController(this, {
    onSettingsLoaded: (settings) => this._applyPersistedSettings(settings),
    getLegendItems: () => this._legendItems,
    getHiddenValues: () => this._hiddenValues,
    shouldPersistCategories: () => !this._isCurrentAnnotationNumeric(),
    shouldPersistCategoryEncodings: () => !this._isCurrentAnnotationNumeric(),
    isNumericAnnotation: () => this._isCurrentAnnotationNumeric(),
    getCurrentSettings: () => {
      const isNumericAnnotation = this._isCurrentAnnotationNumeric();
      return {
        maxVisibleValues: this.maxVisibleValues,
        shapeSize: this._annotationShapeSize ?? SHAPE_SIZE_FILLER,
        sortMode: normalizeSortModeForType(
          this._annotationSortModes[this.selectedAnnotation],
          isNumericAnnotation,
        ),
        enableDuplicateStackUI: this._enableDuplicateStackUI,
        selectedPaletteId: isNumericAnnotation
          ? normalizeNumericPaletteId(this._selectedPaletteId)
          : normalizeCategoricalPaletteId(this._selectedPaletteId),
        numericSettings: isNumericAnnotation
          ? {
              strategy:
                this._numericSettingsByAnnotation[this.selectedAnnotation]?.strategy ??
                DEFAULT_NUMERIC_STRATEGY,
              reverseGradient:
                this._numericSettingsByAnnotation[this.selectedAnnotation]?.reverseGradient ??
                false,
              signature: this.annotationData.numericMetadata?.signature ?? '',
              topologySignature: this.annotationData.numericMetadata?.topologySignature ?? '',
              manualOrderIds: this._buildNumericManualOrderIds(this.selectedAnnotation),
            }
          : undefined,
      };
    },
  });

  private _dragController = new DragController(this, {
    getLegendItems: () => this._legendItems,
    setLegendItems: (items) => {
      this._legendItems = items;
      if (this._isNumericAnnotation()) {
        // Exclude Other (synthetic) and NA (locked to legend end regardless of
        // sort) from the persisted manual order — they have no observable
        // position effect and would clutter the saved state.
        this._setNumericManualOrderIds(this.selectedAnnotation, numericOrderFromItems(items));
      }
    },
    onReorder: () => {
      this._scatterplotController.dispatchZOrderChange();
      this._persistenceController.saveSettings();
      this._dispatchLegendStateChange();
    },
    onMergeToOther: (value) => this._handleMergeToOther(value),
    onSortModeChange: (mode) => {
      this._announceManualPromotionOnNextReorder =
        mode === 'manual' && !this._currentSortMode.startsWith('manual');
      this._annotationSortModes = {
        ...this._annotationSortModes,
        [this.selectedAnnotation]: mode,
      };
      this._keyboard.clear();
      this._scatterplotController.syncNumericAnnotationSettings();
    },
    onDropComplete: (value) => this._highlightDroppedItem(value),
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
    onPick: (mode) => this._applySortMode(mode),
    onReverse: () => this._toggleLegendOrderDirection(),
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

  private _keyboard = new LegendKeyboardController(this, {
    getSortedItems: () => this._sortedLegendItems,
    canDrag: (item) => this._canDragLegendItem(item),
    toggle: (value) => this._handleItemClick(value),
    isolate: (value) => this._handleItemDoubleClick(value),
    snapshot: () => ({
      annotation: this.selectedAnnotation,
      sortMode: this._currentSortMode,
      legendItems: this._legendItems.map((item) => ({ ...item })),
      otherItems: this._otherItems.map((item) => ({ ...item })),
      numericManualOrderIds: this._isNumericAnnotation()
        ? [...(this._numericManualOrderIdsByAnnotation[this.selectedAnnotation] ?? [])]
        : undefined,
    }),
    restore: (snapshot) => this._restoreKeyboardReorderSnapshot(snapshot),
    move: (value, direction) => this._moveFocusedManualItem(value, direction),
    announce: (message) => this._announceStatus(message),
    annotationName: () => this._annotationDisplayName,
  });

  private _nameTooltip = new TruncatedNameTooltip(this);

  private _rowMenu = new LegendRowMenu(this, {
    getItems: () => this._legendItems,
    isNumeric: () => this._isNumericAnnotation(),
    isolate: (value) => this._handleItemDoubleClick(value),
    customize: (value) => {
      // Found by its dataset rather than a selector: a value can hold any character.
      const row = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.legend-item') ?? [])].find(
        (each) => each.dataset.value === value,
      );
      // Opening is idempotent: chosen again for the row whose picker is open, it stays open.
      if (row) this._colorPicker.open(value, row);
    },
  });

  private _otherPopover = new OtherPopoverControl(this, {
    getItems: () => this._otherItems,
    add: (value) => this._handleExtractFromOther(value),
    addAll: () => this._handleExtractAllFromOther(),
    focusFirstRow: () => this._keyboard.focusItem(0),
  });

  private _eatControls = new EatReliabilityController(this, {
    getScatterplot: () => this._scatterplotController.scatterplot,
    isHostDriven: () => this._hostDriven,
    getAnnotation: () => this.selectedAnnotation,
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

  private _clearKeyboardReorderState(): void {
    this._keyboard.clear();
    this._announceManualPromotionOnNextReorder = false;
  }

  private _restoreKeyboardReorderSnapshot(snapshot: LegendReorderSnapshot): void {
    if (snapshot.annotation !== this.selectedAnnotation) {
      this._clearKeyboardReorderState();
      return;
    }

    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: snapshot.sortMode,
    };
    if (this._isNumericAnnotation()) {
      this._setNumericManualOrderIds(this.selectedAnnotation, snapshot.numericManualOrderIds);
    }
    // Only the order goes back: colour, shape and visibility set during the reorder stay.
    const live = new Map(this._legendItems.map((item) => [item.value, item]));
    this._legendItems = snapshot.legendItems.map((item) => ({
      ...(live.get(item.value) ?? item),
      zOrder: item.zOrder,
    }));
    this._otherItems = snapshot.otherItems.map((item) => ({ ...item }));
    this._clearKeyboardReorderState();

    if (!snapshot.sortMode.startsWith('manual')) {
      this._updateLegendItems();
    }

    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._scatterplotController.syncOtherValues();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
    this.requestUpdate();
  }

  private _syncNumericSettingsFromPersistence(): void {
    const annotationEntries = Object.entries(this.data?.annotations ?? {});
    if (annotationEntries.length === 0) {
      return;
    }

    const persistedSettings = this.getAllPersistedSettings();
    const nextNumericSettings = { ...this._numericSettingsByAnnotation };
    let didChange = false;

    for (const [annotationName, annotation] of annotationEntries) {
      if (!isNumericAnnotation(annotation)) {
        continue;
      }

      const persisted = persistedSettings[annotationName];
      const { settings: nextSettings } = resolveNumericAnnotationDisplaySettings({
        persistedSettings: persisted,
        liveSettings: nextNumericSettings[annotationName],
        defaultBinCount: LEGEND_DEFAULTS.maxVisibleValues,
      });

      const currentSettings = nextNumericSettings[annotationName];
      if (
        !currentSettings ||
        currentSettings.binCount !== nextSettings.binCount ||
        currentSettings.strategy !== nextSettings.strategy ||
        currentSettings.paletteId !== nextSettings.paletteId ||
        currentSettings.reverseGradient !== nextSettings.reverseGradient
      ) {
        nextNumericSettings[annotationName] = nextSettings;
        didChange = true;
      }
    }

    if (didChange) {
      this._numericSettingsByAnnotation = nextNumericSettings;
      this._scatterplotController.syncNumericAnnotationSettings();
    }
  }

  private _dispatchLegendStateChange(): void {
    window.dispatchEvent(
      new CustomEvent('protspace-legend-state-change', {
        detail: {
          annotation: this.selectedAnnotation,
          scatterplotSelector: this.scatterplotSelector,
        },
      }),
    );
  }

  /** Returns whether the move switched the annotation to manual order. */
  private _commitManualOrderFromVisibleValues(orderedValues: string[]): boolean {
    const visibleOrder = [...orderedValues];
    const didPromote = !this._currentSortMode.startsWith('manual');
    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: 'manual',
    };

    if (this._isNumericAnnotation()) {
      this._setNumericManualOrderIds(this.selectedAnnotation, visibleOrder);
      this._updateLegendItems();
    } else {
      this._legendItems = reorderByValues(this._legendItems, visibleOrder);
    }

    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
    this.requestUpdate();
    return didPromote;
  }

  private _moveFocusedManualItem(
    value: string,
    direction: -1 | 1,
  ): { moved: LegendItem; promoted: boolean } | null {
    const orderedItems = this._sortedLegendItems.filter(
      (item) => item.value !== LEGEND_VALUES.OTHER,
    );
    const currentIndex = orderedItems.findIndex((item) => item.value === value);
    if (currentIndex === -1) return null;

    const nextIndex = Math.max(0, Math.min(orderedItems.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return null;

    const reordered = [...orderedItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const promoted = this._commitManualOrderFromVisibleValues(reordered.map((item) => item.value));
    return { moved, promoted };
  }

  // ─────────────────────────────────────────────────────────────────
  // Computed Properties
  // ─────────────────────────────────────────────────────────────────

  private get _currentSortMode(): LegendSortMode {
    return this._normalizeSortModeForAnnotation(
      this.selectedAnnotation,
      this._annotationSortModes[this.selectedAnnotation],
    );
  }

  /** The selected annotation's display name, never its key (decision 15). */
  private get _annotationDisplayName(): string {
    const name = this.selectedAnnotation;
    return name ? annotationLabel(name, this.data?.annotations?.[name] ?? this.annotationData) : '';
  }

  /** `autoSync` is off; its doc lists what that changes. */
  private get _hostDriven(): boolean {
    return !this.autoSync;
  }

  /**
   * Get the set of currently visible values (from legend items, excluding "Other").
   * Used to preserve membership when sort mode changes.
   * N/A items use '__NA__' as their value.
   */
  private get _visibleValues(): Set<string> {
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
      this._updateAnnotationDataFromData();
      this._ensureSortModeDefaults();

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

      this._syncNumericSettingsFromPersistence();
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
      this._rebuildLegendItems();
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
      this._rebuildLegendItems();
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
    this._clearKeyboardReorderState();

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

  private _handleScatterplotDataChange(
    data: ScatterplotData,
    selectedAnnotation: string,
    selectedProjectionName: string,
  ): void {
    // A pending edit lands on the annotation it was made for, before the plot moves to another.
    if (selectedAnnotation !== this.selectedAnnotation) this._closeAnnotationOverlays();
    this._clearKeyboardReorderState();
    const scatterplot = this._scatterplotController.scatterplot;
    this._eatControls.mirrorOverlayEnabled(scatterplot?.eatOverlayEnabled ?? true);
    // The reliability slider position is legend-owned now (it drives the query
    // filter, not scatter-plot dimming), so it is preserved across data-change
    // rather than re-read from the scatter plot.
    this.data = {
      annotations: data.annotations,
      protein_ids: data.protein_ids,
      numeric_annotation_data: data.numeric_annotation_data,
      annotation_predicted: data.annotation_predicted,
    };
    this.selectedAnnotation = selectedAnnotation;
    this.annotationData = {
      name: selectedAnnotation,
      values: data.annotations[selectedAnnotation].values,
      colors: data.annotations[selectedAnnotation].colors,
      shapes: data.annotations[selectedAnnotation].shapes,
      kind: data.annotations[selectedAnnotation].kind,
      sourceKind: data.annotations[selectedAnnotation].sourceKind,
      numericMetadata: data.annotations[selectedAnnotation].numericMetadata,
      runtime: data.annotations[selectedAnnotation].runtime,
    };
    this._updateAnnotationValues(data, selectedAnnotation);
    this._eatCounts = computeEatPopulationCounts(
      data,
      selectedAnnotation,
      this._eatControls.overlayEnabled,
    );
    // Taken from the unsliced element, not from the incoming payload.
    // `sliceWith` in utils strips `statisticsRows` from a filtered or isolated
    // view on purpose (a slice must not carry scores that describe the whole dataset), so
    // reading them off `data` made every filter look identical to "this annotation was never
    // scored" -- which is why this used to need a sticky per-annotation memory to tell the two
    // apart. The scores are whole-dataset facts about the annotation, so the legend reads them
    // from the whole dataset and decides separately whether to plot them (`_renderScoreStrips`).
    // Same escape hatch the dataset hash in `updated()` already uses, and the same source the
    // sibling projection-metadata panel is handed.
    const statisticsRows = scatterplot?.data?.statisticsRows ?? data.statisticsRows;
    this._categoryScores = annotationCategoryScores(
      statisticsRows,
      selectedAnnotation,
      selectedProjectionName,
    );
    this._isClusterAnnotation = isAutoClusterColumn(statisticsRows, selectedAnnotation);
    this.proteinIds = data.protein_ids;

    // Sync isolation state
    const { isolationMode, isolationHistory } = this._scatterplotController.getIsolationState();

    // Save visible values before entering isolation so "Other" items stay grouped
    if (isolationMode && !this.isolationMode) {
      this._preIsolationVisibleValues = this._visibleValues;
    }

    this.isolationMode = isolationMode;
    this.isolationHistory = isolationHistory;
  }

  private _handleAnnotationChange(annotation: string): void {
    // A value still being typed belongs to the annotation it was typed for.
    this._closeAnnotationOverlays();
    this._clearKeyboardReorderState();
    this.selectedAnnotation = annotation;
    this._hiddenValues = [];
    // Reset pre-isolation visible values so the new annotation uses maxVisibleValues
    // instead of being constrained to the old annotation's visible set
    if (this.isolationMode) {
      this._preIsolationVisibleValues = new Set<string>();
    }
    this._scatterplotController.forceSync();
  }

  private _updateAnnotationDataFromData(): void {
    const annotationInfo = this.data?.annotations?.[this.selectedAnnotation] ?? null;
    this.annotationData = annotationInfo
      ? {
          name: this.selectedAnnotation,
          values: annotationInfo.values,
          colors: annotationInfo.colors,
          shapes: annotationInfo.shapes,
          kind: annotationInfo.kind,
          sourceKind: annotationInfo.sourceKind,
          numericMetadata: annotationInfo.numericMetadata,
          runtime: annotationInfo.runtime,
        }
      : { name: '', values: [] };
  }

  private _updateAnnotationValues(data: ScatterplotData, selectedAnnotation: string): void {
    this._countSource = {
      colData: data.annotation_data[selectedAnnotation],
      values: data.annotations[selectedAnnotation].values,
      proteinCount: data.protein_ids.length,
    };
  }

  /**
   * Legend counts, isolation applied: from the synced storage, or from the public
   * `annotationValues` array when there is none. Either way the processor only ever
   * sees the counted map.
   *
   * Recomputed per rebuild rather than cached: the bincount is ~2 ms at 573K,
   * cheaper than the array scan it replaces, and it depends on the isolation
   * state, which changes independently of the storage.
   */
  private _computeAnnotationCounts(knownValues: string[]): ReadonlyMap<string, number> {
    const isolating = this.isolationMode && this.isolationHistory?.length > 0;
    const filteredIndices = isolating
      ? LegendDataProcessor.getFilteredIndices(true, this.isolationHistory, this.proteinIds)
      : null;
    const source = this._countSource;
    if (!source) {
      // The array holds one value per protein in `proteinIds` order, so the filter's
      // protein indices address it directly.
      return LegendDataProcessor.countAnnotationFrequencies(
        this.annotationValues,
        filteredIndices,
        knownValues,
      );
    }
    // Protein order while host-driven, the order a per-protein `annotationValues` feed
    // gives, so the legend comes out the same whether its host feeds it or it counts the
    // synced storage. Tied counts keep this order, which settles their rows and colours.
    return LegendDataProcessor.countFromStorage(
      source.colData,
      source.values,
      source.proteinCount,
      filteredIndices,
      knownValues,
      this._hostDriven,
    );
  }

  private _hasSelectedEatAnnotation(): boolean {
    const stableData = this._scatterplotController.scatterplot?.data ?? this.data;
    return hasEatPredictionsForAnnotation(stableData, this.selectedAnnotation);
  }

  private _ensureSortModeDefaults(): void {
    const annotationNames = this.data?.annotations ? Object.keys(this.data.annotations) : [];
    if (annotationNames.length === 0) return;

    const updated: Record<string, LegendSortMode> = { ...this._annotationSortModes };
    for (const aname of annotationNames) {
      updated[aname] = this._normalizeSortModeForAnnotation(aname, updated[aname]);
    }
    this._annotationSortModes = updated;
  }

  private _isMultilabelAnnotation(): boolean {
    return this._scatterplotController.isMultilabelAnnotation(this.selectedAnnotation);
  }

  private _isNumericAnnotation(): boolean {
    return isNumericAnnotation(this.annotationData);
  }

  private _isCurrentAnnotationNumeric(): boolean {
    const sourceAnnotation =
      this._scatterplotController.scatterplot?.data?.annotations?.[this.selectedAnnotation];
    return isNumericAnnotation(sourceAnnotation) || this._isNumericAnnotation();
  }

  private _hasSameProteinIds(left: readonly string[], right: readonly string[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;

    return left.every((proteinId, index) => proteinId === right[index]);
  }

  // ─────────────────────────────────────────────────────────────────
  // Legend Item Processing
  // ─────────────────────────────────────────────────────────────────

  /**
   * Rebuild legend items and apply persisted z-order.
   * Use when forcing a full rebuild outside the updated() lifecycle.
   */
  private _rebuildLegendItems(): void {
    if (perfCounters) perfCounters.legendRebuild++;
    this._updateLegendItems();

    if (!this._isNumericAnnotation() && this._persistenceController.hasPendingCategories()) {
      this._legendItems = this._persistenceController.applyPendingZOrder(this._legendItems);
    }
  }

  private _getPersistedCategoriesForProcessing(): Record<string, PersistedCategoryData> {
    if (!this._isNumericAnnotation()) {
      return this._persistenceController.pendingCategories;
    }

    return {};
  }

  private _getNumericOrderValues(): Map<string, number> {
    return getNumericBinLowerBoundMap(this.annotationData);
  }

  private _buildNumericManualOrderIds(annotationName: string): string[] | undefined {
    if (!annotationName) return undefined;
    const manualOrderIds = this._numericManualOrderIdsByAnnotation[annotationName];
    if (manualOrderIds?.length) {
      return manualOrderIds;
    }

    if (annotationName !== this.selectedAnnotation || !this._isNumericAnnotation()) {
      return undefined;
    }

    return numericOrderFromItems(this._legendItems);
  }

  private _setNumericManualOrderIds(annotationName: string, orderIds: string[] | undefined): void {
    if (!annotationName) return;

    if (!orderIds || orderIds.length === 0) {
      const rest = { ...this._numericManualOrderIdsByAnnotation };
      delete rest[annotationName];
      this._numericManualOrderIdsByAnnotation = rest;
      return;
    }

    this._numericManualOrderIdsByAnnotation = {
      ...this._numericManualOrderIdsByAnnotation,
      [annotationName]: [...orderIds],
    };
  }

  private _updateLegendItems(): void {
    if (perfCounters) perfCounters.legendUpdate++;
    // Aligned with PersistenceController's isNumericAnnotation callback so the
    // processor and the persistence layer agree on numeric-ness in transient states.
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();
    // Ahead of the bincount below, which is O(proteins) and has nothing to count for
    // an annotation with no values at all.
    if (!this.annotationData?.values?.length) {
      this._legendItems = [];
      return;
    }
    const knownValues = isNumericAnnotation
      ? this.annotationData.values.map((value) => toInternalValue(value))
      : [];
    const frequencies = this._computeAnnotationCounts(knownValues);
    if (!isNumericAnnotation && frequencies.size === 0) {
      this._legendItems = [];
      return;
    }

    try {
      // Get persisted categories from persistence controller
      const persistedCategories = this._getPersistedCategoriesForProcessing();

      // Get pending values for extract/merge operations
      // undefined = no pending operation, string = value (including '__NA__' for N/A)
      const pendingExtract = this._pendingExtractValue;
      const pendingMerge = this._pendingMergeValue;

      // Use visibleValues to preserve the current visible set when:
      // - There are persisted settings in localStorage
      // - There are pending extract/merge operations
      // - There are already legend items (e.g., switching sort mode before persistence)
      // When none of these apply (true initial load), use empty set so maxVisibleValues is respected.
      const hasPendingOps = pendingExtract !== undefined || pendingMerge !== undefined;
      const hasExistingItems = this._legendItems.some((i) => i.value !== LEGEND_VALUES.OTHER);
      const visibleValues = this.isolationMode
        ? this._preIsolationVisibleValues
        : this._persistenceController.hasPersistedSettings() || hasPendingOps || hasExistingItems
          ? this._visibleValues
          : new Set<string>();
      const numericOrderValues = this._getNumericOrderValues();
      const numericDisplayLabels = getNumericBinLabelMap(this.annotationData);
      const numericManualOrderIds = isNumericAnnotation
        ? (this._buildNumericManualOrderIds(this.selectedAnnotation) ?? [])
        : [];
      const existingLegendItems =
        isNumericAnnotation && this._currentSortMode.startsWith('manual')
          ? getOrderedNumericBinIds(this.annotationData, 'manual', numericManualOrderIds).map(
              (id, index) => ({
                value: id,
                displayValue: numericDisplayLabels.get(id) ?? id,
                color: '',
                shape: 'circle',
                count: 0,
                isVisible: true,
                zOrder: index,
              }),
            )
          : this._legendItems;

      const { legendItems, otherItems } = LegendDataProcessor.processLegendItems(
        this._processorContext,
        this.annotationData.name || this.selectedAnnotation,
        frequencies,
        this.maxVisibleValues,
        this.isolationMode,
        existingLegendItems,
        this._currentSortMode,
        persistedCategories,
        visibleValues,
        numericOrderValues,
        !isNumericAnnotation,
        pendingExtract,
        pendingMerge,
        isNumericAnnotation,
      );

      // Apply hidden values
      if (this._hiddenValues.length > 0) {
        this._legendItems = legendItems.map((item: LegendItem) => ({
          ...item,
          isVisible: !this._hiddenValues.includes(valueToKey(item.value)),
        }));
      } else {
        this._legendItems = legendItems;
      }
      this._otherItems = otherItems;

      if (isNumericAnnotation) {
        // Only once the annotation itself reads as numeric: a plot-side numeric column whose
        // legend data has not caught up yet keeps the processor's labels and colours.
        if (this._isNumericAnnotation()) {
          this._legendItems = applyDerivedNumericColors(
            applyNumericDisplayLabels(this._legendItems, this.annotationData),
            this.annotationData,
          );
        }
      } else if (this._selectedPaletteId !== 'kellys') {
        this._legendItems = applyPaletteColors(this._legendItems, this._selectedPaletteId);
      }

      // Clear pending extract/merge values after they've been applied
      this._pendingExtractValue = undefined;
      this._pendingMergeValue = undefined;
      // Note: We do NOT clear pendingCategories here because subsequent update cycles
      // (triggered by property changes in _applyPersistedSettings) may rebuild legend items
      // and need the persisted colors/shapes. Categories are cleared when loadSettings()
      // is called for a new annotation.

      // Sync with scatterplot
      this._scatterplotController.dispatchZOrderChange();
      this._scatterplotController.dispatchColorMappingChange();
      this._scatterplotController.syncOtherValues();
      this._scatterplotController.syncHiddenValues();
    } catch (error) {
      this._dispatchError(
        'Failed to process legend data',
        'data-processing',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Settings Persistence
  // ─────────────────────────────────────────────────────────────────

  private _applyPersistedSettings(settings: LegendPersistedSettings): void {
    try {
      const resolved: ResolvedLegendSettings = resolvePersistedSettings(settings, {
        isNumeric: this._isCurrentAnnotationNumeric(),
        liveNumeric: this._numericSettingsByAnnotation[this.selectedAnnotation],
        signatures: (binCount, strategy, paletteId, reverseGradient) =>
          this._computeNumericSettingsSignatures(binCount, strategy, paletteId, reverseGradient),
      });

      if (resolved.clearPendingCategories) {
        this._persistenceController.clearPendingCategories();
      }
      this.maxVisibleValues = resolved.maxVisibleValues;
      this._annotationShapeSize = resolved.annotationShapeSize;
      this.shapeSize = this._resolveShapeSize();
      this._hiddenValues = resolved.hiddenValues;
      this._selectedPaletteId = resolved.paletteId;

      if (resolved.numeric) {
        const { manualOrderIds, ...numericSettings } = resolved.numeric;
        this._numericSettingsByAnnotation = {
          ...this._numericSettingsByAnnotation,
          [this.selectedAnnotation]: numericSettings,
        };
        this._setNumericManualOrderIds(this.selectedAnnotation, manualOrderIds);
      }

      this._annotationSortModes = {
        ...this._annotationSortModes,
        [this.selectedAnnotation]: resolved.sortMode,
      };

      this._enableDuplicateStackUI = resolved.enableDuplicateStackUI === true;
      this._scatterplotController.updateConfig({
        pointSize: calculatePointSize(this.shapeSize),
        enableDuplicateStackUI: this._enableDuplicateStackUI,
      });
      this._scatterplotController.syncNumericAnnotationSettings();
    } catch (error) {
      this._dispatchError(
        'Failed to apply persisted settings',
        'persistence',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * The dataset's stored size (picked, or a bundle's top-level size), else the annotation's own,
   * else the default from the dataset's protein count; capped at the dialog's bound.
   */
  private _resolveShapeSize(): number {
    return Math.min(
      this._persistenceController.loadShapeSize() ??
        this._annotationShapeSize ??
        defaultShapeSize(this._datasetProteinCount),
      LEGEND_DEFAULTS.maxSymbolSize,
    );
  }

  /**
   * Forget the dataset's picked size and every annotation's own, so the default from the
   * protein count applies; that default is never stored.
   */
  private _clearShapeSize(): void {
    this._persistenceController.clearShapeSize(Object.keys(this.data?.annotations ?? {}));
    this._annotationShapeSize = null;
    this.shapeSize = this._resolveShapeSize();
  }

  private _computeNumericSettingsSignatures(
    binCount: number,
    strategy: NumericBinningStrategy,
    paletteId: string,
    reverseGradient: boolean,
  ): { signature: string | null; topologySignature: string | null } {
    const rawNumericValues =
      this._scatterplotController.scatterplot?.data?.numeric_annotation_data?.[
        this.selectedAnnotation
      ] ?? this.data?.numeric_annotation_data?.[this.selectedAnnotation];

    if (!rawNumericValues) {
      return {
        signature: this.annotationData.numericMetadata?.signature ?? null,
        topologySignature: this.annotationData.numericMetadata?.topologySignature ?? null,
      };
    }

    const metadata = materializeNumericAnnotation(rawNumericValues, {
      binCount,
      strategy,
      paletteId,
      reverseGradient,
    }).annotation.numericMetadata;
    return {
      signature: metadata?.signature ?? null,
      topologySignature: metadata?.topologySignature ?? null,
    };
  }

  private _normalizeSortModeForAnnotation(
    annotationName: string,
    sortMode: LegendSortMode | undefined,
  ): LegendSortMode {
    const annotation =
      this.data?.annotations?.[annotationName] ??
      (annotationName === this.selectedAnnotation ? this.annotationData : undefined);
    const isNumeric = isNumericAnnotation(annotation);

    return normalizeSortModeForType(sortMode, isNumeric);
  }

  // ─────────────────────────────────────────────────────────────────
  // Item Interactions
  // ─────────────────────────────────────────────────────────────────

  /** Toggles, except on the second click of a double-click (`isSecondClickOfDouble`). */
  private _handleItemMouseClick(value: string, event: MouseEvent): void {
    const valueKey = valueToKey(value);
    if (isSecondClickOfDouble(this._firstClick, valueKey, event)) return;

    const itemsBefore = this._legendItems;
    this._handleItemClick(value);
    this._firstClick =
      event.detail === 1 ? { valueKey, itemsBefore, itemsAfter: this._legendItems } : null;
  }

  private _handleItemMouseDoubleClick(value: string): void {
    const first = this._firstClick;
    this._firstClick = null;
    this._handleItemDoubleClick(value, isolationBase(first, valueToKey(value), this._legendItems));
  }

  private _handleItemClick(value: string): void {
    const valueKey = valueToKey(value);
    const result = updateItemsVisibility(this._legendItems, this._hiddenValues, valueKey);

    this._legendItems = result.items;
    this._hiddenValues = result.hiddenValues;

    const item = this._legendItems.find((i) => valueToKey(i.value) === valueKey);
    this._announceStatus(`${toDisplayValue(value)} ${item?.isVisible ? 'shown' : 'hidden'}`);

    this._scatterplotController.syncHiddenValues();
    this._dispatchItemAction(value, 'toggle');
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  private _handleItemDoubleClick(value: string, items: LegendItem[] = this._legendItems): void {
    const result = isolateItem(items, value);

    this._legendItems = result.items;
    this._hiddenValues = result.hiddenValues;

    const visibleCount = result.items.filter((i) => i.isVisible).length;
    this._announceStatus(
      visibleCount === 1 ? `Isolated ${toDisplayValue(value)}` : 'All items shown',
    );

    this._scatterplotController.syncHiddenValues();
    this._dispatchItemAction(value, 'isolate');
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  private _handleExtractFromOther(value: string): void {
    // Set pending extract value - will be used by processor to add this item to visible set
    this._pendingExtractValue = value;

    // Increase maxVisibleValues to accommodate the extracted item
    // This triggers updated() which calls _updateLegendItems() with pending value still set
    this.maxVisibleValues = this.maxVisibleValues + 1;

    // Don't call _updateLegendItems() explicitly - the maxVisibleValues change will trigger
    // updated() which calls it. If we call it here, it will be called twice and the
    // pending value will be cleared after the first call, causing the second call to not
    // respect the extract operation.

    this._announceStatus(`Extracted ${toDisplayValue(value)} from Other category`);
    this._dispatchItemAction(value, 'extract');
    // Save settings after the update cycle completes
    this.updateComplete.then(() => {
      this._persistenceController.saveSettings();
    });
  }

  private _handleExtractAllFromOther(): void {
    const nonOtherCount = this._legendItems.filter((i) => i.value !== LEGEND_VALUES.OTHER).length;
    const targetMaxVisibleValues = nonOtherCount + this._otherItems.length;

    this._otherPopover.close();

    this._announceStatus('Extracted all items from Other category');
    for (const item of this._otherItems) {
      this._dispatchItemAction(item.value, 'extract');
    }
    this.maxVisibleValues = targetMaxVisibleValues;

    this.updateComplete.then(() => {
      this._persistenceController.saveSettings();
    });
  }

  private _handleMergeToOther(value: string): void {
    // Set pending merge value - will be used by processor to remove this item from visible set
    this._pendingMergeValue = value;

    // Decrease maxVisibleValues to remove space for the merged item
    // This triggers updated() which calls _updateLegendItems() with pending value still set
    this.maxVisibleValues = Math.max(1, this.maxVisibleValues - 1);

    // Don't call _updateLegendItems() explicitly - the maxVisibleValues change will trigger
    // updated() which calls it. If we call it here, it will be called twice and the
    // pending value will be cleared after the first call, causing the second call to not
    // respect the merge operation.

    this._announceStatus(`Moved ${toDisplayValue(value)} to Other category`);
    // Save settings after the update cycle completes
    this.updateComplete.then(() => {
      this._persistenceController.saveSettings();
    });
  }

  private async _highlightDroppedItem(value: string): Promise<void> {
    // Wait for Lit to render the new item order. The second await covers an update that the
    // first one's `updated()` schedules (the data pipeline still writes state there).
    await this.updateComplete;
    await this.updateComplete;

    const items = this.shadowRoot?.querySelectorAll('.legend-item');
    if (!items) return;

    for (const el of items) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.getAttribute('data-value') === value) {
        htmlEl.classList.add('legend-item-just-dropped');
        // The handle, as before the main button moved ahead of it in the row; Other has no usable one.
        const focusTarget =
          htmlEl.querySelector<HTMLElement>('.drag-handle:not(:disabled)') ??
          htmlEl.querySelector<HTMLElement>('.legend-item-main');
        focusTarget?.focus();
        this._announceStatus(
          this._announceManualPromotionOnNextReorder
            ? `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}. Switched ${this._annotationDisplayName} to Manual order.`
            : `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}.`,
        );
        this._announceManualPromotionOnNextReorder = false;
        htmlEl.addEventListener(
          'animationend',
          () => {
            htmlEl.classList.remove('legend-item-just-dropped');
          },
          { once: true },
        );
        break;
      }
    }
  }

  private _reverseZOrder(): void {
    if (this._legendItems.length <= 1) return;

    const currentMode = this._currentSortMode;
    if (
      this._isNumericAnnotation() &&
      currentMode === 'manual' &&
      !this._numericManualOrderIdsByAnnotation[this.selectedAnnotation]?.length
    ) {
      this._setNumericManualOrderIds(
        this.selectedAnnotation,
        [...this._sortedLegendItems]
          .filter((item) => item.value !== LEGEND_VALUES.OTHER)
          .map((item) => item.value),
      );
    }

    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: reverseSortMode(currentMode),
    };

    if (!this._isNumericAnnotation()) {
      // Always reverse the visible items directly, keeping "Other" at the end.
      this._legendItems = reverseKeepingOtherLast(this._legendItems);
    } else {
      this._updateLegendItems();
    }

    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
    this.requestUpdate();
  }

  /**
   * Applies a sort-menu pick at once and stores it, as the settings dialog's Save applied an
   * order. "Your order" starts from the order on screen, whatever sorted it.
   */
  private _applySortMode(mode: LegendSortMode): void {
    const isNumeric = this._isCurrentAnnotationNumeric();
    const next = normalizeSortModeForType(mode, isNumeric);
    this._keyboard.clear();
    if (next === 'manual' && !this._currentSortMode.startsWith('manual')) {
      const shown = displayedOrder(this._sortedLegendItems, isNumeric);
      if (isNumeric) this._setNumericManualOrderIds(this.selectedAnnotation, shown);
      else this._legendItems = reorderByValues(this._legendItems, shown);
    }
    this._annotationSortModes = { ...this._annotationSortModes, [this.selectedAnnotation]: next };
    this._updateLegendItems();
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
  }

  private _toggleLegendOrderDirection(): void {
    if (this._legendItems.length <= 1) return;
    this._clearKeyboardReorderState();

    if (this._isNumericAnnotation() && !this._currentSortMode.startsWith('manual')) {
      const nextMode: LegendSortMode =
        this._currentSortMode === 'alpha-desc' ? 'alpha-asc' : 'alpha-desc';
      this._annotationSortModes = {
        ...this._annotationSortModes,
        [this.selectedAnnotation]: nextMode,
      };
      this._updateLegendItems();
      this._scatterplotController.syncNumericAnnotationSettings();
      this._persistenceController.saveSettings();
      this._dispatchLegendStateChange();
      this.requestUpdate();
      return;
    }

    this._reverseZOrder();
  }

  private _dispatchItemAction(value: string, action: 'toggle' | 'isolate' | 'extract'): void {
    this.dispatchEvent(createItemActionEvent(LEGEND_EVENTS.ITEM_CLICK, value, action));
  }

  private _announceStatus(message: string): void {
    this._statusMessage = message;
    // Clear after announcement to allow repeated messages
    setTimeout(() => {
      this._statusMessage = '';
    }, 1000);
  }

  private _dispatchError(message: string, source: LegendErrorSource, originalError?: Error): void {
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
  // Settings Popover
  // ─────────────────────────────────────────────────────────────────

  /** The header's settings button: opens the settings popover under it, or closes it. */
  private _openSettings(anchor: HTMLElement): void {
    if (this._settingsAnchor) {
      this._closeSettings();
      return;
    }
    // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
    this._clearKeyboardReorderState();
    this._colorPicker.close();
    this._rowMenu.close();
    this._sortMenu = null;
    this._otherPopover.close();
    this._settingsAnchor = anchor;
    this.dispatchEvent(new CustomEvent(LEGEND_EVENTS.CUSTOMIZE, { bubbles: true, composed: true }));
  }

  /** Closes the annotation's own overlays, landing their pending edits on it first. */
  private _closeAnnotationOverlays(): void {
    this._closeSettings();
    this._colorPicker.close();
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
        this._clearShapeSize();
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
    this._dispatchLegendStateChange();
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
    this._clearShapeSize();
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
      this._setNumericManualOrderIds(this.selectedAnnotation, undefined);
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
        ${this._hasSelectedEatAnnotation()
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
        this._handleItemClick(category);
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
      // scores themselves are read from the unsliced dataset (see `_handleScatterplotDataChange`)
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
      onClick: (e: MouseEvent) => this._handleItemMouseClick(item.value, e),
      onDoubleClick: () => this._handleItemMouseDoubleClick(item.value),
      onKeyDown: (e: KeyboardEvent) => this._keyboard.onItemKeyDown(e, item, sortedIndex),
      onHandleKeyDown: (e: KeyboardEvent) => this._keyboard.onHandleKeyDown(e, item),
      onHover: (category) => this._setHoveredCategory(category),
      onFocus: () => {
        this._keyboard.focusValue = item.value;
      },
      onToggle: () => this._handleItemClick(item.value),
      onMenu: (e: MouseEvent) => this._rowMenu.toggle(item.value, e.currentTarget as HTMLElement),
      onViewOther: (e: Event) => this._otherPopover.toggle(e),
      onNamePointerEnter: this._nameTooltip.onNamePointerEnter,
    };
    return renderLegendRow(item, view, handlers);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend': ProtspaceLegend;
  }
}
