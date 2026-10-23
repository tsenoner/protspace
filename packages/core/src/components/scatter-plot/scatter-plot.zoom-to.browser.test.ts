import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';

afterEach(() => document.body.replaceChildren());

/** Three proteins far apart on the diagonal. */
function makeData(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 5, 5, 10, 10]) }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#336699'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(3) },
  } as unknown as VisualizationData;
}

async function mountPlot(): Promise<ProtspaceScatterplot> {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  await vi.waitFor(() => {
    const rect = plot.getBoundingClientRect();
    const p = plot.getProteinClientPosition('P3')!;
    expect(plot.pickInteractivePointAt(p.x - rect.left, p.y - rect.top)).not.toBeNull();
  });
  return plot;
}

const transformOf = (plot: ProtspaceScatterplot) =>
  (plot as unknown as { _transform: { k: number; x: number; y: number } })._transform;
const svgRect = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector('svg')!.getBoundingClientRect();

describe('scatterplot zoomToProteins', () => {
  it('one id moves that point to the plot centre ±1 px at k ≥ 8', async () => {
    const plot = await mountPlot();
    expect(plot.zoomToProteins(['P2'])).toBe(true);
    const rect = svgRect(plot);
    const p = plot.getProteinClientPosition('P2')!;
    expect(Math.abs(p.x - (rect.left + rect.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - (rect.top + rect.height / 2))).toBeLessThanOrEqual(1);
    expect(transformOf(plot).k).toBeGreaterThanOrEqual(8);
  });

  it('several ids fit their box inside 40 px', async () => {
    const plot = await mountPlot();
    expect(plot.zoomToProteins(['P1', 'P3'])).toBe(true);
    const rect = svgRect(plot);
    const p1 = plot.getProteinClientPosition('P1')!;
    const p3 = plot.getProteinClientPosition('P3')!;
    for (const p of [p1, p3]) {
      expect(p.x).toBeGreaterThanOrEqual(rect.left + 39);
      expect(p.x).toBeLessThanOrEqual(rect.right - 39);
      expect(p.y).toBeGreaterThanOrEqual(rect.top + 39);
      expect(p.y).toBeLessThanOrEqual(rect.bottom - 39);
    }
    // The box fills the room on its tighter side.
    const fill = Math.max(
      Math.abs(p3.x - p1.x) / (rect.width - 80),
      Math.abs(p3.y - p1.y) / (rect.height - 80),
    );
    expect(fill).toBeCloseTo(1, 1);
  });

  it('unknown or unplotted ids return false and leave the transform', async () => {
    const plot = await mountPlot();
    expect(plot.zoomToProteins([])).toBe(false);
    expect(plot.zoomToProteins(['nope'])).toBe(false);
    plot.filteredProteinIds = ['P1', 'P3'];
    plot.filtersActive = true;
    await vi.waitFor(() => expect(plot.getProteinClientPosition('P2')).toBeNull());
    expect(plot.zoomToProteins(['P2'])).toBe(false);
    expect(plot.zoomToProteins(['P2', 'nope'])).toBe(false);
    expect(transformOf(plot)).toMatchObject({ k: 1, x: 0, y: 0 });
  });

  it('a wheel after zoomToProteins starts from the new transform (d3 state in sync)', async () => {
    const plot = await mountPlot();
    plot.zoomToProteins(['P2']);
    const before = transformOf(plot).k;
    const p = plot.getProteinClientPosition('P2')!;
    plot.shadowRoot!.querySelector('svg')!.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: p.x,
        clientY: p.y,
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(transformOf(plot).k).toBeGreaterThan(before));
    // One wheel step from 8×, not from the 1× d3 would still hold had the zoom bypassed it.
    expect(transformOf(plot).k).toBeLessThan(before * 1.5);
  });
});
