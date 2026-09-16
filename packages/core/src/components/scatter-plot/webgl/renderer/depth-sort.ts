/**
 * Fill `order[0..count)` with 0..count-1 and sort it so points are ordered far -> near
 * (DESCENDING depth) for the painter's algorithm. Ties break by ascending original index
 * (stable). Sorts `order` in place; `depths` is indexed by original point index and is not
 * modified.
 *
 * Depth is BUCKETED, not continuous: `composePaintDepth` (point-staging.ts) maps a slot onto
 * one of 4 painter tiers times the handful of base depths the style getters emit (a few
 * opacities times at most ~12 legend slots), so a real dataset has tens of distinct values.
 * That makes an O(n) counting sort over the distinct values far cheaper than a comparator
 * sort (573K points: 139 ms -> 26 ms). If a future caller does feed continuous depth we fall
 * back to the comparator, which produces the same output, just slower.
 */

/** Above this many distinct depths the counting sort stops paying and we use the comparator. */
const MAX_DISTINCT_DEPTHS = 4096;

export function sortIndicesByDepthDescending(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
): void {
  for (let i = 0; i < count; i++) order[i] = i;
  if (count < 2) return;

  // Collect the distinct depths. Bail out to the comparator if there are too many, or if any
  // depth is NaN (the comparator's ordering is engine-defined there, so we must not diverge).
  const rank = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const d = depths[i];
    if (d !== d) {
      comparatorSort(order, depths, count);
      return;
    }
    rank.set(d, 0);
    if (rank.size > MAX_DISTINCT_DEPTHS) {
      comparatorSort(order, depths, count);
      return;
    }
  }

  const distinct = Array.from(rank.keys()).sort((a, b) => b - a);
  if (distinct.length < 2) return; // all equal -> identity order is already the answer
  for (let r = 0; r < distinct.length; r++) rank.set(distinct[r], r);

  // Counting sort: bucket sizes -> exclusive prefix sums -> scatter.
  const starts = new Int32Array(distinct.length + 1);
  for (let i = 0; i < count; i++) starts[rank.get(depths[i])! + 1]++;
  for (let r = 0; r < distinct.length; r++) starts[r + 1] += starts[r];
  // Scattering in ascending `i` keeps the sort stable, i.e. ties break by ascending index.
  for (let i = 0; i < count; i++) order[starts[rank.get(depths[i])!]++] = i;
}

function comparatorSort(order: Uint32Array, depths: Float32Array, count: number): void {
  order.subarray(0, count).sort((a, b) => depths[b] - depths[a] || a - b);
}
