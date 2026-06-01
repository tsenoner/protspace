import type { LegendItem, OtherItem, LegendSortMode, PersistedCategoryData } from './types';
import { getVisualEncoding, SlotTracker } from './visual-encoding';
import {
  LEGEND_VALUES,
  NA_DEFAULT_COLOR,
  toInternalValue,
  isNAValue,
  toDisplayValue,
} from './config';

/**
 * Context object for legend data processing.
 * Each legend component should have its own context to avoid state conflicts.
 */
export interface LegendProcessorContext {
  slotTracker: SlotTracker;
  currentAnnotation: string | null;
}

/**
 * Creates a new processor context for a legend instance.
 * Each legend component should create its own context.
 */
export function createProcessorContext(): LegendProcessorContext {
  return {
    slotTracker: new SlotTracker(),
    currentAnnotation: null,
  };
}

/**
 * Processes legend data with slot-based visual encoding.
 *
 * Slot assignment:
 * - Initial: slots 0, 1, 2, ... assigned by frequency (most frequent = slot 0)
 * - Subsequent: existing slots persist; only freed when items move to "Other"
 * - Extracted items reuse freed slots or get the next available
 *
 * Note: All methods that need slot tracking now require a context parameter
 * to support multiple legend instances on the same page.
 */
export class LegendDataProcessor {
  private static resetIfAnnotationChanged(
    ctx: LegendProcessorContext,
    annotationName: string,
  ): void {
    if (ctx.currentAnnotation !== annotationName) {
      ctx.slotTracker.reset();
      ctx.currentAnnotation = annotationName;
    }
  }

  static getFilteredIndices(
    isolationMode: boolean,
    isolationHistory: string[][],
    proteinIds: string[],
  ): Set<number> {
    const filtered = new Set<number>();
    if (!isolationMode || !isolationHistory?.length || !proteinIds) return filtered;

    proteinIds.forEach((id, index) => {
      const isIncluded = isolationHistory.every((history) => history.includes(id));
      if (isIncluded) filtered.add(index);
    });

    return filtered;
  }

  /**
   * Count frequencies of annotation values.
   * Raw null/empty values are converted to NA_VALUE.
   */
  static countAnnotationFrequencies(
    annotationValues: (string | null)[],
    isolationMode: boolean,
    isolationHistory: string[][],
    filteredIndices: Set<number>,
    knownValues: string[] = [],
  ): Map<string, number> {
    const freq = new Map<string, number>(knownValues.map((value) => [value, 0] as const));

    const countValue = (rawValue: string | null) => {
      const value = toInternalValue(rawValue);
      freq.set(value, (freq.get(value) || 0) + 1);
    };

    if (isolationMode && isolationHistory?.length) {
      annotationValues.forEach((value, index) => {
        if (filteredIndices.has(index)) {
          countValue(value);
        }
      });
    } else {
      annotationValues.forEach(countValue);
    }

    return freq;
  }

