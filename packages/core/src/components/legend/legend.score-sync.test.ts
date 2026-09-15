// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import type { ProjectionStatisticRow, VisualizationData } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import type { ScoreStripPoint } from './category-score-strip';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

// The persistence controller keys real `localStorage` by a hash of the dataset, and every test
// here shares one jsdom environment, so saved sort modes and z-orders leak between tests whose
// fixtures hash the same. Stub an in-memory store rather than using the runtime's: it scopes that
// state to this file, and Node does not hand jsdom a usable `localStorage` without
// `--localstorage-file`, which made the `clear()` calls below throw outright. Same shape as the
// mock in `packages/utils/src/storage/storage-service.test.ts`.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

const STAT_BASE = {
  space_kind: 'projection' as const,
  space_name: 'UMAP 2',
  annotation: 'major_group',
  stat_family: 'annotation_validity' as const,
  label_kind: 'annotation',
  metric: 'silhouette',
  metric_kind: 'validity' as const,
};

const statRow = (over: Partial<ProjectionStatisticRow>): ProjectionStatisticRow => ({
  ...STAT_BASE,
  value: 0,
  ...over,
});

function makeData(extraRows: ProjectionStatisticRow[] = []): VisualizationData {
  return {
    protein_ids: ['p1', 'p2', 'p3', 'p4'],
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(8) }],
    annotations: {
      major_group: {
        kind: 'categorical',
        values: ['Elapidae', 'Viperidae'],
        colors: ['#ff0000', '#00ff00'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: {
      major_group: new Int32Array([0, 0, 1, 1]),
    },
    statisticsRows: [
      statRow({ category: 'Elapidae', value: 0.81 }),
      statRow({ category: 'Viperidae', value: -0.15 }),
      ...extraRows,
    ],
  };
}

type StripElement = HTMLElement & {
  highlighted: string | null;
  points: ScoreStripPoint[];
};

async function setup(data: VisualizationData): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, 'major_group');
  return legend;
}

describe('legend score strip synchronisation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks the legend row when a dot is hovered', async () => {
    const legend = await setup(makeData());
    const strip = legend.shadowRoot!.querySelector('protspace-score-strip')!;

    strip.dispatchEvent(
      new CustomEvent('strip-hover', {
        detail: { category: 'Elapidae' },
        bubbles: true,
        composed: true,
      }),
    );
    await legend.updateComplete;

    const marked = legend.shadowRoot!.querySelectorAll('.legend-item-score-hover');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-value')).toBe('Elapidae');
  });

  it('marks the dot when a legend row is hovered', async () => {
    const legend = await setup(makeData());
    const row = legend.shadowRoot!.querySelector('[data-value="Viperidae"]')!;

    row.dispatchEvent(new Event('mouseenter', { bubbles: false }));
    await legend.updateComplete;

    const strip = legend.shadowRoot!.querySelector('protspace-score-strip') as StripElement;
    expect(strip.highlighted).toBe('Viperidae');
  });

  it('clears the mark on pointer leave', async () => {
    const legend = await setup(makeData());
    const row = legend.shadowRoot!.querySelector('[data-value="Viperidae"]')!;

    row.dispatchEvent(new Event('mouseenter', { bubbles: false }));
    await legend.updateComplete;
    // Confirm the mark actually appeared, so this test cannot pass merely because
    // hovering never marked anything in the first place.
    expect(legend.shadowRoot!.querySelectorAll('.legend-item-score-hover')).toHaveLength(1);

    row.dispatchEvent(new Event('mouseleave', { bubbles: false }));
    await legend.updateComplete;

    expect(legend.shadowRoot!.querySelectorAll('.legend-item-score-hover')).toHaveLength(0);
  });

  it('still plots a category that has no legend row, in grey', async () => {
    // Scores are computed over the whole dataset, so a category swept into the
    // "Other" bucket must keep its dot or the distribution would be misstated.
    const legend = await setup(makeData([statRow({ category: 'NotInTheLegend', value: 0.4 })]));

    const strip = legend.shadowRoot!.querySelector('protspace-score-strip') as StripElement;
    expect(strip.points.find((point) => point.category === 'NotInTheLegend')?.color).toBe('#888');
  });

  it('toggles the category on a dot click, exactly like clicking its legend row', async () => {
    const legend = await setup(makeData());
    const strip = legend.shadowRoot!.querySelector('protspace-score-strip')!;
    expect(
      legend.shadowRoot!.querySelector('[data-value="Elapidae"]')!.classList.contains('hidden'),
    ).toBe(false);

    strip.dispatchEvent(
      new CustomEvent('strip-click', {
        detail: { category: 'Elapidae' },
        bubbles: true,
        composed: true,
      }),
    );
    // _handleItemClick sets _legendItems; _sortedLegendItems (what the template renders)
    // only re-derives from it in the *next* updated() cycle, so this needs two chained
    // awaits, same as the existing _highlightDroppedItem (legend.ts).
    await legend.updateComplete;
    await legend.updateComplete;

    expect(
      legend.shadowRoot!.querySelector('[data-value="Elapidae"]')!.classList.contains('hidden'),
    ).toBe(true);
  });

  it('is inert on click for a dot with no legend row (the "Other" bucket)', async () => {
    const legend = await setup(makeData([statRow({ category: 'NotInTheLegend', value: 0.4 })]));
    const strip = legend.shadowRoot!.querySelector('protspace-score-strip')!;
    const onItemClick = vi.fn();
    legend.addEventListener('legend-item-click', onItemClick);

    strip.dispatchEvent(
      new CustomEvent('strip-click', {
        detail: { category: 'NotInTheLegend' },
        bubbles: true,
        composed: true,
      }),
    );
    await legend.updateComplete;

    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('does not mark any row on hover when the dataset has no statistics', async () => {
    const legend = await setup({ ...makeData(), statisticsRows: [] });
    // No scores means no strips at all: this is the precondition the guard depends on.
    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).toBeNull();
    const row = legend.shadowRoot!.querySelector('[data-value="Viperidae"]')!;

    row.dispatchEvent(new Event('mouseenter', { bubbles: false }));
    await legend.updateComplete;

    expect(legend.shadowRoot!.querySelectorAll('.legend-item-score-hover')).toHaveLength(0);
  });
});

