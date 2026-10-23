import type { ReactiveController, ReactiveControllerHost } from 'lit';
import Sortable from 'sortablejs';
import type { LegendItem, LegendSortMode } from '../types';
import { LEGEND_VALUES } from '../config';

/** How long a finger rests on a drag handle before the row lifts; a swipe moves first and scrolls. */
const TOUCH_DRAG_DELAY_MS = 250;

/** Sortable's class for the copy of the row that follows a finger in a touch drag. */
const FALLBACK_CLASS = 'sortable-fallback';

/**
 * Callback interface for drag events
 */
export interface DragCallbacks {
  /**
   * Returns the legend items in the order the rows are drawn. Sortable's indices count drawn
   * rows, which differ from zOrder order in the separation sorts.
   */
  getDisplayedItems: () => readonly LegendItem[];
  /** Updates legend items with new z-orders */
  setLegendItems: (items: LegendItem[]) => void;
  /** Called after successful reorder */
  onReorder: () => void;
  /** Called when an item is dropped onto "Other" */
  onMergeToOther?: (value: string) => void;
  /** Called to switch to manual sort mode */
  onSortModeChange?: (mode: LegendSortMode) => void;
  /** Called after a successful drop to highlight the dropped item */
  onDropComplete?: (value: string) => void;
}

export class DragController implements ReactiveController {
  private host: ReactiveControllerHost;
  private callbacks: DragCallbacks;
  private sortableInstance: Sortable | null = null;
  private containerEl: HTMLElement | null = null;
  private enabled = true;

  private preDragChildNodes: Node[] = [];
  private highlightedOtherEl: HTMLElement | null = null;
  private dragging = false;

  /**
   * While a row is lifted, a finger's move drags it instead of scrolling the list. Sortable does
   * this itself except on Chrome for Android, and a handle's touch-action cannot change once its
   * touch has started, so the list stops the scroll here.
   */
  private onTouchMove = (event: Event): void => {
    if (this.dragging && event.cancelable) event.preventDefault();
  };

  constructor(host: ReactiveControllerHost, callbacks: DragCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.destroy();
  }

  /**
   * Initialize Sortable on the legend items container.
   * Should be called once when the container element is available.
   */
  initialize(container: HTMLElement, enabled: boolean = true): void {
    this.enabled = enabled;

    // Don't reinitialize on the same container
    if (this.sortableInstance && this.containerEl === container) {
      this.sortableInstance.option('disabled', !enabled);
      return;
    }

    // Destroy previous instance if exists
    if (this.sortableInstance) {
      this.destroy();
    }

    this.containerEl = container;
    container.addEventListener('touchmove', this.onTouchMove, { passive: false });

    this.sortableInstance = new Sortable(container, {
      animation: 200,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      ghostClass: 'legend-item-ghost',
      chosenClass: 'legend-item-chosen',
      dragClass: 'legend-item-drag',
      // A disabled grip (a numeric legend's N/A row) lifts nothing.
      handle: '.drag-handle:not(:disabled)',
      // On touch a row lifts only after the finger rests on its handle; a swipe that starts on a
      // handle moves past the threshold first, so it scrolls the list. Mouse drags start at once.
      delay: TOUCH_DRAG_DELAY_MS,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      fallbackClass: FALLBACK_CLASS,
      swapThreshold: 0.65,
      direction: 'vertical',
      disabled: !enabled,

      // Prevent dragging the "Other" item (always stays at bottom)
      filter: '.legend-item-other',
      preventOnFilter: true,

      onStart: (evt) => this.handleDragStart(evt),
      onMove: (evt) => this.handleDragMove(evt),
      onEnd: (evt) => this.handleDragEnd(evt),
    });
  }

  private handleDragStart(evt: Sortable.SortableEvent): void {
    this.dragging = true;
    // A touch drag floats a copy of the row in the list (Sortable's fallback). Sortable removes it
    // on drop, before `restoreDom` runs, so it must not be put back with the rows.
    this.preDragChildNodes = Array.from(evt.from.childNodes).filter(
      (node) => !(node instanceof Element && node.classList.contains(FALLBACK_CLASS)),
    );
  }

  private handleDragMove(evt: Sortable.MoveEvent): boolean | -1 | 1 | void {
    const relatedEl = evt.related;
    const isOverOther = relatedEl.classList.contains('legend-item-other');

    if (isOverOther) {
      // Highlight the "Other" item as a merge target
      if (this.highlightedOtherEl !== relatedEl) {
        this.clearOtherHighlight();
        relatedEl.classList.add('legend-item-merge-target');
        this.highlightedOtherEl = relatedEl;
      }
      // Prevent the ghost from appearing at/below "Other"
      return false;
    }

    // Moving over a normal item — clear any "Other" highlight
    this.clearOtherHighlight();
    return undefined;
  }

  private clearOtherHighlight(): void {
    if (this.highlightedOtherEl) {
      this.highlightedOtherEl.classList.remove('legend-item-merge-target');
      this.highlightedOtherEl = null;
    }
  }

