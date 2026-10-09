/**
 * Control bar-related type definitions
 */

import type {
  AnnotationData,
  AnnotationPredictedData,
  ProjectionStatisticRow,
} from '@protspace/utils';

export interface ProtspaceData {
  projections?: Array<{ name: string; metadata?: { dimension?: 2 | 3 } }>;
  annotations?: Record<
    string,
    {
      kind?: 'categorical' | 'numeric';
      sourceKind?: 'categorical' | 'numeric';
      values: (string | null)[];
      colors?: string[];
      shapes?: string[];
      numericMetadata?: {
        strategy: 'linear' | 'quantile' | 'logarithmic';
        binCount: number;
        signature: string;
        topologySignature: string;
        logSupported: boolean;
        bins: Array<{
          id: string;
          label: string;
          lowerBound: number;
          upperBound: number;
          count: number;
        }>;
      };
      runtime?: {
        role: 'eat-confidence';
        baseAnnotation: string;
      };
    }
  >;
  annotation_data?: Record<string, AnnotationData>;
  numeric_annotation_data?: Record<string, Float64Array>;
  protein_ids?: string[];
  annotation_predicted?: AnnotationPredictedData;
  /** Rows of the bundle's optional statistics part (backend `--stats`); absent otherwise. */
  statisticsRows?: readonly ProjectionStatisticRow[];
}
