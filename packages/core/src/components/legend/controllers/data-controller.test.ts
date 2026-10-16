/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PerfCounters from '../../../utils/perf-counters';

// A live counter set, as `scatter-plot.resize.test.ts` does: `perfCounters` is null unless the
// page URL carries `?perfCounters`.
vi.mock('../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { perfCounters } from '../../../utils/perf-counters';
import type { ProtspaceLegend } from '../legend';
import { categoricalData, numericData, TWELVE } from '../test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from '../test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from '../test-support/local-storage-mock';
import { LegendDataController } from './data-controller';

vi.stubGlobal('localStorage', createLocalStorageMock());

const counters = perfCounters!;

type DataInternals = ProtspaceLegend & {
  _data: LegendDataController;
  _updateLegendItems(): void;
};

async function mount(...args: Parameters<typeof mountLegendWithScatterplot>) {
  const { legend } = await mountLegendWithScatterplot(...args);
  await settleLegend(legend);
  return legend as DataInternals;
}

describe('LegendDataController', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it("is the legend's data pipeline; updateItems counts one legendUpdate per _updateLegendItems call", async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    expect(legend._data).toBeInstanceOf(LegendDataController);
    const updateItems = vi.spyOn(legend._data, 'updateItems');
    const before = counters.legendUpdate;

    legend._updateLegendItems();
    legend._updateLegendItems();

    // Read synchronously: the item pass runs inside the call, before any re-render.
    expect(counters.legendUpdate - before).toBe(2);
    expect(updateItems).toHaveBeenCalledTimes(2);
  });

  it('normalizeSortMode keeps a numeric annotation off categorical modes', async () => {
    const numeric = await mount(numericData([1, 2, 3, 4, 5, null]), 'length');
    expect(numeric._data.normalizeSortMode('length', 'size-desc')).toBe('alpha-asc');
    expect(numeric._data.normalizeSortMode('length', 'manual')).toBe('manual');
    expect(numeric._data.normalizeSortMode('length', undefined)).toBe('alpha-asc');
    document.body.innerHTML = '';

    const categorical = await mount(categoricalData(TWELVE), 'family');
    expect(categorical._data.normalizeSortMode('family', undefined)).toBe('size-desc');
    expect(categorical._data.normalizeSortMode('family', 'alpha-asc')).toBe('alpha-asc');
  });
});
