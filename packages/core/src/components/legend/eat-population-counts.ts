import type { ScatterplotData } from './types';

/**
 * How many proteins carry a prediction for `annotation` in the whole dataset, for the legend's
 * one-line EAT note; null when the annotation has none.
 */
export function countEatPredictions(
  data: Pick<ScatterplotData, 'annotation_predicted'> | null | undefined,
  annotation: string,
): number | null {
  const cells = data?.annotation_predicted?.[annotation];
  if (!cells) return null;
  let predicted = 0;
  for (const cell of cells) if (cell) predicted += 1;
  return predicted > 0 ? predicted : null;
}
