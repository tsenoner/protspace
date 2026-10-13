import { isCsrAnnotationData, type VisualizationData } from '@protspace/utils';

/**
 * Test support: every typed array `collectTransferables` names a buffer for, in a stable
 * order, so a dataset and its structured clone can be compared element by element.
 */
export const bulkViews = (
  data: VisualizationData,
): (Int32Array | Float32Array | Float64Array)[] => [
  ...data.projections.map((projection) => projection.data as Float32Array),
  ...Object.values(data.numeric_annotation_data ?? {}),
  ...Object.values(data.annotation_data).flatMap((value) =>
    value instanceof Int32Array
      ? [value]
      : isCsrAnnotationData(value)
        ? [
            value.offsets,
            value.codes,
            ...(value.scores ? [value.scores.offsets, value.scores.values] : []),
            ...(value.evidence ? [value.evidence.codes] : []),
          ]
        : [],
  ),
];
