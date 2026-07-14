import type { LegendErrorEventDetail, LegendErrorSource } from './legend.events';
import type { AnnotationData, AnnotationPredictedData } from '@protspace/utils';

/**
 * A legend item representing a category.
 * N/A items use NA_VALUE ('__NA__') as their value.
 */
export interface LegendItem {
  /** Category value. N/A items use '__NA__', "Other" uses 'Other' */
  value: string;
  displayValue?: string;
  color: string;
  shape: string;
  count: number;
  isVisible: boolean;
  zOrder: number;
}

/**
 * An item in the "Other" category bucket.
 * These are items that didn't make the top maxVisibleValues.
 */
export interface OtherItem {
  /** Category value. N/A items use '__NA__' */
  value: string;
  count: number;
}

export interface ScatterplotData {
  protein_ids: string[];
  annotations: Record<
    string,
    {
      kind?: 'categorical' | 'numeric';
      sourceKind?: 'categorical' | 'numeric';
      numericType?: 'int' | 'float';
      values: (string | null)[];
      colors?: string[];
      shapes?: string[];
      numericMetadata?: LegendAnnotationData['numericMetadata'];
    }
  >;
  annotation_data: Record<string, AnnotationData>;
  numeric_annotation_data?: Record<string, (number | null)[]>;
  annotation_predicted?: AnnotationPredictedData;
  projections?: Array<{ name: string }>;
}

export interface LegendAnnotationData {
  name: string;
  values: (string | null)[];
  colors?: string[];
  shapes?: string[];
  kind?: 'categorical' | 'numeric';
  sourceKind?: 'categorical' | 'numeric';
  numericType?: 'int' | 'float';
  numericMetadata?: {
    strategy: 'linear' | 'quantile' | 'logarithmic';
    binCount: number;
    numericType?: 'int' | 'float';
    signature: string;
    topologySignature: string;
    logSupported: boolean;
    bins: Array<{
      id: string;
      label: string;
      lowerBound: number;
      upperBound: number;
      count: number;
      colorPosition?: number;
    }>;
  };
}

// Note: IScatterplotElement in scatterplot-interface.ts is the canonical interface
// for scatterplot element interactions with type guards.

// ─────────────────────────────────────────────────────────────────
// Custom Event Detail Types
// ─────────────────────────────────────────────────────────────────

/** Item action types for legend events */
export type ItemAction = 'toggle' | 'isolate' | 'extract';

export interface LegendDataInput {
  annotations?: ScatterplotData['annotations'];
  protein_ids?: string[];
  numeric_annotation_data?: ScatterplotData['numeric_annotation_data'];
  annotation_predicted?: ScatterplotData['annotation_predicted'];
}

export type { LegendErrorEventDetail, LegendErrorSource };

// Internal re-exports from @protspace/utils for legend component implementation
// External consumers should import directly from @protspace/utils
export type {
  LegendSortMode,
  PersistedCategoryData,
  LegendPersistedSettings,
} from '@protspace/utils';
