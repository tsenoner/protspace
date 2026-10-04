import { describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createInteractionController } from './interaction-controller';

const data: VisualizationData = {
  protein_ids: ['p0', 'p1'],
  projections: [{ name: 'pca', data: new Float32Array(4), dimension: 2 }],
  annotations: {
    family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
  },
  annotation_data: { family: new Int32Array([0, 0]) },
};

function setup(autoSync: boolean) {
  const legendElement = { autoSync, forceSync: vi.fn() };
  const controller = createInteractionController({
    plotElement: { selectedAnnotation: 'family', getCurrentData: () => data } as never,
    legendElement: legendElement as never,
    structureViewer: {} as never,
  });
  return { controller, legendElement };
}

describe('interaction controller legend updates', () => {
  // A load holds auto-sync off while the plot takes the new data. The legend follows the
  // plot through its own sync controller then, so a data change hands it nothing.
  it('leaves the legend alone while auto-sync is off', () => {
    const { controller, legendElement } = setup(false);

    controller.handlePlotDataChange();

    expect(Object.keys(legendElement)).toEqual(['autoSync', 'forceSync']);
    expect(legendElement.forceSync).not.toHaveBeenCalled();
  });

  it('resyncs the legend once auto-sync is on', () => {
    const { controller, legendElement } = setup(true);

    controller.updateLegend();

    expect(legendElement.forceSync).toHaveBeenCalledOnce();
  });
});
