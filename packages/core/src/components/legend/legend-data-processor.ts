import type { AnnotationData } from '@protspace/utils';
import {
  DEFAULT_CATEGORICAL_PALETTE_ID,
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
} from '@protspace/utils';
import type { LegendItem, OtherItem, LegendSortMode, PersistedCategoryData } from './types';
import { getVisualEncoding, SlotTracker } from './visual-encoding';
import { renumberKeepingOtherLast } from './legend-items-state';
import {
  LEGEND_VALUES,
  NA_DEFAULT_COLOR,
  NA_VALUE,
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
 * The `filled` bins of a {@link LegendDataProcessor.countFromStorage} count, in the order a walk
 * over the proteins first hits them. A second walk rather than bookkeeping in the count, which
 * would slow every count down; it stops once it has met every filled bin. The two storage kinds
 * large datasets use read their arrays directly: through the generic accessors a walk that has
 * to reach the last protein costs several times the count itself.
 */
function binsInProteinOrder(
  colData: AnnotationData,
  binCount: number,
  filled: number,
  proteinCount: number,
  filteredIndices: ReadonlySet<number> | null,
): number[] {
  const naBin = binCount - 1;
  let left = filled;
  const seen = new Uint8Array(binCount);
  const order: number[] = [];
  const meet = (code: number) => {
    const bin = code >= 0 && code < naBin ? code : naBin;
    if (seen[bin] === 0) {
      seen[bin] = 1;
      order.push(bin);
      left--;
    }
  };

  if (colData instanceof Int32Array) {
    const limit = Math.min(proteinCount, colData.length);
    for (let i = 0; i < limit && left > 0; i++) {
      if (filteredIndices !== null && !filteredIndices.has(i)) continue;
      const code = colData[i];
      if (code >= 0) meet(code);
    }
  } else if (isCsrAnnotationData(colData)) {
    const { offsets, codes } = colData;
    const limit = Math.min(proteinCount, colData.length);
    for (let i = 0; i < limit && left > 0; i++) {
      if (filteredIndices !== null && !filteredIndices.has(i)) continue;
      const stop = offsets[i + 1];
      for (let j = offsets[i]; j < stop; j++) meet(codes[j]);
    }
  } else {
    for (let i = 0; i < proteinCount && left > 0; i++) {
      if (filteredIndices !== null && !filteredIndices.has(i)) continue;
      const hits = getProteinAnnotationCount(colData, i);
      for (let k = 0; k < hits; k++) meet(getProteinAnnotationIndexAt(colData, i, k));
    }
  }
  return order;
}

/** What `createLegendItems` needs to know about the view besides its rows. */
interface LegendItemsViewOptions {
  /**
   * A filter or an isolation narrows the view. Its rows keep their slots, and so do the
   * categories it leaves out: a slot is freed only in an unconstrained view.
   */
  constrained?: boolean;
  /** The values the view counted. A stored colour of a value it left out stays taken. */
  presentValues?: ReadonlySet<string>;
  /** The categorical palette that colours each slot. */
  paletteId?: string;
}

/** What `processLegendItems` needs besides the counted view. */
interface LegendProcessOptions {
  /** The categorical palette that colours each slot. */
  paletteId?: string;
  /**
   * The counts without the filter or isolation. A constrained view of an annotation that has no
   * slots yet (just selected, or Reset) takes its slots from these, so each category gets the
   * colour the unfiltered view gives it. Called only then.
   */
  unfilteredFrequencies?: () => ReadonlyMap<string, number>;
}

/**
 * Processes legend data with slot-based visual encoding.
 *
 * Slot assignment:
 * - Initial: slots 0, 1, 2, ... assigned by frequency (most frequent = slot 0)
 * - Subsequent: existing slots persist; only freed when items move to "Other" in an
 *   unconstrained view. A filter or isolation frees none, so it never recolours a category.
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

    // Build a Set per isolation layer once so membership is O(1). The previous
    // `history.includes(id)` was a linear scan run for every protein, making this
    // O(N × layerSize): on the 573K dataset an isolate triggered a ~18s main-thread
    // freeze here. Mirrors the Set-based intersection in
    // DataProcessor.processVisualizationData.
    const layerSets = isolationHistory.map((layer) => new Set(layer));

    proteinIds.forEach((id, index) => {
      if (layerSets.every((set) => set.has(id))) filtered.add(index);
    });

    return filtered;
  }

  /**
   * Count legend frequencies straight out of the annotation storage, keyed by
   * PROTEIN index.
   *
   * Replaces "materialise a flat `string[]` of one interned label per hit, then
   * reduce it to a Map". That array was a pure intermediate (at 573K proteins,
   * 33 ms single-valued and 140 ms with two hits each, against 1 to 3 ms for
   * this bincount) and it also broke isolation filtering: it
   * compacted proteins with no annotation away and expanded multi-valued ones,
   * so its indices no longer lined up with the protein indices that
   * `filteredIndices` holds. Counting per protein removes both problems.
   *
   * `filteredIndices === null` means "no isolation filter". Per-code semantics
   * match the accessor path exactly: a negative code on single-valued storage
   * means "no annotation" and contributes nothing, while any code outside
   * `[0, values.length)` inside a hit list resolves to `undefined` and lands in
   * the `__NA__` bucket, exactly as `toInternalValue(values[code])` did.
   *
   * Keys (after `knownValues`, which come first) are in the order the proteins first
   * meet them, `__NA__` included: the order a per-protein list gives
   * {@link countAnnotationFrequencies}, and so one order however the legend is fed or
   * when it recounts. The sort keeps tied entries, and the "Other" list, in this order,
   * which settles the rows and default colours of tied categories.
   */
  static countFromStorage(
    colData: AnnotationData,
    values: (string | null)[],
    proteinCount: number,
    filteredIndices: ReadonlySet<number> | null,
    knownValues: string[] = [],
  ): Map<string, number> {
    const valueCount = values.length;
    // One extra slot for every code that does not address a real value.
    const naBin = valueCount;
    const bins = new Int32Array(valueCount + 1);

    if (isSparseMultiValueAnnotationData(colData)) {
      const { base, overrides } = colData;
      for (let i = 0; i < proteinCount; i++) {
        if (filteredIndices !== null && !filteredIndices.has(i)) continue;
        const override = overrides.get(i);
        if (override) {
          for (let j = 0; j < override.length; j++) {
            const code = override[j];
            bins[code >= 0 && code < valueCount ? code : naBin]++;
          }
          continue;
        }
        if (i >= base.length) continue;
        const code = base[i];
        if (code >= 0) bins[code < valueCount ? code : naBin]++;
      }
    } else if (isCsrAnnotationData(colData)) {
      const { offsets, codes } = colData;
      const limit = Math.min(proteinCount, colData.length);
      for (let i = 0; i < limit; i++) {
        if (filteredIndices !== null && !filteredIndices.has(i)) continue;
        const stop = offsets[i + 1];
        for (let j = offsets[i]; j < stop; j++) {
          const code = codes[j];
          bins[code >= 0 && code < valueCount ? code : naBin]++;
        }
      }
    } else if (colData instanceof Int32Array) {
      const limit = Math.min(proteinCount, colData.length);
      for (let i = 0; i < limit; i++) {
        if (filteredIndices !== null && !filteredIndices.has(i)) continue;
        const code = colData[i];
        if (code >= 0) bins[code < valueCount ? code : naBin]++;
      }
    } else {
      const limit = Math.min(proteinCount, colData.length);
      for (let i = 0; i < limit; i++) {
        if (filteredIndices !== null && !filteredIndices.has(i)) continue;
        const row = colData[i];
        for (let j = 0; j < row.length; j++) {
          const code = row[j];
          bins[code >= 0 && code < valueCount ? code : naBin]++;
        }
      }
    }

    const freq = new Map<string, number>(knownValues.map((value) => [value, 0] as const));
    const add = (bin: number) => {
      const key = bin === naBin ? NA_VALUE : toInternalValue(values[bin]);
      freq.set(key, (freq.get(key) ?? 0) + bins[bin]);
    };
    let filled = 0;
    let lastFilled = -1;
    for (let bin = 0; bin <= naBin; bin++) {
      if (bins[bin] > 0) {
        filled++;
        lastFilled = bin;
      }
    }
    // Only the relative order of two or more keys needs the walk over the proteins.
    if (filled === 1) add(lastFilled);
    else if (filled > 1) {
      binsInProteinOrder(colData, bins.length, filled, proteinCount, filteredIndices).forEach(add);
    }
    return freq;
  }

  /**
   * Count frequencies of a per-protein value list, the public `annotationValues` shape.
   * Raw null/empty values are converted to NA_VALUE.
   *
   * `filteredIndices` holds PROTEIN indices, as in {@link countFromStorage}, so it only
   * lines up with a list that has exactly one value per protein; `null` means "no
   * isolation filter".
   */
  static countAnnotationFrequencies(
    annotationValues: readonly (string | null)[],
    filteredIndices: ReadonlySet<number> | null,
    knownValues: string[] = [],
  ): Map<string, number> {
    const freq = new Map<string, number>(knownValues.map((value) => [value, 0] as const));
    annotationValues.forEach((rawValue, index) => {
      if (filteredIndices !== null && !filteredIndices.has(index)) return;
      const value = toInternalValue(rawValue);
      freq.set(value, (freq.get(value) ?? 0) + 1);
    });
    return freq;
  }

  /**
   * Sort and limit items to maxVisibleValues.
   * All values are internal format (N/A is '__NA__').
   */
  static sortAndLimitItems(
    frequencyMap: ReadonlyMap<string, number>,
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
      // The visible set decides which rows show, not their order: a sort lists them all in its
      // own order. "Your order" keeps the promoted rows after the ones the user placed.
      if (sortMode !== 'manual' && sortMode !== 'manual-reverse') topItems.sort(sortFn);
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
    view: LegendItemsViewOptions = {},
  ): LegendItem[] {
    const { constrained = false, presentValues, paletteId = DEFAULT_CATEGORICAL_PALETTE_ID } = view;
    // Use passed zOrders if available, otherwise extract from existingLegendItems. Other's own
    // zOrder is never read: it always goes last.
    let existingZOrders: Map<string, number>;

    if (passedZOrders.size > 0) {
      existingZOrders = passedZOrders;
    } else {
      existingZOrders = new Map();
      existingLegendItems.forEach((item) => {
        if (item.value !== LEGEND_VALUES.OTHER) existingZOrders.set(item.value, item.zOrder);
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
    } else if (!constrained) {
      // Every category holding a slot without a row went to Other: its slot is free again. A
      // constrained view frees none, so a category it leaves out keeps its colour.
      const currentVisibleSet = new Set(visibleCategoryNames);
      for (const category of ctx.slotTracker.assignedCategories()) {
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

        newItems.sort((a, b) => a.targetIndex - b.targetIndex);
        for (const newItem of newItems) {
          existingZOrders.forEach((zOrder, key) => {
            if (zOrder >= newItem.targetIndex) {
              existingZOrders.set(key, zOrder + 1);
            }
          });
        }
      }
    }

    // Pre-scan: collect colors already claimed by items with persisted or existing values, and
    // by categories holding a slot or a stored colour that the view leaves out.
    const claimedColors = new Set<string>(ctx.slotTracker.rememberedColors());
    for (const [value] of topItems) {
      const persisted = persistedCategories[value];
      const existing = existingColors.get(value);
      claimedColors.add((persisted?.color || existing?.color) ?? '');
    }
    if (presentValues) {
      for (const [value, persisted] of Object.entries(persistedCategories)) {
        if (persisted.color && !presentValues.has(value)) claimedColors.add(persisted.color);
      }
    }

    const keepsZOrder = sortMode === 'manual';
    const items: LegendItem[] = topItems.map(([value, count], index) => {
      const displayName = toDisplayValue(value);
      const zOrder = keepsZOrder ? (existingZOrders.get(value) ?? index) : index;
      const slot = ctx.slotTracker.getSlot(displayName);

      let encoding = getVisualEncoding(slot, displayName, paletteId);

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

      // Priority: persisted > existing > remembered > default encoding (with conflict resolution)
      const persisted = persistedCategories[value];
      const existing = existingColors.get(value);
      const remembered = ctx.slotTracker.rememberedColor(displayName);

      if (persisted?.color || persisted?.shape) {
        encoding = {
          color: persisted.color || encoding.color,
          shape: persisted.shape || encoding.shape,
        };
      } else if (existing) {
        encoding = { color: existing.color, shape: encoding.shape };
      } else if (remembered) {
        encoding = { color: remembered, shape: encoding.shape };
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
          color = getVisualEncoding(altSlot, displayName, paletteId).color;
          while (claimedColors.has(color) && altSlot < slot + 30) {
            altSlot++;
            color = getVisualEncoding(altSlot, displayName, paletteId).color;
          }
        }
        encoding = { color, shape };
        claimedColors.add(color);
      }
      ctx.slotTracker.rememberColor(displayName, encoding.color);

      return {
        value,
        color: encoding.color,
        shape: encoding.shape,
        count,
        isVisible: true,
        zOrder,
      };
    });

    // Add "Other" if there are items beyond the cap: a bucket, not a place, so always last.
    if (otherCount > 0) {
      const encoding = getVisualEncoding(-1, LEGEND_VALUES.OTHER);

      items.push({
        value: LEGEND_VALUES.OTHER,
        color: encoding.color,
        shape: encoding.shape,
        count: otherCount,
        isVisible: true,
        zOrder: items.length,
      });
    }

    // "Your order" keeps each row's place, but a row merged into Other leaves a gap, and a row
    // taken out of it takes its list index, which can equal a kept row's zOrder or pass Other's.
    // Numbered 0..n-1 in that order, the rows stay apart and Other stays after them.
    return keepsZOrder ? renumberKeepingOtherLast(items) : items;
  }

  /**
   * Main entry point for processing legend items.
   * Sorts the already-counted frequencies (internal value format, isolation applied)
   * and creates legend items from them.
   */
  static processLegendItems(
    ctx: LegendProcessorContext,
    annotationName: string,
    frequencyMap: ReadonlyMap<string, number>,
    maxVisibleValues: number,
    isolationMode: boolean,
    existingLegendItems: LegendItem[],
    sortMode: LegendSortMode = 'size-desc',
    persistedCategories: Record<string, PersistedCategoryData> = {},
    visibleValues: Set<string> = new Set(),
    numericOrderValues: Map<string, number> = new Map(),
    useOtherBucket: boolean = true,
    pendingExtract?: string,
    pendingMerge?: string,
    isNumericSource: boolean = false,
    options: LegendProcessOptions = {},
  ): { legendItems: LegendItem[]; otherItems: OtherItem[] } {
    this.resetIfAnnotationChanged(ctx, annotationName);

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

    // A categorical "Your order, reversed" holds its zOrders in display order (the legend's
    // `ItemActionsController.reverseZOrder` writes them so): it buckets and numbers exactly as
    // "Your order". A numeric one re-derives from its manual bin ids each pass.
    const orderMode: LegendSortMode =
      sortMode === 'manual-reverse' && !isNumericSource ? 'manual' : sortMode;

    // A constrained view of an annotation with no slots yet takes them from the unfiltered view,
    // so a category's colour does not depend on the filter it was first seen under.
    if (
      isolationMode &&
      !isNumericSource &&
      ctx.slotTracker.isEmpty() &&
      options.unfilteredFrequencies
    ) {
      const seedVisible =
        visibleValues.size > 0 ? visibleValues : new Set(Object.keys(persistedCategories));
      const { topItems: unfilteredTop } = this.sortAndLimitItems(
        options.unfilteredFrequencies(),
        maxVisibleValues,
        false,
        orderMode,
        existingZOrders,
        seedVisible,
        numericOrderValues,
        useOtherBucket,
      );
      ctx.slotTracker.reassignSlots(unfilteredTop.map(([value]) => toDisplayValue(value)));
    }

    const { topItems, otherItems, otherCount } = this.sortAndLimitItems(
      frequencyMap,
      maxVisibleValues,
      isolationMode,
      orderMode,
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
      orderMode,
      new Map(existingZOrders),
      persistedCategories,
      isNumericSource,
      {
        constrained: isolationMode,
        presentValues: new Set(frequencyMap.keys()),
        paletteId: options.paletteId,
      },
    );

    // List a reversed order bottom-up, as its sort did before. Other stays last.
    if (orderMode !== sortMode) {
      const isOther = (item: LegendItem) => Number(item.value === LEGEND_VALUES.OTHER);
      items.sort((a, b) => isOther(a) - isOther(b) || b.zOrder - a.zOrder);
    }

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

  /**
   * The palette's colour for the slot a category holds, or undefined while it holds none.
   * `value` is internal (N/A is '__NA__').
   */
  static slotColor(
    ctx: LegendProcessorContext,
    value: string,
    paletteId: string,
  ): string | undefined {
    const displayName = toDisplayValue(value);
    const slot = ctx.slotTracker.peekSlot(displayName);
    return slot === undefined ? undefined : getVisualEncoding(slot, displayName, paletteId).color;
  }

  /**
   * A palette pick: each row takes the palette's colour for its slot, so colours follow the
   * categories, not the rows' positions. Other and N/A keep theirs. Every category holding a
   * slot remembers its new colour, the ones the view leaves out too.
   */
  static recolorBySlot(
    ctx: LegendProcessorContext,
    items: readonly LegendItem[],
    paletteId: string,
  ): LegendItem[] {
    const recolored = items.map((item) => {
      if (item.value === LEGEND_VALUES.OTHER || isNAValue(item.value)) return item;
      const displayName = toDisplayValue(item.value);
      const slot = ctx.slotTracker.getSlot(displayName);
      return { ...item, color: getVisualEncoding(slot, displayName, paletteId).color };
    });
    const naName = toDisplayValue(NA_VALUE);
    for (const category of ctx.slotTracker.assignedCategories()) {
      if (category === naName) continue;
      const slot = ctx.slotTracker.peekSlot(category)!;
      ctx.slotTracker.rememberColor(category, getVisualEncoding(slot, category, paletteId).color);
    }
    return recolored;
  }
}
