/**
 * @vitest-environment jsdom
 *
 * Issue #343: the plot's existing point-count chip exposes whether the active
 * D3 view is zoomed in. The full transform remains non-reactive; only
 * crossings between identity and k > 1 schedule a Lit update for the marker, and only a changed count or flag is reported to the host (view-status-change).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as d3 from 'd3';
import type { VisualizationData } from '@protspace/utils';

import { createPlot, type PlotInternals } from './test-support/plot-fixture';

function makeData(): VisualizationData {
  return {
    protein_ids: ['p0'],
    projections: [{ name: 'umap', data: new Float32Array([0, 0]), dimension: 2 }],
    annotations: {
      family: {
        values: ['A'],
        colors: ['#ff0000'],
        shapes: ['circle'],
      },
    },
    annotation_data: { family: [[0]] },
  } as unknown as VisualizationData;
}

async function makePlot(): Promise<PlotInternals> {
  const plot = createPlot();
  // Avoid WebGL/controller startup; these tests drive the real host bridge directly.
  plot.firstUpdated = () => {};
  plot.data = makeData();
  plot.selectedAnnotation = 'family';
  document.body.appendChild(plot);
  while (!(await plot.updateComplete)) {
    // Lit reports false while an update triggered by the previous cycle is pending.
  }
  return plot;
}

function statusChip(plot: PlotInternals): Element | null | undefined {
  return plot.shadowRoot?.querySelector('[role="status"]');
}

describe('scatterplot zoom indicator (#343)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('renders the point count and zoom label as a polite status', async () => {
    const plot = await makePlot();
    const host = plot._interactionHost();
    host.onTransform(d3.zoomIdentity.scale(2));
    await plot.updateComplete;

    const chip = statusChip(plot);
    expect(chip?.getAttribute('aria-live')).toBe('polite');
    expect(chip?.textContent?.trim()).toBe('1 protein · Zoomed in');
  });

  it('schedules a Lit update only when the zoomed-in boundary changes', async () => {
    const plot = await makePlot();
    const host = plot._interactionHost();

    host.onTransform(d3.zoomIdentity.scale(2));
    expect(plot.isUpdatePending).toBe(true);
    await plot.updateComplete;

    host.onTransform(d3.zoomIdentity.scale(3));
    expect(plot.isUpdatePending).toBe(false);

    host.onTransform(d3.zoomIdentity.translate(30, 20));
    expect(plot.isUpdatePending).toBe(true);
    await plot.updateComplete;
    expect(statusChip(plot)?.textContent?.trim()).toBe('1 protein');

    host.onTransform(d3.zoomIdentity.scale(0.5));
    expect(plot.isUpdatePending).toBe(false);
  });

  it('does not redraw plot content for a zoom-indicator-only update', async () => {
    const plot = await makePlot();
    const renderPlot = vi.spyOn(plot, '_renderPlot').mockImplementation(() => {});
    const updateOverlays = vi.spyOn(plot, '_updateSelectionOverlays').mockImplementation(() => {});

    plot._interactionHost().onTransform(d3.zoomIdentity.scale(2));
    await plot.updateComplete;

    expect(renderPlot).not.toHaveBeenCalled();
    expect(updateOverlays).not.toHaveBeenCalled();
  });

  it('treats floating-point wheel residue as identity', async () => {
    const plot = await makePlot();

    plot._interactionHost().onTransform(d3.zoomIdentity.scale(1.0000000000000002));
    await plot.updateComplete;

    expect(statusChip(plot)?.textContent?.trim()).toBe('1 protein');
  });

  it('view-status-change fires once per boundary crossing, not per zoom frame', async () => {
    const plot = await makePlot();
    const reports: Array<{ count: number; zoomedIn: boolean }> = [];
    plot.addEventListener('view-status-change', (event) =>
      reports.push((event as CustomEvent<{ count: number; zoomedIn: boolean }>).detail),
    );
    const host = plot._interactionHost();
    for (const t of [
      d3.zoomIdentity.scale(2),
      d3.zoomIdentity.scale(3),
      d3.zoomIdentity.scale(4),
      d3.zoomIdentity,
    ]) {
      host.onTransform(t);
      await plot.updateComplete;
    }
    expect(reports).toEqual([
      { count: 1, zoomedIn: true },
      { count: 1, zoomedIn: false },
    ]);
  });

  it('hide-status hides the count but not the recalculating note', async () => {
    const plot = await makePlot();
    plot.hideStatus = true;
    plot._numericRecomputeRunning = true;
    await plot.updateComplete;
    expect(statusChip(plot)).toBeNull();
    const notes = [...plot.shadowRoot!.querySelectorAll('.plot-indicator')].map((note) =>
      note.textContent!.trim(),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^Recalculating bins for/);
  });

  it('hidden-values-change reports the number of hidden values when it changes', async () => {
    const plot = await makePlot();
    const counts: number[] = [];
    plot.addEventListener('hidden-values-change', (event) =>
      counts.push((event as CustomEvent<{ count: number }>).detail.count),
    );
    plot.hiddenAnnotationValues = ['A'];
    await plot.updateComplete;
    plot.hiddenAnnotationValues = ['A'];
    await plot.updateComplete;
    plot.hiddenAnnotationValues = [];
    await plot.updateComplete;
    expect(counts).toEqual([1, 0]);
  });
});
