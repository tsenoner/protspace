import {
  DEFAULT_CATEGORICAL_PALETTE_ID,
  COLOR_SCHEMES,
  getNumericBinLabelMap,
  isGradientPalette,
  resolveNumericAnnotationDisplaySettings,
  type CategoryScore,
  type NumericAnnotationDisplaySettings,
  type NumericBinningStrategy,
} from '@protspace/utils';
import { LEGEND_DEFAULTS, LEGEND_VALUES, NA_VALUE, toInternalValue } from './config';
import { explicitShapeSize, valueToKey } from './legend-helpers';
import type {
  LegendAnnotationData,
  LegendItem,
  LegendPersistedSettings,
  LegendSortMode,
} from './types';

/**
 * The legend's computations that only read their inputs. `legend.ts` assigns what they return to
 * its state and runs the plot syncs itself, so none of these touches the element, the plot or
 * storage.
 */

const isSpecial = (value: string): boolean => value === LEGEND_VALUES.OTHER || value === NA_VALUE;

/** A sort mode the annotation's type supports: numeric legends sort by value or by hand. */
export function normalizeSortModeForType(
  mode: LegendSortMode | undefined,
  isNumeric: boolean,
): LegendSortMode {
  if (isNumeric) {
    return mode === 'alpha-asc' ||
      mode === 'alpha-desc' ||
      mode === 'manual' ||
      mode === 'manual-reverse'
      ? mode
      : 'alpha-asc';
  }
  return mode ?? 'size-desc';
}

/** A categorical palette id: a gradient or a missing id falls back to Kelly's colours. */
export function normalizeCategoricalPaletteId(id: string | null | undefined): string {
  return !id || isGradientPalette(id) ? DEFAULT_CATEGORICAL_PALETTE_ID : id;
}

/** The same order the other way round: `manual` ↔ `manual-reverse`, `-asc` ↔ `-desc`. */
export function reverseSortMode(mode: LegendSortMode): LegendSortMode {
  if (mode === 'manual') return 'manual-reverse';
  if (mode === 'manual-reverse') return 'manual';
  return (
    mode.endsWith('-asc') ? mode.replace('-asc', '-desc') : mode.replace('-desc', '-asc')
  ) as LegendSortMode;
}

/**
 * Display order for the legend list. Every mode but the separation sorts has already been applied
 * upstream and is carried by `zOrder`; scores arrive too late for that path, so they are applied
 * here. Deliberately display-only: bucket membership stays size-driven, so switching sort never
 * changes which categories are visible.
 */
export function sortItemsForDisplay(
  items: readonly LegendItem[],
  mode: LegendSortMode,
  scores: readonly CategoryScore[],
): LegendItem[] {
  const sorted = [...items];
  if (mode !== 'silhouette-desc' && mode !== 'silhouette-asc') {
    return sorted.sort((a, b) => a.zOrder - b.zOrder);
  }
  // Indexed once rather than a `.find()` per comparison: the comparator runs
  // O(items · log items) times and the scan is O(categories), so a legend with a few
  // hundred categories paid hundreds of thousands of string compares per rebuild.
  const scoreByCategory = new Map(scores.map((score) => [score.category, score.silhouette]));
  const scoreOf = (value: string): number => scoreByCategory.get(value) ?? Number.NEGATIVE_INFINITY;
  // Ascending is the reverse of best-first. Unscored categories keep sorting last either way:
  // they sit at -Infinity, so the ascending branch negates only the scored gap.
  const descending = mode === 'silhouette-desc';
  return sorted.sort((a, b) => {
    // "Other" is a bucket, not a category, so it has no score and stays last.
    if (a.value === LEGEND_VALUES.OTHER) return 1;
    if (b.value === LEGEND_VALUES.OTHER) return -1;
    const scoreA = scoreOf(a.value);
    const scoreB = scoreOf(b.value);
    const unscored = scoreA === Number.NEGATIVE_INFINITY || scoreB === Number.NEGATIVE_INFINITY;
    const diff = unscored || descending ? scoreB - scoreA : scoreA - scoreB;
    // `||` (not `!== 0 ? … :`) so an unscored pair, where diff is NaN, also falls
    // through to the zOrder tiebreak instead of coercing to a no-op comparator.
    return diff || a.zOrder - b.zOrder;
  });
}

/** The rows by zOrder the other way round, Other still last, zOrders renumbered from 0. */
export function reverseKeepingOtherLast(items: readonly LegendItem[]): LegendItem[] {
  const sorted = [...items].sort((a, b) => a.zOrder - b.zOrder);
  const other = sorted.find((each) => each.value === LEGEND_VALUES.OTHER);
  const reversed = sorted.filter((each) => each.value !== LEGEND_VALUES.OTHER).reverse();
  return (other ? [...reversed, other] : reversed).map((each, index) => ({
    ...each,
    zOrder: index,
  }));
}

/** The rows in `orderedValues` order, numbered by position there, with Other appended last. */
export function reorderByValues(
  items: readonly LegendItem[],
  orderedValues: readonly string[],
): LegendItem[] {
  const byValue = new Map(items.map((each) => [each.value, each]));
  const other = byValue.get(LEGEND_VALUES.OTHER);
  const reordered = orderedValues
    .map((value, index) => {
      const found = byValue.get(value);
      return found ? { ...found, zOrder: index } : null;
    })
    .filter((each): each is LegendItem => each !== null);
  if (other) reordered.push({ ...other, zOrder: reordered.length });
  return reordered;
}

