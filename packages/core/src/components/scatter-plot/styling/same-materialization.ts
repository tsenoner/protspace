import type { VisualizationData } from '@protspace/utils';

/**
 * Whether two materializations of the same dataset give the plot the same thing to draw for the
 * selected annotation, so a rebuild from the second would reproduce the first.
 *
 * Only the selected numeric annotation is ever re-binned; every other annotation passes through
 * by reference. A materialization is therefore the same when the selected annotation is the same
 * object, or when it is a numeric one whose binning signature matches. The signature covers the
 * strategy, bin count, palette, direction and every bin's bounds, count and colour position, and
 * the per-row bin indices follow from the bounds. A rebin that lands on the same bins (the legend
 * publishing the defaults the plot already used) therefore compares equal despite being a new
 * object.
 */
export function sameMaterialization(
  previous: VisualizationData,
  next: VisualizationData,
  selectedAnnotation: string,
): boolean {
  if (previous === next) return true;
  // Both are `...source` spreads: a different dataset or projection list is a different draw.
  if (previous.protein_ids !== next.protein_ids || previous.projections !== next.projections) {
    return false;
  }

  const before = previous.annotations[selectedAnnotation];
  const after = next.annotations[selectedAnnotation];
  if (!before || !after) return false;
  if (before === after) {
    return (
      previous.annotation_data[selectedAnnotation] === next.annotation_data[selectedAnnotation]
    );
  }

  const signature = before.numericMetadata?.signature;
  return signature !== undefined && signature === after.numericMetadata?.signature;
}