describe('legend score column', () => {
  beforeEach(() => {
    // The persistence controller reads/writes real localStorage keyed by a hash of
    // the dataset, and every test in this file shares one jsdom environment. Without
    // this, an earlier test's saved sort mode or z-order leaks into these tests
    // whenever the fixture hashes the same as theirs (plain makeData() does).
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps a scored row down to its label and count', async () => {
    // The per-row number is gone: the strips' value gutters read out the hovered
    // category on every metric at once, so repeating silhouette alone on each row was
    // a second, narrower answer to the same question. A row is its label and count.
    const el = await setup(makeData());

    const row = el.shadowRoot!.querySelector('[data-value="Elapidae"]')!;
    expect(row.querySelector('.legend-count')!.textContent!.trim()).toBe('2');
    // Elapidae's silhouette in this fixture, which used to render as "0.81".
    expect(row.textContent).not.toContain('0.81');
  });

  it('sorts rows best-separating-first when the sort mode is silhouette-desc', async () => {
    // Viperidae outnumbers Elapidae here, so every mode but silhouette-desc puts it
    // first: silhouette-desc has no upstream zOrder of its own and falls back to the
    // size-desc default (see legend-data-processor.ts), even though Elapidae is the
    // better-separated category (0.81 vs -0.15).
    const el = await setup({
      ...makeData(),
      annotation_data: { major_group: new Int32Array([0, 1, 1, 1]) },
    });
    const rowOrder = () =>
      [...el.shadowRoot!.querySelectorAll('[data-value]')].map((row) =>
        row.getAttribute('data-value'),
      );
    // Confirms the fixture actually starts in the "wrong" order, so the assertion
    // below cannot pass by coincidence.
    expect(rowOrder().indexOf('Viperidae')).toBeLessThan(rowOrder().indexOf('Elapidae'));

    const internals = el as unknown as {
      _dialogSettings: { annotationSortModes: Record<string, string> } & Record<string, unknown>;
      _handleSettingsSave: () => void;
    };
    internals._dialogSettings = {
      ...internals._dialogSettings,
      annotationSortModes: { major_group: 'silhouette-desc' },
    };
    internals._handleSettingsSave();
    // Same two-cycle wait as the click-toggle test above: _handleSettingsSave sets
    // _legendItems; _sortedLegendItems only re-derives from it in the next updated().
    await el.updateComplete;
    await el.updateComplete;

    expect(rowOrder().indexOf('Elapidae')).toBeLessThan(rowOrder().indexOf('Viperidae'));
  });
});

describe('legend settings dialog: sort by separation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function renderDialog(el: ProtspaceLegend): HTMLDivElement {
    const internals = el as unknown as {
      _showSettingsDialog: boolean;
      _renderSettingsDialog: () => unknown;
    };
    internals._showSettingsDialog = true;
    const container = document.createElement('div');
    render(internals._renderSettingsDialog(), container);
    return container;
  }

  function radioLabels(container: HTMLDivElement): (string | undefined)[] {
    return [...container.querySelectorAll('label')].map((label) => label.textContent?.trim());
  }

  it('offers "By separation" sorting when the annotation has per-category scores', async () => {
    const el = await setup(makeData());

    expect(radioLabels(renderDialog(el))).toContain('By separation');
  });

  it('omits "By separation" sorting when the dataset has no statistics', async () => {
    const el = await setup({ ...makeData(), statisticsRows: [] });

    const labels = radioLabels(renderDialog(el));
    // Proves the dialog actually rendered its other options (not an empty template
    // that would vacuously satisfy the assertion below).
    expect(labels).toContain('By category size');
    expect(labels).not.toContain('By separation');
  });
});
