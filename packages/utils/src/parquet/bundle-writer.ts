/**
 * Bundle writer utilities for creating .parquetbundle files with optional settings and
 * statistics.
 *
 * Bundle format:
 * - Part 1: selected_annotations.parquet (identifier + annotation columns)
 * - Delimiter: ---PARQUET_DELIMITER---
 * - Part 2: projections_metadata.parquet (projection_name, dimensions, info_json)
 * - Delimiter: ---PARQUET_DELIMITER---
 * - Part 3: projections_data.parquet (projection_name, identifier, x, y, z)
 * - Delimiter: ---PARQUET_DELIMITER--- (present when a 4th part follows)
 * - Part 4: settings.parquet (settings_json column) — present whenever settings are
 *   included; also written as a MANDATORY ZERO-BYTE placeholder when statistics are
 *   carried without settings, so the statistics part keeps a fixed slot (5)
 * - Delimiter: ---PARQUET_DELIMITER--- (present when a 5th part follows)
 * - Part 5: statistics.parquet — copied verbatim from the source bundle, never
 *   re-serialized. See `createParquetBundle` for why.
 *
 * Resulting layouts: 3 parts (no settings, no statistics), 4 parts (settings only), or
 * 5 parts (statistics present, with part 4 either real settings or the zero-byte
 * placeholder above).
 */

import { parquetWriteBuffer } from 'hyparquet-writer';
import type { VisualizationData, BundleSettings } from '../types';
import { BUNDLE_DELIMITER_BYTES } from './constants';
import { assertNoBundleDelimiter } from './delimiter-utils';
import { bigIntReplacer } from './bigint-utils';
import { isNumericAnnotation } from '../visualization/numeric-binning.js';
import { getProteinAnnotationIndices } from '../visualization/annotation-data-access.js';
import { getEatCompanionColumn, getPredictedCellValues } from '../visualization/eat-overlay.js';
import { isNAValue } from '../visualization/missing-values.js';
import { encodeAnnotationField } from './annotation-codec.js';

const ANNOTATION_FORMAT_VERSION = '2';
const ANNOTATION_FORMAT_VERSION_KEY = 'protspace_format_version';

