import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { resolveRenderableView } from './data-renderer';
import type { EffectiveExploreView } from './view-state';

const projections: VisualizationData['projections'] = [
  { name: 'umap', dimension: 2, data: new Float32Array([0, 0, 1, 1]) },
];

describe('resolveRenderableView eat-confidence exclusion', () => {
  it('skips a leading eat-confidence key and defaults to the first non-eat annotation', () => {
    // `pfam__eat_confidence` iterates first in Object.keys() — this is the exact
    // shape of the bug: without the exclusion, the scatter plot would be
    // auto-colored by the raw EAT confidence values on load.
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2'],
      projections,
      annotations: {
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          colors: [],
          shapes: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
        pfam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        pfam__eat_confidence: new Int32Array([0, 1]),
        pfam: new Int32Array([0, 1]),
      },
    };

    const result = resolveRenderableView(data, null);

    expect(result.annotation).toBe('pfam');
  });

  it('ignores a deep-linked initialView.annotation that points at an eat-confidence key', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2'],
      projections,
      annotations: {
        pfam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          colors: [],
          shapes: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
      },
      annotation_data: {
        pfam: new Int32Array([0, 1]),
        pfam__eat_confidence: new Int32Array([0, 1]),
      },
    };
    const initialView: EffectiveExploreView = {
      annotation: 'pfam__eat_confidence',
      projection: 'umap',
      tooltip: [],
    };

    const result = resolveRenderableView(data, initialView);

    expect(result.annotation).toBe('pfam');
  });

  it('selects Object.keys(annotations)[0] as before when no eat-confidence keys are present', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2'],
      projections,
      annotations: {
        species: {
          kind: 'categorical',
          values: ['human', 'mouse'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
        pfam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        species: new Int32Array([0, 1]),
        pfam: new Int32Array([0, 1]),
      },
    };

    const result = resolveRenderableView(data, null);

    expect(result.annotation).toBe('species');
  });
});
