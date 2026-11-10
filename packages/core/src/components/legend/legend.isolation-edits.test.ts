// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

const rows = (legend: ProtspaceLegend) =>
  legend.getLegendExportData().items.map((item) => item.value);
const other = (legend: ProtspaceLegend) => legend._otherItems.map((item) => item.value);

/**
 * TWELVE at five rows (A–E, Other: F–L), then isolated to the proteins of A, E and K: rows A, E
 * and Other(K). The plot's isolation is read on each data-change, as the scatterplot reports it.
 */
async function isolatedSetup() {
  const data = categoricalData(TWELVE);
  let history: string[][] = [];
  const { legend, plot } = await mountLegendWithScatterplot(data, 'family', {
    isIsolationMode: () => history.length > 0,
    getIsolationHistory: () => history,
  });
  await settleLegend(legend);
  legend.maxVisibleValues = 5;
  await settleLegend(legend);

  // Proteins are laid out A×12, B×11, … so each category's ids are one contiguous run.
  const start = (value: string) => {
    const keys = Object.keys(TWELVE);
    return keys.slice(0, keys.indexOf(value)).reduce((sum, key) => sum + TWELVE[key], 0);
  };
  const idsOf = (value: string) =>
    data.protein_ids.slice(start(value), start(value) + TWELVE[value]);
  const resync = async () => {
    plot.dispatchEvent(new CustomEvent('data-change', { detail: { data } }));
    await settleLegend(legend);
  };
  const isolate = async (values: string[] | null) => {
    history = values ? [values.flatMap(idsOf)] : [];
    await resync();
  };
  return { legend, plot: plot as MockScatterplot, isolate, resync };
}

describe('legend edits while isolated', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps a row merged into Other there through the next rebuild', async () => {
    const { legend, isolate, resync } = await isolatedSetup();
    await isolate(['A', 'E', 'K']);
    expect(rows(legend)).toEqual(['A', 'E', 'Other']);

    legend._actions.mergeToOther('A');
    await settleLegend(legend);
    expect(rows(legend)).toEqual(['E', 'Other']);

    // A projection switch or a filter edit: the plot reports its data again.
    await resync();
    expect(rows(legend)).toEqual(['E', 'Other']);
    expect(other(legend)).toContain('A');
  });

  it('puts a row taken out of Other after the rows placed in "Your order"', async () => {
    const { legend, isolate } = await isolatedSetup();
    legend._actions.applySortMode('manual');
    await settleLegend(legend);
    await isolate(['A', 'E', 'K']);
    expect(rows(legend)).toEqual(['A', 'E', 'Other']);

    legend._actions.extractFromOther('K');
    await settleLegend(legend);

    expect(rows(legend)).toEqual(['A', 'E', 'K']);
  });
});
