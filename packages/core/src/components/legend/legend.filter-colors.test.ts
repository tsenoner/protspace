// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getColorSchemeStops } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';
import { LEGEND_VALUES } from './config';
import { createDefaultSettings } from './legend-helpers';

vi.stubGlobal('localStorage', createLocalStorageMock());

/** UniProt's protein existence levels, most common first, as in the user's report. */
const PROTEIN_EXISTENCE: Readonly<Record<string, number>> = Object.freeze({
  '1: Evidence at protein level': 20,
  '2: Evidence at transcript level': 15,
  '3: Inferred from homology': 10,
  '4: Predicted': 6,
  '5: Uncertain': 3,
});
const LEVELS = Object.keys(PROTEIN_EXISTENCE);
const [LEVEL_1] = LEVELS;

/** Each row's colour, Other left out. */
const colors = (legend: ProtspaceLegend) =>
  Object.fromEntries(
    legend._legendItems
      .filter((item) => item.value !== LEGEND_VALUES.OTHER)
      .map((item) => [item.value, item.color]),
  );

/**
 * A legend over `counts`, with the plot's query filter driven from the test: `filter(values)`
 * keeps the proteins of those categories, `filter(null)` removes the filter. The legend reads a
 * filter as a constrained view, from `filtersActive` and `filteredProteinIds`.
 */
async function filterableSetup(counts: Readonly<Record<string, number>>, annotation: string) {
  const data = categoricalData(counts, annotation);
  const { legend, plot } = await mountLegendWithScatterplot(data, annotation);
  await settleLegend(legend);

  const keys = Object.keys(counts);
  const idsOf = (value: string) => {
    const start = keys.slice(0, keys.indexOf(value)).reduce((sum, key) => sum + counts[key], 0);
    return data.protein_ids.slice(start, start + counts[value]);
  };
  const filter = async (values: string[] | null) => {
    plot.filtersActive = values !== null;
    plot.filteredProteinIds = values ? values.flatMap(idsOf) : [];
    plot.dispatchEvent(new CustomEvent('data-change', { detail: { data } }));
    await settleLegend(legend);
  };
  return { legend, filter };
}

const stored = (legend: ProtspaceLegend, annotation: string) =>
  legend.getAllPersistedSettings()[annotation]?.categories ?? {};

