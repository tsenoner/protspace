import { getProteinAnnotationIndices, isNAValue } from '@protspace/utils';
import type { ScatterplotData } from './types';

export interface EatPopulationCounts {
  observed: number;
  predicted: number;
  missing: number;
  total: number;
}

/** Partition the represented view into mutually exclusive EAT population states. */
export function computeEatPopulationCounts(
  data: ScatterplotData,
  selectedAnnotation: string,
  overlayEnabled: boolean,
): EatPopulationCounts | null {
  const predictedCells = data.annotation_predicted?.[selectedAnnotation];
  if (!overlayEnabled || !predictedCells) return null;
  const annotation = data.annotations[selectedAnnotation];
  const rows = data.annotation_data[selectedAnnotation];
  if (!annotation || !rows) return null;

  let observed = 0;
  let predicted = 0;
  let missing = 0;
  for (let index = 0; index < data.protein_ids.length; index++) {
    if (predictedCells[index]) {
      predicted += 1;
      continue;
    }
    const hasObservedValue = getProteinAnnotationIndices(rows, index).some((valueIndex) => {
      const value = annotation.values[valueIndex];
      return value != null && !isNAValue(value);
    });
    if (hasObservedValue) observed += 1;
    else missing += 1;
  }

  return { observed, predicted, missing, total: data.protein_ids.length };
}
