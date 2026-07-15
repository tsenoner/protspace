// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';
import type { ProtspaceScatterplot } from './scatter-plot';

type ConnectorSeam = {
  _connectorOverlay: {
    set: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    hasActiveRequest: ReturnType<typeof vi.fn>;
    invalidateDataCache: ReturnType<typeof vi.fn>;
  };
  _mergedConfig: { selectedOpacity: number };
  _getInteractableProteinIds(): ReadonlySet<string>;
  _formatConnectorStatus(status: {
    shown: number;
    total: number;
    missingEndpoints: number;
  }): string;
  _reconcileProvenanceConnectors(changed: Map<string, unknown>): void;
};

function makePlot() {
  const plot = document.createElement('protspace-scatterplot') as ProtspaceScatterplot;
  const overlay = {
    set: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    hasActiveRequest: vi.fn(() => true),
    invalidateDataCache: vi.fn(),
  };
  (plot as unknown as ConnectorSeam)._connectorOverlay = overlay;
  return { plot, overlay, seam: plot as unknown as ConnectorSeam };
}

describe('scatter-plot provenance connector contract', () => {
  it('caps requests at 20 and replaces highlighted ids with connector endpoints', () => {
    const { plot, overlay } = makePlot();
    const pairs = Array.from({ length: 25 }, (_, index) => ({
      sourceProteinId: 'source',
      targetProteinId: `target-${index}`,
      confidence: 1 - index / 100,
    }));

    plot.setProvenanceConnectors({ pairs, totalCandidates: 25 });

    expect(overlay.set).toHaveBeenCalledWith({ pairs: pairs.slice(0, 20), totalCandidates: 25 });
    expect(plot.highlightedProteinIds).toEqual([
      'source',
      ...pairs.slice(0, 20).map((pair) => pair.targetProteinId),
    ]);
  });

  it('clears connector-owned highlights and stale state on an annotation change', () => {
    const { plot, overlay, seam } = makePlot();
    plot.highlightedProteinIds = ['source', 'target'];

    seam._reconcileProvenanceConnectors(new Map([['selectedAnnotation', 'ec']]));

    expect(overlay.clear).toHaveBeenCalledOnce();
    expect(plot.highlightedProteinIds).toEqual([]);
    expect(overlay.invalidateDataCache).not.toHaveBeenCalled();
  });

  it('releases the dataset-owned lookup when data identity changes', () => {
    const { overlay, seam } = makePlot();

    seam._reconcileProvenanceConnectors(new Map([['data', undefined]]));

    expect(overlay.clear).toHaveBeenCalledOnce();
    expect(overlay.invalidateDataCache).toHaveBeenCalledOnce();
  });

  it.each(['source', 'target'])(
    'clears an active pair when its %s category is hidden',
    (endpoint) => {
      const { plot, overlay, seam } = makePlot();
      plot.setProvenanceConnectors({
        pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
        totalCandidates: 1,
      });
      overlay.clear.mockClear();

      plot.hiddenAnnotationValues = [`hidden-${endpoint}`];
      seam._reconcileProvenanceConnectors(new Map([['hiddenAnnotationValues', []]]));

      expect(overlay.clear).toHaveBeenCalledOnce();
      expect(plot.highlightedProteinIds).toEqual([]);
    },
  );

  it('rerenders geometry for projection and filter changes', () => {
    const { overlay, seam } = makePlot();

    seam._reconcileProvenanceConnectors(
      new Map([
        ['selectedProjectionIndex', 0],
        ['filteredProteinIds', []],
      ]),
    );

    expect(overlay.render).toHaveBeenCalledOnce();
  });

  it('announces eligible endpoints that are unavailable outside the current view', () => {
    const { seam } = makePlot();

    expect(seam._formatConnectorStatus({ shown: 0, total: 1, missingEndpoints: 1 })).toBe(
      'Showing 0 of 1 provenance connection · 1 connection unavailable outside the current view',
    );
  });

  it('suppresses a pair that becomes non-interactable under connector-owned highlighting', () => {
    const { plot, overlay, seam } = makePlot();
    seam._mergedConfig = { ...seam._mergedConfig, selectedOpacity: 0 };
    seam._getInteractableProteinIds = vi.fn(() => {
      expect(plot.highlightedProteinIds).toEqual(['source', 'target']);
      return new Set();
    });

    plot.setProvenanceConnectors({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    });

    expect(seam._getInteractableProteinIds).toHaveBeenCalledOnce();
    expect(overlay.set).not.toHaveBeenCalled();
    expect(overlay.clear).toHaveBeenCalledOnce();
    expect(plot.highlightedProteinIds).toEqual([]);
  });
});
