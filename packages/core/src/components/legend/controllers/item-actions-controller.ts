import { LEGEND_VALUES, toDisplayValue } from '../config';
import type { ProtspaceLegend } from '../legend';
import {
  clickPointerType,
  isDoubleTap,
  isolateItem,
  isolationBase,
  isSecondClickOfDouble,
  updateItemsVisibility,
  valueToKey,
  type FirstClick,
} from '../legend-helpers';
import {
  displayedOrder,
  normalizeSortModeForType,
  reorderByValues,
  reverseKeepingOtherLast,
  reverseSortMode,
} from '../legend-items-state';
import type { LegendItem, LegendSortMode } from '../types';

/**
 * What a row, the Other popover and the sort menu do to the legend: toggle, isolate, extract
 * from and merge into Other, the drop highlight, the sort mode and the order direction. A plain
 * class over its element: it reads and writes the legend's state directly (the members
 * `legend.ts` lists as read and written by its controllers).
 */
export class ItemActionsController {
  // Kept until its dblclick arrives, which isolates from `isolationBase`.
  private _firstClick: FirstClick | null = null;
  // Touch: the last tap on a row (a second one soon after isolates) and the pointer behind the
  // last row click (a dblclick after touch taps is ignored).
  private _lastTap: { valueKey: string; time: number } | null = null;
  private _lastClickPointer = 'mouse';

  constructor(private readonly host: ProtspaceLegend) {}

  /**
   * Toggles, except on the second click of a mouse double-click (`isSecondClickOfDouble`). The
   * second of two quick taps on one row isolates it (`isDoubleTap`), as a double-click does.
   */
  rowClick(value: string, event: MouseEvent): void {
    const valueKey = valueToKey(value);
    const pointerType = clickPointerType(event, this.host._lastRowPointerDown);
    this._lastClickPointer = pointerType;
    if (isSecondClickOfDouble(this._firstClick, valueKey, { detail: event.detail, pointerType })) {
      return;
    }
    if (isDoubleTap(this._lastTap, { valueKey, time: event.timeStamp, pointerType })) {
      this._lastTap = null;
      this.isolateFromFirstClick(value);
      return;
    }
    const touch = pointerType === 'touch' || pointerType === 'pen';
    this._lastTap = touch ? { valueKey, time: event.timeStamp } : null;

    const itemsBefore = this.host._legendItems;
    this.toggle(value);
    this._firstClick =
      event.detail === 1 ? { valueKey, itemsBefore, itemsAfter: this.host._legendItems } : null;
  }

  rowDoubleClick(value: string): void {
    // Touch and pen double taps isolated on their second tap already.
    if (this._lastClickPointer === 'touch' || this._lastClickPointer === 'pen') return;
    this.isolateFromFirstClick(value);
  }

  private isolateFromFirstClick(value: string): void {
    const first = this._firstClick;
    this._firstClick = null;
    this.isolate(value, isolationBase(first, valueToKey(value), this.host._legendItems));
  }