  /**
   * Sort and limit items to maxVisibleValues.
   * All values are internal format (N/A is '__NA__').
   */
  static sortAndLimitItems(
    frequencyMap: Map<string, number>,
    maxVisibleValues: number,
    isolationMode: boolean,
    sortMode: LegendSortMode,
    existingZOrders: Map<string, number> = new Map(),
    visibleValues: Set<string> = new Set(),
    numericOrderValues: Map<string, number> = new Map(),
    useOtherBucket: boolean = true,
    pendingExtract?: string,
    pendingMerge?: string,
    isNumericSource: boolean = false,
  ): {
    topItems: Array<[string, number]>;
    otherItems: OtherItem[];
    otherCount: number;
  } {
    const sortFn = (a: [string, number], b: [string, number]) => {
      // Numeric annotations: NA pins to end (no bin range to sort by).
      // Categorical annotations: NA sorts like any other value.
      if (isNumericSource) {
        const aIsNA = isNAValue(a[0]);
        const bIsNA = isNAValue(b[0]);
        if (aIsNA && !bIsNA) return 1;
        if (!aIsNA && bIsNA) return -1;
      }

      if (sortMode === 'manual' || sortMode === 'manual-reverse') {
        const aOrder = existingZOrders.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = existingZOrders.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
        return sortMode === 'manual' ? aOrder - bOrder : bOrder - aOrder;
      } else if (sortMode === 'alpha-asc' || sortMode === 'alpha-desc') {
        const isAsc = sortMode === 'alpha-asc';
        const aNumericOrder = numericOrderValues.get(a[0]);
        const bNumericOrder = numericOrderValues.get(b[0]);
        if (
          aNumericOrder !== undefined &&
          bNumericOrder !== undefined &&
          aNumericOrder !== bNumericOrder
        ) {
          return isAsc ? aNumericOrder - bNumericOrder : bNumericOrder - aNumericOrder;
        }
        const cmp = a[0].localeCompare(b[0], undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (cmp !== 0) return isAsc ? cmp : -cmp;
        // Tiebreaker: larger count first
        return b[1] - a[1];
      } else if (sortMode === 'size-asc') {
        return a[1] - b[1];
      }
      return b[1] - a[1]; // 'size-desc' default
    };

    const entries = Array.from(frequencyMap.entries());

    // Build working set of visible values, applying pending extract/merge
    const workingVisible = new Set(visibleValues);
    if (pendingExtract !== undefined) {
      workingVisible.add(pendingExtract);
    }
    if (pendingMerge !== undefined) {
      workingVisible.delete(pendingMerge);
    }

    let topItems: Array<[string, number]>;

    if (workingVisible.size > 0) {
      // Filter to visible items
      const visibleEntries = entries.filter(([v]) => workingVisible.has(v));

      // Get items NOT in visible set (candidates to promote from "Other")
      // Exclude pendingMerge from being promoted back
      const nonVisibleEntries = entries.filter(([v]) => {
        if (pendingMerge !== undefined && v === pendingMerge) return false;
        return !workingVisible.has(v);
      });

      const sortedVisible = [...visibleEntries].sort(sortFn);
      const sortedNonVisible = [...nonVisibleEntries].sort(sortFn);

      const remainingSlots = isolationMode
        ? 0
        : Math.max(0, maxVisibleValues - sortedVisible.length);
      topItems = [
        ...sortedVisible.slice(0, maxVisibleValues),
        ...sortedNonVisible.slice(0, remainingSlots),
      ].slice(0, maxVisibleValues);
    } else {
      // Initial load: sort all and take top N
      const sorted = [...entries].sort(sortFn);
      topItems = sorted.slice(0, maxVisibleValues);
    }

    // Items beyond the cap go to "Other".
    const topValuesSet = new Set(topItems.map(([v]) => v));
    const beyondCap = entries.filter(([v]) => !topValuesSet.has(v));

    return {
      topItems,
      otherItems: useOtherBucket ? beyondCap.map(([value, count]) => ({ value, count })) : [],
      otherCount: useOtherBucket ? beyondCap.reduce((sum, [, count]) => sum + count, 0) : 0,
    };
  }

  /**
   * Create legend items from sorted top items.
   * All values are internal format (N/A is '__NA__').
   */
  static createLegendItems(
    ctx: LegendProcessorContext,
    topItems: Array<[string, number]>,
    otherCount: number,
    existingLegendItems: LegendItem[],
    sortMode: LegendSortMode = 'size-desc',
    passedZOrders: Map<string, number> = new Map(),
    persistedCategories: Record<string, PersistedCategoryData> = {},
    isNumericSource: boolean = false,
  ): LegendItem[] {
    // Use passed zOrders if available, otherwise extract from existingLegendItems
    let existingZOrders: Map<string, number>;
    let existingOtherZOrder: number | null = null;

    if (passedZOrders.size > 0) {
      existingZOrders = passedZOrders;
      const existingOther = existingLegendItems.find((i) => i.value === LEGEND_VALUES.OTHER);
      existingOtherZOrder = existingOther?.zOrder ?? null;
    } else {
      existingZOrders = new Map();
      existingLegendItems.forEach((item) => {
        if (item.value === LEGEND_VALUES.OTHER) {
          existingOtherZOrder = item.zOrder;
        } else {
          existingZOrders.set(item.value, item.zOrder);
        }
      });
    }

    // Build a map of existing colors/shapes from existingLegendItems
    const existingColors = new Map<string, { color: string; shape: string }>();
    existingLegendItems.forEach((item) => {
      if (item.value !== LEGEND_VALUES.OTHER) {
        existingColors.set(item.value, { color: item.color, shape: item.shape });
      }
    });

    // Get current visible category names (for slot tracking, use display names)
    const visibleCategoryNames = topItems.map(([value]) => toDisplayValue(value));

    if (ctx.slotTracker.isEmpty()) {
      ctx.slotTracker.reassignSlots(visibleCategoryNames);
    } else {
      const currentVisibleSet = new Set(visibleCategoryNames);
      const previousVisible = existingLegendItems
        .filter((i) => i.value !== LEGEND_VALUES.OTHER)
        .map((i) => toDisplayValue(i.value));

      for (const category of previousVisible) {
        if (!currentVisibleSet.has(category)) {
          ctx.slotTracker.freeSlot(category);
        }
      }
    }

    // In 'manual' mode, shift existing zOrders to make room for newly extracted items
    if (sortMode === 'manual' && existingZOrders.size > 0) {
      const existingZOrderValues = Array.from(existingZOrders.values()).sort((a, b) => a - b);
      const isConsecutive =
        existingZOrderValues[0] === 0 && existingZOrderValues.every((v, i) => v === i);

      if (isConsecutive) {
        const newItems: Array<{ value: string; targetIndex: number }> = [];
        topItems.forEach(([value], index) => {
          if (!existingZOrders.has(value)) {
            newItems.push({ value, targetIndex: index });
          }
        });

        newItems.sort((a, b) => b.targetIndex - a.targetIndex);
        for (const newItem of newItems) {
          existingZOrders.forEach((zOrder, key) => {
            if (zOrder >= newItem.targetIndex) {
              existingZOrders.set(key, zOrder + 1);
            }
          });
          if (existingOtherZOrder !== null && existingOtherZOrder >= newItem.targetIndex) {
            existingOtherZOrder = existingOtherZOrder + 1;
          }
        }
      }
    }

    // Pre-scan: collect colors already claimed by items with persisted or existing values
    const claimedColors = new Set<string>();
    for (const [value] of topItems) {
      const persisted = persistedCategories[value];
      const existing = existingColors.get(value);
      claimedColors.add((persisted?.color || existing?.color) ?? '');
    }

    const items: LegendItem[] = topItems.map(([value, count], index) => {
      const displayName = toDisplayValue(value);
      const zOrder = sortMode === 'manual' ? (existingZOrders.get(value) ?? index) : index;
      const slot = ctx.slotTracker.getSlot(displayName);

      let encoding = getVisualEncoding(slot, displayName);

      // Numeric NA is locked: ignore persisted/existing overrides, force defaults.
      if (isNumericSource && isNAValue(value)) {
        return {
          value,
          color: NA_DEFAULT_COLOR,
          shape: 'circle',
          count,
          isVisible: true,
          zOrder,
        };
      }

      // Priority: persisted > existing > default encoding (with conflict resolution)
      const persisted = persistedCategories[value];
      const existing = existingColors.get(value);

      if (persisted?.color || persisted?.shape) {
        encoding = {
          color: persisted.color || encoding.color,
          shape: persisted.shape || encoding.shape,
        };
      } else if (existing) {
        encoding = { color: existing.color, shape: encoding.shape };
      } else {
        // Default encoding — categorical NA gets NA_DEFAULT_COLOR instead of slot color.
        let { color, shape } = encoding;
        if (isNAValue(value)) {
          color = NA_DEFAULT_COLOR;
        }
        // Conflict resolution applies to NA too — if NA_DEFAULT_COLOR is already
        // claimed by another category, NA gets bumped via slot probing.
        if (claimedColors.has(color)) {
          // Probe subsequent slots for an unclaimed color (cap at 30 to exceed
          // Kelly's 21-color palette and guarantee termination)
          let altSlot = slot + 1;
          color = getVisualEncoding(altSlot, displayName).color;
          while (claimedColors.has(color) && altSlot < slot + 30) {
            altSlot++;
            color = getVisualEncoding(altSlot, displayName).color;
          }
        }
        encoding = { color, shape };
        claimedColors.add(color);
      }

      return {
        value,
        color: encoding.color,
        shape: encoding.shape,
        count,
        isVisible: true,
        zOrder,
      };
    });

    // Add "Other" if there are items beyond the cap
    if (otherCount > 0) {
      const encoding = getVisualEncoding(-1, LEGEND_VALUES.OTHER);
      const otherZOrder =
        sortMode === 'manual' ? (existingOtherZOrder ?? items.length) : items.length;

      items.push({
        value: LEGEND_VALUES.OTHER,
        color: encoding.color,
        shape: encoding.shape,
        count: otherCount,
        isVisible: true,
        zOrder: otherZOrder,
      });
    }

    return items;
  }

  /**
   * Main entry point for processing legend items.
   * Converts raw annotation values to internal format, sorts, and creates legend items.
   */
  static processLegendItems(
    ctx: LegendProcessorContext,
    annotationName: string,
    annotationValues: (string | null)[],
    proteinIds: string[],
    maxVisibleValues: number,
    isolationMode: boolean,
    isolationHistory: string[][],
    existingLegendItems: LegendItem[],
    sortMode: LegendSortMode = 'size-desc',
    persistedCategories: Record<string, PersistedCategoryData> = {},
    visibleValues: Set<string> = new Set(),
    numericOrderValues: Map<string, number> = new Map(),
    useOtherBucket: boolean = true,
    pendingExtract?: string,
    pendingMerge?: string,
    knownValues: string[] = [],
    isNumericSource: boolean = false,
  ): { legendItems: LegendItem[]; otherItems: OtherItem[] } {
    this.resetIfAnnotationChanged(ctx, annotationName);

    const filteredIndices = this.getFilteredIndices(isolationMode, isolationHistory, proteinIds);
    const frequencyMap = this.countAnnotationFrequencies(
      annotationValues,
      isolationMode,
      isolationHistory,
      filteredIndices,
      knownValues,
    );

    // Build existing zOrder map for manual sorting
    const existingZOrders = new Map<string, number>();
    // First apply persisted categories
    for (const [key, data] of Object.entries(persistedCategories)) {
      existingZOrders.set(key, data.zOrder);
    }
    // Then override with current legend items if they exist
    existingLegendItems.forEach((item) => {
      if (item.value !== LEGEND_VALUES.OTHER) {
        existingZOrders.set(item.value, item.zOrder);
      }
    });

    const { topItems, otherItems, otherCount } = this.sortAndLimitItems(
      frequencyMap,
      maxVisibleValues,
      isolationMode,
      sortMode,
      existingZOrders,
      visibleValues,
      numericOrderValues,
      useOtherBucket,
      pendingExtract,
      pendingMerge,
      isNumericSource,
    );

    const items = this.createLegendItems(
      ctx,
      topItems,
      otherCount,
      existingLegendItems,
      sortMode,
      new Map(existingZOrders),
      persistedCategories,
      isNumericSource,
    );

    // Filter "Other" items to exclude any that are already shown
    const shownValues = new Set(items.map((i) => i.value).filter((v) => v !== LEGEND_VALUES.OTHER));
    const filteredOther = otherItems.filter((oi) => !shownValues.has(oi.value));
    const newOtherCount = filteredOther.reduce((sum, oi) => sum + oi.count, 0);

    const otherIdx = items.findIndex((i) => i.value === LEGEND_VALUES.OTHER);
    if (otherIdx !== -1) {
      if (newOtherCount > 0) {
        items[otherIdx] = { ...items[otherIdx], count: newOtherCount };
      } else {
        items.splice(otherIdx, 1);
      }
    }

    return { legendItems: items, otherItems: filteredOther };
  }
}
