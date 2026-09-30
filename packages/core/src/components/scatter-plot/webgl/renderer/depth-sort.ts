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

  // Collect the distinct depths, giving each an id in first-seen order and recording every
  // point's id, so no later pass looks a float up in the Map. Runs of equal depth (the common
  // case: staging emits points tier by tier) skip the lookup too. Bail out to the comparator
  // if there are too many distinct depths, or if any depth is NaN (the comparator's ordering
  // is engine-defined there, so we must not diverge).
  const idOf = new Map<number, number>();
  const ids = new Uint16Array(count);
  let previous = NaN;
  let id = 0;
  for (let i = 0; i < count; i++) {
    const d = depths[i];
    if (d !== previous) {
      if (d !== d) {
        comparatorSort(order, depths, count);
        return;
      }
      const known = idOf.get(d);
      if (known === undefined) {
        id = idOf.size;
        if (id >= MAX_DISTINCT_DEPTHS) {
          comparatorSort(order, depths, count);
          return;
        }
        idOf.set(d, id);
      } else {
        id = known;
      }
      previous = d;
    }
    ids[i] = id;
  }

  if (idOf.size < 2) return; // all equal -> identity order is already the answer
  const distinct = Array.from(idOf.keys()).sort((a, b) => b - a);
  const rankOfId = new Uint16Array(distinct.length);
  for (let r = 0; r < distinct.length; r++) rankOfId[idOf.get(distinct[r])!] = r;

  // Counting sort: bucket sizes -> exclusive prefix sums -> scatter. `ids` is overwritten
  // with each point's rank as it is counted, so the scatter pass reads it directly.
  const starts = new Int32Array(distinct.length + 1);
  for (let i = 0; i < count; i++) {
    const rank = rankOfId[ids[i]];
    ids[i] = rank;
    starts[rank + 1]++;
  }
  for (let r = 0; r < distinct.length; r++) starts[r + 1] += starts[r];
  // Scattering in ascending `i` keeps the sort stable, i.e. ties break by ascending index.
  for (let i = 0; i < count; i++) order[starts[ids[i]]++] = i;
}

function comparatorSort(order: Uint32Array, depths: Float32Array, count: number): void {
  order.subarray(0, count).sort((a, b) => depths[b] - depths[a] || a - b);
}