  private handleDragEnd(evt: Sortable.SortableEvent): void {
    this.dragging = false;
    const wasMergeTarget = this.highlightedOtherEl !== null;
    this.clearOtherHighlight();

    const { oldIndex, newIndex, item } = evt;

    // Get the dragged item's value from data attribute
    const draggedValue = item.getAttribute('data-value');

    // If dropped while "Other" was highlighted, trigger merge
    if (wasMergeTarget && draggedValue && draggedValue !== LEGEND_VALUES.OTHER) {
      this.restoreDom(evt.from);
      this.callbacks.onMergeToOther?.(draggedValue);
      return;
    }

    // Validate indices
    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) {
      this.restoreDom(evt.from);
      return;
    }

    if (!draggedValue) {
      console.warn('[DragController] Dragged item missing data-value attribute');
      this.restoreDom(evt.from);
      return;
    }

    // The rows as drawn: Sortable's indices count them, not the zOrder.
    const sortedItems = this.callbacks.getDisplayedItems();

    // Find the dragged item
    const draggedItem = sortedItems.find((i) => i.value === draggedValue);
    if (!draggedItem) {
      console.warn('[DragController] Could not find dragged item in legend items');
      this.restoreDom(evt.from);
      return;
    }

    // Check if dropping onto "Other" category (merge operation)
    const targetItem = sortedItems[newIndex];
    if (targetItem?.value === LEGEND_VALUES.OTHER && draggedValue !== LEGEND_VALUES.OTHER) {
      // Restore DOM first, then trigger merge
      this.restoreDom(evt.from);
      this.callbacks.onMergeToOther?.(draggedValue);
      return;
    }

    // Prevent dropping below "Other" (Other must stay at bottom)
    const otherIndex = sortedItems.findIndex((i) => i.value === LEGEND_VALUES.OTHER);
    if (otherIndex !== -1 && newIndex >= otherIndex && draggedValue !== LEGEND_VALUES.OTHER) {
      // Restore DOM - can't drop at or after "Other"
      this.restoreDom(evt.from);
      return;
    }

    // Build new order: remove dragged item, insert at new position
    const itemsWithoutDragged = sortedItems.filter((i) => i.value !== draggedValue);
    const newOrder = [
      ...itemsWithoutDragged.slice(0, newIndex),
      draggedItem,
      ...itemsWithoutDragged.slice(newIndex),
    ];

    const currentOrderValues = sortedItems.map((currentItem) => currentItem.value);
    const nextOrderValues = newOrder.map((nextItem) => nextItem.value);
    const orderChanged =
      currentOrderValues.length === nextOrderValues.length &&
      currentOrderValues.some((value, index) => value !== nextOrderValues[index]);
    if (!orderChanged) {
      this.restoreDom(evt.from);
      return;
    }

    // Assign new z-orders based on position
    const reorderedItems = newOrder.map((reorderedItem, idx) => ({
      ...reorderedItem,
      zOrder: idx,
    }));

    // Restore DOM to pre-drag state so Lit's internal tracking is intact
    this.restoreDom(evt.from);

    // Update state - Lit will re-render with correct order
    this.callbacks.onSortModeChange?.('manual');
    this.callbacks.setLegendItems(reorderedItems);
    this.callbacks.onReorder();
    this.callbacks.onDropComplete?.(draggedValue);
  }

  private restoreDom(container: HTMLElement): void {
    // Temporarily disable Sortable to prevent interference
    if (this.sortableInstance) {
      this.sortableInstance.option('disabled', true);
    }

    // Restore all child nodes (including Lit comment markers) to pre-drag order
    if (this.preDragChildNodes.length > 0) {
      for (const node of this.preDragChildNodes) {
        container.appendChild(node);
      }
      this.preDragChildNodes = [];
    }
    // A copy an interrupted touch drag left behind would stay as a stray row.
    container.querySelectorAll(`:scope > .${FALLBACK_CLASS}`).forEach((node) => node.remove());

    // Force Lit to re-render with correct state
    this.host.requestUpdate();

    // Re-enable Sortable after render
    requestAnimationFrame(() => {
      if (this.sortableInstance) {
        this.sortableInstance.option('disabled', !this.enabled);
      }
    });
  }

  /**
   * Destroy the Sortable instance and clean up
   */
  destroy(): void {
    if (this.sortableInstance) {
      this.sortableInstance.destroy();
      this.sortableInstance = null;
    }
    this.containerEl?.removeEventListener('touchmove', this.onTouchMove);
    this.containerEl = null;
    this.dragging = false;
    this.preDragChildNodes = [];
  }

  /**
   * Get the Sortable instance (for testing)
   */
  getInstance(): Sortable | null {
    return this.sortableInstance;
  }

  /**
   * Check if controller is initialized
   */
  isInitialized(): boolean {
    return this.sortableInstance !== null;
  }
}
