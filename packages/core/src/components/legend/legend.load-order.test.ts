// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProteinAnnotationIndices, type VisualizationData } from '@protspace/utils';
import type { ProtspaceLegend } from './legend';
import type { OtherItem } from './types';
import { getVisualEncoding } from './visual-encoding';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

// Twelve families of two proteins each, two more than get a row. Storage lists them A to L
// and the proteins meet them L to A, so the order of the tie picks the rows.
const FAMILIES = [...'ABCDEFGHIJKL'];

function makeData(): VisualizationData {
  const met = FAMILIES.map((_, code) => code).reverse();
  const codes = Int32Array.from([...met, ...met]);
  return {
    protein_ids: Array.from(codes, (_, i) => `p${i}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(codes.length * 2) }],
    annotations: {
      family: {
        kind: 'categorical',
        values: FAMILIES,
        colors: FAMILIES.map(() => '#000000'),
        shapes: FAMILIES.map(() => 'circle'),
      },
    },
    annotation_data: { family: codes },
  };
}

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

/**
 * A dataset load as `data-renderer.ts` runs it: auto-sync off while the plot takes the data,
 * then back on and a forced sync. `feed` also hands the legend the per-protein
 * `annotationValues`, the list the app built for that window.
 */
async function load(feed: boolean) {
  const data = makeData();
  const { legend, plot } = await mountLegendWithScatterplot(data, 'family');
  await settle(legend);

  legend.clearForNewDataset('dataset');
  legend.autoSync = false;
  plot.dispatchEvent(new CustomEvent('data-change', { detail: { data } }));
  if (feed) {
    const rows = data.annotation_data.family;
    legend.annotationValues = data.protein_ids.flatMap((_, i) =>
      getProteinAnnotationIndices(rows, i).map((code) => data.annotations.family.values[code]),
    );
  }
  await settle(legend);
  legend.autoSync = true;
  legend.forceSync();
  await settle(legend);

  return {
    items: legend.getLegendExportData().items,
    other: (legend as unknown as { _otherItems: OtherItem[] })._otherItems.map((o) => o.value),
  };
}

describe('legend after a dataset load', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('counts the synced storage in protein order while auto-sync is off', async () => {
    const counted = await load(false);
    document.body.innerHTML = '';
    localStorage.clear();
    const fed = await load(true);

    expect(counted).toEqual(fed);
    // The proteins meet L to C first, so those get the rows and the colours in that order;
    // the sync then orders the tie as storage lists it.
    const slot = (value: string) => FAMILIES.length - 1 - FAMILIES.indexOf(value);
    expect(counted.items.map(({ value, color }) => [value, color])).toEqual([
      ...FAMILIES.slice(2).map((value) => [value, getVisualEncoding(slot(value), value).color]),
      ['Other', getVisualEncoding(-1, 'Other').color],
    ]);
    expect(counted.other).toEqual(['A', 'B']);
  });
});
