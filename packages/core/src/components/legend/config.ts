import { DEFAULT_CONFIG } from '../scatter-plot/config';
import {
  LEGEND_VALUES,
  toDisplayValue,
  SHAPE_PATH_GENERATORS,
  NA_VALUE,
  NA_DEFAULT_COLOR,
  isNAValue,
  toInternalValue,
} from '@protspace/utils';

const SYMBOL_SIZE_MULTIPLIER = 8;

export const LEGEND_DEFAULTS = {
  maxVisibleValues: 10,
  symbolSize: DEFAULT_CONFIG.pointSize / SYMBOL_SIZE_MULTIPLIER,
  symbolSizeMultiplier: SYMBOL_SIZE_MULTIPLIER,
  // The largest size from 10,000 proteins up: a UX bound from the original spinner.
  maxSymbolSize: 64,
  // The largest size a small dataset may pick (see maxShapeSize). A UX rule, not a GPU bound: the
  // point shader clamps every sprite to the context's ALIASED_POINT_SIZE_RANGE itself. With zoom
  // (<=4x), plot-area (<=1.5x) and diamond (1.25x) growth the largest live sprite at dpr 3 is
  // ~480 device px, so it still fits ANGLE/Metal's 511 px range and is never cut down there.
  smallDatasetMaxSymbolSize: 128,
  dragTimeout: 100,
  scatterplotSelector: 'protspace-scatterplot',
  autoSyncDelay: 100,
  enableDuplicateStackUI: false,
} as const;

export const LEGEND_STYLES = {
  strokeWidth: {
    default: 1,
    outline: 2,
  },
  colors: {
    defaultStroke: '#394150',
  },
  outlineShapes: new Set<string>([]),
  // The row symbol's size in px: a 10 px mark in a 16 px box (3 px padding), as the mockups draw it.
  legendDisplaySize: 10,
} as const;

// Re-export legend utilities so existing imports from './config' keep working
export {
  LEGEND_VALUES,
  toDisplayValue,
  toInternalValue,
  SHAPE_PATH_GENERATORS,
  NA_VALUE,
  NA_DEFAULT_COLOR,
  isNAValue,
};

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
  PROJECTION_CHANGE: 'projection-change',
  /** The plot's Shift + hover focus (scatter-plot.events.ts, `CategoryFocusDetail`). */
  CATEGORY_FOCUS: 'category-focus',
} as const;
