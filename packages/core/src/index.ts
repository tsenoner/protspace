// Export web components - these will auto-register when imported
export * from './components/scatter-plot/scatter-plot';
export * from './components/legend/legend';
export * from './components/structure-viewer/structure-viewer';
// The view bar's pickers (design decision 9).
export { ProtspaceProjectionSelect } from './components/projection-select/projection-select';
export { ProtspaceContoursMenu } from './components/contours-menu/contours-menu';
export type { DensityLayerChangeDetail } from './components/contours-menu/contours-menu';
export { ProtspaceAnnotationSelect } from './components/control-bar/annotation-select';
export { ProtspaceProjectionMetadata } from './components/scatter-plot/projection-metadata/projection-metadata';
export { DENSITY_MODE_LABELS } from '@protspace/utils';
// The plot's tool strip and the app bar's search (design decision 9).
export { ProtspacePlotTools } from './components/plot-tools/plot-tools';
export type { PlotTool } from './components/plot-tools/plot-tools';
export { ProtspaceSelectionBar } from './components/plot-tools/selection-bar';
export { ProtspacePlotStatus, type StatusChipKind } from './components/plot-tools/plot-status';
export { ProtspaceProteinSearch } from './components/protein-search/protein-search';
export { AfterPaintCommit } from './utils/after-paint-commit';
// The filter's query builder and its pure query helpers; the app's filter controller drives them.
export { ProtspaceQueryBuilder } from './components/query-builder/query-builder';
export { createCondition } from './components/query-builder/query-types';
export type { FilterQuery } from './components/query-builder/query-types';
export { evaluateQuery, hasConfiguredCondition } from './components/query-builder/query-evaluate';
export { sameQuery } from './components/query-builder/query-equal';
export {
  findConditionsForAnnotation,
  replaceConditionsForAnnotation,
} from './components/query-builder/query-annotation-conditions';
export {
  conditionsForReliability,
  reliabilityFromConditions,
  sameConditions,
} from './components/query-builder/eat-reliability';
export { ProtspaceImportMenu } from './components/import-menu/import-menu';
export { ProtspaceExportMenu, type ExportEventDetail } from './components/export-menu/export-menu';
export { EXPORT_DEFAULTS } from './components/export-menu/export-defaults';
export * from './components/data-loader/data-loader';
export * from './components/kit';
export type { ExampleDatasetSummary } from './components/import-menu/types';
export type { DataLoadedEventDetail } from './components/data-loader/data-loader';
export type {
  DataErrorContext,
  DataErrorEventDetail,
} from './components/data-loader/data-loader.events';
export type { LegendErrorEventDetail, LegendErrorSource } from './components/legend/legend.events';
export type {
  BrushSelectionDetail,
  ProteinClickDetail,
  RendererDegradedContext,
  RendererDegradedDetail,
  RendererDegradedReason,
  TooltipAction,
  TooltipActionDetail,
} from './components/scatter-plot/scatter-plot.events';
export type {
  StructureErrorContext,
  StructureErrorEvent,
  StructureErrorEventDetail,
  StructureLoadDetail,
  StructureLoadEvent,
} from './components/structure-viewer/types';
export type { HostMessageEventDetail, HostMessageSeverity } from './events';

// Export types for TypeScript support (for components that don't need value access)
export type { ProtspaceScatterplot } from './components/scatter-plot/scatter-plot';
export type { ProtspaceLegend } from './components/legend/legend';
export type { ProtspaceStructureViewer } from './components/structure-viewer/structure-viewer';

// Publish modal types (component itself is lazy-loaded via @protspace/core/publish)
export type { ProtspacePublishModal } from './components/publish/publish-modal';
export type {
  PublishState,
  Overlay,
  Inset,
  LegendPosition,
  LegendOverflow,
} from './components/publish/publish-state';
export type { PresetId, JournalPreset } from './components/publish/journal-presets';
export { pxToMm } from './components/publish/dimension-utils';

// Utilities for data loading
export { decodeParquetBundle } from './components/data-loader/utils/bundle';
export type { DecodedParquetBundle } from './components/data-loader/utils/bundle';
// Deprecated: v1/v2 bundles and plain parquet, whose support ends in protspace 5.0.0.
export {
  convertParquetToVisualizationDataOptimized,
  extractRowsFromParquetBundle,
  readFileOptimized,
} from './components/data-loader/legacy';
export type { BundleExtractionResult } from './components/data-loader/legacy';
