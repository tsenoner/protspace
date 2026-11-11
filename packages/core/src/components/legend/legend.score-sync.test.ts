// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectionStatisticRow, VisualizationData } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import type { ScoreStripPoint } from './category-score-strip';
import {
  mountLegendWithScatterplot,
  stubLocalStorage,
} from './test-support/legend-scatterplot-harness';

// Saved sort modes and z-orders leak between tests whose fixtures hash the same; the store is
// cleared before each test below.
stubLocalStorage();

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
  beforeEach(() => {
    // The dot-click test persists a hidden category under makeData()'s hash.
    localStorage.clear();
  });

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

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await legend.updateComplete;

    const strip = legend.shadowRoot!.querySelector('protspace-score-strip') as StripElement;
    expect(strip.highlighted).toBe('Viperidae');
  });

  it('clears the mark on pointer leave', async () => {
    const legend = await setup(makeData());
    const row = legend.shadowRoot!.querySelector('[data-value="Viperidae"]')!;

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await legend.updateComplete;
    // Confirm the mark actually appeared, so this test cannot pass merely because
    // hovering never marked anything in the first place.
    expect(legend.shadowRoot!.querySelectorAll('.legend-item-score-hover')).toHaveLength(1);

    row.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
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
    // ItemActionsController.toggle sets _legendItems; _sortedLegendItems (what the template
    // renders) only re-derives from it in the *next* updated() cycle, so this needs two chained
    // awaits, same as ItemActionsController.highlightDropped.
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

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await legend.updateComplete;

    expect(legend.shadowRoot!.querySelectorAll('.legend-item-score-hover')).toHaveLength(0);
  });
});

describe('legend score hover focuses the plot', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mountWithSpy(data: VisualizationData = makeData()) {
    const focusCategories = vi.fn();
    const { legend } = await mountLegendWithScatterplot(data, 'major_group', { focusCategories });
    return { legend, focusCategories };
  }

  const hoverStrip = (legend: ProtspaceLegend, category: string | null) =>
    legend
      .shadowRoot!.querySelector('protspace-score-strip')!
      .dispatchEvent(
        new CustomEvent('strip-hover', { detail: { category }, bubbles: true, composed: true }),
      );
  const row = (legend: ProtspaceLegend, value: string) =>
    legend.shadowRoot!.querySelector(`[data-value="${value}"]`)!;

  it('a strip dot focuses its category in the plot, and leaving it ends the focus', async () => {
    const { legend, focusCategories } = await mountWithSpy();
    hoverStrip(legend, 'Elapidae');
    hoverStrip(legend, null);
    expect(focusCategories.mock.calls).toEqual([[['Elapidae'], 'strip'], [null]]);
  });

  it('a tapped strip dot marks its row but leaves the plot alone', async () => {
    const { legend, focusCategories } = await mountWithSpy();
    legend.shadowRoot!.querySelector('protspace-score-strip')!.dispatchEvent(
      new CustomEvent('strip-hover', {
        detail: { category: 'Elapidae', touch: true },
        bubbles: true,
        composed: true,
      }),
    );
    await legend.updateComplete;
    expect(legend.shadowRoot!.querySelector('.legend-item-score-hover')).not.toBeNull();
    expect(focusCategories).not.toHaveBeenCalled();
  });

  it('a strip dot under Other focuses only its own category', async () => {
    const { legend, focusCategories } = await mountWithSpy(
      makeData([statRow({ category: 'NotInTheLegend', value: 0.4 })]),
    );
    hoverStrip(legend, 'NotInTheLegend');
    expect(focusCategories).toHaveBeenLastCalledWith(['NotInTheLegend'], 'strip');
  });

  it('a scored row reports its category as a row, which the plot focuses only with Shift', async () => {
    const { legend, focusCategories } = await mountWithSpy();
    const viperidae = row(legend, 'Viperidae');
    viperidae.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(focusCategories).toHaveBeenLastCalledWith(['Viperidae'], 'row');
    viperidae.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(focusCategories).toHaveBeenLastCalledWith(null);
    row(legend, 'Elapidae').dispatchEvent(
      new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    );
    expect(focusCategories).toHaveBeenLastCalledWith(['Elapidae'], 'row');
  });

  it('the legend leaves Shift to the plot: it listens for no key', async () => {
    const { focusCategories } = await mountWithSpy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(focusCategories).not.toHaveBeenCalled();
  });

  it('a row of an annotation without scores reports its category too, for Shift', async () => {
    const { legend, focusCategories } = await mountWithSpy({ ...makeData(), statisticsRows: [] });
    row(legend, 'Viperidae').dispatchEvent(
      new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    );
    expect(focusCategories).toHaveBeenLastCalledWith(['Viperidae'], 'row');
  });

  it('a pointer resting on one row reports it once', async () => {
    const { legend, focusCategories } = await mountWithSpy();
    const viperidae = row(legend, 'Viperidae');
    viperidae.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    viperidae.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(focusCategories).toHaveBeenCalledOnce();
  });

  it('removing the legend mid-hover ends the focus', async () => {
    const { legend, focusCategories } = await mountWithSpy();
    hoverStrip(legend, 'Elapidae');
    legend.remove();
    expect(focusCategories).toHaveBeenLastCalledWith(null);
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

  it("renders a scored row's category count", async () => {
    const el = await setup(makeData());

    const row = el.shadowRoot!.querySelector('[data-value="Elapidae"]')!;
    expect(row.querySelector('.legend-count')!.textContent!.trim()).toBe('2');
  });

  it('keeps the rows in the order the plot draws, not by separation', async () => {
    // Viperidae outnumbers Elapidae here, though Elapidae separates better (0.81 vs -0.15):
    // the scores never reorder the list, which is also the plot's draw order.
    const el = await setup({
      ...makeData(),
      annotation_data: { major_group: new Int32Array([0, 1, 1, 1]) },
    });
    const rowOrder = () =>
      [...el.shadowRoot!.querySelectorAll('[data-value]')].map((row) =>
        row.getAttribute('data-value'),
      );
    expect(rowOrder()).toEqual(['Viperidae', 'Elapidae']);
    expect(el._sortedLegendItems.map((item) => item.zOrder)).toEqual([0, 1]);
  });
});