/**
 * The order on screen, which "Your order" starts from: the displayed rows' values without Other,
 * and for a numeric legend without N/A too (both have no position of their own).
 */
export function displayedOrder(sorted: readonly LegendItem[], isNumeric: boolean): string[] {
  return sorted
    .map((each) => each.value)
    .filter((value) => (isNumeric ? !isSpecial(value) : value !== LEGEND_VALUES.OTHER));
}

/** A categorical palette over the rows by position; Other and N/A keep their fixed colours. */
export function applyPaletteColors(items: readonly LegendItem[], paletteId: string): LegendItem[] {
  const palette = COLOR_SCHEMES[paletteId as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES.kellys;
  return items.map((each, index) =>
    isSpecial(each.value) ? each : { ...each, color: palette[index % palette.length] },
  );
}

/** Each numeric bin's label from the annotation; Other, N/A and unknown ids keep theirs. */
export function applyNumericDisplayLabels(
  items: readonly LegendItem[],
  annotation: LegendAnnotationData,
): LegendItem[] {
  const labels = getNumericBinLabelMap(annotation);
  return items.map((each) =>
    isSpecial(each.value)
      ? each
      : { ...each, displayValue: labels.get(each.value) ?? each.displayValue ?? each.value },
  );
}

/** Each numeric bin's colour from the annotation's gradient; Other and N/A keep theirs. */
export function applyDerivedNumericColors(
  items: readonly LegendItem[],
  annotation: LegendAnnotationData,
): LegendItem[] {
  const derived = new Map(
    annotation.values.map((value, index) => [
      valueToKey(toInternalValue(value)),
      annotation.colors?.[index] ?? '',
    ]),
  );
  return items.map((each) => {
    if (isSpecial(each.value)) return each;
    const color = derived.get(each.value);
    return color ? { ...each, color } : each;
  });
}

/**
 * The bin ids in display order (by zOrder), for a numeric manual order. Other (synthetic) and N/A
 * (locked to the end) have no position of their own, so they are left out; undefined when no bin
 * is left.
 */
export function numericOrderFromItems(items: readonly LegendItem[]): string[] | undefined {
  const ids = items
    .filter((each) => !isSpecial(each.value))
    .sort((a, b) => a.zOrder - b.zOrder)
    .map((each) => each.value);
  return ids.length > 0 ? ids : undefined;
}

/** A persisted legend record as live values, decided but not yet applied. */
export interface ResolvedLegendSettings {
  maxVisibleValues: number;
  /** The annotation's own size, capped at the dialog's bound; null for a filler (unset). */
  annotationShapeSize: number | null;
  hiddenValues: string[];
  paletteId: string;
  sortMode: LegendSortMode;
  enableDuplicateStackUI: boolean;
  /** Numeric annotations only: the binning to keep, and the manual order if it still applies. */
  numeric: (NumericAnnotationDisplaySettings & { manualOrderIds?: string[] }) | null;
  /** Stored category colours and shapes no longer apply (numeric, or a changed binning). */
  clearPendingCategories: boolean;
}

/**
 * Decides what a stored record means for the selected annotation. A numeric record carries the
 * signatures of the binning it was saved under: a changed signature drops the stored colours, and
 * a changed topology (different bins) also drops what was hidden and the manual order, which
 * name bins that no longer exist.
 */
export function resolvePersistedSettings(
  settings: LegendPersistedSettings,
  context: {
    isNumeric: boolean;
    liveNumeric?: NumericAnnotationDisplaySettings;
    signatures(
      binCount: number,
      strategy: NumericBinningStrategy,
      paletteId: string,
      reverseGradient: boolean,
    ): { signature: string | null; topologySignature: string | null };
  },
): ResolvedLegendSettings {
  const { isNumeric } = context;
  const { settings: numericSettings } = resolveNumericAnnotationDisplaySettings({
    persistedSettings: settings,
    liveSettings: context.liveNumeric,
    defaultBinCount: LEGEND_DEFAULTS.maxVisibleValues,
  });
  const paletteId = isNumeric
    ? numericSettings.paletteId
    : normalizeCategoricalPaletteId(settings.selectedPaletteId);
  const maxVisibleValues = isNumeric ? numericSettings.binCount : settings.maxVisibleValues;
  const strategy = numericSettings.strategy;
  const reverseGradient = numericSettings.reverseGradient ?? false;

  const stored = isNumeric ? settings.numericSettings : undefined;
  const live = stored
    ? context.signatures(maxVisibleValues, strategy, paletteId, reverseGradient)
    : null;
  const signatureMatches = !stored || stored.signature === live?.signature;
  const topologyMatches = !stored || stored.topologySignature === live?.topologySignature;

  // Capped here, not only when resolved: the record and the export keep this value.
  const ownShapeSize = explicitShapeSize(settings.shapeSize);
  return {
    maxVisibleValues,
    annotationShapeSize:
      ownShapeSize === null ? null : Math.min(ownShapeSize, LEGEND_DEFAULTS.maxSymbolSize),
    hiddenValues: topologyMatches ? [...settings.hiddenValues] : [],
    paletteId,
    sortMode: normalizeSortModeForType(settings.sortMode, isNumeric),
    enableDuplicateStackUI: settings.enableDuplicateStackUI,
    numeric: isNumeric
      ? {
          binCount: maxVisibleValues,
          strategy,
          paletteId,
          reverseGradient,
          manualOrderIds: topologyMatches ? settings.numericSettings?.manualOrderIds : undefined,
        }
      : null,
    clearPendingCategories: isNumeric || !signatureMatches,
  };
}
