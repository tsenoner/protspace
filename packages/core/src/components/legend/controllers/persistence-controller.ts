import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { setStorageItem, removeStorageItem, type LegendSettingsMap } from '@protspace/utils';
import type {
  LegendPersistedSettings,
  LegendItem,
  LegendSortMode,
  PersistedCategoryData,
} from '../types';
import { LEGEND_VALUES, isNAValue } from '../config';
import { createDefaultSettings } from '../legend-helpers';
import { BasePersistenceController } from '../../../controllers/base-persistence-controller';

/**
 * Callback interface for persistence events
 */
export interface PersistenceCallbacks {
  onSettingsLoaded: (settings: LegendPersistedSettings) => void;
  getLegendItems: () => LegendItem[];
  getHiddenValues: () => string[];
  shouldPersistCategories: () => boolean;
  shouldPersistCategoryEncodings: () => boolean;
  /** Returns true when the currently selected annotation is numeric (NA visuals are locked). */
  isNumericAnnotation?: () => boolean;
  getCurrentSettings: () => {
    maxVisibleValues: number;
    shapeSize: number;
    sortMode: LegendSortMode;
    enableDuplicateStackUI: boolean;
    selectedPaletteId: string;
    numericSettings?: LegendPersistedSettings['numericSettings'];
  };
}

/**
 * Reactive controller for managing localStorage persistence.
 * Handles saving and loading legend settings per dataset/annotation combination.
 * Also supports file-based persistence for parquetbundle export/import.
 */
