import { DEFAULT_CONFIG } from '../scatter-plot/config';
import {
  LEGEND_VALUES,
  toDisplayValue,
  SHAPE_PATH_GENERATORS,
  NA_VALUE,
  NA_DISPLAY,
  NA_DEFAULT_COLOR,
  isNAValue,
  toInternalValue,
} from '@protspace/utils';

const SYMBOL_SIZE_MULTIPLIER = 8;

export const LEGEND_DEFAULTS = {
  maxVisibleValues: 10,
  symbolSize: DEFAULT_CONFIG.pointSize / SYMBOL_SIZE_MULTIPLIER,
  symbolSizeMultiplier: SYMBOL_SIZE_MULTIPLIER,
  dragTimeout: 100,
  scatterplotSelector: 'protspace-scatterplot',
  autoSyncDelay: 100,
  enableDuplicateStackUI: false,
} as const;

export const LEGEND_STYLES = {
  strokeWidth: {
    default: 1,
    selected: 2,
    outline: 2,
  },
  colors: {
    defaultStroke: '#394150',
    selectedStroke: '#00A3E0',
  },
  outlineShapes: new Set<string>([]),
  legendDisplaySize: 16,
} as const;

// Re-export legend utilities so existing imports from './config' keep working
export {
  LEGEND_VALUES,
  toDisplayValue,
  toInternalValue,
  SHAPE_PATH_GENERATORS,
  NA_VALUE,
  NA_DISPLAY,
  NA_DEFAULT_COLOR,
  isNAValue,
};

/**
 * Convert internal legend value back to raw data value for matching.
 * NA_VALUE becomes null for matching against raw annotation data.
 */
export function toDataValue(value: string): string | null {
  return value === NA_VALUE ? null : value;
}

/** Event name constants for legend component */
export const LEGEND_EVENTS = {
  ITEM_CLICK: 'legend-item-click',
  ZORDER_CHANGE: 'legend-zorder-change',
  COLORMAPPING_CHANGE: 'legend-colormapping-change',
  CUSTOMIZE: 'legend-customize',
  DOWNLOAD: 'legend-download',
  ERROR: 'legend-error',
  DATA_CHANGE: 'data-change',
  ANNOTATION_CHANGE: 'annotation-change',
} as const;
