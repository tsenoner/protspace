// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

describe('legend state that Reset and a new dataset leave', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('offers no Reset for a numeric annotation whose stored record only names its bins', async () => {
    const values = Array.from({ length: 40 }, (_, i) => (i % 9 === 0 ? null : i));
    const { legend } = await mountLegendWithScatterplot(numericData(values), 'length');
    await settleLegend(legend);
    expect(legend._settings.canReset()).toBe(false);

    // Hide and show a bin: each saves the record, the bins' order as shown included.
    const bin = legend._sortedLegendItems[0].value;
    legend._actions.toggle(bin);
    legend._actions.toggle(bin);
    await settleLegend(legend);
    // The stored record read back, as switching away and back does.
    legend._persistenceController.loadSettings();
    await settleLegend(legend);

    expect(legend._numericManualOrderIdsByAnnotation.length?.length ?? 0).toBeGreaterThan(0);
    expect(legend._settings.canReset()).toBe(false);
  });

  it('drops the previous dataset’s scores, caveat and focus on clearForNewDataset', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    await settleLegend(legend);
    legend._categoryScores = [
      { category: 'A', silhouette: 0.5, silhouetteEmbedding: null, daviesBouldin: null },
    ];
    legend._clusterCaveat = 'optimistic';
    legend._eatOff = true;
    await settleLegend(legend);

    legend.clearForNewDataset('next-dataset');
    await settleLegend(legend);

    expect(legend._categoryScores).toEqual([]);
    expect(legend._clusterCaveat).toBeNull();
    expect(legend._eatOff).toBe(false);
    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).toBeNull();
  });
});
