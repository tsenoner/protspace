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

function makeFanoutData(): VisualizationData {
  const proteinIds = ['source', ...Array.from({ length: 24 }, (_, index) => `query-${index}`)];
  return {
    ...makeData(),
    protein_ids: proteinIds,
    projections: [{ name: 'pca', data: new Float32Array(proteinIds.length * 2), dimension: 2 }],
    annotation_data: { ec: new Int32Array(proteinIds.length).fill(-1) },
    annotation_predicted: {
      ec: [
        null,
        ...proteinIds.slice(1).map((_, index) => ({
          value: '1.1.1.1',
          confidence: 1 - index / 25,
          source: 'source',
        })),
      ],
    },
  };
}

function setup(data = makeData()) {
  const currentView = new Set(data.protein_ids.map((_, index) => index));
  const plotElement = {
    data,
    selectedAnnotation: 'ec',
    selectedProteinIds: [],
    eatOverlayEnabled: true,
    isProteinLegendEligible: vi.fn(() => true),
    isProteinInCurrentView: vi.fn((index: number) => currentView.has(index)),
    hasActiveProvenanceConnectors: vi.fn(() => true),
    getCurrentData: vi.fn(() => data),
    setProvenanceConnectors: vi.fn(),
    clearProvenanceConnectors: vi.fn(),
  };
  const controller = createInteractionController({
    plotElement: plotElement as never,
    legendElement: { autoSync: true } as never,
    selectedProteinElement: null,
    structureViewer: { loadProtein: vi.fn() } as never,
  });
  return { controller, currentView, plotElement };
}

describe('interaction controller EAT provenance', () => {
  it('forwards a predicted click to the scatter connector API', () => {
    const { controller, plotElement } = setup();

    controller.handleProteinClick({
      detail: { proteinId: 'query', point: { originalIndex: 1 } },
    } as unknown as Event);

    expect(plotElement.setProvenanceConnectors).toHaveBeenCalledWith({
      pairs: [
        {
          sourceProteinId: 'source',
          targetProteinId: 'query',
          confidence: 0.83,
        },
      ],
      totalCandidates: 1,
      unavailableCandidates: 0,
    });
  });

  it('clears connectors when EAT is disabled or a click has no provenance', () => {
    const { controller, plotElement } = setup();
    plotElement.eatOverlayEnabled = false;
    controller.handleProteinClick({
      detail: { proteinId: 'query', point: { originalIndex: 1 } },
    } as unknown as Event);
    plotElement.eatOverlayEnabled = true;
    controller.handleProteinClick({
      detail: { proteinId: 'unknown', point: { originalIndex: 9 } },
    } as unknown as Event);

    expect(plotElement.clearProvenanceConnectors).toHaveBeenCalledTimes(2);
    expect(plotElement.setProvenanceConnectors).not.toHaveBeenCalled();
  });

  it('threads global indices through repeated provenance clicks', () => {
    const { controller, plotElement } = setup();

    controller.handleProteinClick({
      detail: { proteinId: 'query', point: { originalIndex: 1 } },
    } as unknown as Event);
    controller.handleProteinClick({
      detail: { proteinId: 'source', point: { originalIndex: 0 } },
    } as unknown as Event);

    expect(plotElement.isProteinLegendEligible).toHaveBeenCalledWith('query', 1);
    expect(plotElement.isProteinLegendEligible).toHaveBeenCalledWith('source', 0);
  });

  it.each(['filtering', 'isolation'])(
    're-resolves an active source click to keep 20 visible targets across %s expansion',
    () => {
      const { controller, currentView, plotElement } = setup(makeFanoutData());
      currentView.delete(3);

      controller.handleProteinClick({
        detail: { proteinId: 'source', point: { originalIndex: 0 } },
      } as unknown as Event);

      const constrained = plotElement.setProvenanceConnectors.mock.lastCall?.[0];
      expect(constrained).toMatchObject({
        totalCandidates: 24,
        unavailableCandidates: 1,
      });
      expect(constrained.pairs).toHaveLength(20);
      expect(
        constrained.pairs.map((pair: { targetProteinId: string }) => pair.targetProteinId),
      ).not.toContain('query-2');
      expect(
        constrained.pairs.map((pair: { targetProteinId: string }) => pair.targetProteinId),
      ).toContain('query-20');

      currentView.add(3);
      controller.handlePlotDataChange();

      const expanded = plotElement.setProvenanceConnectors.mock.lastCall?.[0];
      expect(expanded).toMatchObject({
        totalCandidates: 24,
        unavailableCandidates: 0,
      });
      expect(expanded.pairs).toHaveLength(20);
      expect(
        expanded.pairs.map((pair: { targetProteinId: string }) => pair.targetProteinId),
      ).toContain('query-2');
      expect(
        expanded.pairs.map((pair: { targetProteinId: string }) => pair.targetProteinId),
      ).not.toContain('query-20');
    },
  );

  it('does not resurrect a dismissed semantic click on a later data change', () => {
    const { controller, plotElement } = setup();
    controller.handleProteinClick({
      detail: { proteinId: 'query', point: { originalIndex: 1 } },
    } as unknown as Event);
    plotElement.hasActiveProvenanceConnectors.mockReturnValue(false);
    plotElement.setProvenanceConnectors.mockClear();

    controller.handlePlotDataChange();

    expect(plotElement.setProvenanceConnectors).not.toHaveBeenCalled();
  });
});
