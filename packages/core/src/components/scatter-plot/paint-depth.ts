/**
 * The paint depth a point is sorted by, shared by the style passes that resolve
 * it and the renderer that draws in its order.
 */

/** Opacity threshold at/above which a point counts as selected for the two-pass cut. */
export const SELECTED_OPACITY_THRESHOLD = 0.99;

/**
 * Encode semantic painter tiers into the existing normalized depth channel.
 *
 * Far -> near order is: unselected observed, unselected predicted, selected observed, selected
 * predicted. This keeps the selected run contiguous for the two-pass blend while ensuring an EAT
 * knockout/outline is not subsequently covered by a coincident ordinary point. The source depth
 * still orders categories and opacity inside each tier.
 */
export function composePaintDepth(baseDepth: number, opacity: number, predicted: boolean): number {
  const withinTier = Math.min(1, Math.max(0, baseDepth)) * 0.24;
  const selected = opacity >= SELECTED_OPACITY_THRESHOLD;
  if (selected) return (predicted ? 0 : 0.25) + withinTier;
  return (predicted ? 0.5 : 0.75) + withinTier;
}