/** Column data format for parquetWriteBuffer */
interface ColumnData {
  name: string;
  data: (string | number | boolean | bigint | null)[];
  type?: 'STRING' | 'INT32' | 'INT64' | 'DOUBLE' | 'FLOAT' | 'BOOLEAN';
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * Physical parquet encoding for one numeric annotation.
 *
 * The physical type is the wire record of the column's int/float identity — the
 * reader derives `numericType` straight back from it — so it is chosen from the
 * declared type, not from whether the visible rows happen to be integral.
 *
 * An integral column must not be widened to DOUBLE: Python keys legends, styles
 * and value-frequency tables off `str(value)`, so a round trip through DOUBLE
 * turns the style key `'100'` into `'100.0'` and makes a previously valid
 * `protspace style` template fail validation.
 *
 * INT32 is the common case and passes `values` through untouched. INT64 is only
 * reached for genuinely large integers and is the one path that must materialize
 * a parallel bigint array (hyparquet-writer rejects plain numbers for INT64),
 * which is worth avoiding at 570K+ proteins.
 */
function encodeNumericColumn(
  name: string,
  values: (number | null)[],
  numericType: 'int' | 'float',
): ColumnData {
  if (numericType === 'int') {
    // Single pass: an out-of-range or non-integral value only demotes the encoding.
    let min = 0;
    let max = 0;
    let integral = true;
    for (const value of values) {
      if (value == null) continue;
      if (!Number.isSafeInteger(value)) {
        integral = false;
        break;
      }
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (integral) {
      if (min >= INT32_MIN && max <= INT32_MAX) return { name, data: values, type: 'INT32' };
      return {
        name,
        data: values.map((value) => (value == null ? null : BigInt(value))),
        type: 'INT64',
      };
    }
  }
  return { name, data: values, type: 'DOUBLE' };
}

function serializeCategoricalValue(
  label: string,
  evidence: string | null | undefined,
  scores: readonly number[] | null | undefined,
): string {
  const encodedLabel = encodeAnnotationField(label);
  if (evidence) return `${encodedLabel}|${evidence}`;
  if (scores && scores.length > 0) return `${encodedLabel}|${scores.join(',')}`;
  return encodedLabel;
}

/**
 * Create the annotations parquet buffer (Part 1).
 * Contains identifier column + all annotation columns.
 */
function createAnnotationsParquet(data: VisualizationData): ArrayBuffer {
  const columnData: ColumnData[] = [
    {
      name: 'identifier',
      data: data.protein_ids,
      type: 'STRING',
    },
  ];

  // Add annotation columns
  for (const [annotationName, annotation] of Object.entries(data.annotations)) {
    // Runtime-only numeric view over the prediction side-channel.
    if (annotation.runtime?.role === 'eat-confidence') continue;

    if (isNumericAnnotation(annotation)) {
      const values = data.numeric_annotation_data?.[annotationName] ?? [];
      columnData.push(
        encodeNumericColumn(annotationName, values, annotation.numericType ?? 'float'),
      );
      continue;
    }

    const annotationIndices = data.annotation_data[annotationName];
    if (!annotationIndices) continue;

    // Convert indices back to actual annotation values
    const values: (string | null)[] = new Array(data.protein_ids.length);
    for (let i = 0; i < data.protein_ids.length; i++) {
      if (data.annotation_predicted?.[annotationName]?.[i]) {
        values[i] = null;
        continue;
      }

      // Reconstruct the v2 wire cell positionally so decoded labels, evidence, and scores survive
      // export without structural semicolons/pipes being reinterpreted on reload.
      const cellValues = getProteinAnnotationIndices(annotationIndices, i).flatMap(
        (valueIndex, cellIndex) => {
          const value = annotation.values[valueIndex];
          // `__NA__` is the in-memory sentinel appendSyntheticNACategory materialises for a
          // missing cell, never a value any bundle holds. Drop it so the cell round-trips as
          // NULL — writing it verbatim would re-import as a real, frequency-sorted category
          // (it is not a MISSING_VALUE_TOKEN) and leak into downstream `protspace` tooling.
          // Mirrors the read side's readCategoricalStorageValues.
          if (value == null || isNAValue(value)) return [];
          const evidence = data.annotation_evidence?.[annotationName]?.[i]?.[cellIndex];
          const scores = data.annotation_scores?.[annotationName]?.[i]?.[cellIndex];
          return [serializeCategoricalValue(value, evidence, scores)];
        },
      );
      values[i] = cellValues.length > 0 ? cellValues.join(';') : null;
    }

    columnData.push({
      name: annotationName,
      data: values,
      type: 'STRING',
    });

    const predictedCells = data.annotation_predicted?.[annotationName];
    if (predictedCells?.some(Boolean)) {
      columnData.push(
        {
          name: getEatCompanionColumn(annotationName, 'value'),
          data: predictedCells.map((cell) => {
            if (!cell) return null;
            return getPredictedCellValues(cell)
              .map((label, index) =>
                serializeCategoricalValue(
                  label,
                  cell.evidence?.[index],
                  cell.scores?.[index] ?? null,
                ),
              )
              .join(';');
          }),
          type: 'STRING',
        },
        {
          name: getEatCompanionColumn(annotationName, 'confidence'),
          data: predictedCells.map((cell) => cell?.confidence ?? null),
          type: 'FLOAT',
        },
        {
          name: getEatCompanionColumn(annotationName, 'source'),
          data: predictedCells.map((cell) => (cell ? encodeAnnotationField(cell.source) : null)),
          type: 'STRING',
        },
      );
    }
  }

  return parquetWriteBuffer({
    columnData,
    kvMetadata: [{ key: ANNOTATION_FORMAT_VERSION_KEY, value: ANNOTATION_FORMAT_VERSION }],
  });
}

/**
 * Create the projections metadata parquet buffer (Part 2).
 * Contains projection_name, dimensions, info_json columns.
 */
function createProjectionsMetadataParquet(data: VisualizationData): ArrayBuffer {
  const projectionNames: string[] = [];
  const dimensions: number[] = [];
  const infoJsons: string[] = [];

  for (const projection of data.projections) {
    projectionNames.push(projection.name);
    const dim = projection.dimension;
    dimensions.push(dim);
    infoJsons.push(JSON.stringify(projection.metadata ?? {}, bigIntReplacer));
  }

  const columnData: ColumnData[] = [
    { name: 'projection_name', data: projectionNames, type: 'STRING' },
    { name: 'dimensions', data: dimensions, type: 'INT32' },
    { name: 'info_json', data: infoJsons, type: 'STRING' },
  ];

  return parquetWriteBuffer({ columnData });
}

/**
 * Create the projections data parquet buffer (Part 3).
 * Contains projection_name, identifier, x, y, z columns.
 */
function createProjectionsDataParquet(data: VisualizationData): ArrayBuffer {
  // Calculate total rows: proteins * projections
  const totalRows = data.protein_ids.length * data.projections.length;

  const projectionNames: string[] = new Array(totalRows);
  const identifiers: string[] = new Array(totalRows);
  const xValues: number[] = new Array(totalRows);
  const yValues: number[] = new Array(totalRows);
  const zValues: (number | null)[] = new Array(totalRows);

  let rowIndex = 0;
  for (const projection of data.projections) {
    for (let i = 0; i < data.protein_ids.length; i++) {
      const base = i * projection.dimension;
      projectionNames[rowIndex] = projection.name;
      identifiers[rowIndex] = data.protein_ids[i];
      xValues[rowIndex] = projection.data[base];
      yValues[rowIndex] = projection.data[base + 1];
      zValues[rowIndex] = projection.dimension === 3 ? projection.data[base + 2] : null;
      rowIndex++;
    }
  }

  const columnData: ColumnData[] = [
    { name: 'projection_name', data: projectionNames, type: 'STRING' },
    { name: 'identifier', data: identifiers, type: 'STRING' },
    { name: 'x', data: xValues, type: 'DOUBLE' },
    { name: 'y', data: yValues, type: 'DOUBLE' },
    { name: 'z', data: zValues, type: 'DOUBLE' },
  ];

  return parquetWriteBuffer({ columnData });
}

/**
 * Create the settings parquet buffer (Part 4 - optional).
 * Contains a single settings_json column with one row.
 */
function createSettingsParquet(settings: BundleSettings): ArrayBuffer {
  const columnData: ColumnData[] = [
    {
      name: 'settings_json',
      data: [JSON.stringify(settings, bigIntReplacer)],
      type: 'STRING',
    },
  ];

  return parquetWriteBuffer({ columnData });
}

function hasBundleSettings(settings: BundleSettings | undefined): settings is BundleSettings {
  if (!settings) {
    return false;
  }

  return (
    Object.keys(settings.legendSettings).length > 0 ||
    Object.keys(settings.exportOptions).length > 0 ||
    settings.publishState !== undefined ||
    settings.eatOverlayEnabled !== undefined ||
    settings.eatConfidenceThreshold !== undefined
  );
}

/**
 * Concatenate multiple ArrayBuffers with delimiters. Exported as the single implementation
 * of the bundle's part-framing (zero-byte slots included) — tests glue fixtures with it
 * instead of re-implementing the protocol.
 */
export function concatenateBuffers(buffers: ArrayBuffer[], delimiter: Uint8Array): ArrayBuffer {
  // Calculate total size
  let totalSize = 0;
  for (let i = 0; i < buffers.length; i++) {
    totalSize += buffers[i].byteLength;
    if (i < buffers.length - 1) {
      totalSize += delimiter.length;
    }
  }

  // Create output buffer
  const result = new Uint8Array(totalSize);
  let offset = 0;

  for (let i = 0; i < buffers.length; i++) {
    result.set(new Uint8Array(buffers[i]), offset);
    offset += buffers[i].byteLength;

    if (i < buffers.length - 1) {
      result.set(delimiter, offset);
      offset += delimiter.length;
    }
  }

  return result.buffer;
}

export interface CreateBundleOptions {
  /**
   * Include persisted settings in the bundle. Adds a 4th part on its own, or fills the
   * settings slot of a 5-part bundle when statistics are also included (see the module
   * doc above for the zero-byte placeholder rule when statistics are included without
   * settings).
   */
  includeSettings?: boolean;
  /** Persisted settings to include (required if includeSettings is true) */
  settings?: BundleSettings;
}

/**
 * Create a .parquetbundle ArrayBuffer from VisualizationData.
 *
 * Parts 1-3 are rebuilt from `data`; part 5 is copied verbatim. That asymmetry is
 * deliberate — the browser authored the annotations and projections, but not the
 * statistics, and it cannot faithfully rewrite them: hyparquet-writer infers a schema
 * from decoded JS values, which narrows INT64 to INT32, degrades an all-null column to
 * BYTE_ARRAY, and drops the `ARROW:schema` metadata pyarrow writes by default. Re-serializing
 * would also silently discard any column added by a newer `protspace stats` release.
 * Copying the bytes is the only way this stays lossless as the producer's schema grows.
 *
 * @param data - The visualization data to export
 * @param options - Options for bundle creation
 * @returns ArrayBuffer containing the parquetbundle
 */
export function createParquetBundle(
  data: VisualizationData,
  options: CreateBundleOptions = {},
): ArrayBuffer {
  const { includeSettings = false, settings } = options;

  // Create the three required parts
  const annotationsBuffer = createAnnotationsParquet(data);
  const metadataBuffer = createProjectionsMetadataParquet(data);
  const projectionsBuffer = createProjectionsDataParquet(data);

  const parts: [string, ArrayBuffer][] = [
    ['annotations', annotationsBuffer],
    ['projections metadata', metadataBuffer],
    ['projections data', projectionsBuffer],
  ];

  // Optionally add settings as 4th part
  if (includeSettings && hasBundleSettings(settings)) {
    parts.push(['settings', createSettingsParquet(settings)]);
  }

  // Carry a statistics part read from the source bundle back out as part 5,
  // mirroring `write_bundle`: a zero-byte settings slot keeps it at that
  // position when the export has no settings of its own. A subset export drops the
  // part upstream in `sliceVisualizationDataByIndices` — whole-dataset scores attached
  // to a slice would read as describing the slice.
  if (data.statistics) {
    if (parts.length === 3) parts.push(['settings', new ArrayBuffer(0)]);
    parts.push(['statistics', data.statistics]);
  }

  // The delimiter is in-band and unescaped, so a part containing it would split
  // into two on read-back. The Python producer guards every part it writes; do
  // the same here or the invariant holds in only one direction. Annotation text
  // and legend category names are user-authored, so this is reachable.
  for (const [name, buffer] of parts) {
    assertNoBundleDelimiter(buffer, name);
  }

  return concatenateBuffers(
    parts.map(([, buffer]) => buffer),
    BUNDLE_DELIMITER_BYTES,
  );
}

/**
 * Export a .parquetbundle file by triggering a download.
 *
 * @param data - The visualization data to export
 * @param filename - The filename for the download (should end in .parquetbundle)
 * @param options - Options for bundle creation
 */
export function exportParquetBundle(
  data: VisualizationData,
  filename: string,
  options: CreateBundleOptions = {},
): void {
  const buffer = createParquetBundle(data, options);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.parquetbundle') ? filename : `${filename}.parquetbundle`;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Generate a filename for the exported bundle.
 *
 * @param includeSettings - Whether settings are included
 * @returns Generated filename
 */
export function generateBundleFilename(includeSettings: boolean = false): string {
  const date = new Date().toISOString().split('T')[0];
  const suffix = includeSettings ? '_with_settings' : '';
  return `protspace${suffix}_${date}.parquetbundle`;
}
