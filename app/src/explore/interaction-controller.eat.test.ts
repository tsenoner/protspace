import { describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createInteractionController } from './interaction-controller';

function makeData(): VisualizationData {
  return {
    protein_ids: ['source', 'query'],
    projections: [{ name: 'pca', data: new Float32Array(4), dimension: 2 }],
    annotations: {
      ec: { kind: 'categorical', values: ['1.1.1.1'], colors: ['#000'], shapes: ['circle'] },
    },
    annotation_data: { ec: new Int32Array([-1, -1]) },
    annotation_predicted: {
      ec: [null, { value: '1.1.1.1', confidence: 0.83, source: 'source' }],
    },
  };
}

function setup() {
  const data = makeData();
  const plotElement = {
    data,
    selectedAnnotation: 'ec',
    selectedProteinIds: [],
    eatOverlayEnabled: true,
    getCurrentData: () => data,
    setProvenanceConnectors: vi.fn(),
    clearProvenanceConnectors: vi.fn(),
  };
  const controller = createInteractionController({
    plotElement: plotElement as never,
    legendElement: { autoSync: true } as never,
    selectedProteinElement: null,
    structureViewer: { loadProtein: vi.fn() } as never,
  });
  return { controller, plotElement };
}

describe('interaction controller EAT provenance', () => {
  it('forwards a predicted click to the scatter connector API', () => {
    const { controller, plotElement } = setup();

    controller.handleProteinClick({ detail: { proteinId: 'query' } } as unknown as Event);

    expect(plotElement.setProvenanceConnectors).toHaveBeenCalledWith({
      pairs: [
        {
          sourceProteinId: 'source',
          targetProteinId: 'query',
          confidence: 0.83,
        },
      ],
      totalCandidates: 1,
    });
  });

  it('clears connectors when EAT is disabled or a click has no provenance', () => {
    const { controller, plotElement } = setup();
    plotElement.eatOverlayEnabled = false;
    controller.handleProteinClick({ detail: { proteinId: 'query' } } as unknown as Event);
    plotElement.eatOverlayEnabled = true;
    controller.handleProteinClick({ detail: { proteinId: 'unknown' } } as unknown as Event);

    expect(plotElement.clearProvenanceConnectors).toHaveBeenCalledTimes(2);
    expect(plotElement.setProvenanceConnectors).not.toHaveBeenCalled();
  });
});
