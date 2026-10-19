/**
 * Fill `order[0..count)` with 0..count-1 and sort it so points are ordered far -> near
 * (DESCENDING depth) for the painter's algorithm. Ties break by ascending original index
 * (stable). Sorts `order` in place; `depths` is indexed by original point index and is not
 * modified.
 *
 * The sort is a stable LSD radix sort on the float bits, with `scratch` (length >= count)
 * as its second buffer. It orders exactly as the comparator `depths[b] - depths[a] || a - b`
 * does, -0 counting as +0. A NaN leaves that comparator's order engine-defined, so any NaN
 * depth hands the sort to the comparator itself.
 */

const DIGIT_BITS = 11;
const DIGIT_COUNT = 1 << DIGIT_BITS;
const DIGIT_MASK = DIGIT_COUNT - 1;

export function sortIndicesByDepthDescending(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
  scratch: Uint32Array,
): void {
  for (let i = 0; i < count; i++) order[i] = i;
  if (count < 2) return;
  if (!radixSortDescending(order, depths, count, scratch)) comparatorSort(order, depths, count);
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
