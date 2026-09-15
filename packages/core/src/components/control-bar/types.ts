/**
 * Control bar-related type definitions
 */

import type {
  NumericAnnotationDisplaySettingsMap,
  AnnotationData,
  AnnotationPredictedData,
  ProjectionStatisticRow,
  LegendSortMode,
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
  numeric_annotation_data?: Record<string, (number | null)[]>;
  protein_ids?: string[];
  annotation_predicted?: AnnotationPredictedData;
  /** Rows of the bundle's optional statistics part (backend `--stats`); absent otherwise. */
  statisticsRows?: readonly ProjectionStatisticRow[];
}

export interface DataChangeDetail {
  data: ProtspaceData;
}

export interface ScatterplotElementLike extends Element {
  // State properties
  selectedProjectionIndex?: number;
  selectedAnnotation?: string;
  tooltipAnnotations?: string[];
  selectionMode?: boolean;
  selectionTool?: 'rectangle' | 'lasso';
  selectedProteinIds?: string[];
  data?: ProtspaceData;
  filteredProteinIds?: string[];
  filtersActive?: boolean;
  numericAnnotationSettings?: NumericAnnotationDisplaySettingsMap;
  annotationSortModes?: Record<string, LegendSortMode>;
  numericManualOrderIdsByAnnotation?: Record<string, string[]>;

  // Data access
  getCurrentData?: (options?: { includeFilteredProteinIds?: boolean }) => ProtspaceData | undefined;
  getMaterializedData?: () => ProtspaceData | undefined;

  // Isolation functionality
  isIsolationMode?: () => boolean;
  getIsolationHistory?: () => string[][];
  isolateSelection?: () => void;
  resetIsolation?: () => void;

  // Duplicate-stack spider expansion
  hasExpandedDuplicateStack?: () => boolean;
  closeExpandedDuplicateStack?: () => void;

  // Event emitting is through DOM, so we rely on add/removeEventListener from Element
  click?: () => void;
}

export interface DataLoaderElement extends Element {
  requestLoad?: () => void;
}

export interface StructureViewerElement extends Element {
  loadStructure?: (proteinId: string, structureUrl: string | null) => void;
  loadProtein?: (proteinId: string) => void;
}
