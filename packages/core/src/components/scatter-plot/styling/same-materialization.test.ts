import { describe, it, expect } from 'vitest';
import { materializeVisualizationData, type VisualizationData } from '@protspace/utils';
import { sameMaterialization } from './same-materialization';

function makeData(): VisualizationData {
  const scores = [0, 1, 2, 3, 4, 5, 6, 7];
  return {
    protein_ids: scores.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: new Float32Array(scores.length * 2), dimension: 2 }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#f00'], shapes: ['circle'] },
      score: { kind: 'numeric', values: [], colors: [], shapes: [] },
      other: { kind: 'numeric', values: [], colors: [], shapes: [] },
    },
    annotation_data: {
      fam: scores.map(() => [0]),
      score: scores.map(() => [0]),
      other: scores.map(() => [0]),
    },
    numeric_annotation_data: { score: scores, other: scores.map((v) => v * 2) },
  } as unknown as VisualizationData;
}

const settings = (binCount: number) => ({
  binCount,
  strategy: 'linear' as const,
  paletteId: 'viridis',
  reverseGradient: false,
});

const materialize = (
  data: VisualizationData,
  map: Record<string, ReturnType<typeof settings>>,
  selected: string,
) => materializeVisualizationData(data, map, 10, selected);

describe('sameMaterialization', () => {
  it('is true for the same object', () => {
    const m = materialize(makeData(), {}, 'score');
    expect(sameMaterialization(m, m, 'score')).toBe(true);
  });

  it('is true for a rebin onto the same bins, which is a new object with equal content', () => {
    const data = makeData();
    const a = materialize(data, { score: settings(3) }, 'score');
    const b = materialize(data, { score: settings(3) }, 'score');
    expect(a).not.toBe(b);
    expect(a.annotations.score).not.toBe(b.annotations.score);
    expect(sameMaterialization(a, b, 'score')).toBe(true);
  });

  it('is false when the selected annotation lands on different bins', () => {
    const data = makeData();
    const a = materialize(data, { score: settings(3) }, 'score');
    const b = materialize(data, { score: settings(5) }, 'score');
    expect(sameMaterialization(a, b, 'score')).toBe(false);
  });

  it('is false when only the palette changes, which recolours the bins', () => {
    const data = makeData();
    const a = materialize(data, { score: settings(3) }, 'score');
    const b = materialize(data, { score: { ...settings(3), paletteId: 'batlow' } }, 'score');
    expect(sameMaterialization(a, b, 'score')).toBe(false);
  });

  it('is true when only another numeric annotation was rebinned', () => {
    const data = makeData();
    const a = materialize(data, { score: settings(3) }, 'fam');
    const b = materialize(data, { score: settings(5), other: settings(4) }, 'fam');
    expect(sameMaterialization(a, b, 'fam')).toBe(true);
  });

  it('is false for different datasets', () => {
    const a = materialize(makeData(), {}, 'score');
    const b = materialize(makeData(), {}, 'score');
    expect(sameMaterialization(a, b, 'score')).toBe(false);
  });

  it('is false when the selected annotation is missing', () => {
    const data = makeData();
    const a = materialize(data, {}, 'score');
    const b = materialize(data, { score: settings(5) }, 'score');
    expect(sameMaterialization(a, b, 'nope')).toBe(false);
  });
});
