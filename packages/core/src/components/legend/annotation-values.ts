import type { AnnotationData } from '@protspace/utils';
import { getFirstAnnotationIndex, getProteinAnnotationIndices } from '@protspace/utils';
import { toInternalValue } from './config';

/**
 * Build the flat list of internal annotation values used by the legend frequency count.
 *
 * Replaces a `protein_ids.flatMap(...)` that allocated a throwaway `[]`/`[value]` array per
 * protein. Output is IDENTICAL to that flatMap:
 *  - Single-valued (Int32Array): one entry per protein that HAS an annotation (idx >= 0),
 *    in protein order; proteins with no annotation are omitted (compacted).
 *  - Multi-valued: one entry per (protein, label) pair, in order (expanded).
 */
export function buildAnnotationValueList(
  colData: AnnotationData,
  values: (string | null)[],
  proteinCount: number,
): string[] {
  const out: string[] = [];
  if (colData instanceof Int32Array) {
    for (let i = 0; i < proteinCount; i++) {
      const idx = getFirstAnnotationIndex(colData, i);
      if (idx >= 0) out.push(toInternalValue(values[idx]));
    }
  } else {
    for (let i = 0; i < proteinCount; i++) {
      const indices = getProteinAnnotationIndices(colData, i);
      for (let j = 0; j < indices.length; j++) {
        out.push(toInternalValue(values[indices[j]]));
      }
    }
  }
  return out;
}
