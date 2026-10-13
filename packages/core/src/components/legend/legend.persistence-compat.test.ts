// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLOR_SCHEMES,
  generateDatasetHash,
  type LegendPersistedSettings,
  type VisualizationData,
} from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import type { LegendDisplaySettings } from './types';
import { LEGEND_STYLES, SHAPE_PATH_GENERATORS } from './config';
import { defaultShapeSize, SHAPE_SIZE_FILLER } from './legend-helpers';
import {
  categoricalData,
  legacyLegendRecord,
  legendStorageKey,
  numericData,
  TWELVE,
} from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

const OKABE_ITO = COLOR_SCHEMES.okabeIto;
const CATEGORICAL_FIELDS = [
  'maxVisibleValues',
  'shapeSize',
  'sortMode',
  'hiddenValues',
  'categories',
  'enableDuplicateStackUI',
  'selectedPaletteId',
];

async function mount(data: VisualizationData, annotation: string): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, annotation);
  await settleLegend(legend);
  return legend;
}

const rows = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item'));
const rowValues = (legend: ProtspaceLegend) => rows(legend).map((row) => row.dataset.value!);
const hiddenRows = (legend: ProtspaceLegend) =>
  rows(legend)
    .filter((row) => row.classList.contains('hidden'))
    .map((row) => row.dataset.value!);
const symbolPath = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector(`.legend-item[data-value="${value}"] .legend-symbol path`)!;

/** Hide or show a row with Enter on its main button: one toggle, one save. */
function toggle(legend: ProtspaceLegend, value: string): void {
  legend
    .shadowRoot!.querySelector<HTMLElement>(
      `.legend-item[data-value="${value}"] .legend-item-main`,
    )!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const stored = (key: string) =>
  JSON.parse(localStorage.getItem(key) ?? 'null') as LegendPersistedSettings | null;

describe('legend settings stored before phase 3', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads a record written before phase 3 unchanged', async () => {
    const data = categoricalData(TWELVE);
    const key = legendStorageKey(generateDatasetHash(data), 'family');
    const seed = legacyLegendRecord();
    localStorage.setItem(key, JSON.stringify(seed));

    const legend = await mount(data, 'family');

    // Eight rows plus Other, in the stored zOrder (H is 0, A is 7).
    expect(rowValues(legend)).toEqual(['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'Other']);
    expect(legend.maxVisibleValues).toBe(8);
    expect(legend.getAllPersistedSettings().family.sortMode).toBe('manual-reverse');
    expect(hiddenRows(legend)).toEqual(['C']);
    for (const [rank, value] of [...'ABCDEFGH'].entries()) {
      const path = symbolPath(legend, value);
      // Okabe-Ito colours every row by its rank; B, D and F's custom colours give way to it.
      expect(path.getAttribute('fill')).toBe(OKABE_ITO[rank]);
      // Their custom shapes stay.
      expect(path.getAttribute('d')).toBe(
        SHAPE_PATH_GENERATORS[seed.categories[value].shape](LEGEND_STYLES.legendDisplaySize),
      );
    }
    // The legacy 30 reads as unset: the dataset's default applies, nothing is picked.
    const proteins = Object.values(TWELVE).reduce((sum, count) => sum + count, 0);
    expect(legend.shapeSize).toBe(defaultShapeSize(proteins));
    expect(legend.pickedShapeSize).toBeUndefined();

    toggle(legend, 'A');
    toggle(legend, 'A');
    await settleLegend(legend);

    const written = stored(key)!;
    expect(Object.keys(written).sort()).toEqual([...CATEGORICAL_FIELDS].sort());
    expect(written.maxVisibleValues).toBe(seed.maxVisibleValues);
    // 30, the old filler, is written as today's filler: both read as unset.
    expect(written.shapeSize).toBe(SHAPE_SIZE_FILLER);
    expect(written.sortMode).toBe(seed.sortMode);
    expect(written.hiddenValues).toEqual(seed.hiddenValues);
    expect(written.enableDuplicateStackUI).toBe(seed.enableDuplicateStackUI);
    expect(written.selectedPaletteId).toBe(seed.selectedPaletteId);
    // Same zOrders and shapes; every colour is the Okabe-Ito colour the row shows.
    expect(written.categories).toEqual(
      Object.fromEntries(
        [...'ABCDEFGH'].map((value, rank) => [
          value,
          { ...seed.categories[value], color: OKABE_ITO[rank] },
        ]),
      ),
    );
  });

  it('round-trips a numeric record with numericSettings; a topology mismatch drops hidden values and the manual order', async () => {
    const data = numericData(Array.from({ length: 20 }, (_, i) => i + 1));
    const key = legendStorageKey(generateDatasetHash(data), 'length');

    let legend = await mount(data, 'length');
    const bins = rowValues(legend);
    expect(bins.length).toBeGreaterThan(1);
    toggle(legend, bins[0]);
    await settleLegend(legend);
    const written = stored(key)!;
    expect(written.hiddenValues).toEqual([bins[0]]);
    expect(written.numericSettings?.signature).toEqual(expect.any(String));
    expect(written.numericSettings?.topologySignature).toEqual(expect.any(String));

    // A fresh legend reads the record into the same state and writes it back unchanged.
    document.body.innerHTML = '';
    legend = await mount(data, 'length');
    expect(rowValues(legend)).toEqual(bins);
    expect(hiddenRows(legend)).toEqual([bins[0]]);
    toggle(legend, bins[1]);
    toggle(legend, bins[1]);
    await settleLegend(legend);
    expect(stored(key)).toEqual(written);

    // A record binned another way keeps its sort mode but not its hidden bins or manual order.
    document.body.innerHTML = '';
    localStorage.setItem(
      key,
      JSON.stringify({
        ...written,
        sortMode: 'manual',
        numericSettings: {
          ...written.numericSettings,
          signature: 'stale-signature',
          topologySignature: 'stale-topology',
          manualOrderIds: [...bins].reverse(),
        },
      }),
    );
    legend = await mount(data, 'length');
    expect(hiddenRows(legend)).toEqual([]);
    expect(rowValues(legend)).toEqual(bins);
    expect(legend.getAllPersistedSettings().length.sortMode).toBe('manual');
  });

  it('writes the same key and field set', async () => {
    const categorical = categoricalData(TWELVE);
    const categoricalKey = legendStorageKey(generateDatasetHash(categorical), 'family');
    let legend = await mount(categorical, 'family');
    expect(localStorage.getItem(categoricalKey)).toBeNull();
    toggle(legend, 'A');
    await settleLegend(legend);
    expect(Object.keys(stored(categoricalKey)!).sort()).toEqual([...CATEGORICAL_FIELDS].sort());

    document.body.innerHTML = '';
    const numeric = numericData(Array.from({ length: 20 }, (_, i) => i + 1));
    const numericKey = legendStorageKey(generateDatasetHash(numeric), 'length');
    legend = await mount(numeric, 'length');
    toggle(legend, rowValues(legend)[0]);
    await settleLegend(legend);
    expect(Object.keys(stored(numericKey)!).sort()).toEqual(
      [...CATEGORICAL_FIELDS, 'numericSettings'].sort(),
    );
  });
});

