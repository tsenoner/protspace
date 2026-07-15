/**
 * Fast hash function (djb2 variant) for generating deterministic dataset identifiers.
 * Used to scope persisted settings to specific datasets.
 */

import { isNumericAnnotation } from '../visualization/numeric-binning.js';
import { getPredictedCellValues } from '../visualization/eat-overlay.js';
import type { PredictedCell } from '../types.js';

interface DatasetHashInput {
  protein_ids: string[];
  annotations?: Record<
    string,
    {
      kind?: 'categorical' | 'numeric';
      sourceKind?: 'categorical' | 'numeric';
      values?: (string | null)[];
      numericMetadata?: {
        strategy?: string;
        binCount?: number;
        bins?: Array<{
          id?: string;
          label?: string;
          lowerBound?: number;
          upperBound?: number;
          count?: number;
        }>;
      };
    }
  >;
  numeric_annotation_data?: Record<string, (number | null)[]>;
  annotation_predicted?: Record<string, readonly (PredictedCell | null)[]>;
}

interface NumericMetadataFingerprintInput {
  strategy?: string;
  binCount?: number;
  bins?: Array<{
    id?: string;
    lowerBound?: number;
    upperBound?: number;
  }>;
}

export function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

function fnv1a64Hash(str: string): string {
  let hash = 0xcbf29ce484222325n;
  const fnvPrime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * fnvPrime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}

function appendFNV1a64(hash: bigint, value: string): bigint {
  const fnvPrime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let nextHash = hash;

  for (let i = 0; i < value.length; i++) {
    nextHash ^= BigInt(value.charCodeAt(i));
    nextHash = (nextHash * fnvPrime) & mask;
  }

  return nextHash;
}

function buildNumericFingerprint(values: Array<number | null>): string {
  if (values.length === 0) {
    return '';
  }

  let hash = 0xcbf29ce484222325n;
  let nonNullCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const serialized = value == null ? 'null' : String(value);
    hash = appendFNV1a64(hash, serialized);
    hash = appendFNV1a64(hash, '\x1f');

    if (value == null || !Number.isFinite(value)) {
      continue;
    }

    nonNullCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return [
    values.length,
    nonNullCount,
    nonNullCount > 0 ? min : 'none',
    nonNullCount > 0 ? max : 'none',
    hash.toString(16).padStart(16, '0'),
  ].join('|');
}

function buildNumericMetadataFingerprint(
  numericMetadata?: NumericMetadataFingerprintInput,
): string {
  if (!numericMetadata) {
    return '';
  }

  const serializedBins = (numericMetadata.bins ?? [])
    .map((bin) =>
      [
        bin.id ?? '',
        Number.isFinite(bin.lowerBound) ? String(bin.lowerBound) : '',
        Number.isFinite(bin.upperBound) ? String(bin.upperBound) : '',
      ].join('|'),
    )
    .join('\x1f');

  return [numericMetadata.strategy ?? '', numericMetadata.binCount ?? '', serializedBins].join(
    '::',
  );
}

function buildDatasetFingerprint(data: DatasetHashInput): string {
  const proteinIds = Array.isArray(data.protein_ids) ? data.protein_ids : [];
  const sortedIds = [...proteinIds].sort();
  const annotationFingerprint = Object.entries(data.annotations ?? {})
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([annotationName, annotation]) => {
      const isNumeric = isNumericAnnotation(annotation);
      const normalizedKind = isNumeric ? 'numeric' : (annotation.kind ?? 'categorical');
      const normalizedSourceKind = isNumeric ? 'numeric' : '';
      const categoricalValues =
        !isNumeric && Array.isArray(annotation.values)
          ? annotation.values.map((value) => value ?? '__NULL__').join('|')
          : '';
      const numericValues = data.numeric_annotation_data?.[annotationName] ?? [];
      const numericFingerprint =
        numericValues.length > 0
          ? buildNumericFingerprint(
              proteinIds.length === numericValues.length
                ? proteinIds
                    .map((proteinId, index) => ({
                      proteinId,
                      index,
                      value: numericValues[index] ?? null,
                    }))
                    .sort(
                      (left, right) =>
                        left.proteinId.localeCompare(right.proteinId) || left.index - right.index,
                    )
                    .map((entry) => entry.value)
                : numericValues,
            )
          : buildNumericMetadataFingerprint(annotation.numericMetadata);

      return [
        annotationName,
        normalizedKind,
        normalizedSourceKind,
        categoricalValues,
        numericFingerprint,
      ].join('::');
    })
    .join('\x01');

  const predictionFingerprint = Object.entries(data.annotation_predicted ?? {})
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([annotationName, cells]) => {
      const ordered = cells
        .map((cell, index) => ({ cell, index, proteinId: proteinIds[index] ?? '' }))
        .sort(
          (left, right) =>
            left.proteinId.localeCompare(right.proteinId) || left.index - right.index,
        );
      let hash = 0xcbf29ce484222325n;
      let count = 0;
      for (const { cell, proteinId } of ordered) {
        if (!cell) continue;
        count += 1;
        hash = appendFNV1a64(
          hash,
          [
            proteinId,
            getPredictedCellValues(cell).join('\x1d'),
            JSON.stringify(cell.scores ?? []),
            JSON.stringify(cell.evidence ?? []),
            String(cell.confidence),
            cell.source,
          ].join('\x1f'),
        );
        hash = appendFNV1a64(hash, '\x1e');
      }
      return `${annotationName}::${count}::${hash.toString(16).padStart(16, '0')}`;
    })
    .join('\x01');

  return [sortedIds.join('\x00'), annotationFingerprint, predictionFingerprint].join('\x02');
}

export function generateDatasetHash(input: string[] | DatasetHashInput): string {
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return '0000000000000000';
  }

  const combined = Array.isArray(input)
    ? [...input].sort().join('\x00')
    : buildDatasetFingerprint(input);

  return fnv1a64Hash(combined);
}
