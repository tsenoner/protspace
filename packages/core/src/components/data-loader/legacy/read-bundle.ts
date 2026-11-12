import type { FileMetaData } from 'hyparquet';
import type { BundleSettings, VisualizationData } from '@protspace/utils';
import type { BundleParts } from '../utils/bundle-parts';
import { extractRowsFromParts, type BundleExtractionResult } from './bundle';
import { convertParquetToVisualizationDataOptimized } from './conversion';

/**
 * Decode a v1/v2 bundle, already split into parts: the row-object reader, then the
 * conversion. `maxRows` lowers the row cap checked on part 3's footer.
 */
export async function readLegacyBundle(
  parts: BundleParts,
  part1Metadata: FileMetaData | null,
  maxRows?: number,
): Promise<{
  data: VisualizationData;
  settings: BundleSettings | null;
  formatVersion: number;
  unplacedProteinCount: number;
}> {
  const extraction = await extractRowsFromParts(parts, part1Metadata, maxRows);
  const data = await convertParquetToVisualizationDataOptimized(extraction);
  return {
    data,
    settings: extraction.settings,
    formatVersion: extraction.formatVersion,
    unplacedProteinCount: countLegacyUnplacedProteins(extraction, data),
  };
}

/**
 * The proteins a legacy bundle names, in its annotations part or its projection rows, that
 * the browser's protein set does not hold: an annotation-only row, which v2 never showed,
 * or a protein whose every coordinate is missing.
 */
function countLegacyUnplacedProteins(
  { annotationsById, projections, projectionIdColumn }: BundleExtractionResult,
  data: VisualizationData,
): number {
  const placed = new Set(data.protein_ids);
  const unplaced = new Set<string>();
  for (const id of annotationsById.keys()) if (!placed.has(id)) unplaced.add(id);
  for (const row of projections) {
    const id = row[projectionIdColumn];
    if (id != null && !placed.has(String(id))) unplaced.add(String(id));
  }
  return unplaced.size;
}
