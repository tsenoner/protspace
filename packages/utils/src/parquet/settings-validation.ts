import type {
  BundleSettings,
  ExportOptionsMap,
  LegacyBundleSettings,
  LegendPersistedSettings,
  LegendSettingsMap,
  PersistedCategoryData,
  PersistedExportOptions,
  LegendSortMode,
  NumericBinningStrategy,
} from '../types';

/**
 * Valid sort mode values for legend persistence.
 */
const VALID_SORT_MODES: LegendSortMode[] = [
  'size-asc',
  'size-desc',
  'alpha-asc',
  'alpha-desc',
  'manual',
  'manual-reverse',
];

const VALID_NUMERIC_BINNING_STRATEGIES: NumericBinningStrategy[] = [
  'linear',
  'quantile',
  'logarithmic',
];

/**
 * Validates that a value is a valid PersistedCategoryData object.
 */
export function isValidPersistedCategoryData(obj: unknown): obj is PersistedCategoryData {
  if (typeof obj !== 'object' || obj === null) return false;
  const cat = obj as Record<string, unknown>;
  return (
    typeof cat.zOrder === 'number' && typeof cat.color === 'string' && typeof cat.shape === 'string'
  );
}

/**
 * Validates that a value is a valid LegendSortMode.
 */
export function isValidSortMode(value: unknown): value is LegendSortMode {
  return typeof value === 'string' && VALID_SORT_MODES.includes(value as LegendSortMode);
}

/**
 * Validates that a value is a valid LegendPersistedSettings object.
 * Checks the structure and types of all required fields.
 *
 * Note: This function is permissive of extra fields for forward compatibility.
 * Unknown fields are silently ignored, allowing newer settings versions
 * to be read by older code.
 */
export function isValidLegendSettings(obj: unknown): obj is LegendPersistedSettings {
  if (typeof obj !== 'object' || obj === null) return false;

  const s = obj as Record<string, unknown>;

  // Check required primitive fields
  if (typeof s.maxVisibleValues !== 'number') return false;
  if (s.includeShapes !== undefined && typeof s.includeShapes !== 'boolean') return false;
  if (typeof s.shapeSize !== 'number') return false;
  if (!isValidSortMode(s.sortMode)) return false;
  if (typeof s.enableDuplicateStackUI !== 'boolean') return false;

  // Check hiddenValues is an array of strings
  if (!Array.isArray(s.hiddenValues)) return false;
  if (!s.hiddenValues.every((v) => typeof v === 'string')) return false;

  // Check categories is an object with valid PersistedCategoryData values
  if (typeof s.categories !== 'object' || s.categories === null || Array.isArray(s.categories)) {
    return false;
  }

  const categories = s.categories as Record<string, unknown>;
  for (const key of Object.keys(categories)) {
    if (!isValidPersistedCategoryData(categories[key])) {
      return false;
    }
  }

  if (s.numericSettings !== undefined) {
    if (typeof s.numericSettings !== 'object' || s.numericSettings === null) return false;
    const numericSettings = s.numericSettings as Record<string, unknown>;
    if (
      typeof numericSettings.signature !== 'string' ||
      (numericSettings.topologySignature !== undefined &&
        typeof numericSettings.topologySignature !== 'string') ||
      (numericSettings.reverseGradient !== undefined &&
        typeof numericSettings.reverseGradient !== 'boolean') ||
      (numericSettings.manualOrderIds !== undefined &&
        (!Array.isArray(numericSettings.manualOrderIds) ||
          !numericSettings.manualOrderIds.every((value) => typeof value === 'string'))) ||
      !VALID_NUMERIC_BINNING_STRATEGIES.includes(numericSettings.strategy as NumericBinningStrategy)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Validates that a value is a valid PersistedExportOptions object.
 */
export function isValidPersistedExportOptions(obj: unknown): obj is PersistedExportOptions {
  if (typeof obj !== 'object' || obj === null) return false;

  const settings = obj as Record<string, unknown>;
  return (
    typeof settings.imageWidth === 'number' &&
    typeof settings.imageHeight === 'number' &&
    typeof settings.lockAspectRatio === 'boolean' &&
    typeof settings.legendWidthPercent === 'number' &&
    typeof settings.legendFontSizePx === 'number' &&
    typeof settings.includeLegendSettings === 'boolean' &&
    typeof settings.includeExportOptions === 'boolean'
  );
}

function isValidSettingsMap<Value>(
  obj: unknown,
  validator: (value: unknown) => value is Value,
): obj is Record<string, Value> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }

  const values = obj as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!validator(values[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Validates a legend settings map (annotation -> legend settings).
 */
export function isValidLegendSettingsMap(obj: unknown): obj is LegendSettingsMap {
  return isValidSettingsMap(obj, isValidLegendSettings);
}

/**
 * Validates an export options map (annotation -> export options).
 */
export function isValidExportOptionsMap(obj: unknown): obj is ExportOptionsMap {
  return isValidSettingsMap(obj, isValidPersistedExportOptions);
}

/**
 * Detects the legacy bundle settings format that stored only legend settings.
 */
export function isLegacyBundleSettings(obj: unknown): obj is LegacyBundleSettings {
  return isValidLegendSettingsMap(obj);
}

/**
 * Validates the current normalized bundle settings object.
 */
export function isNormalizedBundleSettings(obj: unknown): obj is BundleSettings {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }

  const settings = obj as Record<string, unknown>;

  // publishState is optional and free-form — just check it's an object if present
  if (
    settings.publishState !== undefined &&
    (typeof settings.publishState !== 'object' ||
      settings.publishState === null ||
      Array.isArray(settings.publishState))
  ) {
    return false;
  }

  return (
    isValidLegendSettingsMap(settings.legendSettings) &&
    isValidExportOptionsMap(settings.exportOptions)
  );
}

/**
 * Validates bundle settings in either the current or legacy format.
 */
export function isValidBundleSettings(obj: unknown): obj is BundleSettings | LegacyBundleSettings {
  return isNormalizedBundleSettings(obj) || isLegacyBundleSettings(obj);
}

function sanitizeLegendSettingsEntry(obj: unknown): LegendPersistedSettings | null {
  if (typeof obj !== 'object' || obj === null) return null;

  const s = obj as Record<string, unknown>;
  if (typeof s.maxVisibleValues !== 'number') return null;
  if (s.includeShapes !== undefined && typeof s.includeShapes !== 'boolean') return null;
  if (typeof s.shapeSize !== 'number') return null;
  if (!isValidSortMode(s.sortMode)) return null;
  if (typeof s.enableDuplicateStackUI !== 'boolean') return null;
  if (!Array.isArray(s.hiddenValues) || !s.hiddenValues.every((v) => typeof v === 'string')) {
    return null;
  }
  if (typeof s.categories !== 'object' || s.categories === null || Array.isArray(s.categories)) {
    return null;
  }

  const categories: Record<string, PersistedCategoryData> = {};
  for (const [key, value] of Object.entries(s.categories as Record<string, unknown>)) {
    if (!isValidPersistedCategoryData(value)) {
      return null;
    }
    categories[key] = value;
  }

  let numericSettings: LegendPersistedSettings['numericSettings'];
  if (
    s.numericSettings !== undefined &&
    typeof s.numericSettings === 'object' &&
    s.numericSettings
  ) {
    const candidate = s.numericSettings as Record<string, unknown>;
    if (
      typeof candidate.signature === 'string' &&
      VALID_NUMERIC_BINNING_STRATEGIES.includes(candidate.strategy as NumericBinningStrategy) &&
      (candidate.topologySignature === undefined ||
        typeof candidate.topologySignature === 'string') &&
      (candidate.reverseGradient === undefined || typeof candidate.reverseGradient === 'boolean') &&
      (candidate.manualOrderIds === undefined ||
        (Array.isArray(candidate.manualOrderIds) &&
          candidate.manualOrderIds.every((value) => typeof value === 'string')))
    ) {
      numericSettings = {
        strategy: candidate.strategy as NumericBinningStrategy,
        signature: candidate.signature,
        topologySignature:
          typeof candidate.topologySignature === 'string' ? candidate.topologySignature : undefined,
        reverseGradient:
          typeof candidate.reverseGradient === 'boolean' ? candidate.reverseGradient : undefined,
        manualOrderIds: Array.isArray(candidate.manualOrderIds)
          ? candidate.manualOrderIds
          : undefined,
      };
    }
  }

  return {
    maxVisibleValues: s.maxVisibleValues,
    shapeSize: s.shapeSize,
    sortMode: s.sortMode,
    hiddenValues: s.hiddenValues,
    categories,
    enableDuplicateStackUI: s.enableDuplicateStackUI,
    selectedPaletteId: typeof s.selectedPaletteId === 'string' ? s.selectedPaletteId : 'kellys',
    numericSettings,
  };
}

export function sanitizeLegendSettingsMap(obj: unknown): LegendSettingsMap | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return null;
  }

  const result: LegendSettingsMap = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const sanitized = sanitizeLegendSettingsEntry(value);
    if (sanitized) {
      result[key] = sanitized;
    }
  }

  return result;
}

