// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createDefaultSettings } from './legend-helpers';
import type { ProtspaceLegend } from './legend';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

/** A, B and C on 4, 3 and 2 proteins: p0–p3 are A, p4–p6 B, p7–p8 C. */
function makeData(indices = [0, 1, 2, 3, 4, 5, 6, 7, 8]): VisualizationData {
  const family = [0, 0, 0, 0, 1, 1, 1, 2, 2];
  return {
    protein_ids: indices.map((i) => `p${i}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(indices.length * 2) }],
    annotations: {
      family: {
        kind: 'categorical',
        values: ['A', 'B', 'C'],
        colors: ['#000000', '#000000', '#000000'],
        shapes: ['circle', 'circle', 'circle'],
      },
    },
    annotation_data: { family: Int32Array.from(indices, (i) => family[i]) },
  };
}

type SortLegend = ProtspaceLegend & {
  _actions: { applySortMode(mode: string): void };
  _currentSortMode: string;
};

const rows = (legend: ProtspaceLegend) =>
  legend.getLegendExportData().items.map((item) => `${item.value} ${item.count}`);

describe('legend sort: the rows follow the sort the header names', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('keeps "By count" in count order after a bundle with a manual order and a filter', async () => {
    const data = makeData();
    const { legend, plot } = await mountLegendWithScatterplot(data, 'family');
    await settleLegend(legend);
    const el = legend as SortLegend;

    // A bundle saved in "Your order": C, B, A.
    const swatch = { color: '#000000', shape: 'circle' };
    legend.setFileSettings({
      family: {
        ...createDefaultSettings('family'),
        sortMode: 'manual',
        categories: {
          C: { zOrder: 0, ...swatch },
          B: { zOrder: 1, ...swatch },
          A: { zOrder: 2, ...swatch },
        },
      },
    });
    await settleLegend(legend);
    expect(rows(legend)).toEqual(['C 2', 'B 3', 'A 4']);

    el._actions.applySortMode('size-desc');
    await settleLegend(legend);
    expect(rows(legend)).toEqual(['A 4', 'B 3', 'C 2']);

    // A filter keeps one A, one B and both Cs: C now has the most.
    const filtered = makeData([0, 4, 7, 8]);
    Object.assign(plot, {
      filtersActive: true,
      filteredProteinIds: filtered.protein_ids,
      getCurrentData: () => filtered,
    });
    plot.dispatchEvent(new CustomEvent('data-change', { detail: { data: filtered } }));
    await settleLegend(legend);

    expect(el._currentSortMode).toBe('size-desc');
    expect(rows(legend)).toEqual(['C 2', 'A 1', 'B 1']);
  });
});
