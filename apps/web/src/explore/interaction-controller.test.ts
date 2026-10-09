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
    requestStructure: vi.fn(),
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

describe('interaction controller structure requests', () => {
  it("a selection requests its last protein's structure", () => {
    const requestStructure = vi.fn();
    const controller = createInteractionController({
      plotElement: { selectedAnnotation: 'family', getCurrentData: () => data } as never,
      legendElement: { autoSync: true, forceSync: vi.fn() } as never,
      requestStructure,
    });

    controller.handleSelectionChange(['p0', 'p1']);
    expect(requestStructure).toHaveBeenCalledExactlyOnceWith('p1');
    expect(controller.getSelectedProteins()).toEqual(['p0', 'p1']);

    // Clearing the selection leaves the structure as it is.
    controller.handleSelectionChange([]);
    expect(requestStructure).toHaveBeenCalledOnce();
    expect(controller.getSelectedProteins()).toEqual([]);
  });
});

describe('interaction controller protein clicks', () => {
  it("a plain click asks for the clicked protein's structure; a modified click does not", () => {
    const requestStructure = vi.fn();
    const controller = createInteractionController({
      plotElement: { clearProvenanceConnectors: vi.fn() } as never,
      legendElement: { autoSync: true, forceSync: vi.fn() } as never,
      requestStructure,
    });
    const click = (detail: object) =>
      controller.handleProteinClick(new CustomEvent('protein-click', { detail }));

    click({ proteinId: 'P1' });
    expect(requestStructure).toHaveBeenCalledExactlyOnceWith('P1');

    for (const key of ['ctrl', 'meta', 'shift']) {
      click({
        proteinId: 'P2',
        modifierKeys: { ctrl: false, meta: false, shift: false, alt: false, [key]: true },
      });
    }
    expect(requestStructure).not.toHaveBeenCalledWith('P2');
  });
});
