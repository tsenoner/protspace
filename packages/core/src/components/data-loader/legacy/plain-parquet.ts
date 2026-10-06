import { parquetReadObjects } from 'hyparquet';
import type { VisualizationData } from '@protspace/utils';
import { convertParquetToVisualizationDataOptimized } from './conversion';

/**
 * Read a plain parquet table, not a bundle, into visualization data through the v1/v2 row
 * conversion, for the data loader's `loadFromUrl`. `onParsed` runs between the parse and
 * the conversion, where the loader counts a progress step.
 */
export async function decodePlainParquet(
  bytes: ArrayBuffer,
  onParsed: () => void,
): Promise<VisualizationData> {
  const table = await parquetReadObjects({ file: bytes });
  onParsed();
  return convertParquetToVisualizationDataOptimized(table);
}
