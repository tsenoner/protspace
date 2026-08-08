import {
  buildStorageKey,
  generateDatasetHash,
  getStorageItem,
  removeAllStorageItemsByHash,
  setStorageItem,
} from '@protspace/utils';

/**
 * Base class for persistence controllers that manage per-dataset/annotation
 * settings in localStorage with optional file-based overrides from parquetbundle files.
 *
 * @typeParam TSettings - The persisted settings type for a single annotation
 * @typeParam TSettingsMap - A record mapping annotation names to settings
 */
export abstract class BasePersistenceController<
  TSettings,
  TSettingsMap extends Record<string, TSettings>,
> {
  protected _datasetHash: string = '';
  protected _selectedAnnotation: string = '';
  protected _settingsLoaded: boolean = false;
  protected _fileSettings: TSettingsMap | null = null;
  protected _appliedFileAnnotations: Set<string> = new Set();

  /** Storage key prefix (e.g. 'legend' or 'control-bar') */
  protected abstract readonly storageKeyPrefix: string;

  /** Create default settings for a given annotation */
  protected abstract createDefaults(annotation: string): TSettings;

  /** Get live settings from the component for the current annotation */
  abstract getCurrentSettingsForExport(): TSettings;

  get settingsLoaded(): boolean {
    return this._settingsLoaded;
  }

  get hasFileSettings(): boolean {
    return this._fileSettings !== null;
  }

  updateDatasetHash(data: Parameters<typeof generateDatasetHash>[0]): boolean {
    const newHash = generateDatasetHash(data);
    if (newHash !== this._datasetHash) {
      this._datasetHash = newHash;
      this._settingsLoaded = false;
      return true;
    }
    return false;
  }

  updateSelectedAnnotation(annotation: string): boolean {
    if (annotation !== this._selectedAnnotation) {
      this._selectedAnnotation = annotation;
      this._settingsLoaded = false;
      return true;
    }
    return false;
  }

  setFileSettings(
    settings: TSettingsMap | null,
    datasetHash?: string,
    clearExistingStorage: boolean = true,
  ): void {
    this._fileSettings = settings ? { ...settings } : null;
    this._appliedFileAnnotations.clear();

    const hashToUse = datasetHash || this._datasetHash;

    if (settings && hashToUse) {
      if (clearExistingStorage) {
        removeAllStorageItemsByHash(hashToUse);
      }

      for (const [annotationName, annotationSettings] of Object.entries(settings)) {
        const key = buildStorageKey(this.storageKeyPrefix, hashToUse, annotationName);
        if (!clearExistingStorage && getStorageItem<TSettings | null>(key, null) !== null) {
          delete (this._fileSettings as Record<string, TSettings>)[annotationName];
          continue;
        }
        setStorageItem(key, annotationSettings);
      }

      if (this._fileSettings && Object.keys(this._fileSettings).length === 0) {
        this._fileSettings = null;
      }
    }

    if (settings && this._selectedAnnotation && settings[this._selectedAnnotation]) {
      this._settingsLoaded = false;
    }
  }

  clearForNewDataset(datasetHash: string, clearPersistedState: boolean = true): void {
    if (clearPersistedState) {
      removeAllStorageItemsByHash(datasetHash);
    }

    this._datasetHash = '';
    this._selectedAnnotation = '';
    this._settingsLoaded = false;
    this._fileSettings = null;
    this._appliedFileAnnotations.clear();
    this.onClearForNewDataset();
  }

  /** Hook for subclasses to reset additional state on dataset clear */
  protected onClearForNewDataset(): void {
    // Default: no-op
  }

  hasFileSettingsForAnnotation(annotation: string): boolean {
    return this._fileSettings !== null && annotation in this._fileSettings;
  }

  getAllSettingsForExport(annotationNames: string[]): TSettingsMap {
    const result = {} as TSettingsMap;

    if (this._selectedAnnotation) {
      (result as Record<string, TSettings>)[this._selectedAnnotation] =
        this.getCurrentSettingsForExport();
    }

    for (const annotation of annotationNames) {
      if (annotation === this._selectedAnnotation) continue;

      const key = buildStorageKey(this.storageKeyPrefix, this._datasetHash, annotation);
      const saved = getStorageItem<Partial<TSettings>>(key, {});

      if (Object.keys(saved as object).length > 0) {
        (result as Record<string, TSettings>)[annotation] = {
          ...this.createDefaults(annotation),
          ...saved,
        };
      }
    }

    return result;
  }

  protected _getStorageKey(): string | null {
    if (!this._datasetHash || !this._selectedAnnotation) {
      return null;
    }
    return buildStorageKey(this.storageKeyPrefix, this._datasetHash, this._selectedAnnotation);
  }

  /**
   * Load file-based settings for the current annotation if available and not yet applied.
   * @returns The merged settings if file settings were used, or null to fall back to localStorage.
   */
  protected tryLoadFileSettings(): TSettings | null {
    if (
      this._fileSettings?.[this._selectedAnnotation] &&
      !this._appliedFileAnnotations.has(this._selectedAnnotation)
    ) {
      const merged = {
        ...this.createDefaults(this._selectedAnnotation),
        ...this._fileSettings[this._selectedAnnotation],
      };
      this._appliedFileAnnotations.add(this._selectedAnnotation);
      return merged;
    }
    return null;
  }

  /**
   * Load settings from localStorage with defaults.
   */
  protected loadFromStorage(): TSettings | null {
    const key = this._getStorageKey();
    if (!key) return null;

    const saved = getStorageItem<Partial<TSettings>>(
      key,
      this.createDefaults(this._selectedAnnotation),
    );
    return {
      ...this.createDefaults(this._selectedAnnotation),
      ...saved,
    };
  }
}