describe('a category keeps its colour through filters', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('"is 1", then "is none of 1", then no filter: every level ends in its original colour', async () => {
    const { legend, filter } = await filterableSetup(PROTEIN_EXISTENCE, 'protein_existence');
    const original = colors(legend);
    expect(Object.keys(original)).toEqual(LEVELS);
    expect(new Set(Object.values(original)).size).toBe(LEVELS.length);

    await filter([LEVEL_1]);
    expect(colors(legend)).toEqual({ [LEVEL_1]: original[LEVEL_1] });

    await filter(LEVELS.slice(1));
    const { [LEVEL_1]: _hidden, ...rest } = original;
    expect(colors(legend)).toEqual(rest);

    await filter(null);
    expect(colors(legend)).toEqual(original);
  });

  it('keeps the colours with a non-default palette, which colours by slot', async () => {
    const { legend, filter } = await filterableSetup(PROTEIN_EXISTENCE, 'protein_existence');
    legend._settings.apply({ paletteId: 'okabeIto' });
    await settleLegend(legend);
    const okabeIto = getColorSchemeStops('okabeIto');
    const original = colors(legend);
    expect(Object.values(original)).toEqual(okabeIto.slice(0, LEVELS.length));

    await filter([LEVEL_1]);
    expect(colors(legend)).toEqual({ [LEVEL_1]: original[LEVEL_1] });
    await filter(LEVELS.slice(1));
    await filter(null);

    expect(colors(legend)).toEqual(original);
  });

  it('does not recolour the rows when the sort changes under a non-default palette', async () => {
    const { legend } = await filterableSetup(PROTEIN_EXISTENCE, 'protein_existence');
    legend._settings.apply({ paletteId: 'okabeIto' });
    await settleLegend(legend);
    const original = colors(legend);

    legend._actions.applySortMode('size-asc');
    await settleLegend(legend);

    expect(colors(legend)).toEqual(original);
  });

  it('a palette picked while filtered recolours the hidden levels by their slot too', async () => {
    const { legend, filter } = await filterableSetup(PROTEIN_EXISTENCE, 'protein_existence');
    await filter(LEVELS.slice(1));

    legend._settings.apply({ paletteId: 'okabeIto' });
    await settleLegend(legend);
    await filter(null);

    expect(Object.values(colors(legend))).toEqual(
      getColorSchemeStops('okabeIto').slice(0, LEVELS.length),
    );
  });

  it('a save while filtered keeps the stored colour and place of the levels the filter hid', async () => {
    const { legend, filter } = await filterableSetup(PROTEIN_EXISTENCE, 'protein_existence');
    legend._actions.applySortMode('manual');
    await settleLegend(legend);
    const original = colors(legend);
    const order = Object.entries(stored(legend, 'protein_existence'))
      .sort(([, a], [, b]) => a.zOrder - b.zOrder)
      .map(([value]) => value);
    expect(order).toEqual(LEVELS);

    await filter(LEVELS.slice(1));
    // Hiding a level saves the record while the filter hides level 1.
    legend._actions.toggle(LEVELS[2]);
    await settleLegend(legend);

    const record = stored(legend, 'protein_existence');
    expect(record[LEVEL_1]?.color).toBe(original[LEVEL_1]);
    expect(
      Object.entries(record)
        .sort(([, a], [, b]) => a.zOrder - b.zOrder)
        .map(([value]) => value),
    ).toEqual(LEVELS);

    await filter(null);
    expect(colors(legend)).toEqual(original);
    expect(legend.getLegendExportData().items.map((item) => item.value)).toEqual(LEVELS);
  });

  it('a colour picked while filtered is stored without dropping the hidden levels', async () => {
    const { legend, filter } = await filterableSetup(PROTEIN_EXISTENCE, 'protein_existence');
    const original = colors(legend);
    await filter([LEVEL_1]);

    legend._settings.commitColor(LEVEL_1, '#123456');
    await settleLegend(legend);
    await filter(null);

    expect(colors(legend)).toEqual({ ...original, [LEVEL_1]: '#123456' });
    expect(stored(legend, 'protein_existence')[LEVELS[4]]?.color).toBe(original[LEVELS[4]]);
  });

  it('a category taken out of Other while filtered keeps its colour after the filter goes', async () => {
    const { legend, filter } = await filterableSetup(TWELVE, 'family');
    legend.maxVisibleValues = 5;
    await settleLegend(legend);
    const original = colors(legend);
    expect(Object.keys(original)).toEqual(['A', 'B', 'C', 'D', 'E']);

    await filter(['B', 'K']);
    legend._actions.extractFromOther('K');
    await settleLegend(legend);
    const k = colors(legend).K;
    expect(Object.values(original)).not.toContain(k);

    await filter(null);
    expect(colors(legend)).toEqual({ ...original, K: k });
  });

  it('a row merged into Other while unfiltered frees its colour for the next category taken out', async () => {
    const { legend } = await filterableSetup(TWELVE, 'family');
    legend.maxVisibleValues = 5;
    await settleLegend(legend);
    const original = colors(legend);

    legend._actions.mergeToOther('B');
    await settleLegend(legend);
    legend._actions.extractFromOther('K');
    await settleLegend(legend);

    expect(colors(legend).K).toBe(original.B);
  });
});

describe("a bundle's stored colours", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a category the bundle does not colour takes a colour no stored category holds', async () => {
    const { legend } = await filterableSetup(TWELVE, 'family');
    const defaults = colors(legend);

    // A bundle styled for A alone, in the colour B had before it was opened (as `protspace style`
    // writes one): B, coloured by nothing stored, must not keep that colour from the default build.
    legend.setFileSettings({
      family: {
        ...createDefaultSettings('family'),
        categories: { A: { zOrder: 0, color: defaults.B, shape: 'circle' } },
      },
    });
    await settleLegend(legend);

    const shown = colors(legend);
    expect(shown.A).toBe(defaults.B);
    expect(new Set(Object.values(shown)).size).toBe(Object.keys(shown).length);
  });
});
