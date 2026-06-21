/**
 * Canonical painter-order staging shared by the live render path
 * (`WebGLRenderer.populateBuffers`) and the off-screen export path
 * (`ExportRenderer.prepareOffscreenBufferData`).
 *
 * The live path is canonical: it stages EVERY slot (including opacity-0 slots,
 * which are invisible but kept so the sort order is stable across visibility
 * toggles), sorts indices far->near via {@link sortIndicesByDepthDescending}
 * (descending depth, ties broken by ascending original slot index), and derives
 * the two-pass selection cut (`selectedStartIndex`) from the FIRST sorted slot
 * whose opacity is >= 0.99 when a selection is active.
 *
 * Extracting it here makes export == live structural rather than
 * hand-maintained: both consume {@link buildPaintOrder}.
 */

import { sortIndicesByDepthDescending } from './depth-sort';

/** Opacity threshold at/above which a point counts as selected for the two-pass cut. */
const SELECTED_OPACITY_THRESHOLD = 0.99;

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
 *                     sorted order; lets the caller hook per-slot side effects
 *                     (e.g. tracking rendered IDs) while we locate `firstSelected`.
 */
export function buildPaintOrder(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
  selectionActive: boolean,
  getOpacityAtSortedSlot: (sortedIndex: number, srcSlot: number) => number,
): PaintOrderPlan {
  sortIndicesByDepthDescending(order, depths, count);

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
