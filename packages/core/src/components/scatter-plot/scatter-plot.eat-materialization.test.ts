// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});
import './scatter-plot';

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  eatOverlayEnabled: boolean;
  eatConfidenceThreshold: number;
  _getMaterializedData(): VisualizationData;
  _scheduleQuadtreeRebuild(): void;
  updated(changedProperties: Map<string, unknown>): void;
};

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
    const plot = document.createElement('protspace-scatterplot') as Internals;
    plot.data = data();
    plot.selectedAnnotation = 'ec';
    plot.eatOverlayEnabled = true;
    const enabled = plot._getMaterializedData();
    expect(Array.from(enabled.annotation_data.ec as Int32Array)).toEqual([0, 0]);

    plot.eatOverlayEnabled = false;
    const disabled = plot._getMaterializedData();
    expect(disabled).not.toBe(enabled);
    expect(Array.from(disabled.annotation_data.ec as Int32Array)).toEqual([0, 1]);
    expect(Array.from(plot.data.annotation_data.ec as Int32Array)).toEqual([0, 1]);
  });

  it('keeps threshold input off quadtree and population data-change paths', () => {
    const plot = document.createElement('protspace-scatterplot') as Internals;
    plot.data = data();
    plot.selectedAnnotation = 'ec';
    plot.eatOverlayEnabled = true;
    plot.eatConfidenceThreshold = 0.75;
    const scheduleQuadtree = vi
      .spyOn(plot, '_scheduleQuadtreeRebuild')
      .mockImplementation(() => undefined);
    const dataChange = vi.fn();
    plot.addEventListener('data-change', dataChange);

    plot.updated(new Map([['eatConfidenceThreshold', 0.5]]));

    expect(scheduleQuadtree).not.toHaveBeenCalled();
    expect(dataChange).not.toHaveBeenCalled();
  });
});
