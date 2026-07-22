// Bundle writer
export {
  createParquetBundle,
  exportParquetBundle,
  generateBundleFilename,
  type CreateBundleOptions,
} from './bundle-writer';

// Constants
export { BUNDLE_DELIMITER, BUNDLE_DELIMITER_BYTES } from './constants';

// Delimiter utilities
export {
  findBundleDelimiterPositions,
  isParquetBundle,
  countBundleDelimiters,
  assertNoBundleDelimiter,
} from './delimiter-utils';

// BigInt utilities
export { sanitizeValue, bigIntReplacer } from './bigint-utils';

// Annotation bundle format v2 codec
export { encodeAnnotationField } from './annotation-codec';

// Settings validation
export {
  isValidLegendSettings,
  isValidBundleSettings,
  isNormalizedBundleSettings,
  isLegacyBundleSettings,
  isValidPersistedCategoryData,
  isValidPersistedExportOptions,
  isValidLegendSettingsMap,
  isValidExportOptionsMap,
  isValidSortMode,
  normalizeBundleSettings,
  type NormalizeBundleSettingsOptions,
} from './settings-validation';

// Types
export type {
  BundleSettings,
  ExportOptionsMap,
  LegacyBundleSettings,
  LegendPersistedSettings,
  LegendSettingsMap,
  PersistedExportOptions,
  PersistedCategoryData,
  LegendSortMode,
} from '../types';
