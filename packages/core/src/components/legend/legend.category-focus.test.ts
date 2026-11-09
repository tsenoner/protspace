// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectionStatisticRow, VisualizationData } from '@protspace/utils';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
  stubLocalStorage,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';

// The plot's Shift + hover focus (scatter-plot.ts `_setFocusedValues`) as the legend hears it.

stubLocalStorage();

const OTHER = LEGEND_VALUES.OTHER;

const statRow = (category: string, value: number): ProjectionStatisticRow => ({
  space_kind: 'projection',
  space_name: 'UMAP 2',
  annotation: 'family',
  stat_family: 'annotation_validity',
  label_kind: 'annotation',
  metric: 'silhouette',
  metric_kind: 'validity',
  category,
  value,
});

/** TWELVE's ten rows and Other (K, L), scored or not. */
function data(scored: boolean): VisualizationData {
  return {
    ...categoricalData(TWELVE),
    statisticsRows: scored ? [statRow('A', 0.6), statRow('B', 0.1), statRow('K', -0.2)] : [],
  };
}

async function mount(scored: boolean) {
  const mounted = await mountLegendWithScatterplot(data(scored), 'family');
  await settleLegend(mounted.legend);
  return mounted;
}

async function focus(
  legend: ProtspaceLegend,
  plot: MockScatterplot,
  values: string[] | null,
): Promise<void> {
  plot.dispatchEvent(
    new CustomEvent(LEGEND_EVENTS.CATEGORY_FOCUS, {
      detail: { values },
      bubbles: true,
      composed: true,
    }),
  );
  await settleLegend(legend);
}

const focusedRows = (legend: ProtspaceLegend) =>
  [...legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item.legend-item-focus')].map(
    (row) => row.dataset.value,
  );

const stripHighlight = (legend: ProtspaceLegend) =>
  (legend.shadowRoot!.querySelector('protspace-score-strip') as { highlighted: string | null })
    .highlighted;

describe('legend and the plot’s category focus', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lights the focused row and its dot, and clears both when the focus ends', async () => {
    const { legend, plot } = await mount(true);

    await focus(legend, plot, ['B']);
    expect(focusedRows(legend)).toEqual(['B']);
    expect(stripHighlight(legend)).toBe('B');

    await focus(legend, plot, null);
    expect(focusedRows(legend)).toEqual([]);
    expect(stripHighlight(legend)).toBeNull();
  });

  it('lights the row without separation scores', async () => {
    const { legend, plot } = await mount(false);
    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).toBeNull();

    await focus(legend, plot, ['C']);
    expect(focusedRows(legend)).toEqual(['C']);
  });

  it('lights every row of a multi-label point', async () => {
    const { legend, plot } = await mount(false);

    await focus(legend, plot, ['A', 'D']);
    expect(focusedRows(legend)).toEqual(['A', 'D']);
  });

  it('lights Other for a point in Other, and that category’s own dot', async () => {
    const { legend, plot } = await mount(true);

    // The plot sends the point's values, then every Other value.
    await focus(legend, plot, ['K', 'K', 'L']);
    expect(focusedRows(legend)).toEqual([OTHER]);
    expect(stripHighlight(legend)).toBe('K');
  });

  it('a pointer on a legend row outranks the plot’s focus in the strips', async () => {
    const { legend, plot } = await mount(true);
    await focus(legend, plot, ['B']);

    const row = legend.shadowRoot!.querySelector('.legend-item[data-value="A"]')!;
    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await settleLegend(legend);
    expect(stripHighlight(legend)).toBe('A');

    row.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await settleLegend(legend);
    expect(stripHighlight(legend)).toBe('B');
  });

  it('drops the focus when the legend stops listening to the plot', async () => {
    const { legend, plot } = await mount(false);
    await focus(legend, plot, ['C']);

    legend.remove();
    document.body.append(legend);
    await settleLegend(legend);

    expect(focusedRows(legend)).toEqual([]);
  });
});
