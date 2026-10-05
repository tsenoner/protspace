// The v1/v2 bundle reader and plain parquet loading, whose support ends in protspace 5.0.0.
// Code outside this folder reaches it only through this file.
export { readLegacyBundle } from './read-bundle';
export { decodePlainParquet } from './plain-parquet';
export { extractRowsFromParquetBundle, type BundleExtractionResult } from './bundle';
export { convertParquetToVisualizationDataOptimized } from './conversion';
export { readFileOptimized } from './file-io';
