export type AnnotationKind = 'categorical' | 'numeric';

export type NumericAnnotationType = 'int' | 'float';

export type NumericBinningStrategy = 'linear' | 'quantile' | 'logarithmic';

export interface NumericBinDefinition {
  id: string;
  label: string;
  lowerBound: number;
  upperBound: number;
  count: number;
  colorPosition?: number;
}

export interface NumericAnnotationMetadata {
  strategy: NumericBinningStrategy;
  binCount: number;
  numericType?: NumericAnnotationType;
  signature: string;
  topologySignature: string;
  logSupported: boolean;
  bins: NumericBinDefinition[];
}

export interface Annotation {
  kind: AnnotationKind;
  values: (string | null)[];
  colors: string[];
  shapes: string[];
  sourceKind?: AnnotationKind;
  numericType?: NumericAnnotationType;
  numericMetadata?: NumericAnnotationMetadata;
}

/**
 * Per-protein annotation indices.
 * - `Int32Array`: strictly single-valued column. `data[proteinIdx]` is the
 *   index, or `-1` when the protein has no value for this column.
 * - `(readonly number[])[]`: multi-valued column. `data[proteinIdx]` is the
 *   list of indices; an empty array means missing.
 */
export type AnnotationData = Int32Array | readonly (readonly number[])[];

/** A value transferred from a reference protein by Embedding Annotation Transfer (EAT). */
export interface PredictedCell {
  value: string;
  /** Bounded EAT reliability index. This is not a calibrated probability. */
  confidence: number;
  /** Protein identifier from which the value was transferred. */
  source: string;
}

/** Per-base-annotation EAT cells, aligned to `protein_ids`. */
export type AnnotationPredictedData = Record<string, readonly (PredictedCell | null)[]>;

export interface Projection {
  name: string;
  metadata?: Record<string, unknown> & { dimension?: 2 | 3 };
  /**
   * Flat coordinates, length = pointCount * dimension.
   * data[i*dimension + 0] = x, +1 = y, +2 = z (when dimension === 3).
   */
  data: Float32Array;
  /** Coordinate stride: 2 (xy) or 3 (xyz). Authoritative — never infer from data. */
  dimension: 2 | 3;
}

export interface VisualizationData {
  protein_ids: string[];
  projections: Projection[];
  annotations: Record<string, Annotation>;
  annotation_data: Record<string, AnnotationData>;
  numeric_annotation_data?: Record<string, (number | null)[]>;
  /** Display-independent EAT provenance, keyed by the curated base annotation. */
  annotation_predicted?: AnnotationPredictedData;
  annotation_scores?: Record<string, (number[] | null)[][]>;
  annotation_evidence?: Record<string, (string | null)[][]>;
}

export interface PlotDataPoint {
  id: string;
  x: number;
  y: number;
  z?: number;
  originalIndex: number;
}

/**
 * Struct-of-Arrays container for the plotted points. Replaces PlotDataPoint[] as the
 * bulk store — eliminates the per-point boxed { id, x, y, z?, originalIndex } objects.
 * Individual PlotDataPoint objects are materialized on demand at interaction boundaries
 * (hover/click/tooltip) via materializePlotDataPoint().
 */
export interface PlotData {
  /** Number of plotted points (slots). */
  readonly length: number;
  /** X coordinate per slot (already plane-mapped for 3D projections). */
  readonly xs: Float32Array;
  /** Y coordinate per slot (already plane-mapped for 3D projections). */
  readonly ys: Float32Array;
  /** Raw z (coords[2]) per slot, or null for 2D projections. */
  readonly zs: Float32Array | null;
  /**
   * Maps slot -> protein index (into proteinIds / VisualizationData.annotation_data).
   * `null` means identity: slot i is protein i — the common non-isolated case.
   */
  readonly originalIndices: Int32Array | null;
  /** Shared reference to VisualizationData.protein_ids. */
  readonly proteinIds: readonly string[];
}

export interface StyleForAnnotation {
  color: string;
  shape: string;
}

export interface ScatterplotConfig {
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  pointSize?: number;
  zoomExtent?: [number, number];
  baseOpacity?: number;
  selectedOpacity?: number;
  fadedOpacity?: number;
  /**
   * Enable duplicate-stack UI for points that share the exact same coordinates.
   * When enabled, the scatterplot will compute duplicate stacks and render an SVG overlay:
   * - numeric count badges
   * - spiderfy expansion on click
   *
   * Default: false (kept off to avoid O(n) duplicate stack computation on large datasets).
   */
  enableDuplicateStackUI?: boolean;
}

export type PointShape = 'circle' | 'square' | 'diamond' | 'triangle-up' | 'triangle-down' | 'plus';

// ─────────────────────────────────────────────────────────────────
// Legend Persistence Types
// ─────────────────────────────────────────────────────────────────

export type LegendSortMode =
  | 'size-asc'
  | 'size-desc'
  | 'alpha-asc'
  | 'alpha-desc'
  | 'manual'
  | 'manual-reverse';

export interface PersistedCategoryData {
  zOrder: number;
  color: string;
  shape: string;
}

export interface LegendPersistedSettings {
  maxVisibleValues: number;
  /** @deprecated Removed in the upcoming release — ignored on read, never emitted on write. */
  includeShapes?: boolean;
  shapeSize: number;
  sortMode: LegendSortMode;
  hiddenValues: string[];
  categories: Record<string, PersistedCategoryData>;
  enableDuplicateStackUI: boolean;
  selectedPaletteId: string;
  numericSettings?: {
    strategy: NumericBinningStrategy;
    signature: string;
    topologySignature?: string;
    manualOrderIds?: string[];
    reverseGradient?: boolean;
  };
}

/**
 * Export settings persisted per dataset + annotation.
 */
export interface PersistedExportOptions {
  imageWidth: number;
  imageHeight: number;
  lockAspectRatio: boolean;
  legendWidthPercent: number;
  legendFontSizePx: number;
  includeLegendSettings: boolean;
  includeExportOptions: boolean;
}

export type LegendSettingsMap = Record<string, LegendPersistedSettings>;

export type ExportOptionsMap = Record<string, PersistedExportOptions>;

/**
 * Current bundle settings format.
 */
export interface BundleSettings {
  legendSettings: LegendSettingsMap;
  exportOptions: ExportOptionsMap;
  /** Serialised publish/figure editor state. Free-form JSON — validated on load. */
  publishState?: Record<string, unknown>;
  /** Whether transferred values are coalesced into their curated base annotation. */
  eatOverlayEnabled?: boolean;
  /** Minimum EAT reliability index before transferred markers receive their full alpha. */
  eatConfidenceThreshold?: number;
}

/**
 * Legacy bundle settings format used before export options were added.
 */
export type LegacyBundleSettings = LegendSettingsMap;
