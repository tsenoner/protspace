// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createPlot } from './test-support/plot-fixture';

function data(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array(4) }],
    annotations: {
      ec: {
        kind: 'categorical',
        values: ['1.1.1.1', '__NA__'],
        colors: ['#f00', '#ddd'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { ec: new Int32Array([0, 1]) },
    annotation_predicted: {
      ec: [null, { value: '1.1.1.1', confidence: 0.8, source: 'P1' }],
    },
  };
}

describe('scatter-plot EAT materialization', () => {
  it('coalesces only while enabled and invalidates the cached view on toggle', () => {
    const plot = createPlot({ data: data(), selectedAnnotation: 'ec', eatOverlayEnabled: true });
    const enabled = plot._getMaterializedData()!;
    expect(Array.from(enabled.annotation_data.ec as Int32Array)).toEqual([0, 0]);

    plot.eatOverlayEnabled = false;
    const disabled = plot._getMaterializedData()!;
    expect(disabled).not.toBe(enabled);
    expect(Array.from(disabled.annotation_data.ec as Int32Array)).toEqual([0, 1]);
    expect(Array.from(plot.data!.annotation_data.ec as Int32Array)).toEqual([0, 1]);
  });
});