describe('legend settings applied live keep the stored format (Task 3.12)', () => {
  const FIELDS = [
    'maxVisibleValues',
    'shapeSize',
    'sortMode',
    'hiddenValues',
    'categories',
    'enableDuplicateStackUI',
    'selectedPaletteId',
  ];

  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  function record(hash: string, annotation: string): Record<string, unknown> {
    return JSON.parse(localStorage.getItem(legendStorageKey(hash, annotation)) ?? 'null');
  }

  function legendKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith('protspace:legend:')) keys.push(key);
    }
    return keys;
  }

  /** What the settings popover dispatches for one edit; jsdom cannot open it, nor needs to. */
  function edit(legend: ProtspaceLegend, detail: Partial<LegendDisplaySettings>): void {
    legend
      .shadowRoot!.querySelector('protspace-legend-settings-popover')!
      .dispatchEvent(new CustomEvent('settings-change', { detail }));
  }

  function firstShownRow(legend: ProtspaceLegend): string {
    return legend
      .shadowRoot!.querySelector('.legend-item:not(.legend-item-other):not(.hidden)')!
      .getAttribute('data-value')!;
  }

  function clickRow(legend: ProtspaceLegend, value: string): void {
    legend
      .shadowRoot!.querySelector(`.legend-item[data-value="${value}"] .legend-item-main`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
  }

  async function mountWith(seed: Record<string, unknown> | null) {
    const data = categoricalData(TWELVE);
    const hash = generateDatasetHash(data);
    if (seed) localStorage.setItem(legendStorageKey(hash, 'family'), JSON.stringify(seed));
    const mounted = await mountLegendWithScatterplot(data, 'family');
    await settleLegend(mounted.legend);
    return { ...mounted, hash };
  }

  it('keeps a stored enableDuplicateStackUI: true across an unrelated save', async () => {
    const { legend, plot, hash } = await mountWith({
      ...legacyLegendRecord(),
      enableDuplicateStackUI: true,
    });
    expect((plot.config as Record<string, unknown>).enableDuplicateStackUI).toBe(true);

    const value = firstShownRow(legend);
    clickRow(legend, value);
    await settleLegend(legend);

    const saved = record(hash, 'family');
    expect(saved.hiddenValues).toContain(value);
    expect(saved.enableDuplicateStackUI).toBe(true);
    expect(
      legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!.settings
        .enableDuplicateStackUI,
    ).toBe(true);
  });

  it('a live palette change writes the same key and field set', async () => {
    const { legend, hash } = await mountWith(null);
    edit(legend, { paletteId: 'okabeIto' });
    await settleLegend(legend);

    expect(legendKeys()).toEqual([legendStorageKey(hash, 'family')]);
    const saved = record(hash, 'family');
    expect(Object.keys(saved)).toEqual(FIELDS);
    expect(saved.selectedPaletteId).toBe('okabeIto');
  });

  it('a live numeric edit writes the same field set with numericSettings', async () => {
    const data = numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const hash = generateDatasetHash(data);
    const { legend } = await mountLegendWithScatterplot(data, 'length');
    await settleLegend(legend);
    edit(legend, { numericStrategy: 'linear' });
    await settleLegend(legend);

    const saved = record(hash, 'length');
    expect(Object.keys(saved)).toEqual([...FIELDS, 'numericSettings']);
    expect((saved.numericSettings as { strategy: string }).strategy).toBe('linear');
  });

  it('a live edit keeps every field it did not touch', async () => {
    const { legend, hash } = await mountWith(legacyLegendRecord());
    // An unrelated save first, so the baseline is the record as this code writes it.
    const value = firstShownRow(legend);
    clickRow(legend, value);
    await settleLegend(legend);
    clickRow(legend, value);
    await settleLegend(legend);
    const baseline = record(hash, 'family');

    edit(legend, { enableDuplicateStackUI: true });
    await settleLegend(legend);

    expect(record(hash, 'family')).toEqual({ ...baseline, enableDuplicateStackUI: true });
  });
});
