import type { Annotation, NumericBinDefinition, VisualizationData } from '@protspace/utils';

/**
 * Whether two materializations of the same dataset give the plot the same thing to draw for the
 * selected annotation, so a rebuild from the second would reproduce the first.
 *
 * Only the selected numeric annotation is ever re-binned; every other annotation passes through
 * by reference. A materialization is therefore the same when the selected annotation is the same
 * object, or when it is a numeric one whose definition matches field by field: the strategy, the
 * bins (id, label, bounds, count, colour position) and the values, colours and shapes derived from
 * them. The per-row bin indices follow from the bin bounds. A rebin that lands on the same bins
 * (the legend publishing the defaults the plot already used) therefore compares equal despite
 * being a new object. The comparison is on the definition itself, not on the metadata's hash.
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

  return sameNumericDefinition(before, after);
}

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

const sameBin = (a: NumericBinDefinition, b: NumericBinDefinition): boolean =>
  a.id === b.id &&
  a.label === b.label &&
  a.lowerBound === b.lowerBound &&
  a.upperBound === b.upperBound &&
  a.count === b.count &&
  a.colorPosition === b.colorPosition;

function sameNumericDefinition(a: Annotation, b: Annotation): boolean {
  const before = a.numericMetadata;
  const after = b.numericMetadata;
  // Two objects without bins have nothing to say they are equal; treat them as different.
  if (!before || !after) return false;
  return (
    a.kind === b.kind &&
    a.sourceKind === b.sourceKind &&
    a.numericType === b.numericType &&
    sameList(a.values, b.values) &&
    sameList(a.colors, b.colors) &&
    sameList(a.shapes, b.shapes) &&
    before.strategy === after.strategy &&
    before.binCount === after.binCount &&
    before.numericType === after.numericType &&
    before.logSupported === after.logSupported &&
    before.bins.length === after.bins.length &&
    before.bins.every((bin, i) => sameBin(bin, after.bins[i]))
  );
}
