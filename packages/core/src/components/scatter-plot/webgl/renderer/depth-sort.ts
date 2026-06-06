/**
 * Fill `order[0..count)` with 0..count-1 and sort it so points are ordered far -> near
 * (DESCENDING depth) for the painter's algorithm. Ties break by ascending original index
 * (stable). Depth is continuous, so this is an O(n log n) comparator sort — NOT a bucket sort.
 * Sorts `order` in place; `depths` is indexed by original point index and is not modified.
 */
export function sortIndicesByDepthDescending(
  order: Uint32Array,
  depths: Float32Array,
  count: number,
): void {
  for (let i = 0; i < count; i++) order[i] = i;
  order.subarray(0, count).sort((a, b) => depths[b] - depths[a] || a - b);
}
