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
  /** Runtime-only identity for derived annotations that must never be persisted as user data. */
  runtime?: {
    role: 'eat-confidence';
    baseAnnotation: string;
  };
}

/**
 * Per-protein annotation indices.
 * - `Int32Array`: strictly single-valued column. `data[proteinIdx]` is the
 *   index, or `-1` when the protein has no value for this column.
 * - `SparseMultiValueAnnotationData`: compact single-value base plus overrides for the uncommon
 *   multi-valued rows.
 * - `(readonly number[])[]`: densely multi-valued column. `data[proteinIdx]` is the
 *   list of indices; an empty array means missing.
 */
export interface SparseMultiValueAnnotationData {
  readonly kind: 'sparse-multi';
  readonly base: Int32Array;
  readonly overrides: ReadonlyMap<number, readonly number[]>;
  readonly length: number;
}

export type AnnotationData =
  | Int32Array
  | SparseMultiValueAnnotationData
  | readonly (readonly number[])[];

/** A value transferred from a reference protein by Embedding Annotation Transfer (EAT). */
export interface PredictedCell {
  value: string;
  /** Ordered decoded labels for multi-valued transfers; absent for legacy/single-valued cells. */
  values?: readonly string[];
  /** Score vectors aligned positionally with `values`. */
  scores?: readonly (readonly number[] | null)[];
  /** Evidence strings aligned positionally with `values`. */
  evidence?: readonly (string | null)[];
  /** Bounded EAT reliability index. This is not a calibrated probability. */
  confidence: number;
  /** Protein identifier from which the value was transferred. */
  source: string;
  /** Runtime global index for O(1) provenance lookup when the source is in this dataset. */
  sourceIndex?: number;
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

/**
 * One row of the optional `statistics.parquet` bundle part (tidy long format, 10 columns).
 * Emitted by the backend's `--stats` flag; absent from bundles prepared without it.
 *
 * Rows are keyed by `space_name` (a projection name, or the source embedding name when
 * `space_kind === 'embedding'`) plus `annotation` (`''` for non-annotation rows such as
 * `n_clusters`). Always filter on `stat_family` *and* `space_kind` — the same `metric`
 * name appears once per (space × annotation).
 */
export interface ProjectionStatisticRow {
  space_kind: 'embedding' | 'projection';
  /** Projection name, or the embedding name for `space_kind === 'embedding'`. */
  space_name: string;
  /** Annotation the row was scored on; `''` for rows that aren't annotation-scoped. */
  annotation: string;
  stat_family: 'annotation_validity' | 'cluster_agreement' | 'cluster_validity';
  label_kind: string;
  metric: string;
  /** `'meta'` rows (e.g. `n_clusters`) are information, not scores. */
  metric_kind: 'validity' | 'agreement' | 'meta';
  value: number;
  /**
   * One category of `annotation` when the metric was decomposed per category;
   * absent on the aggregate row, and absent entirely on bundles written before
   * the column existed. Deliberately NOT in `PROJECTION_STATISTIC_COLUMNS`:
   * that list is the required set the reader's schema guard checks, so adding
   * it would reject every bundle already prepared with `--stats`. Same for
   * `extra_json` below.
   */
  category?: string;
  /** Per-metric provenance as a JSON string (sample size, seed, …). */
  extra_json?: string;
}

/**
 * Required column names of the statistics part, in the writer's order — the set the reader's
 * schema guard insists on. The optional columns (`extra_json`, `category`) are deliberately
 * excluded: a bundle prepared before either existed must still be read, so requiring them
 * would reject it. `satisfies` ties the list to `ProjectionStatisticRow`, so renaming a column
 * in only one of them is a compile error instead of a reader/type drift the guard can't see.
 */
export const PROJECTION_STATISTIC_COLUMNS = [
  'space_kind',
  'space_name',
  'annotation',
  'stat_family',
  'label_kind',
  'metric',
  'metric_kind',
  'value',
] as const satisfies readonly (keyof ProjectionStatisticRow)[];

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
  /**
   * Raw projection-statistics parquet part (bundle part 5) as read, carried
   * unparsed so an export re-emits it instead of dropping it. This is the
   * authoritative copy — a column the reader below does not model still survives
   * a load/export round trip, because nothing re-serializes this part.
   */
  statistics?: ArrayBuffer;
  /**
   * The same part parsed for rendering, derived from `statistics` at load and never
   * written back to it. The two must be cleared together whenever the underlying data
   * changes; `sliceVisualizationDataByIndices` is the one place that happens.
   */
  statisticsRows?: readonly ProjectionStatisticRow[];
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
  | 'manual-reverse'
  /** Best-separating category first. Display order only; the "Other" bucket stays size-driven. */
  | 'silhouette-desc'
  /**
   * Worst-separating category first — what the legend header's reverse button produces from
   * `silhouette-desc`. It must exist as a real mode: that button derives its result by string
   * surgery on the current mode, so without this it minted a value outside this union, which
   * `sanitizeLegendSettingsEntry` rejects — discarding the annotation's whole persisted block.
   */
  | 'silhouette-asc';

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
  /**
   * Saved reliability-slider position (0…1, default 0). On load it seeds the
   * slider, which derives an `EAT_confidence >= x or N/A` query filter only when
   * above 0 — so an absent or `0` value means no reliability filter (#6b).
   */
  eatConfidenceThreshold?: number;
}

/**
 * Legacy bundle settings format used before export options were added.
 */
export type LegacyBundleSettings = LegendSettingsMap;
