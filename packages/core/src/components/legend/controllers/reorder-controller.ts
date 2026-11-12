import type { ProtspaceLegend } from '../legend';
import type { LegendReorderSnapshot } from '../legend-list';
import { numericOrderFromItems, reorderByValues } from '../legend-items-state';
import type { LegendItem, LegendSortMode } from '../types';

/**
 * The legend's side of a reorder: the keyboard reorder's snapshot, move, restore and clear
 * (`LegendKeyboardController` calls them through the legend), and what a drag commits
 * (`DragController`'s item and sort-mode callbacks). A plain class over its element: it reads
 * and writes the legend's state directly (the members `legend.ts` lists as read and written by
 * its controllers).
 */
export class ReorderController {
  constructor(private readonly host: ProtspaceLegend) {}

  /** Drops a keyboard reorder in progress and the pending "switched to manual" announcement. */
  clear(): void {
    this.host._keyboard.clear();
    this.host._announceManualPromotionOnNextReorder = false;
  }

  /** What Escape puts back: the order, the sort mode and the numeric manual order. */
  snapshot(): LegendReorderSnapshot {
    return {
      annotation: this.host.selectedAnnotation,
      sortMode: this.host._currentSortMode,
      legendItems: this.host._legendItems.map((item) => ({ ...item })),
      otherItems: this.host._otherItems.map((item) => ({ ...item })),
      numericManualOrderIds: this.host._isNumericAnnotation()
        ? [...(this.host._numericManualOrderIdsByAnnotation[this.host.selectedAnnotation] ?? [])]
        : undefined,
    };
  }

  restore(snapshot: LegendReorderSnapshot): void {
    if (snapshot.annotation !== this.host.selectedAnnotation) {
      this.clear();
      return;
    }

    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: snapshot.sortMode,
    };
    if (this.host._isNumericAnnotation()) {
      this.host._data.setNumericManualOrderIds(
        this.host.selectedAnnotation,
        snapshot.numericManualOrderIds,
      );
    }
    // Only the order goes back: colour, shape and visibility set during the reorder stay.
    const live = new Map(this.host._legendItems.map((item) => [item.value, item]));
    this.host._legendItems = snapshot.legendItems.map((item) => ({
      ...(live.get(item.value) ?? item),
      zOrder: item.zOrder,
    }));
    this.host._otherItems = snapshot.otherItems.map((item) => ({ ...item }));
    this.clear();

    if (!snapshot.sortMode.startsWith('manual')) {
      this.host._updateLegendItems();
    }

    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._scatterplotController.syncOtherValues();
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /** Returns whether the move switched the annotation to manual order. */
  private commitManualOrder(orderedValues: string[]): boolean {
    const visibleOrder = [...orderedValues];
    const didPromote = !this.host._currentSortMode.startsWith('manual');
    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: 'manual',
    };

    if (this.host._isNumericAnnotation()) {
      this.host._data.setNumericManualOrderIds(this.host.selectedAnnotation, visibleOrder);
      this.host._updateLegendItems();
    } else {
      this.host._legendItems = reorderByValues(this.host._legendItems, visibleOrder);
    }

    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
    return didPromote;
  }

  move(value: string, direction: -1 | 1): { moved: LegendItem; promoted: boolean } | null {
    const orderedItems = this.host._sortedLegendItems.filter((item) =>
      this.host._canDragLegendItem(item),
    );
    const currentIndex = orderedItems.findIndex((item) => item.value === value);
    if (currentIndex === -1) return null;

    const nextIndex = Math.max(0, Math.min(orderedItems.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return null;

    const reordered = [...orderedItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const promoted = this.commitManualOrder(reordered.map((item) => item.value));
    return { moved, promoted };
  }

  /** A drag's new order: the items, and for a numeric annotation its stored manual order. */
  setItemsFromDrag(items: LegendItem[]): void {
    this.host._legendItems = items;
    if (this.host._isNumericAnnotation()) {
      // Exclude Other (synthetic) and NA (locked to legend end regardless of
      // sort) from the persisted manual order — they have no observable
      // position effect and would clutter the saved state.
      this.host._data.setNumericManualOrderIds(
        this.host.selectedAnnotation,
        numericOrderFromItems(items),
      );
    }
  }

  /** A drag switched the sort mode (to manual). */
  onDragSortModeChange(mode: LegendSortMode): void {
    this.host._announceManualPromotionOnNextReorder =
      mode === 'manual' && !this.host._currentSortMode.startsWith('manual');
    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: mode,
    };
    this.host._keyboard.clear();
    this.host._scatterplotController.syncNumericAnnotationSettings();
  }
}