  toggle(value: string): void {
    const valueKey = valueToKey(value);
    const result = updateItemsVisibility(this.host._legendItems, this.host._hiddenValues, valueKey);

    this.host._legendItems = result.items;
    this.host._hiddenValues = result.hiddenValues;

    const item = this.host._legendItems.find((i) => valueToKey(i.value) === valueKey);
    this.host._announceStatus(`${toDisplayValue(value)} ${item?.isVisible ? 'shown' : 'hidden'}`);

    this.host._scatterplotController.syncHiddenValues();
    this.host._dispatchItemAction(value, 'toggle');
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  isolate(value: string, items: LegendItem[] = this.host._legendItems): void {
    const result = isolateItem(items, value);

    this.host._legendItems = result.items;
    this.host._hiddenValues = result.hiddenValues;

    const visibleCount = result.items.filter((i) => i.isVisible).length;
    this.host._announceStatus(
      visibleCount === 1 ? `Isolated ${toDisplayValue(value)}` : 'All items shown',
    );

    this.host._scatterplotController.syncHiddenValues();
    this.host._dispatchItemAction(value, 'isolate');
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  extractFromOther(value: string): void {
    // Set pending extract value - will be used by processor to add this item to visible set
    this.host._pendingExtractValue = value;

    // Increase maxVisibleValues to accommodate the extracted item
    // This triggers updated() which calls _updateLegendItems() with pending value still set
    this.host.maxVisibleValues = this.host.maxVisibleValues + 1;

    // Don't call _updateLegendItems() explicitly - the maxVisibleValues change will trigger
    // updated() which calls it. If we call it here, it will be called twice and the
    // pending value will be cleared after the first call, causing the second call to not
    // respect the extract operation.

    this.host._announceStatus(`Extracted ${toDisplayValue(value)} from Other category`);
    this.host._dispatchItemAction(value, 'extract');
    // Save settings after the update cycle completes
    this.host.updateComplete.then(() => {
      this.host._persistenceController.saveSettings();
    });
  }

  extractAllFromOther(): void {
    const nonOtherCount = this.host._legendItems.filter(
      (i) => i.value !== LEGEND_VALUES.OTHER,
    ).length;
    const targetMaxVisibleValues = nonOtherCount + this.host._otherItems.length;

    this.host._otherPopover.close();

    this.host._announceStatus('Extracted all items from Other category');
    for (const item of this.host._otherItems) {
      this.host._dispatchItemAction(item.value, 'extract');
    }
    this.host.maxVisibleValues = targetMaxVisibleValues;

    this.host.updateComplete.then(() => {
      this.host._persistenceController.saveSettings();
    });
  }

  mergeToOther(value: string): void {
    // Set pending merge value - will be used by processor to remove this item from visible set
    this.host._pendingMergeValue = value;

    // Decrease maxVisibleValues to remove space for the merged item
    // This triggers updated() which calls _updateLegendItems() with pending value still set
    this.host.maxVisibleValues = Math.max(1, this.host.maxVisibleValues - 1);

    // Don't call _updateLegendItems() explicitly - the maxVisibleValues change will trigger
    // updated() which calls it. If we call it here, it will be called twice and the
    // pending value will be cleared after the first call, causing the second call to not
    // respect the merge operation.

    this.host._announceStatus(`Moved ${toDisplayValue(value)} to Other category`);
    // Save settings after the update cycle completes
    this.host.updateComplete.then(() => {
      this.host._persistenceController.saveSettings();
    });
  }

  async highlightDropped(value: string): Promise<void> {
    // Wait for Lit to render the new item order. The second await covers an update that the
    // first one's `updated()` schedules (the data pipeline still writes state there).
    await this.host.updateComplete;
    await this.host.updateComplete;

    const items = this.host.shadowRoot?.querySelectorAll('.legend-item');
    if (!items) return;

    for (const el of items) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.getAttribute('data-value') === value) {
        htmlEl.classList.add('legend-item-just-dropped');
        // The handle, as before the main button moved ahead of it in the row; Other has no usable one.
        const focusTarget =
          htmlEl.querySelector<HTMLElement>('.drag-handle:not(:disabled)') ??
          htmlEl.querySelector<HTMLElement>('.legend-item-main');
        focusTarget?.focus();
        this.host._announceStatus(
          this.host._announceManualPromotionOnNextReorder
            ? `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}. Switched ${this.host._annotationDisplayName} to Manual order.`
            : `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}.`,
        );
        this.host._announceManualPromotionOnNextReorder = false;
        htmlEl.addEventListener(
          'animationend',
          () => {
            htmlEl.classList.remove('legend-item-just-dropped');
          },
          { once: true },
        );
        break;
      }
    }
  }

  private reverseZOrder(): void {
    if (this.host._legendItems.length <= 1) return;

    const currentMode = this.host._currentSortMode;
    if (
      this.host._isNumericAnnotation() &&
      currentMode === 'manual' &&
      !this.host._numericManualOrderIdsByAnnotation[this.host.selectedAnnotation]?.length
    ) {
      this.host._data.setNumericManualOrderIds(
        this.host.selectedAnnotation,
        [...this.host._sortedLegendItems]
          .filter((item) => item.value !== LEGEND_VALUES.OTHER)
          .map((item) => item.value),
      );
    }

    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: reverseSortMode(currentMode),
    };

    if (!this.host._isNumericAnnotation()) {
      // Always reverse the visible items directly, keeping "Other" at the end.
      this.host._legendItems = reverseKeepingOtherLast(this.host._legendItems);
    } else {
      this.host._updateLegendItems();
    }

    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /**
   * Applies a sort-menu pick at once and stores it, as the settings dialog's Save applied an
   * order. "Your order" starts from the order on screen, whatever sorted it.
   */
  applySortMode(mode: LegendSortMode): void {
    const isNumeric = this.host._isCurrentAnnotationNumeric();
    const next = normalizeSortModeForType(mode, isNumeric);
    this.host._keyboard.clear();
    if (next === 'manual' && !this.host._currentSortMode.startsWith('manual')) {
      const shown = displayedOrder(this.host._sortedLegendItems, isNumeric);
      if (isNumeric) this.host._data.setNumericManualOrderIds(this.host.selectedAnnotation, shown);
      else this.host._legendItems = reorderByValues(this.host._legendItems, shown);
    }
    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: next,
    };
    this.host._updateLegendItems();
    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._persistenceController.saveSettings();
  }

  toggleOrderDirection(): void {
    if (this.host._legendItems.length <= 1) return;
    this.host._reorder.clear();

    if (this.host._isNumericAnnotation() && !this.host._currentSortMode.startsWith('manual')) {
      const nextMode: LegendSortMode =
        this.host._currentSortMode === 'alpha-desc' ? 'alpha-asc' : 'alpha-desc';
      this.host._annotationSortModes = {
        ...this.host._annotationSortModes,
        [this.host.selectedAnnotation]: nextMode,
      };
      this.host._updateLegendItems();
      this.host._scatterplotController.syncNumericAnnotationSettings();
      this.host._persistenceController.saveSettings();
      this.host.requestUpdate();
      return;
    }

    this.reverseZOrder();
  }
}
