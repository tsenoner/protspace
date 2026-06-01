import { LitElement, html } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import {
  COLOR_SCHEMES,
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  getNumericBinLabelMap,
  getNumericBinLowerBoundMap,
  getOrderedNumericBinIds,
  isGradientPalette,
  isNumericAnnotation,
  materializeNumericAnnotation,
  normalizeNumericPaletteId,
  resolveNumericAnnotationDisplaySettings,
  getFirstAnnotationIndex,
  getProteinAnnotationIndices,
  type NumericBinningStrategy,
  type NumericAnnotationDisplaySettingsMap,
} from '@protspace/utils';
import type { LegendSettingsMap } from '@protspace/utils';

// Configuration and styles
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  LEGEND_EVENTS,
  NA_VALUE,
  toDisplayValue,
  toInternalValue,
  SHAPE_PATH_GENERATORS,
} from './config';

import type { PointShape } from '@protspace/utils';
import { legendStyles } from './legend.styles';

// Controllers
import { ScatterplotSyncController, PersistenceController, DragController } from './controllers';

// Processors and renderers
import {
  LegendDataProcessor,
  createProcessorContext,
  type LegendProcessorContext,
} from './legend-data-processor';
import { LegendRenderer } from './legend-renderer';

// Helpers
import {
  valueToKey,
  calculatePointSize,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  updateItemsVisibility,
  isolateItem,
  computeOtherConcreteValues,
} from './legend-helpers';

// Dialogs
import {
  renderSettingsDialog,
  initializeAnnotationSortMode,
  type SettingsDialogState,
  type SettingsDialogCallbacks,
} from './legend-settings-dialog';
import { renderOtherDialog } from './legend-other-dialog';
import { createFocusTrap } from './focus-trap';
import { createLegendErrorEventDetail } from './legend.events';

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
} from './types';

