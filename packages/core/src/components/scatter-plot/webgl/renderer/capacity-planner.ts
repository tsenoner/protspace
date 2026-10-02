/**
 * How far retained capacity may exceed the requirement before it is released.
 *
 * Retaining is normally right — it is what stops progressively larger datasets reallocating every
 * time — but grow-only retention was only harmless while the clamp bounded capacity at 1,000,000.
 * At a 2,000,000 cap, "load 2M then open the 5K demo" would hold the larger footprint for the rest
 * of the session. 4x is wide enough that ordinary dataset switches still reuse their buffers.
 */
const CAPACITY_SHRINK_FACTOR = 4;

/**
 * Plan the next renderer buffer capacity.
 *
 * - At least `minCapacityFloor` (MIN_CAPACITY).
 * - Across reloads, grow geometrically by 1.5x so progressively larger datasets don't trigger a
 *   reallocation every time — but only while the retained capacity is still within
 *   `CAPACITY_SHRINK_FACTOR` of what is required. Past that the retained figure is discarded and
 *   the plan is made afresh, because the 1.5x rule is about growing ACROSS reloads, not a floor.
 * - Rounded UP to a whole `capacityGranularity` block, so SoA arrays aren't oversized to the next
 *   power of two (which wasted ~83% at 573K) and the label atlas has no partial-row waste at its
 *   narrowest supported width.
 * - Bounded by `maxCapacity`, the largest point count the renderer will ever draw. Without this
 *   the 1.5x growth allocates for points that can never be rendered — and, because the label
 *   atlas is sized from capacity, pushes its height past `gl.MAX_TEXTURE_SIZE` at point counts
 *   well under the cap (900k then 950k used to plan 1,350,144).
 *
 * The bound never starves a load: it is floored at the snapped requirement, so asking for more
 * than `maxCapacity` still returns enough capacity for the request.
 *
 * `maxCapacity` is deliberately required rather than defaulted to Infinity: an unbounded plan is
 * the bug this function exists to prevent, so a caller that forgets it should not silently get one.
 *
 * Callers reallocate iff the result differs from what they hold, so this single function decides
 * both growth and release — there is no second capacity rule at the call site.
 */
export function planRendererCapacity(
  minCapacity: number,
  currentCapacity: number,
  minCapacityFloor: number,
  capacityGranularity: number,
  maxCapacity: number,
): number {
  const snap = (value: number) => Math.ceil(value / capacityGranularity) * capacityGranularity;
  const required = Math.max(minCapacity, minCapacityFloor);
  // What we already hold covers the requirement and is not absurd for it — the
  // common case, and the one where returning anything else would reallocate for
  // nothing.
  if (currentCapacity >= required && currentCapacity <= required * CAPACITY_SHRINK_FACTOR) {
    return currentCapacity;
  }
  // Geometric growth applies only when actually growing across a reload. On the
  // release path it must not fight the shrink: it is a rule about growing, not a
  // floor.
  const growing = currentCapacity > 0 && required > currentCapacity;
  const target = growing ? Math.max(required, Math.ceil(currentCapacity * 1.5)) : required;
  // Clamp first, snap once: `snap` is monotone, so snapping the clamped value is
  // identical to clamping the snapped ones — and this reads as the sentence the
  // doc block above states.
  return snap(Math.max(required, Math.min(target, maxCapacity)));
}

/**
 * Whether a capacity-sized resource planned for `plannedCapacity` should be re-planned now that
 * the renderer holds `capacity`.
 *
 * Same rule as `planRendererCapacity`, exposed separately for resources the planner does not size
 * directly — the label atlas, whose geometry also depends on the device texture limit. Keeping
 * both on one rule is what stops the SoA arrays shrinking while the atlas quietly does not.
 */
export function shouldReplanCapacityResource(
  plannedCapacity: number,
  capacity: number,
  minCapacityFloor: number,
): boolean {
  if (plannedCapacity < capacity) return true;
  return plannedCapacity > Math.max(minCapacityFloor, capacity) * CAPACITY_SHRINK_FACTOR;
}
