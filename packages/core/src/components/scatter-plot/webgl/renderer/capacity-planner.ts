/**
 * Plan the next renderer buffer capacity.
 *
 * - At least `minCapacityFloor` (MIN_CAPACITY).
 * - Across reloads (currentCapacity > 0), grow geometrically by 1.5x so progressively larger
 *   datasets don't trigger a reallocation every time.
 * - Rounded UP to a whole label-texture row (`pointsPerTextureRow` points) so the label texture
 *   (LABEL_TEXTURE_WIDTH wide, MAX_LABELS texels/point) has no partial-row waste — and so SoA
 *   arrays aren't oversized to the next power of two (which wasted ~83% at 573K).
 */
export function planRendererCapacity(
  minCapacity: number,
  currentCapacity: number,
  minCapacityFloor: number,
  pointsPerTextureRow: number,
): number {
  const required = Math.max(minCapacity, minCapacityFloor);
  const target =
    currentCapacity > 0 ? Math.max(required, Math.ceil(currentCapacity * 1.5)) : required;
  return Math.ceil(target / pointsPerTextureRow) * pointsPerTextureRow;
}
