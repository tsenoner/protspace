import { NA_VALUE } from '@protspace/utils';
import type { VisualizationData } from '@protspace/utils';

// P7 sits before P5 in `protein_ids`, so the 0.55 tie must be broken by id, not by index.
export const EAT_FIXTURE_IDS = ['P0', 'P1', 'P2', 'P3', 'P7', 'P5', 'P4', 'P6', 'P8', 'P9'];
export const EAT_FIXTURE_CONFIDENCE_KEY = 'toxin__eat_confidence';

/**
 * Ten proteins, annotation `toxin` (values A, B, C, N/A): 4 curated (A, A, B, C), 5 predicted at
 * 0.12, 0.55, 0.55, 0.81 and 1 (one of them multi-valued A;B), 1 with nothing. Source `S1` lends
 * 3, `P0` lends 1, `S9` (not in the dataset) lends 1. `family` has no predictions.
 */
export function createEatFixture(): VisualizationData {
  const cells = new Array(EAT_FIXTURE_IDS.length).fill(null);
  cells[EAT_FIXTURE_IDS.indexOf('P3')] = { value: 'A', confidence: 0.12, source: 'S1' };
  cells[EAT_FIXTURE_IDS.indexOf('P7')] = { value: 'B', confidence: 0.55, source: 'S1' };
  cells[EAT_FIXTURE_IDS.indexOf('P5')] = {
    value: 'A;B',
    values: ['A', 'B'],
    confidence: 0.55,
    source: 'S1',
  };
  cells[EAT_FIXTURE_IDS.indexOf('P8')] = {
    value: 'C',
    confidence: 0.81,
    source: 'P0',
    sourceIndex: 0,
  };
  cells[EAT_FIXTURE_IDS.indexOf('P9')] = { value: 'A', confidence: 1, source: 'S9' };
  const category = (values: (string | null)[]) => ({
    kind: 'categorical' as const,
    values,
    colors: values.map(() => '#888'),
    shapes: values.map(() => 'circle'),
  });
  return {
    protein_ids: [...EAT_FIXTURE_IDS],
    projections: [
      { name: 'umap', dimension: 2, data: new Float32Array(EAT_FIXTURE_IDS.length * 2) },
    ],
    annotations: {
      toxin: category(['A', 'B', 'C', NA_VALUE]),
      family: category(['F']),
      [EAT_FIXTURE_CONFIDENCE_KEY]: {
        kind: 'numeric',
        values: [],
        colors: [],
        shapes: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'toxin' },
      },
    },
    annotation_data: {
      // Curated: P0 A, P1 A, P2 B, P4 C. P9 also holds a curated A its prediction overrides.
      toxin: new Int32Array([0, 0, 1, 3, 3, 3, 2, 3, 3, 0]),
      family: new Int32Array(EAT_FIXTURE_IDS.length).fill(0),
    },
    numeric_annotation_data: {
      [EAT_FIXTURE_CONFIDENCE_KEY]: Float64Array.from(cells, (cell) => cell?.confidence ?? NaN),
    },
    annotation_predicted: { toxin: cells },
  };
}
