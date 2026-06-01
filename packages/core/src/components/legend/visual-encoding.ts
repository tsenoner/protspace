/**
 * Visual encoding for legend categories.
 * Assigns colors and shapes based on slot index.
 *
 * Key principles:
 * - Visible items always get the most distinct colors (slots 0, 1, 2, ...)
 * - Items in "Other" bucket don't consume slots
 * - "Other" has a fixed color and always uses a circle
 * - NA participates in regular slot assignment; the legend processor
 *   overrides NA's default color to NA_DEFAULT_COLOR before conflict resolution.
 * - Slot recycling ensures extracted items get available slots
 */

import { COLOR_SCHEMES } from '@protspace/utils';
import { LEGEND_VALUES } from './config';

const KELLYS_COLORS = COLOR_SCHEMES.kellys;

/** Special slot values for reserved categories */
export const SPECIAL_SLOTS = {
  OTHER: -1,
} as const;

/** Fixed color for the synthetic "Other" category. */
const OTHER_COLOR = '#999999';

interface VisualEncoding {
  color: string;
  shape: string;
}

/**
 * Get visual encoding for a category based on its slot.
 *
 * The default shape is always `circle`. Users assign per-category shapes
 * through the per-item shape picker; those persist via `PersistedCategoryData.shape`.
 *
 * NA color is NOT special-cased here — that's the legend processor's job.
 * This function only knows about "Other" (fixed) vs slot-indexed regulars.
 */
export function getVisualEncoding(slot: number, categoryName?: string): VisualEncoding {
  if (categoryName === LEGEND_VALUES.OTHER) {
    return { color: OTHER_COLOR, shape: 'circle' };
  }

  const color = KELLYS_COLORS[slot % KELLYS_COLORS.length];
  return { color, shape: 'circle' };
}

/**
 * Slot manager with recycling support.
 *
 * Ensures visible items get the most distinct colors by:
 * 1. Assigning slots 0, 1, 2, ... to visible items in order
 * 2. Tracking freed slots when items move to Others
 * 3. Reusing lowest freed slot for newly visible/extracted items
 */
export class SlotTracker {
  /** Map from category name to assigned slot */
  private slots = new Map<string, number>();
  /** Pool of freed slots available for reuse (kept sorted ascending) */
  private freedSlots: number[] = [];
  /** Next slot to assign if no freed slots available */
  private nextSlot = 0;

  /**
   * Get or assign a slot for a category.
   * - "Other" gets a reserved negative slot
   * - N/A participates in regular slot assignment
   * - Regular categories get the lowest available slot
   */
  getSlot(categoryName: string): number {
    // Special categories get fixed slots
    if (categoryName === LEGEND_VALUES.OTHER) {
      return SPECIAL_SLOTS.OTHER;
    }

    // Return existing slot if already assigned
    if (this.slots.has(categoryName)) {
      return this.slots.get(categoryName)!;
    }

    // Assign new slot: prefer recycled slots, otherwise use next available
    let slot: number;
    if (this.freedSlots.length > 0) {
      slot = this.freedSlots.shift()!; // Take lowest freed slot
    } else {
      slot = this.nextSlot++;
    }

    this.slots.set(categoryName, slot);
    return slot;
  }

  /**
   * Free a slot when a category moves to Others.
   * The slot will be recycled for future use.
   */
  freeSlot(categoryName: string): void {
    if (categoryName === LEGEND_VALUES.OTHER) {
      return; // "Other" doesn't have a freeable slot
    }

    const slot = this.slots.get(categoryName);
    if (slot !== undefined) {
      this.slots.delete(categoryName);
      // Insert into freed slots maintaining sorted order
      const insertIdx = this.freedSlots.findIndex((s) => s > slot);
      if (insertIdx === -1) {
        this.freedSlots.push(slot);
      } else {
        this.freedSlots.splice(insertIdx, 0, slot);
      }
    }
  }

  /**
   * Bulk update: reassign slots to match the given visible items order.
   * This ensures visible items always have slots 0, 1, 2, ... in display order.
   *
   * @param visibleCategories - Category names in their display order (most frequent first)
   */
  reassignSlots(visibleCategories: string[]): void {
    // Track which slots are being used
    const oldSlots = new Map(this.slots);
    const newSlots = new Map<string, number>();

    // Assign slots 0, 1, 2, ... to visible non-Other items in order.
    let slotIndex = 0;
    visibleCategories.forEach((category) => {
      if (category !== LEGEND_VALUES.OTHER) {
        newSlots.set(category, slotIndex);
        slotIndex++;
      }
    });

    // Find slots that were freed (categories that are no longer visible)
    const freedFromOld: number[] = [];
    for (const [category, slot] of oldSlots) {
      if (!newSlots.has(category)) {
        freedFromOld.push(slot);
      }
    }

    // Update state
    this.slots = newSlots;
    this.nextSlot = slotIndex;

    // Freed slots are those beyond the visible count
    this.freedSlots = freedFromOld.filter((s) => s >= this.nextSlot).sort((a, b) => a - b);
  }

  /**
   * Reset the tracker completely.
   */
  reset(): void {
    this.slots.clear();
    this.freedSlots = [];
    this.nextSlot = 0;
  }

  /**
   * Check if the tracker is empty (no slots assigned).
   */
  isEmpty(): boolean {
    return this.slots.size === 0;
  }
}
