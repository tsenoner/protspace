// Bundle writer
export {
  concatenateBuffers,
  createParquetBundle,
  exportParquetBundle,
  generateBundleFilename,
  type CreateBundleOptions,
} from './bundle-writer';

// Constants
export { BUNDLE_DELIMITER, BUNDLE_DELIMITER_BYTES } from './constants';
export {
  V3_AXES,
  V3_CONTAINER_VERSION,
  V3_CONTAINER_VERSION_KEY,
  V3_EVIDENCE_DICT_NAME,
  V3_MANIFEST_KEY,
  v3AxisColumn,
  v3Payload,
  v3PhysicalColumn,
} from './v3-format';

// Delimiter utilities
export {
  findBundleDelimiterPositions,
  isParquetBundle,
  countBundleDelimiters,
  assertNoBundleDelimiter,
} from './delimiter-utils';

// BigInt utilities
export { sanitizeValue, bigIntReplacer } from './bigint-utils';

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