export class PersistenceController
  extends BasePersistenceController<LegendPersistedSettings, LegendSettingsMap>
  implements ReactiveController
{
  protected readonly storageKeyPrefix = 'legend';
  private callbacks: PersistenceCallbacks;
  private _pendingCategories: Record<string, PersistedCategoryData> = {};

  constructor(host: ReactiveControllerHost, callbacks: PersistenceCallbacks) {
    super();
    this.callbacks = callbacks;
    host.addController(this);
  }

  hostConnected(): void {
    // No initialization needed on connect
  }

  hostDisconnected(): void {
    // No cleanup needed
  }

  protected createDefaults(annotation: string): LegendPersistedSettings {
    return createDefaultSettings(annotation);
  }

  protected override onClearForNewDataset(): void {
    this._pendingCategories = {};
  }

  override getAllSettingsForExport(annotationNames: string[]): LegendSettingsMap {
    const settings = super.getAllSettingsForExport(annotationNames);
    const sanitized: LegendSettingsMap = {};

    for (const [annotation, annotationSettings] of Object.entries(settings)) {
      sanitized[annotation] = this._stripLegacyFields(annotationSettings);
    }

    return sanitized;
  }

  private _stripLegacyFields(settings: LegendPersistedSettings): LegendPersistedSettings {
    return {
      maxVisibleValues: settings.maxVisibleValues,
      shapeSize: settings.shapeSize,
      sortMode: settings.sortMode,
      hiddenValues: settings.hiddenValues,
      categories: settings.categories,
      enableDuplicateStackUI: settings.enableDuplicateStackUI,
      selectedPaletteId: settings.selectedPaletteId,
      numericSettings: settings.numericSettings,
    };
  }

  /**
   * Get pending categories (to apply after legend items are created)
   */
  get pendingCategories(): Record<string, PersistedCategoryData> {
    return this._pendingCategories;
  }

  /**
   * Load persisted settings for current dataset/annotation.
   * Prioritizes file-based settings over localStorage if available.
   */
  loadSettings(): void {
    if (!this._selectedAnnotation) return;

    const fileSettings = this.tryLoadFileSettings();
    let mergedSettings: LegendPersistedSettings;

    if (fileSettings) {
      mergedSettings = fileSettings;
    } else {
      const storageSettings = this.loadFromStorage();
      if (!storageSettings) return;
      mergedSettings = storageSettings;
    }

    this._pendingCategories = this.callbacks.shouldPersistCategories()
      ? mergedSettings.categories
      : {};
    this._settingsLoaded = true;

    this.callbacks.onSettingsLoaded(mergedSettings);
  }

  /**
   * Persist current settings to localStorage
   */
  saveSettings(): void {
    const key = this._getStorageKey();
    if (!key) return;

    const currentSettings = this.callbacks.getCurrentSettings();
    const categories = this._buildCategoriesFromItems();

    const settings: LegendPersistedSettings = {
      maxVisibleValues: currentSettings.maxVisibleValues,
      shapeSize: currentSettings.shapeSize,
      sortMode: currentSettings.sortMode,
      hiddenValues: this.callbacks.getHiddenValues(),
      categories,
      enableDuplicateStackUI: currentSettings.enableDuplicateStackUI,
      selectedPaletteId: currentSettings.selectedPaletteId,
      numericSettings: currentSettings.numericSettings,
    };

    setStorageItem(key, settings);

    // Update pending categories to match the saved state
    // This ensures subsequent _updateLegendItems() calls use the current data
    this._pendingCategories = categories;
  }

  /**
   * Build categories from current legend items (excluding "Other" which is synthetic)
   */
  private _buildCategoriesFromItems(): Record<string, PersistedCategoryData> {
    if (!this.callbacks.shouldPersistCategories()) {
      return {};
    }

    const legendItems = this.callbacks.getLegendItems();
    const persistCategoryEncodings = this.callbacks.shouldPersistCategoryEncodings();
    const isNumeric = this.callbacks.isNumericAnnotation?.() ?? false;
    const categories: Record<string, PersistedCategoryData> = {};
    legendItems.forEach((item) => {
      if (item.value === LEGEND_VALUES.OTHER) return;
      // Skip NA color/shape persistence for numeric annotations — they're locked.
      if (isNumeric && isNAValue(item.value)) return;
      categories[item.value] = {
        zOrder: item.zOrder,
        color: persistCategoryEncodings ? item.color : '',
        shape: persistCategoryEncodings ? item.shape : '',
      };
    });
    return categories;
  }

  /**
   * Get the current settings for the selected annotation.
   * Returns the current state built from legend items and component settings.
   */
  getCurrentSettingsForExport(): LegendPersistedSettings {
    const currentSettings = this.callbacks.getCurrentSettings();

    return {
      maxVisibleValues: currentSettings.maxVisibleValues,
      shapeSize: currentSettings.shapeSize,
      sortMode: currentSettings.sortMode,
      hiddenValues: this.callbacks.getHiddenValues(),
      categories: this._buildCategoriesFromItems(),
      enableDuplicateStackUI: currentSettings.enableDuplicateStackUI,
      selectedPaletteId: currentSettings.selectedPaletteId,
      numericSettings: currentSettings.numericSettings,
    };
  }

  /**
   * Check if there are persisted settings for current dataset/annotation
   */
  hasPersistedSettings(): boolean {
    const key = this._getStorageKey();
    if (!key) return false;
    return localStorage.getItem(key) !== null;
  }

  /**
   * Remove persisted settings for current dataset/annotation
   */
  removeSettings(): void {
    const key = this._getStorageKey();
    if (key) {
      removeStorageItem(key);
    }
  }

  /**
   * Set pending categories (used when extracting items from Other)
   */
  setPendingCategories(categories: Record<string, PersistedCategoryData>): void {
    this._pendingCategories = categories;
  }

  /**
   * Clear pending categories after they've been applied
   */
  clearPendingCategories(): void {
    this._pendingCategories = {};
  }

  /**
   * Check if there are pending categories to apply
   */
  hasPendingCategories(): boolean {
    return Object.keys(this._pendingCategories).length > 0;
  }

  /**
   * Apply pending categories (z-order only) to legend items.
   * Color/shape are applied during legend item creation in the processor.
   * N/A items use '__NA__' as their value.
   *
   * Note: This method does NOT clear pendingCategories because subsequent update
   * cycles (triggered by property changes in _applyPersistedSettings) need them
   * for _visibleValues to work correctly. Categories are naturally overwritten
   * when loadSettings() is called for a different annotation.
   */
  applyPendingZOrder(legendItems: LegendItem[]): LegendItem[] {
    if (!this.hasPendingCategories() || legendItems.length === 0) {
      return legendItems;
    }

    const hasMapping = legendItems.some(
      (item) => this._pendingCategories[item.value] !== undefined,
    );

    if (!hasMapping) {
      return legendItems;
    }

    return legendItems.map((item) => {
      const persisted = this._pendingCategories[item.value];
      if (persisted !== undefined) {
        return { ...item, zOrder: persisted.zOrder };
      }
      return item;
    });
  }
}
