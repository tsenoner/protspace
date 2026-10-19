import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructureErrorEventDetail } from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import { createInteractionController } from './interaction-controller';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../lib/notify', () => ({ notify: notifyMock }));

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

describe('interaction controller structure errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The structure viewer shows its own error inline; a toast on top would say it twice.
  it('logs a structure-viewer error without raising a toast', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = createInteractionController({
      plotElement: {} as never,
      legendElement: {} as never,
      structureViewer: {} as never,
    });
    const detail: StructureErrorEventDetail = {
      message: 'No structure available for P12345',
      severity: 'error',
      source: 'structure-viewer',
      context: { proteinId: 'P12345' },
    };

    controller.handleStructureError(new CustomEvent('structure-error', { detail }));

    expect(warn).toHaveBeenCalledWith('Structure viewer error:', detail);
    for (const level of ['success', 'info', 'warning', 'error'] as const) {
      expect(notifyMock[level]).not.toHaveBeenCalled();
    }
  });
});
