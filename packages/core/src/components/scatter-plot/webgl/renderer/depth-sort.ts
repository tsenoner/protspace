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
 *
 * With `scratch` (length >= count) a large sort is a stable LSD radix sort on the
 * float bits instead, about 3x faster than the counting sort at 573K points. It
 * orders exactly as the comparator does: -0 counts as +0, and a NaN falls through.
 */

/**
 * Below this many points the counting sort is as fast as the radix sort, whose
 * three histograms cost the same at any size.
 */
const RADIX_MIN_COUNT = 2048;
const DIGIT_BITS = 11;
const DIGIT_COUNT = 1 << DIGIT_BITS;
const DIGIT_MASK = DIGIT_COUNT - 1;

/** Above this many distinct depths the counting sort stops paying and we use the comparator. */
const MAX_DISTINCT_DEPTHS = 4096;

export function sortIndicesByDepthDescending(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
  scratch?: Uint32Array,
): void {
  for (let i = 0; i < count; i++) order[i] = i;
  if (count < 2) return;
  if (count >= RADIX_MIN_COUNT && scratch && scratch.length >= count) {
    if (radixSortDescending(order, depths, count, scratch)) return;
  }

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

/**
 * The key whose ascending order is descending depth. IEEE floats order like their
 * bits once negative values have every bit flipped and positive ones the sign bit;
 * a final NOT turns that ascending key into a descending one.
 */
function descendingKey(bits: number): number {
  if (bits === 0x80000000) bits = 0; // -0 sorts as +0
  return (bits & 0x80000000 ? bits : ~(bits | 0x80000000)) >>> 0;
}

/** Returns false, leaving `order` as the identity, when a depth is NaN. */
function radixSortDescending(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
  scratch: Uint32Array,
): boolean {
  const bits = new Uint32Array(depths.buffer, depths.byteOffset, count);
  const histograms = new Uint32Array(DIGIT_COUNT * 3);
  for (let i = 0; i < count; i++) {
    const b = bits[i];
    if ((b & 0x7fffffff) > 0x7f800000) return false;
    const key = descendingKey(b);
    histograms[key & DIGIT_MASK]++;
    histograms[DIGIT_COUNT + ((key >>> DIGIT_BITS) & DIGIT_MASK)]++;
    histograms[2 * DIGIT_COUNT + (key >>> (2 * DIGIT_BITS))]++;
  }

  let src = order;
  let dst = scratch;
  for (let pass = 0; pass < 3; pass++) {
    const base = pass * DIGIT_COUNT;
    const shift = pass * DIGIT_BITS;
    // A digit every key shares would leave the order as it is.
    if (histograms[base + ((descendingKey(bits[0]) >>> shift) & DIGIT_MASK)] === count) continue;

    let offset = 0;
    for (let d = 0; d < DIGIT_COUNT; d++) {
      const n = histograms[base + d];
      histograms[base + d] = offset;
      offset += n;
    }
    for (let i = 0; i < count; i++) {
      const idx = src[i];
      dst[histograms[base + ((descendingKey(bits[idx]) >>> shift) & DIGIT_MASK)]++] = idx;
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  if (src !== order) order.set(src.subarray(0, count));
  return true;
}