/**
 * Legend component for displaying and interacting with annotation categories.
 *
 * @fires legend-item-click - When a legend item is clicked (toggled, isolated, extracted, or merged)
 * @fires legend-zorder-change - When the z-order of legend items changes
 * @fires legend-colormapping-change - When color/shape mappings change
 * @fires legend-customize - When the customize dialog is opened
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
  @state() private _showOtherDialog = false;
  private _preIsolationVisibleValues: Set<string> = new Set();
  @state() private _showSettingsDialog = false;
  @state() private _statusMessage = '';
  @state() private _colorPickerItem: string | null = null;
  @state() private _colorPickerPosition: { x: number; y: number } | null = null;
  @state() private _showShapePicker = false;
  @state() private _selectedPaletteId = 'kellys';
  @state() private _numericSettingsByAnnotation: NumericAnnotationDisplaySettingsMap = {};
  @state() private _numericManualOrderIdsByAnnotation: Record<string, string[]> = {};
  @state() private _keyboardDragValue: string | null = null;
  private _announceManualPromotionOnNextReorder = false;
  private _keyboardReorderSnapshot: {
    annotation: string;
    sortMode: LegendSortMode;
    legendItems: LegendItem[];
    otherItems: OtherItem[];
    numericManualOrderIds?: string[];
  } | null = null;

  // Pending extract/merge values for next update cycle.
  // undefined = no pending operation, string = value to extract/merge (including '__NA__' for N/A)
  private _pendingExtractValue: string | undefined = undefined;
  private _pendingMergeValue: string | undefined = undefined;

  // Settings dialog temporary state (consolidated into single object)
  @state() private _dialogSettings: {
    maxVisibleValues: number;
    shapeSize: number;
    enableDuplicateStackUI: boolean;
    annotationSortModes: Record<string, LegendSortMode>;
    selectedPaletteId: string;
    numericStrategy: NumericBinningStrategy;
    reverseGradient: boolean;
  } = {
    maxVisibleValues: LEGEND_DEFAULTS.maxVisibleValues,
    shapeSize: LEGEND_DEFAULTS.symbolSize,
    enableDuplicateStackUI: false,
    annotationSortModes: {},
    selectedPaletteId: 'kellys',
    numericStrategy: DEFAULT_NUMERIC_STRATEGY,
    reverseGradient: false,
  };

  @query('#legend-settings-dialog')
  private _settingsDialogEl?: HTMLDivElement;

  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;

  // Instance-specific processor context (avoids global state conflicts)
  private _processorContext: LegendProcessorContext = createProcessorContext();

  // Focus trap cleanup function (stored for proper cleanup)
  private _focusTrapCleanup: (() => void) | null = null;

  // Debounce timer for color picker updates
  private _colorChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Track where mousedown occurred for click-outside detection
  private _mouseDownOutsideColorPicker = false;
  private _mouseDownOutsideSettings = false;
  private _mouseDownOutsideOther = false;

  // ─────────────────────────────────────────────────────────────────
  // Controllers
  // ─────────────────────────────────────────────────────────────────

  private _scatterplotController = new ScatterplotSyncController(this, {
    onDataChange: (data, annotation) => this._handleScatterplotDataChange(data, annotation),
    onAnnotationChange: (annotation) => this._handleAnnotationChange(annotation),
    getHiddenValues: () => this._hiddenValues,
    getOtherItems: () => this._otherItems,
    getLegendItems: () => this._legendItems,
    getOtherConcreteValues: () => computeOtherConcreteValues(this._otherItems),
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
        shapeSize: this.shapeSize,
        sortMode: this._normalizeSortModeForEffectiveType(
          this._annotationSortModes[this.selectedAnnotation],
          isNumericAnnotation,
        ),
        enableDuplicateStackUI: this._dialogSettings.enableDuplicateStackUI,
        selectedPaletteId: isNumericAnnotation
          ? normalizeNumericPaletteId(this._selectedPaletteId)
          : this._normalizeCategoricalPaletteId(this._selectedPaletteId),
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
        const orderedIds = [...items]
          .filter((item) => item.value !== LEGEND_VALUES.OTHER && item.value !== NA_VALUE)
          .sort((left, right) => left.zOrder - right.zOrder)
          .map((item) => item.value);
        this._setNumericManualOrderIds(this.selectedAnnotation, orderedIds);
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
      this._keyboardDragValue = null;
      this._scatterplotController.syncNumericAnnotationSettings();
    },
    onDropComplete: (value) => this._highlightDroppedItem(value),
  });

  private _canDragLegendItem(item: LegendItem): boolean {
    return item.value !== LEGEND_VALUES.OTHER;
  }

  private _clearKeyboardReorderState(): void {
    this._keyboardDragValue = null;
    this._announceManualPromotionOnNextReorder = false;
    this._keyboardReorderSnapshot = null;
  }

  private _beginKeyboardReorder(itemValue: string): void {
    this._keyboardDragValue = itemValue;
    this._keyboardReorderSnapshot = {
      annotation: this.selectedAnnotation,
      sortMode: this._currentSortMode,
      legendItems: this._legendItems.map((item) => ({ ...item })),
      otherItems: this._otherItems.map((item) => ({ ...item })),
      numericManualOrderIds: this._isNumericAnnotation()
        ? [...(this._numericManualOrderIdsByAnnotation[this.selectedAnnotation] ?? [])]
        : undefined,
    };
  }

  private _restoreKeyboardReorderSnapshot(): void {
    const snapshot = this._keyboardReorderSnapshot;
    if (!snapshot || snapshot.annotation !== this.selectedAnnotation) {
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
    this._legendItems = snapshot.legendItems.map((item) => ({ ...item }));
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

  // ─────────────────────────────────────────────────────────────────
  // Keyboard Handler
  // ─────────────────────────────────────────────────────────────────

  private _onWindowKeydownCapture = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Close color picker first if open
      if (this._colorPickerItem !== null) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this._flushColorChangeDebounce();
        this._colorPickerItem = null;
        this._showShapePicker = false;
        return;
      }
      // Close Other dialog second if open
      if (this._showOtherDialog) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this._showOtherDialog = false;
        return;
      }
      // Then close Settings dialog if open
      if (this._showSettingsDialog) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this._handleSettingsClose();
        return;
      }
      // Cancel active keyboard reorder. The drag-handle's own Escape handler
      // works only while focus stays on that handle, but Lit re-renders during
      // ArrowDown can briefly move focus to <body> before rAF restores it —
      // catching Escape here makes cancel robust to that focus gap.
      if (this._keyboardDragValue !== null) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this._restoreKeyboardReorderSnapshot();
        this._announceStatus('Reordering canceled.');
        return;
      }
    }
  };

  private _onWindowMouseDown = (e: MouseEvent) => {
    if (this._colorPickerItem === null) return;

    // Check if mousedown is outside the color picker
    const colorPicker = this.shadowRoot?.querySelector('.color-picker-popover');
    if (colorPicker && !colorPicker.contains(e.target as Node)) {
      this._mouseDownOutsideColorPicker = true;
    } else {
      this._mouseDownOutsideColorPicker = false;
    }
  };

  private _onWindowMouseUp = () => {
    // Only close if mousedown also occurred outside
    if (this._colorPickerItem !== null && this._mouseDownOutsideColorPicker) {
      this._flushColorChangeDebounce();
      this._colorPickerItem = null;
      this._showShapePicker = false;
      this._mouseDownOutsideColorPicker = false;
    }
  };

  private _handleItemKeyDown(e: KeyboardEvent, item: LegendItem, itemIndex: number): void {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight': {
        e.preventDefault();
        const nextIndex = Math.min(itemIndex + 1, this._sortedLegendItems.length - 1);
        this._focusItem(nextIndex);
        break;
      }
      case 'ArrowUp':
      case 'ArrowLeft': {
        e.preventDefault();
        const prevIndex = Math.max(itemIndex - 1, 0);
        this._focusItem(prevIndex);
        break;
      }
      case 'Home': {
        e.preventDefault();
        this._focusItem(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        this._focusItem(this._sortedLegendItems.length - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        this._handleItemClick(item.value);
        break;
      }
      case 'i':
      case 'I': {
        e.preventDefault();
        this._handleItemDoubleClick(item.value);
        break;
      }
    }
  }

  private _focusItem(index: number): void {
    const items = this.shadowRoot?.querySelectorAll('.legend-item-main');
    if (items?.[index]) {
      (items[index] as HTMLElement).focus();
    }
  }

  private _focusDragHandleForValue(value: string): void {
    const handle = this.shadowRoot?.querySelector(
      `.legend-item[data-value="${CSS.escape(value)}"] .drag-handle`,
    ) as HTMLButtonElement | null;
    handle?.focus();
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

  private _commitManualOrderFromVisibleValues(
    orderedValues: string[],
    options: { preserveKeyboardDragValue?: boolean } = {},
  ): void {
    const visibleOrder = [...orderedValues];
    const didPromote = !this._currentSortMode.startsWith('manual');
    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: 'manual',
    };

    const itemMap = new Map(this._legendItems.map((item) => [item.value, item]));
    const otherItem = itemMap.get(LEGEND_VALUES.OTHER);

    if (this._isNumericAnnotation()) {
      this._setNumericManualOrderIds(this.selectedAnnotation, visibleOrder);
      this._updateLegendItems();
    } else {
      const reorderedItems = visibleOrder
        .map((value, index) => {
          const item = itemMap.get(value);
          return item ? { ...item, zOrder: index } : null;
        })
        .filter((item): item is LegendItem => item !== null);

      if (otherItem) {
        reorderedItems.push({ ...otherItem, zOrder: reorderedItems.length });
      }

      this._legendItems = reorderedItems;
    }

    this._announceManualPromotionOnNextReorder = didPromote;
    if (!options.preserveKeyboardDragValue) {
      this._keyboardDragValue = null;
    }
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
    this.requestUpdate();
  }

  private _moveFocusedManualItem(value: string, direction: -1 | 1): void {
    const orderedItems = [...this._sortedLegendItems].filter(
      (item) => item.value !== LEGEND_VALUES.OTHER,
    );
    const currentIndex = orderedItems.findIndex((item) => item.value === value);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(orderedItems.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) {
      return;
    }

    const reordered = [...orderedItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    this._commitManualOrderFromVisibleValues(
      reordered.map((item) => item.value),
      {
        preserveKeyboardDragValue: true,
      },
    );

    this._announceStatus(
      this._announceManualPromotionOnNextReorder
        ? `Moved ${moved.displayValue ?? toDisplayValue(moved.value)}. Switched ${this.selectedAnnotation} to Manual order.`
        : `Moved ${moved.displayValue ?? toDisplayValue(moved.value)}.`,
    );
    this._announceManualPromotionOnNextReorder = false;
    requestAnimationFrame(() => this._focusDragHandleForValue(value));
  }

  private _handleDragHandleKeyDown(e: KeyboardEvent, item: LegendItem): void {
    if (!this._canDragLegendItem(item)) {
      return;
    }

    switch (e.key) {
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const isDropping = this._keyboardDragValue === item.value;
        if (isDropping) {
          this._clearKeyboardReorderState();
        } else {
          this._beginKeyboardReorder(item.value);
        }
        this._announceStatus(
          !isDropping
            ? `Picked up ${item.displayValue ?? toDisplayValue(item.value)} for reordering`
            : `Dropped ${item.displayValue ?? toDisplayValue(item.value)}`,
        );
        break;
      }
      case 'Escape': {
        if (this._keyboardDragValue === item.value) {
          e.preventDefault();
          this._restoreKeyboardReorderSnapshot();
          this._announceStatus('Reordering canceled.');
          requestAnimationFrame(() => this._focusDragHandleForValue(item.value));
        }
        break;
      }
      case 'ArrowUp': {
        if (this._keyboardDragValue === item.value) {
          e.preventDefault();
          this._moveFocusedManualItem(item.value, -1);
        }
        break;
      }
      case 'ArrowDown': {
        if (this._keyboardDragValue === item.value) {
          e.preventDefault();
          this._moveFocusedManualItem(item.value, 1);
        }
        break;
      }
    }
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
    this._scatterplotController.autoSync = this.autoSync;
    this._scatterplotController.autoHide = this.autoHide;
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this._onWindowKeydownCapture, true);
    window.removeEventListener('mousedown', this._onWindowMouseDown);
    window.removeEventListener('mouseup', this._onWindowMouseUp);
    this._cleanupFocusTrap();
    this._cleanupColorChangeDebounce();
    super.disconnectedCallback();
  }

  private _cleanupColorChangeDebounce(): void {
    if (this._colorChangeDebounceTimer !== null) {
      clearTimeout(this._colorChangeDebounceTimer);
      this._colorChangeDebounceTimer = null;
    }
  }

  private _flushColorChangeDebounce(): void {
    if (this._colorChangeDebounceTimer !== null) {
      clearTimeout(this._colorChangeDebounceTimer);
      this._colorChangeDebounceTimer = null;
      // The color has already been updated in the UI by _handleColorChangeDebounced
      // We just need to trigger the scatterplot sync
      if (this._colorPickerItem !== null) {
        const item = this._legendItems.find((i) => i.value === this._colorPickerItem);
        if (item) {
          this._handleColorChange(item.value, item.color);
        }
      }
    }
  }

  private _cleanupFocusTrap(): void {
    if (this._focusTrapCleanup) {
      this._focusTrapCleanup();
      this._focusTrapCleanup = null;
    }
  }

  private _setupFocusTrap(dialogId: string): void {
    this._cleanupFocusTrap();
    requestAnimationFrame(() => {
      const dialog = this.shadowRoot?.querySelector(`#${dialogId}`) as HTMLElement | null;
      if (dialog) {
        this._focusTrapCleanup = createFocusTrap(dialog);
      }
    });
  }

  updated(changedProperties: Map<string, unknown>): void {
    // Handle keyboard events for dialogs, color picker, and active keyboard reorder
    const dialogsChanged =
      changedProperties.has('_showSettingsDialog') ||
      changedProperties.has('_showOtherDialog') ||
      changedProperties.has('_colorPickerItem') ||
      changedProperties.has('_keyboardDragValue');
    if (dialogsChanged) {
      const anyDialogOpen =
        this._showSettingsDialog ||
        this._showOtherDialog ||
        this._colorPickerItem !== null ||
        this._keyboardDragValue !== null;
      if (anyDialogOpen) {
        window.addEventListener('keydown', this._onWindowKeydownCapture, true);
      } else {
        window.removeEventListener('keydown', this._onWindowKeydownCapture, true);
      }
    }

    // Handle global mousedown/mouseup for color picker (close on press outside)
    if (changedProperties.has('_colorPickerItem')) {
      if (this._colorPickerItem !== null) {
        window.addEventListener('mousedown', this._onWindowMouseDown);
        window.addEventListener('mouseup', this._onWindowMouseUp);
      } else {
        window.removeEventListener('mousedown', this._onWindowMouseDown);
        window.removeEventListener('mouseup', this._onWindowMouseUp);
        this._mouseDownOutsideColorPicker = false;
      }
    }

    // Handle settings dialog focus trapping
    if (changedProperties.has('_showSettingsDialog')) {
      if (this._showSettingsDialog) {
        this._setupFocusTrap('legend-settings-dialog');
      } else if (!this._showOtherDialog) {
        this._cleanupFocusTrap();
      }
    }

    // Handle other dialog focus trapping
    if (changedProperties.has('_showOtherDialog')) {
      if (this._showOtherDialog) {
        this._setupFocusTrap('legend-other-dialog');
      } else if (!this._showSettingsDialog) {
        this._cleanupFocusTrap();
      }
    }

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
      const unfilteredData = sourceDataMatchesCurrentLegend
        ? {
            protein_ids: sourceData.protein_ids,
            annotations: sourceData.annotations,
            numeric_annotation_data: sourceData.numeric_annotation_data,
          }
        : {
            protein_ids: this.proteinIds,
            annotations: this.data?.annotations,
            numeric_annotation_data: this.data?.numeric_annotation_data,
          };

      this._persistenceController.updateDatasetHash({
        protein_ids: unfilteredData.protein_ids,
        annotations: unfilteredData.annotations,
        numeric_annotation_data: unfilteredData.numeric_annotation_data,
      });
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

    // Update sorted items cache when legend items change
    if (changedProperties.has('_legendItems')) {
      this._sortedLegendItems = [...this._legendItems].sort((a, b) => a.zOrder - b.zOrder);
    }

    // Initialize Sortable when container becomes available
    // The controller handles preventing duplicate initialization
    if (this._legendItemsEl && this._sortedLegendItems.length > 0) {
      this._dragController.initialize(this._legendItemsEl, true);
    }
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
    // Reset visual encoding state
    this._processorContext.slotTracker.reset();

    // Clear legend items and related state
    this._legendItems = [];
    this._sortedLegendItems = [];
    this._otherItems = [];
    this._hiddenValues = [];

    // Clear persistence state for the new dataset
    this._persistenceController.clearForNewDataset(datasetHash, clearPersistedState);

    // Reset UI state
    this._showSettingsDialog = false;
    this._showOtherDialog = false;
    this._colorPickerItem = null;
    this._selectedPaletteId = 'kellys';
    this._numericSettingsByAnnotation = {};
    this._numericManualOrderIdsByAnnotation = {};
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

  private _handleScatterplotDataChange(data: ScatterplotData, selectedAnnotation: string): void {
    this._clearKeyboardReorderState();
    this.data = {
      annotations: data.annotations,
      protein_ids: data.protein_ids,
      numeric_annotation_data: data.numeric_annotation_data,
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
    };
    this._updateAnnotationValues(data, selectedAnnotation);
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
        }
      : { name: '', values: [] };
  }

  private _updateAnnotationValues(data: ScatterplotData, selectedAnnotation: string): void {
    const colData = data.annotation_data[selectedAnnotation];
    const values = data.annotations[selectedAnnotation].values;
    let annotationValues: string[];
    if (colData instanceof Int32Array) {
      // Single-valued storage: use the allocation-free accessor.
      annotationValues = data.protein_ids.flatMap((_: string, index: number) => {
        const idx = getFirstAnnotationIndex(colData, index);
        return idx < 0 ? [] : [toInternalValue(values[idx])];
      });
    } else {
      annotationValues = data.protein_ids.flatMap((_: string, index: number) => {
        const annotationIdxArray = getProteinAnnotationIndices(colData, index);
        return annotationIdxArray.map((annotationIdx: number) =>
          toInternalValue(values[annotationIdx]),
        );
      });
    }
    this.annotationValues = annotationValues;
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

  private _getNumericDisplayLabelMap(): Map<string, string> {
    return getNumericBinLabelMap(this.annotationData);
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

    const visibleIds = [...this._legendItems]
      .filter((item) => item.value !== LEGEND_VALUES.OTHER && item.value !== NA_VALUE)
      .sort((left, right) => left.zOrder - right.zOrder)
      .map((item) => item.value);

    return visibleIds.length > 0 ? visibleIds : undefined;
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

  private _applyNumericDisplayLabels(): void {
    if (!this._isNumericAnnotation()) return;

    const labelMap = this._getNumericDisplayLabelMap();
    this._legendItems = this._legendItems.map((item) =>
      item.value === LEGEND_VALUES.OTHER || item.value === NA_VALUE
        ? item
        : { ...item, displayValue: labelMap.get(item.value) ?? item.displayValue ?? item.value },
    );
  }

  private _applyDerivedNumericColors(): void {
    if (!this._isNumericAnnotation()) return;

    const derivedColors = new Map(
      this.annotationData.values.map((value, index) => [
        valueToKey(toInternalValue(value)),
        this.annotationData.colors?.[index] ?? '',
      ]),
    );

    this._legendItems = this._legendItems.map((item) => {
      if (item.value === LEGEND_VALUES.OTHER || item.value === NA_VALUE) {
        return item;
      }
      const derivedColor = derivedColors.get(item.value);
      return derivedColor ? { ...item, color: derivedColor } : item;
    });
  }

  private _updateLegendItems(): void {
    // Aligned with PersistenceController's isNumericAnnotation callback so the
    // processor and the persistence layer agree on numeric-ness in transient states.
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();
    if (
      !this.annotationData?.values?.length ||
      (!isNumericAnnotation && !this.annotationValues?.length)
    ) {
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
      const numericDisplayLabels = this._getNumericDisplayLabelMap();
      const knownValues = isNumericAnnotation
        ? this.annotationData.values.map((value) => toInternalValue(value))
        : [];
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
        this.annotationValues,
        this.proteinIds,
        this.maxVisibleValues,
        this.isolationMode,
        this.isolationHistory,
        existingLegendItems,
        this._currentSortMode,
        persistedCategories,
        visibleValues,
        numericOrderValues,
        !isNumericAnnotation,
        pendingExtract,
        pendingMerge,
        knownValues,
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
        this._applyNumericDisplayLabels();
        this._applyDerivedNumericColors();
      } else if (this._selectedPaletteId !== 'kellys') {
        this._applyPaletteColors(this._selectedPaletteId);
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
      const isNumericAnnotation = this._isCurrentAnnotationNumeric();
      const { settings: resolvedNumericSettings } = resolveNumericAnnotationDisplaySettings({
        persistedSettings: settings,
        liveSettings: this._numericSettingsByAnnotation[this.selectedAnnotation],
        defaultBinCount: LEGEND_DEFAULTS.maxVisibleValues,
      });
      const resolvedPaletteId = isNumericAnnotation
        ? resolvedNumericSettings.paletteId
        : this._normalizeCategoricalPaletteId(settings.selectedPaletteId);
      const resolvedMaxVisibleValues = isNumericAnnotation
        ? resolvedNumericSettings.binCount
        : settings.maxVisibleValues;
      const resolvedNumericStrategy = resolvedNumericSettings.strategy;
      const resolvedReverseGradient = resolvedNumericSettings.reverseGradient ?? false;
      const persistedNumericState =
        isNumericAnnotation && settings.numericSettings
          ? this._computeNumericSettingsSignatures(
              resolvedMaxVisibleValues,
              resolvedNumericStrategy,
              resolvedPaletteId,
              resolvedReverseGradient,
            )
          : null;
      const hasMatchingNumericSignature =
        !isNumericAnnotation ||
        !settings.numericSettings ||
        (persistedNumericState !== null &&
          settings.numericSettings.signature === persistedNumericState.signature);
      const hasMatchingNumericTopology =
        !isNumericAnnotation ||
        !settings.numericSettings ||
        (persistedNumericState !== null &&
          settings.numericSettings.topologySignature === persistedNumericState.topologySignature);

      if (!hasMatchingNumericSignature) {
        this._persistenceController.clearPendingCategories();
      }

      this.maxVisibleValues = resolvedMaxVisibleValues;
      this.shapeSize = settings.shapeSize;
      this._hiddenValues = hasMatchingNumericTopology ? settings.hiddenValues : [];
      this._selectedPaletteId = resolvedPaletteId;
      if (isNumericAnnotation) {
        this._persistenceController.clearPendingCategories();
      }

      if (isNumericAnnotation) {
        this._numericSettingsByAnnotation = {
          ...this._numericSettingsByAnnotation,
          [this.selectedAnnotation]: {
            binCount: resolvedMaxVisibleValues,
            strategy: resolvedNumericStrategy,
            paletteId: resolvedPaletteId,
            reverseGradient: resolvedReverseGradient,
          },
        };
        this._setNumericManualOrderIds(
          this.selectedAnnotation,
          hasMatchingNumericTopology ? settings.numericSettings?.manualOrderIds : undefined,
        );
      }

      this._annotationSortModes = {
        ...this._annotationSortModes,
        [this.selectedAnnotation]: this._normalizeSortModeForEffectiveType(
          settings.sortMode,
          isNumericAnnotation,
        ),
      };

      this._scatterplotController.updateConfig({
        pointSize: calculatePointSize(this.shapeSize),
        enableDuplicateStackUI: settings.enableDuplicateStackUI,
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

    return this._normalizeSortModeForEffectiveType(sortMode, isNumeric);
  }

  private _normalizeSortModeForEffectiveType(
    sortMode: LegendSortMode | undefined,
    isNumeric: boolean,
  ): LegendSortMode {
    if (isNumeric) {
      if (
        sortMode === 'alpha-asc' ||
        sortMode === 'alpha-desc' ||
        sortMode === 'manual' ||
        sortMode === 'manual-reverse'
      ) {
        return sortMode;
      }
      return 'alpha-asc';
    }

    return sortMode ?? 'size-desc';
  }

  private _normalizeCategoricalPaletteId(paletteId: string | undefined | null): string {
    if (!paletteId || isGradientPalette(paletteId)) {
      return 'kellys';
    }
    return paletteId;
  }

  // ─────────────────────────────────────────────────────────────────
  // Item Interactions
  // ─────────────────────────────────────────────────────────────────

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

  private _handleItemDoubleClick(value: string): void {
    const result = isolateItem(this._legendItems, value);

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
    this._closeOtherDialog();

    this._announceStatus(`Extracted ${toDisplayValue(value)} from Other category`);
    this._dispatchItemAction(value, 'extract');
    // Save settings after the update cycle completes
    this.updateComplete.then(() => {
      this._persistenceController.saveSettings();
    });
  }

  private _closeOtherDialog(): void {
    this._showOtherDialog = false;
    this._mouseDownOutsideOther = false;
  }

  private _handleExtractAllFromOther(): void {
    const nonOtherCount = this._legendItems.filter((i) => i.value !== LEGEND_VALUES.OTHER).length;
    const targetMaxVisibleValues = nonOtherCount + this._otherItems.length;

    // Keep settings dialog in sync if it's open.
    if (this._showSettingsDialog) {
      this._dialogSettings = {
        ...this._dialogSettings,
        maxVisibleValues: targetMaxVisibleValues,
      };
    }

    this._closeOtherDialog();

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
    // Wait for Lit to complete rendering with the new item order.
    // Two chained awaits: first for _legendItems update, second for _sortedLegendItems.
    await this.updateComplete;
    await this.updateComplete;

    const items = this.shadowRoot?.querySelectorAll('.legend-item');
    if (!items) return;

    for (const el of items) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.getAttribute('data-value') === value) {
        htmlEl.classList.add('legend-item-just-dropped');
        const focusTarget = htmlEl.querySelector(
          '.drag-handle, .legend-item-main',
        ) as HTMLElement | null;
        focusTarget?.focus();
        this._announceStatus(
          this._announceManualPromotionOnNextReorder
            ? `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}. Switched ${this.selectedAnnotation} to Manual order.`
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

    // Toggle direction: asc <-> desc, or manual <-> manual-reverse
    let newMode: LegendSortMode;
    if (currentMode === 'manual') {
      newMode = 'manual-reverse';
    } else if (currentMode === 'manual-reverse') {
      newMode = 'manual';
    } else if (currentMode.endsWith('-asc')) {
      newMode = currentMode.replace('-asc', '-desc') as LegendSortMode;
    } else {
      newMode = currentMode.replace('-desc', '-asc') as LegendSortMode;
    }

    // Update sort mode
    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: newMode,
    };

    if (!this._isNumericAnnotation()) {
      // Always reverse the visible items directly, keeping "Other" at the end.
      const sorted = [...this._legendItems].sort((a, b) => a.zOrder - b.zOrder);
      const otherItem = sorted.find((i) => i.value === LEGEND_VALUES.OTHER);
      const nonOther = sorted.filter((i) => i.value !== LEGEND_VALUES.OTHER);
      const reversed = nonOther.reverse();
      const reordered = otherItem ? [...reversed, otherItem] : reversed;
      this._legendItems = reordered.map((item, idx) => ({ ...item, zOrder: idx }));
    } else {
      this._updateLegendItems();
    }

    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
    this.requestUpdate();
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
  // Settings Dialog
  // ─────────────────────────────────────────────────────────────────

  private async _handleCustomize(): Promise<void> {
    this._clearKeyboardReorderState();
    const scatterplot = this._scatterplotController.scatterplot;
    const numericSettings = this._numericSettingsByAnnotation[this.selectedAnnotation];
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();
    const selectedPaletteId = isNumericAnnotation
      ? normalizeNumericPaletteId(numericSettings?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID)
      : this._normalizeCategoricalPaletteId(this._selectedPaletteId);
    this._dialogSettings = {
      maxVisibleValues: this.maxVisibleValues,
      shapeSize: this.shapeSize,
      annotationSortModes: this._annotationSortModes,
      enableDuplicateStackUI: Boolean(
        scatterplot &&
          'config' in scatterplot &&
          (scatterplot as { config?: Record<string, unknown> }).config?.enableDuplicateStackUI,
      ),
      selectedPaletteId,
      numericStrategy: numericSettings?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
      reverseGradient: numericSettings?.reverseGradient ?? false,
    };

    this._showSettingsDialog = true;
    this.dispatchEvent(new CustomEvent(LEGEND_EVENTS.CUSTOMIZE, { bubbles: true, composed: true }));

    this.requestUpdate();
    await this.updateComplete;
    this._settingsDialogEl?.focus();
  }

  private _handleSymbolClick(item: LegendItem, event: MouseEvent): void {
    event.stopPropagation();

    // Close if clicking the same item
    if (this._colorPickerItem === item.value) {
      this._flushColorChangeDebounce();
      this._colorPickerItem = null;
      this._showShapePicker = false;
      return;
    }

    // Flush any pending changes when switching to a different item
    this._flushColorChangeDebounce();

    // Calculate position relative to the legend container
    const container = this.shadowRoot?.querySelector('.legend-container');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    this._colorPickerPosition = {
      x: targetRect.left - containerRect.left + targetRect.width + 8,
      y: targetRect.top - containerRect.top,
    };
    this._colorPickerItem = item.value;
    this._showShapePicker = false; // Reset shape picker when opening new item
    this.requestUpdate();
  }

  private _handleSettingsSave(): void {
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();
    const nextSelectedPaletteId = isNumericAnnotation
      ? normalizeNumericPaletteId(this._dialogSettings.selectedPaletteId)
      : this._normalizeCategoricalPaletteId(this._dialogSettings.selectedPaletteId);
    const nextAnnotationSortModes = {
      ...this._dialogSettings.annotationSortModes,
      [this.selectedAnnotation]: this._normalizeSortModeForEffectiveType(
        this._dialogSettings.annotationSortModes[this.selectedAnnotation],
        isNumericAnnotation,
      ),
    };

    this.maxVisibleValues = this._dialogSettings.maxVisibleValues;
    this.shapeSize = this._dialogSettings.shapeSize;
    this._annotationSortModes = nextAnnotationSortModes;
    if (!nextAnnotationSortModes[this.selectedAnnotation]?.startsWith('manual')) {
      this._keyboardDragValue = null;
    }
    this._selectedPaletteId = nextSelectedPaletteId;
    if (isNumericAnnotation) {
      this._numericSettingsByAnnotation = {
        ...this._numericSettingsByAnnotation,
        [this.selectedAnnotation]: {
          binCount: this._dialogSettings.maxVisibleValues,
          strategy: this._dialogSettings.numericStrategy,
          paletteId: nextSelectedPaletteId,
          reverseGradient: this._dialogSettings.reverseGradient,
        },
      };
    }
    this._showSettingsDialog = false;

    // Don't clear _legendItems - we want to preserve current zOrders when switching sort modes.
    // This ensures switching to manual mode keeps the current display order.
    this._updateLegendItems();
    this._syncLegendColorsToPersistence();
    this._scatterplotController.syncHiddenValues();
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.shapeSize),
      enableDuplicateStackUI: this._dialogSettings.enableDuplicateStackUI,
    });
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
    this.requestUpdate();
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

  private _handleColorChangeDebounced(value: string, newColor: string): void {
    // Clear any pending debounce timer
    this._cleanupColorChangeDebounce();

    // Update the color in the UI immediately for visual feedback
    const item = this._legendItems.find((i) => i.value === value);
    if (item) {
      item.color = newColor;
      this.requestUpdate();
    }

    // Debounce the expensive operations (scatterplot update)
    this._colorChangeDebounceTimer = setTimeout(() => {
      this._handleColorChange(value, newColor);
      this._colorChangeDebounceTimer = null;
    }, 150);
  }

  private _handleShapeChange(value: string, newShape: PointShape): void {
    // Update the shape immediately
    this._legendItems = this._legendItems.map((item) =>
      item.value === value ? { ...item, shape: newShape } : item,
    );

    // Close the shape picker dropdown
    this._showShapePicker = false;

    // Sync to persistence
    this._syncLegendColorsToPersistence();

    // Update scatterplot and save (shape change, no z-order change)
    this._scatterplotController.dispatchColorMappingChange(true);
    this._persistenceController.saveSettings();
    this.requestUpdate();
  }

  private _handlePaletteChange(paletteId: string): void {
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();
    this._dialogSettings = {
      ...this._dialogSettings,
      selectedPaletteId: isNumericAnnotation
        ? normalizeNumericPaletteId(paletteId)
        : this._normalizeCategoricalPaletteId(paletteId),
    };
  }

  private _handleSettingsClose(): void {
    this._showSettingsDialog = false;
    this._mouseDownOutsideSettings = false;
  }

  private _handleSettingsOverlayMouseDown(e: MouseEvent): void {
    // Check if mousedown is on the overlay (not inside dialog content)
    const dialogContent = this.shadowRoot?.querySelector('#legend-settings-dialog');
    if (dialogContent && !dialogContent.contains(e.target as Node)) {
      this._mouseDownOutsideSettings = true;
    } else {
      this._mouseDownOutsideSettings = false;
    }
  }

  private _handleSettingsOverlayMouseUp(): void {
    // Only close if mousedown also occurred outside the dialog content
    if (this._mouseDownOutsideSettings) {
      this._handleSettingsClose();
    }
  }

  private _handleOtherOverlayMouseDown(e: MouseEvent): void {
    // Check if mousedown is on the overlay (not inside dialog content)
    const dialogContent = this.shadowRoot?.querySelector('#legend-other-dialog');
    if (dialogContent && !dialogContent.contains(e.target as Node)) {
      this._mouseDownOutsideOther = true;
    } else {
      this._mouseDownOutsideOther = false;
    }
  }

  private _handleOtherOverlayMouseUp(): void {
    // Only close if mousedown also occurred outside the dialog content
    if (this._mouseDownOutsideOther) {
      this._closeOtherDialog();
    }
  }

  private _handleSettingsReset(): void {
    // Remove localStorage and clear pending categories
    this._persistenceController.removeSettings();
    this._persistenceController.clearPendingCategories();

    // Reset all settings to defaults
    this.maxVisibleValues = LEGEND_DEFAULTS.maxVisibleValues;
    this.shapeSize = LEGEND_DEFAULTS.symbolSize;
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

    // Reset slot tracker so colors are reassigned from scratch
    this._processorContext.slotTracker.reset();

    // Clear legend items so processor creates fresh ones with default colors
    this._legendItems = [];

    this._showSettingsDialog = false;

    this._scatterplotController.updateConfig({
      pointSize: calculatePointSize(LEGEND_DEFAULTS.symbolSize),
      enableDuplicateStackUI: false,
    });

    this._updateLegendItems();
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchColorMappingChange();
    this.requestUpdate();
  }

  private _handleDialogKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.stopImmediatePropagation();
      e.preventDefault();
      this._handleSettingsSave();
    }
  }

  private _applyPaletteColors(paletteId: string): void {
    if (this._isNumericAnnotation()) {
      return;
    }
    const palette = COLOR_SCHEMES[paletteId as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES.kellys;

    // Apply palette colors to all legend items (excluding special categories like "Others" and "N/A")
    this._legendItems = this._legendItems.map((item, index) => {
      // Skip special categories (Other, N/A) as they have fixed colors
      if (item.value === LEGEND_VALUES.OTHER || item.value === NA_VALUE) {
        return item;
      }

      return { ...item, color: palette[index % palette.length] };
    });
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
    const title = this.annotationData.name || this.annotationName || 'Legend';

    return html`
      <div
        class="legend-container"
        part="container"
        @click=${() => {
          this._flushColorChangeDebounce();
          this._colorPickerItem = null;
          this._showShapePicker = false;
        }}
      >
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          ${this._statusMessage}
        </div>
        ${LegendRenderer.renderHeader(title, {
          onReverse: () => this._toggleLegendOrderDirection(),
          reverseLabel: this._isNumericAnnotation()
            ? this._currentSortMode.startsWith('manual')
              ? 'Reverse manual order'
              : this._currentSortMode === 'alpha-desc'
                ? 'Show low to high'
                : 'Show high to low'
            : 'Reverse z-order (keep Other last)',
          onCustomize: () => this._handleCustomize(),
        })}
        ${LegendRenderer.renderLegendContent(this._sortedLegendItems, (item, index) =>
          this._renderLegendItem(item, index),
        )}
        ${this._renderColorPicker()}
      </div>
      ${this._renderOtherDialog()} ${this._renderSettingsDialog()}
    `;
  }

  private _renderLegendItem(item: LegendItem, sortedIndex: number) {
    const selected = isItemSelected(item, this.selectedItems);
    const classes = getItemClasses(item, selected, false);
    const otherCount = item.value === LEGEND_VALUES.OTHER ? this._otherItems.length : undefined;

    return LegendRenderer.renderLegendItem(
      item,
      classes,
      selected,
      {
        onClick: () => this._handleItemClick(item.value),
        onDoubleClick: () => this._handleItemDoubleClick(item.value),
        onViewOther: (e: Event) => {
          e.stopPropagation();
          this._showOtherDialog = true;
        },
        onKeyDown: (e: KeyboardEvent) => this._handleItemKeyDown(e, item, sortedIndex),
        onDragHandleKeyDown: (e: KeyboardEvent) => this._handleDragHandleKeyDown(e, item),
        onSymbolClick:
          item.value !== LEGEND_VALUES.OTHER && !this._isNumericAnnotation()
            ? (e: MouseEvent) => this._handleSymbolClick(item, e)
            : undefined,
      },
      LEGEND_STYLES.legendDisplaySize,
      otherCount,
      sortedIndex,
      this._canDragLegendItem(item),
    );
  }

  private _renderOtherDialog() {
    if (!this._showOtherDialog) return html``;

    return renderOtherDialog(
      { otherItems: this._otherItems },
      {
        onExtract: (value) => this._handleExtractFromOther(value),
        onExtractAll: () => this._handleExtractAllFromOther(),
        onClose: () => this._closeOtherDialog(),
        onOverlayMouseDown: (e) => this._handleOtherOverlayMouseDown(e),
        onOverlayMouseUp: () => this._handleOtherOverlayMouseUp(),
      },
    );
  }

  private _renderSettingsDialog() {
    if (!this._showSettingsDialog) return html``;

    // Initialize sort mode for current annotation if needed
    const initializedSortModes = initializeAnnotationSortMode(
      this._dialogSettings.annotationSortModes,
      this.selectedAnnotation,
      this._annotationSortModes,
    );
    const isNumericAnnotation = this._isCurrentAnnotationNumeric();
    const annotationSortModes = this.selectedAnnotation
      ? {
          ...initializedSortModes,
          [this.selectedAnnotation]: this._normalizeSortModeForEffectiveType(
            initializedSortModes[this.selectedAnnotation],
            isNumericAnnotation,
          ),
        }
      : initializedSortModes;
    this._dialogSettings = {
      ...this._dialogSettings,
      annotationSortModes,
    };

    const state: SettingsDialogState = {
      maxVisibleValues: this._dialogSettings.maxVisibleValues,
      shapeSize: this._dialogSettings.shapeSize,
      enableDuplicateStackUI: this._dialogSettings.enableDuplicateStackUI,
      selectedAnnotation: this.selectedAnnotation,
      annotationSortModes: this._dialogSettings.annotationSortModes,
      isNumericAnnotation,
      selectedNumericStrategy: this._dialogSettings.numericStrategy,
      reverseGradient: this._dialogSettings.reverseGradient,
      logBinningAvailable: this.annotationData.numericMetadata?.logSupported ?? true,
      hasPersistedSettings: this._persistenceController.hasPersistedSettings(),
      selectedPaletteId: this._dialogSettings.selectedPaletteId,
    };

    const callbacks: SettingsDialogCallbacks = {
      onMaxVisibleValuesChange: (v) => {
        this._dialogSettings = { ...this._dialogSettings, maxVisibleValues: v };
      },
      onShapeSizeChange: (v) => {
        this._dialogSettings = { ...this._dialogSettings, shapeSize: v };
      },
      onEnableDuplicateStackUIChange: (v) => {
        this._dialogSettings = { ...this._dialogSettings, enableDuplicateStackUI: v };
      },
      onSortModeChange: (annotation, mode) => {
        this._clearKeyboardReorderState();
        this._dialogSettings = {
          ...this._dialogSettings,
          annotationSortModes: { ...this._dialogSettings.annotationSortModes, [annotation]: mode },
        };
      },
      onPaletteChange: (paletteId) => this._handlePaletteChange(paletteId),
      onNumericStrategyChange: (strategy) => {
        this._dialogSettings = { ...this._dialogSettings, numericStrategy: strategy };
      },
      onReverseGradientChange: (checked) => {
        this._dialogSettings = { ...this._dialogSettings, reverseGradient: checked };
      },
      onSave: () => this._handleSettingsSave(),
      onClose: () => this._handleSettingsClose(),
      onReset: () => this._handleSettingsReset(),
      onKeydown: (e) => this._handleDialogKeydown(e),
      onOverlayMouseDown: (e) => this._handleSettingsOverlayMouseDown(e),
      onOverlayMouseUp: () => this._handleSettingsOverlayMouseUp(),
    };

    return renderSettingsDialog(state, callbacks);
  }

  private _renderColorPicker() {
    if (this._colorPickerItem === null || !this._colorPickerPosition) {
      return html``;
    }

    const item = this._legendItems.find((i) => i.value === this._colorPickerItem);
    if (!item) return html``;

    const displayLabel = item.displayValue ?? toDisplayValue(item.value);
    const isMultilabel = this._isMultilabelAnnotation();
    const isNumeric = this._isNumericAnnotation();
    const availableShapes: PointShape[] = [
      'circle',
      'square',
      'diamond',
      'triangle-up',
      'triangle-down',
      'plus',
    ];

    // Render shape swatch SVG (outline only, no fill)
    const renderShapeSwatch = (shape: string, disabled: boolean = false) => {
      const pathGenerator =
        SHAPE_PATH_GENERATORS[shape as PointShape] || SHAPE_PATH_GENERATORS.circle;
      const size = 20;
      const canvasSize = 28;
      const centerOffset = canvasSize / 2;
      const path = pathGenerator(size);
      const strokeColor = disabled ? '#999' : '#333';

      return html`
        <svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">
          <g transform="translate(${centerOffset}, ${centerOffset})">
            <path d="${path}" fill="none" stroke="${strokeColor}" stroke-width="1.5" />
          </g>
        </svg>
      `;
    };

    return html`
      <div
        class="color-picker-popover"
        style="left: ${this._colorPickerPosition.x}px; top: ${this._colorPickerPosition.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
        @mousedown=${(e: Event) => e.stopPropagation()}
      >
        <div class="color-picker-header">${displayLabel}</div>
        <div class="symbol-picker-sections">
          <!-- Color Section -->
          <div class="symbol-picker-section">
            <div class="symbol-picker-section-label">Color</div>
            <input
              type="color"
              class="color-picker-swatch"
              .value=${item.color}
              aria-label=${`Set color for ${displayLabel}`}
              @input=${(e: Event) =>
                this._handleColorChangeDebounced(item.value, (e.target as HTMLInputElement).value)}
            />
          </div>
          <!-- Shape Section -->
          <div class="symbol-picker-section">
            <div class="symbol-picker-section-label">Shape</div>
            <div class="shape-swatch-container">
              ${isMultilabel || isNumeric
                ? html`
                    <button
                      type="button"
                      class="shape-picker-swatch disabled"
                      aria-label="${isNumeric
                        ? 'Shape selection disabled for numeric annotations'
                        : 'Shape selection disabled for multilabel annotations'}"
                      title="${isNumeric
                        ? 'Shape selection disabled for numeric annotations'
                        : 'Shape selection disabled for multilabel annotations'}"
                      disabled
                    >
                      ${renderShapeSwatch(item.shape, true)}
                    </button>
                  `
                : html`
                    <button
                      type="button"
                      class="shape-picker-swatch ${this._showShapePicker ? 'active' : ''}"
                      aria-label=${`Change shape for ${displayLabel}`}
                      title="Click to change shape"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._showShapePicker = !this._showShapePicker;
                      }}
                    >
                      ${renderShapeSwatch(item.shape)}
                    </button>
                    ${this._showShapePicker
                      ? html`
                          <div class="shape-picker-dropdown">
                            <div class="shape-picker-grid">
                              ${availableShapes.map((shape) => {
                                const isSelected = item.shape === shape;
                                const pathGenerator = SHAPE_PATH_GENERATORS[shape];
                                const size = 14;
                                const canvasSize = 20;
                                const centerOffset = canvasSize / 2;
                                const path = pathGenerator(size);
                                const isOutlineOnly = shape === 'plus';

                                return html`
                                  <button
                                    type="button"
                                    class="shape-picker-item ${isSelected ? 'selected' : ''}"
                                    aria-label=${`Use ${shape} shape for ${displayLabel}`}
                                    title="${shape}"
                                    @click=${(e: Event) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      this._handleShapeChange(item.value, shape);
                                    }}
                                  >
                                    <svg
                                      width="${canvasSize}"
                                      height="${canvasSize}"
                                      viewBox="0 0 ${canvasSize} ${canvasSize}"
                                    >
                                      <g transform="translate(${centerOffset}, ${centerOffset})">
                                        <path
                                          d="${path}"
                                          fill="${isOutlineOnly ? 'none' : 'currentColor'}"
                                          stroke="currentColor"
                                          stroke-width="${isOutlineOnly ? 1.5 : 1}"
                                        />
                                      </g>
                                    </svg>
                                  </button>
                                `;
                              })}
                            </div>
                          </div>
                        `
                      : null}
                  `}
            </div>
          </div>
        </div>
        ${isMultilabel || isNumeric
          ? html`<div class="symbol-picker-note">
              ${isNumeric
                ? 'Shapes unavailable for numeric annotations'
                : 'Shapes unavailable for multilabel annotations'}
            </div>`
          : null}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend': ProtspaceLegend;
  }
}
