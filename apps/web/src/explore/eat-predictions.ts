import type { AnnotationPredictedData, VisualizationData } from '@protspace/utils';

const NONE: readonly string[] = [];
const scanned = new WeakMap<AnnotationPredictedData, readonly string[]>();

/**
 * The annotations with at least one EAT prediction, in the data's order. Scanned once per dataset:
 * the view bar and the EAT panel ask on every `data-change` (each filter, isolation and overlay
 * switch), and an annotation without predictions is a full pass over its column.
 */
export function predictedAnnotations(
  data: Pick<VisualizationData, 'annotation_predicted'> | null | undefined,
): readonly string[] {
  const predicted = data?.annotation_predicted;
  if (!predicted) return NONE;
  let annotations = scanned.get(predicted);
  if (!annotations) {
    annotations = Object.keys(predicted).filter((annotation) =>
      predicted[annotation].some((cell) => cell !== null && cell !== undefined),
    );
    scanned.set(predicted, annotations);
  }
  return annotations;
}
