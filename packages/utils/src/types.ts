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

export interface Projection {
  name: string;
  metadata?: Record<string, unknown> & { dimension?: 2 | 3 };
  // Each point is either [x, y] or [x, y, z]
  data: Array<[number, number] | [number, number, number]>;
}

export interface VisualizationData {
  protein_ids: string[];
  projections: Projection[];
  annotations: Record<string, Annotation>;
  annotation_data: Record<string, AnnotationData>;
  numeric_annotation_data?: Record<string, (number | null)[]>;
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
}

/**
 * Legacy bundle settings format used before export options were added.
 */
export type LegacyBundleSettings = LegendSettingsMap;
