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

/**
 * FNV-1a 64 carried as two 32-bit lanes instead of a BigInt.
 *
 * The BigInt form allocated one BigInt per character, which at 573K proteins is
 * millions of allocations on the main thread. The lane form is value-identical:
 * with `hash = hi * 2^32 + lo` and the prime `2^40 + 0x1b3`,
 *
 *   hash * prime = hi*2^72 + hi*0x1b3*2^32 + lo*2^40 + lo*0x1b3   (mod 2^64)
 *
 * `hi*2^72` vanishes mod 2^64; `lo*2^40 mod 2^64` is `((lo << 8) >>> 0) * 2^32`;
 * `lo*0x1b3` contributes its low word plus a carry into the high word. Every
 * intermediate stays below 2^42, so it is exact in a double.
 */
interface Fnv1a64State {
  hi: number;
  lo: number;
}

function createFNV1a64(): Fnv1a64State {
  return { hi: 0xcbf29ce4, lo: 0x84222325 };
}

function appendFNV1a64(state: Fnv1a64State, value: string): void {
  let hi = state.hi;
  let lo = state.lo;

  for (let i = 0; i < value.length; i++) {
    lo = (lo ^ value.charCodeAt(i)) >>> 0;
    const product = lo * 0x1b3;
    const nextLo = product >>> 0;
    hi = (hi * 0x1b3 + (product - nextLo) / 4294967296 + ((lo << 8) >>> 0)) >>> 0;
    lo = nextLo;
  }

  state.hi = hi;
  state.lo = lo;
}

function formatFNV1a64(state: Fnv1a64State): string {
  return state.hi.toString(16).padStart(8, '0') + state.lo.toString(16).padStart(8, '0');
}

function fnv1a64Hash(str: string): string {
  const state = createFNV1a64();
  appendFNV1a64(state, str);
  return formatFNV1a64(state);
}

/**
 * Do not "optimize" this into a hoisted `new Intl.Collator()`. It is value-identical
 * (ECMA-402 defines bare `localeCompare` as `new Intl.Collator(undefined, undefined)
 * .compare(...)`), but V8 already caches the default collator and takes a fast path
 * for one-byte strings: measured on 573K SwissProt accessions the hoisted collator
 * sorts in 26 ms against 10 ms for `localeCompare`.
 */
function buildProteinIndexOrder(proteinIds: readonly string[]): number[] {
  const order = Array.from({ length: proteinIds.length }, (_, index) => index);
  order.sort((left, right) => proteinIds[left].localeCompare(proteinIds[right]) || left - right);
  return order;
}

function buildNumericFingerprint(
  values: Array<number | null>,
  proteinIndexOrder?: readonly number[],
): string {
  if (values.length === 0) {
    return '';
  }

  const hash = createFNV1a64();
  let nonNullCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let position = 0; position < values.length; position++) {
    const value = values[proteinIndexOrder?.[position] ?? position];
    const serialized = value == null ? 'null' : String(value);
    appendFNV1a64(hash, serialized);
    appendFNV1a64(hash, '\x1f');

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
    formatFNV1a64(hash),
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
  const proteinIndexOrder = buildProteinIndexOrder(proteinIds);
  const sortedIds = proteinIndexOrder.map((index) => proteinIds[index]);
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
              numericValues,
              proteinIds.length === numericValues.length ? proteinIndexOrder : undefined,
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
      const hash = createFNV1a64();
      let count = 0;
      const appendCell = (cell: PredictedCell | null, proteinId: string): void => {
        if (!cell) return;
        count += 1;
        appendFNV1a64(
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
        appendFNV1a64(hash, '\x1e');
      };
      for (let index = proteinIds.length; index < cells.length; index++) {
        appendCell(cells[index], '');
      }
      for (const index of proteinIndexOrder) {
        appendCell(cells[index] ?? null, proteinIds[index]);
      }
      return `${annotationName}::${count}::${formatFNV1a64(hash)}`;
    })
    .join('\x01');

  return [sortedIds.join('\x00'), annotationFingerprint, predictionFingerprint].join('\x02');
}

/**
 * Callers rebuild the wrapper object on every data change (`legend.ts`) while the
 * inner arrays keep their identity, so keying on `protein_ids` identity plus the
 * three payload references turns the repeat calls into a lookup. This is only
 * sound because no producer mutates a live dataset in place: every transform
 * (`materializeVisualizationData`, `cloneWithPredictions`, the conversion
 * pipeline) hands back fresh containers, which miss the memo and recompute.
 * The one in-place writer is `restoreDeclaredNumericAnnotations` (conversion.ts),
 * which runs inside that pipeline before any hash is taken — keep it there.
 */
interface DatasetHashMemo {
  annotations: DatasetHashInput['annotations'];
  numericAnnotationData: DatasetHashInput['numeric_annotation_data'];
  annotationPredicted: DatasetHashInput['annotation_predicted'];
  hash: string;
}

const datasetHashMemo = new WeakMap<readonly string[], DatasetHashMemo>();

export function generateDatasetHash(input: string[] | DatasetHashInput): string {
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return '0000000000000000';
  }

  if (Array.isArray(input)) {
    return fnv1a64Hash([...input].sort().join('\x00'));
  }

  const memoKey = Array.isArray(input.protein_ids) ? input.protein_ids : null;
  const memo = memoKey ? datasetHashMemo.get(memoKey) : undefined;
  if (
    memo &&
    memo.annotations === input.annotations &&
    memo.numericAnnotationData === input.numeric_annotation_data &&
    memo.annotationPredicted === input.annotation_predicted
  ) {
    return memo.hash;
  }

  const hash = fnv1a64Hash(buildDatasetFingerprint(input));

  if (memoKey) {
    datasetHashMemo.set(memoKey, {
      annotations: input.annotations,
      numericAnnotationData: input.numeric_annotation_data,
      annotationPredicted: input.annotation_predicted,
      hash,
    });
  }

  return hash;
}
