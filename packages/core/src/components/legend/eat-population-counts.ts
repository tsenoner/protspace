import {
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  isNAValue,
} from '@protspace/utils';
import type { ScatterplotData } from './types';

export interface EatPopulationCounts {
  observed: number;
  predicted: number;
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
  for (let index = 0; index < data.protein_ids.length; index++) {
    if (predictedCells[index]) {
      predicted += 1;
      continue;
    }
    for (let k = 0, count = getProteinAnnotationCount(rows, index); k < count; k++) {
      const value = annotation.values[getProteinAnnotationIndexAt(rows, index, k)];
      if (value != null && !isNAValue(value)) {
        observed += 1;
        break;
      }
    }
  }

  return { observed, predicted, total: data.protein_ids.length };
}
