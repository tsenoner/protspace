import {
  buildStorageKey,
  COLOR_SCHEMES,
  materializeVisualizationData,
  type LegendPersistedSettings,
  type VisualizationData,
} from '@protspace/utils';
import { LEGEND_DEFAULTS, NA_VALUE } from '../config';

/**
 * Shared datasets for the legend's tests: every later legend test builds its data here, so the
 * characterization tests of phase 3 and the redesign tests that follow read the same fixtures.
 * Nothing in production code imports this module.
 */

/**
 * Twelve categories, A…L, with distinct descending counts (12 down to 1). The legend shows ten
 * rows by default, so K and L land in Other; no two counts tie, so the size order is fixed.
 */
export const TWELVE: Readonly<Record<string, number>> = Object.freeze({
  A: 12,
  B: 11,
  C: 10,
  D: 9,
  E: 8,
  F: 7,
  G: 6,
  H: 5,
  I: 4,
  J: 3,
  K: 2,
  L: 1,
});

/**
 * One categorical annotation whose values appear `counts[value]` times, in key order. A
 * `__NA__` key gives that many proteins with no value: their code points past the last value,
 * which the legend counts as N/A.
 */
export function categoricalData(
  counts: Readonly<Record<string, number>>,
  annotation = 'family',
): VisualizationData {
  const values = Object.keys(counts).filter((value) => value !== NA_VALUE);
  const codes: number[] = [];
  for (const [value, count] of Object.entries(counts)) {
    const code = value === NA_VALUE ? values.length : values.indexOf(value);
    for (let i = 0; i < count; i++) codes.push(code);
  }
  return {
    protein_ids: codes.map((_, i) => `p${i + 1}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(codes.length * 2) }],
    annotations: {
      [annotation]: {
        kind: 'categorical',
        values,
        colors: values.map(() => '#888888'),
        shapes: values.map(() => 'circle'),
      },
    },
    annotation_data: { [annotation]: Int32Array.from(codes) },
  };
}

/**
 * One numeric annotation over `values` (`null` is a missing value), binned with the default
 * settings the way the scatterplot hands numeric data to the legend.
 */
export function numericData(
  values: readonly (number | null)[],
  annotation = 'length',
): VisualizationData {
  const raw: VisualizationData = {
    protein_ids: values.map((_, i) => `p${i + 1}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(values.length * 2) }],
    annotations: { [annotation]: { kind: 'numeric', values: [], colors: [], shapes: [] } },
    annotation_data: { [annotation]: new Int32Array(values.length) },
    numeric_annotation_data: {
      [annotation]: Float64Array.from(values, (value) => value ?? Number.NaN),
    },
  };
  return materializeVisualizationData(raw, {}, LEGEND_DEFAULTS.maxVisibleValues, annotation);
}

const OKABE_ITO = COLOR_SCHEMES.okabeIto;

/** The three rows the legacy record's user recoloured and reshaped in the picker. */
const LEGACY_CUSTOM: Readonly<Record<string, { color: string; shape: string }>> = {
  B: { color: '#123456', shape: 'diamond' },
  D: { color: '#abcdef', shape: 'square' },
  F: { color: '#0f0f0f', shape: 'triangle-up' },
};

/**
 * A record as the settings dialog of before phase 3 writes it for `categoricalData(TWELVE)`:
 * "Max legend items" 8 and the Okabe-Ito palette saved (each shown row coloured by its rank),
 * the order reversed with the header button (zOrder 7 - rank, so H comes first), C hidden,
 * then B, D and F given a colour and a shape in the picker. `shapeSize: 30` is the filler older
 * writers emitted, and `includeShapes` is the field today's code reads and never writes.
 */
export function legacyLegendRecord(): LegendPersistedSettings & { includeShapes: boolean } {
  const categories = Object.fromEntries(
    [...'ABCDEFGH'].map((value, rank) => [
      value,
      {
        zOrder: 7 - rank,
        color: LEGACY_CUSTOM[value]?.color ?? OKABE_ITO[rank],
        shape: LEGACY_CUSTOM[value]?.shape ?? 'circle',
      },
    ]),
  );
  return {
    maxVisibleValues: 8,
    shapeSize: 30,
    sortMode: 'manual-reverse',
    hiddenValues: ['C'],
    categories,
    enableDuplicateStackUI: false,
    selectedPaletteId: 'okabeIto',
    includeShapes: true,
  };
}

/** The key the legend stores an annotation's settings under for a dataset. */
export function legendStorageKey(hash: string, annotation: string): string {
  return buildStorageKey('legend', hash, annotation);
}
