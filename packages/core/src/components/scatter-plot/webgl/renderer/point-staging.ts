/**
 * The painter order `stageInPaintOrder` (pass-staging.ts) stages both the live
 * points and the export in, so the two cannot drift.
 *
 * EVERY slot is ordered, opacity-0 ones included: they are invisible but kept
 * so the sort order is stable across visibility toggles. Indices sort far->near
 * via {@link sortIndicesByDepthDescending} (descending depth, ties broken by
 * ascending original slot index), and the two-pass selection cut
 * (`selectedStartIndex`) is the FIRST sorted slot whose opacity is >= 0.99 when
 * a selection is active.
 */

import { sortIndicesByDepthDescending } from './depth-sort';
import { SELECTED_OPACITY_THRESHOLD } from '../../paint-depth';

/** Result of computing the canonical painter-order staging plan. */
interface PaintOrderPlan {
  /**
   * Slot indices in far->near (descending-depth) draw order. `order[0..count)`
   * is valid; entries index into the ORIGINAL (input) slot order. This is the
   * caller's `sortOrder` scratch, sorted in place.
   */
  order: Uint32Array;
  /**
   * Index into `order` where the selected (opacity >= 0.99) run begins, used by
   * the two-pass selection blend. Equals `count` when no selection is active or
   * no point qualifies (i.e. draw everything in a single blended pass).
   */
  selectedStartIndex: number;
}

/**
 * Compute the canonical painter-order plan for `count` slots.
 *
 * @param order        Caller-owned scratch (length >= count); sorted in place and returned.
 * @param depths       Per-slot depth scratch indexed by ORIGINAL slot index (length >= count).
 *                     Caller fills `depths[i]` for every `i < count` before calling.
 * @param count        Number of slots to stage.
 * @param selectionActive Whether a selection is active (enables the two-pass cut).
 * @param getOpacityAtSortedSlot Returns the opacity of the slot drawn at sorted
 *                     position `k` (i.e. for `order[k]`). Called once per slot in
 *                     sorted order, so the caller can stage each slot there while
 *                     we locate `firstSelected`.
 * @param sortScratch  Caller-owned scratch (length >= count); the depth sort's second buffer.
 */
export function buildPaintOrder(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
  selectionActive: boolean,
  getOpacityAtSortedSlot: (sortedIndex: number, srcSlot: number) => number,
  sortScratch: Uint32Array,
): PaintOrderPlan {
  sortIndicesByDepthDescending(order, depths, count, sortScratch);

  let firstSelected = -1;
  for (let k = 0; k < count; k++) {
    const opacity = getOpacityAtSortedSlot(k, order[k]);
    if (selectionActive && firstSelected === -1 && opacity >= SELECTED_OPACITY_THRESHOLD) {
      firstSelected = k;
    }
  }

  const selectedStartIndex = selectionActive && firstSelected !== -1 ? firstSelected : count;

  return { order, selectedStartIndex };
}
