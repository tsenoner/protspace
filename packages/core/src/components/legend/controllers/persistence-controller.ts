import type { ReactiveController, ReactiveControllerHost } from 'lit';
import {
  buildStorageKey,
  getStorageItem,
  setStorageItem,
  removeStorageItem,
  hasStorageItem,
  type LegendSettingsMap,
} from '@protspace/utils';
import type {
  LegendPersistedSettings,
  LegendItem,
  LegendSortMode,
  PersistedCategoryData,
} from '../types';
import { LEGEND_VALUES, isNAValue } from '../config';
import { SHAPE_SIZE_FILLER, createDefaultSettings, positiveSize } from '../legend-helpers';
import {
  BasePersistenceController,
  type DatasetHashData,
} from '../../../controllers/base-persistence-controller';

/** Storage component of the dataset-wide shape size, picked or applied from a bundle. */
const SHAPE_SIZE_KEY = 'shape-size';

/** Storage component the dataset-wide size had before the default followed the protein count. */
const LEGACY_SHAPE_SIZE_KEY = 'point-size';

/** What the old Reset stored under the legacy key: the default of the time. */
const LEGACY_RESET_SHAPE_SIZE = 10;

function readShapeSize(key: string): number | null {
  return positiveSize(getStorageItem<unknown>(key, null));
}

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

  /** Also migrates the legacy shape size key when the hash changes, before any settings load. */
  override updateDatasetHash(data: DatasetHashData): boolean {
    const changed = super.updateDatasetHash(data);
    if (changed) {
      this._migrateLegacyShapeSize(Array.isArray(data) ? [] : Object.keys(data.annotations ?? {}));
    }
    return changed;
  }

  /**
   * Move the dataset's shape size off the key it had before the default followed the protein
   * count, once: the key is removed, and the current key wins if both are set. The old Reset
   * stored 10 there, the default of the time, in the record a pick of 10 writes, and left the
   * size picked before it in each annotation's record, so a legacy 10 clears those records as
   * Reset does now. Any other legacy size is a pick and moves to the current key.
   */
  private _migrateLegacyShapeSize(annotationNames: string[]): void {
    const legacyKey = buildStorageKey(LEGACY_SHAPE_SIZE_KEY, this._datasetHash);
    if (!hasStorageItem(legacyKey)) return;
    const legacy = readShapeSize(legacyKey);
    removeStorageItem(legacyKey);
    if (this.loadShapeSize() !== null) return;
    if (legacy === LEGACY_RESET_SHAPE_SIZE) this._clearStoredAnnotationShapeSizes(annotationNames);
    else if (legacy !== null) this.saveShapeSize(legacy);
  }

  override getAllSettingsForExport(annotationNames: string[]): LegendSettingsMap {
    const settings = super.getAllSettingsForExport(annotationNames);
    const sanitized: LegendSettingsMap = {};
    const picked = this.loadShapeSize();

    for (const [annotation, annotationSettings] of Object.entries(settings)) {
      sanitized[annotation] = this._stripLegacyFields(
        picked === null ? annotationSettings : { ...annotationSettings, shapeSize: picked },
      );
    }

    return sanitized;
  }

  /** The dataset's picked size, or a bundle's top-level size. */
  loadShapeSize(): number | null {
    if (!this._datasetHash) return null;
    return readShapeSize(buildStorageKey(SHAPE_SIZE_KEY, this._datasetHash));
  }

  saveShapeSize(size: number, datasetHash: string = this._datasetHash): void {
    if (!datasetHash) return;
    setStorageItem(buildStorageKey(SHAPE_SIZE_KEY, datasetHash), size);
  }

  /**
   * Forget every shape size set for the dataset: the picked one, and each annotation's own,
   * stored or in bundle settings not yet applied, so the dataset's default applies everywhere.
   */
  clearShapeSize(annotationNames: string[]): void {
    if (!this._datasetHash) return;
    removeStorageItem(buildStorageKey(SHAPE_SIZE_KEY, this._datasetHash));
    this._clearStoredAnnotationShapeSizes(annotationNames);

    if (this._fileSettings) {
      this._fileSettings = Object.fromEntries(
        Object.entries(this._fileSettings).map(([annotation, settings]) => [
          annotation,
          { ...settings, shapeSize: SHAPE_SIZE_FILLER },
        ]),
      );
    }
  }

  /**
   * Rewrite each annotation's stored shape size to the filler. Records written before the
   * default followed the protein count can hold a picked size.
   */
  private _clearStoredAnnotationShapeSizes(annotationNames: string[]): void {
    for (const annotation of annotationNames) {
      const key = buildStorageKey(this.storageKeyPrefix, this._datasetHash, annotation);
      const saved = getStorageItem<Partial<LegendPersistedSettings> | null>(key, null);
      if (saved && saved.shapeSize !== SHAPE_SIZE_FILLER) {
        setStorageItem(key, { ...saved, shapeSize: SHAPE_SIZE_FILLER });
      }
    }
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
   * Check if there are persisted settings for current dataset/annotation.
   *
   * Goes through `hasStorageItem` rather than touching `localStorage` directly: this runs on the
   * legend's main rebuild path (`_updateLegendItems`), so a throw here — Safari private browsing,
   * site data blocked — took down legend rendering entirely rather than just losing the saved
   * settings it is asking about.
   */
  hasPersistedSettings(): boolean {
    const key = this._getStorageKey();
    if (!key) return false;
    return hasStorageItem(key);
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
