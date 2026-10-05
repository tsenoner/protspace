// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render as litRender } from 'lit';
import { createPlot } from './test-support/plot-fixture';

function makePlot() {
  const plot = createPlot();
  const overlay = {
    set: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    hasActiveRequest: vi.fn(() => true),
    invalidateDataCache: vi.fn(),
  };
  plot._connectorOverlay = overlay as never;
  return { plot, overlay };
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
    const { plot, overlay } = makePlot();
    plot.highlightedProteinIds = ['source', 'target'];

    plot._reconcileProvenanceConnectors(new Map([['selectedAnnotation', 'ec']]));

    expect(overlay.clear).toHaveBeenCalledOnce();
    expect(plot.highlightedProteinIds).toEqual([]);
    expect(overlay.invalidateDataCache).not.toHaveBeenCalled();
  });

  it('releases the dataset-owned lookup when data identity changes', () => {
    const { plot, overlay } = makePlot();

    plot._reconcileProvenanceConnectors(new Map([['data', undefined]]));

    expect(overlay.clear).toHaveBeenCalledOnce();
    expect(overlay.invalidateDataCache).toHaveBeenCalledOnce();
  });

  it.each(['source', 'target'])(
    'clears an active pair when its %s category is hidden',
    (endpoint) => {
      const { plot, overlay } = makePlot();
      plot.setProvenanceConnectors({
        pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
        totalCandidates: 1,
      });
      overlay.clear.mockClear();

      plot.hiddenAnnotationValues = [`hidden-${endpoint}`];
      plot._reconcileProvenanceConnectors(new Map([['hiddenAnnotationValues', []]]));

      expect(overlay.clear).toHaveBeenCalledOnce();
      expect(plot.highlightedProteinIds).toEqual([]);
    },
  );

  it('rerenders geometry for projection and filter changes', () => {
    const { plot, overlay } = makePlot();

    plot._reconcileProvenanceConnectors(
      new Map([
        ['selectedProjectionIndex', 0],
        ['filteredProteinIds', []],
      ]),
    );

    expect(overlay.render).toHaveBeenCalledOnce();
  });

  it('announces eligible endpoints that are unavailable outside the current view', () => {
    const { plot } = makePlot();

    expect(plot._formatConnectorStatus({ shown: 0, total: 1, missingEndpoints: 1 })).toBe(
      '1 hidden (off-view)',
    );
  });

  it('omits the connector-status chip once every connector endpoint is visible', () => {
    const { plot } = makePlot();
    plot._connectorStatus = { shown: 1, total: 1, missingEndpoints: 0 };

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    litRender(plot.render(), shadow);

    expect(shadow.querySelector('.connector-status')).toBeNull();
  });

  it('renders the terse connector-status chip once an endpoint is off-view', () => {
    const { plot } = makePlot();
    plot._connectorStatus = { shown: 0, total: 1, missingEndpoints: 1 };

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    litRender(plot.render(), shadow);

    const chip = shadow.querySelector('.connector-status');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('1 hidden (off-view)');
  });

  it('suppresses a pair that becomes non-interactable under connector-owned highlighting', () => {
    const { plot, overlay } = makePlot();
    plot._mergedConfig = { ...plot._mergedConfig, selectedOpacity: 0 };
    plot._getInteractableProteinIds = vi.fn(() => {
      expect(plot.highlightedProteinIds).toEqual(['source', 'target']);
      return new Set();
    });

    plot.setProvenanceConnectors({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    });

    expect(plot._getInteractableProteinIds).toHaveBeenCalledOnce();
    expect(overlay.set).not.toHaveBeenCalled();
    expect(overlay.clear).toHaveBeenCalledOnce();
    expect(plot.highlightedProteinIds).toEqual([]);
  });
});