function sanitizeExportOptionsMap(obj: unknown): ExportOptionsMap | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return null;
  }

  const result: ExportOptionsMap = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isValidPersistedExportOptions(value)) {
      result[key] = value;
    }
  }
  return result;
}

export interface NormalizeBundleSettingsOptions {
  /** Optional sanitizer applied to `publishState` before it leaves the boundary.
   *  Injected because `@protspace/utils` cannot depend on `@protspace/core`. */
  sanitizePublishState?: (input: unknown) => unknown;
}

/**
 * Normalize bundle settings to the current format.
 */
export function normalizeBundleSettings(
  obj: unknown,
  options: NormalizeBundleSettingsOptions = {},
): BundleSettings | null {
  if (isNormalizedBundleSettings(obj)) {
    return {
      legendSettings: sanitizeLegendSettingsMap(obj.legendSettings) ?? obj.legendSettings,
      exportOptions: sanitizeExportOptionsMap(obj.exportOptions) ?? obj.exportOptions,
      publishState:
        options.sanitizePublishState && obj.publishState !== undefined
          ? (options.sanitizePublishState(obj.publishState) as Record<string, unknown>)
          : obj.publishState,
    };
  }

  if (isLegacyBundleSettings(obj)) {
    return {
      legendSettings: sanitizeLegendSettingsMap(obj) ?? obj,
      exportOptions: {},
    };
  }

  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
    const settings = obj as Record<string, unknown>;
    const sanitizedLegendSettings =
      sanitizeLegendSettingsMap(settings.legendSettings) ?? sanitizeLegendSettingsMap(obj);
    const sanitizedExportOptions = sanitizeExportOptionsMap(settings.exportOptions) ?? {};

    if (sanitizedLegendSettings) {
      const rawPublishState =
        typeof settings.publishState === 'object' &&
        settings.publishState !== null &&
        !Array.isArray(settings.publishState)
          ? (settings.publishState as Record<string, unknown>)
          : undefined;
      const publishState =
        options.sanitizePublishState && rawPublishState !== undefined
          ? (options.sanitizePublishState(rawPublishState) as Record<string, unknown>)
          : rawPublishState;
      return {
        legendSettings: sanitizedLegendSettings,
        exportOptions: sanitizedExportOptions,
        publishState,
      };
    }
  }

  return null;
}
