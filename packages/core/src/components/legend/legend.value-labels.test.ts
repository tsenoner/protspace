/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NA_VALUE } from './config';
import { categoricalData } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
  stubLocalStorage,
} from './test-support/legend-scatterplot-harness';

stubLocalStorage();
afterEach(() => document.body.replaceChildren());

const rowLabels = (root: ShadowRoot) =>
  [...root.querySelectorAll<HTMLElement>('.legend-item')].map((row) => row.dataset.displayValue);

describe('legend value labels', () => {
  it("shows TED's '-' as No CATH label, keeping N/A for proteins without TED data", async () => {
    const data = categoricalData({ '-': 3, '3.40.50.300': 2, [NA_VALUE]: 1 }, 'ted_domains');
    const { legend } = await mountLegendWithScatterplot(data, 'ted_domains');
    await settleLegend(legend);

    expect(rowLabels(legend.shadowRoot!)).toEqual(['No CATH label', '3.40.50.300', 'N/A']);
    // The value itself, which the plot, filters and settings key on, stays '-'.
    expect(legend._legendItems.map((item) => item.value)).toEqual(['-', '3.40.50.300', NA_VALUE]);
  });

  it("keeps another annotation's '-' as written", async () => {
    const data = categoricalData({ '-': 3, PF00001: 2 }, 'pfam');
    const { legend } = await mountLegendWithScatterplot(data, 'pfam');
    await settleLegend(legend);

    expect(rowLabels(legend.shadowRoot!)).toEqual(['-', 'PF00001']);
  });
});
