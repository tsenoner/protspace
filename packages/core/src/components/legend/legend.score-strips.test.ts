// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectionStatisticRow, VisualizationData } from '@protspace/utils';
import { metricDisplay } from '@protspace/utils';
import './legend';
import type { ScoreStripPoint } from './category-score-strip';
import { LEGEND_EVENTS } from './config';
import {
  mountLegendWithScatterplot,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';

// Read from the same registry the strips label themselves from, rather than
// restating the spelling here -- that duplication is what let the strips drift
// from the metadata panel in the first place.
const SILHOUETTE_LABEL = metricDisplay('silhouette').label;
const DAVIES_BOULDIN_LABEL = metricDisplay('davies_bouldin').label;

const STAT_BASE = {
  annotation: 'family',
  stat_family: 'annotation_validity' as const,
  label_kind: 'annotation',
  metric_kind: 'validity' as const,
};

function makeData(): VisualizationData {
  return {
    protein_ids: ['p1', 'p2'],
    projections: [
      { name: 'UMAP 2', dimension: 2, data: new Float32Array(4) },
      { name: 'PCA 2', dimension: 2, data: new Float32Array(4) },
    ],
    annotations: {
      family: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#ff0000', '#00ff00'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: {
      family: new Int32Array([0, 1]),
    },
    statisticsRows: [
      // UMAP 2: category A's silhouette is 0.5.
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'UMAP 2',
        metric: 'silhouette',
        category: 'A',
        value: 0.5,
      },
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'UMAP 2',
        metric: 'silhouette',
        category: 'B',
        value: 0.2,
      },
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'UMAP 2',
        metric: 'davies_bouldin',
        category: 'A',
        value: 1.2,
      },
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'UMAP 2',
        metric: 'davies_bouldin',
        category: 'B',
        value: 0.9,
      },
      // PCA 2: the same category A scores completely differently (-0.3, not 0.5).
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'PCA 2',
        metric: 'silhouette',
        category: 'A',
        value: -0.3,
      },
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'PCA 2',
        metric: 'silhouette',
        category: 'B',
        value: -0.1,
      },
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'PCA 2',
        metric: 'davies_bouldin',
        category: 'A',
        value: 2.0,
      },
      {
        ...STAT_BASE,
        space_kind: 'projection',
        space_name: 'PCA 2',
        metric: 'davies_bouldin',
        category: 'B',
        value: 1.5,
      },
      // Source embedding: only A has a silhouette ceiling; B has none.
      {
        ...STAT_BASE,
        space_kind: 'embedding',
        space_name: 'prot_t5',
        metric: 'silhouette',
        category: 'A',
        value: 0.42,
      },
    ] satisfies ProjectionStatisticRow[],
  };
}

type StripElement = HTMLElement & {
  label: string;
  higherIsBetter: boolean;
  points: ScoreStripPoint[];
};

async function setup(
  overrides: { data?: Partial<VisualizationData>; plot?: Partial<MockScatterplot> } = {},
) {
  const data = { ...makeData(), ...overrides.data };
  const mounted = await mountLegendWithScatterplot(data, 'family', overrides.plot);
  return { data, ...mounted };
}

describe('legend score strips', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('re-syncs the strips to the new projection when the control bar reports a projection change', async () => {
    const { legend, plot, controlBar } = await setup();

    const before = legend.shadowRoot!.querySelector('protspace-score-strip') as StripElement;
    expect(before.points.find((point) => point.category === 'A')?.value).toBe(0.5);

    // Mirrors what protspace-control-bar's applyProjectionSelection does in production:
    // it sets the scatterplot's index directly, then dispatches projection-change.
    plot.selectedProjectionIndex = 1;
    controlBar.dispatchEvent(
      new CustomEvent('projection-change', {
        detail: { projection: 'PCA 2' },
        bubbles: true,
        composed: true,
      }),
    );
    await legend.updateComplete;

    const after = legend.shadowRoot!.querySelector('protspace-score-strip') as StripElement;
    expect(after.points.find((point) => point.category === 'A')?.value).toBe(-0.3);
  });

  it('passes higherIsBetter=false to the Davies-Bouldin strip and true to the Silhouette strip', async () => {
    const { legend } = await setup();

    const strips = Array.from(
      legend.shadowRoot!.querySelectorAll('protspace-score-strip'),
    ) as StripElement[];
    const silhouette = strips.find((strip) => strip.label === SILHOUETTE_LABEL)!;
    const daviesBouldin = strips.find((strip) => strip.label === DAVIES_BOULDIN_LABEL)!;

    expect(silhouette.higherIsBetter).toBe(true);
    expect(daviesBouldin.higherIsBetter).toBe(false);
  });

  it('wires the embedding ceiling into the silhouette strip only, from silhouetteEmbedding', async () => {
    // Davies-Bouldin has no embedding-space counterpart on CategoryScore, so only the
    // silhouette strip's dots may carry a ceiling for the tooltip.
    const { legend } = await setup();

    const strips = Array.from(
      legend.shadowRoot!.querySelectorAll('protspace-score-strip'),
    ) as StripElement[];
    const silhouette = strips.find((strip) => strip.label === SILHOUETTE_LABEL)!;
    const daviesBouldin = strips.find((strip) => strip.label === DAVIES_BOULDIN_LABEL)!;

    expect(silhouette.points.find((point) => point.category === 'A')?.ceiling).toBe(0.42);
    expect(silhouette.points.find((point) => point.category === 'B')?.ceiling).toBeNull();
    expect(daviesBouldin.points.every((point) => point.ceiling == null)).toBe(true);
  });

  it('re-sorts by separation after a projection switch, not just a data resync', async () => {
    // _sortedLegendItems is only re-derived in updated() when _legendItems or
    // _categoryScores changes. A projection switch changes only the scores (same
    // two categories stay visible), so this is the one path that exercises the
    // `|| changedProperties.has('_categoryScores')` half of that guard. Silhouette
    // ranks A above B on UMAP 2 and B above A on PCA 2 (see makeData), so a stale
    // sort would still show the UMAP 2 order after switching.
    const { legend, plot, controlBar } = await setup();

    const internals = legend as unknown as {
      _dialogSettings: { annotationSortModes: Record<string, string> } & Record<string, unknown>;
      _handleSettingsSave: () => void;
    };
    internals._dialogSettings = {
      ...internals._dialogSettings,
      annotationSortModes: { family: 'silhouette-desc' },
    };
    internals._handleSettingsSave();
    // Same two-cycle wait legend.score-sync.test.ts documents: _handleSettingsSave
    // sets _legendItems; _sortedLegendItems only re-derives from it in the next
    // updated().
    await legend.updateComplete;
    await legend.updateComplete;

    const rowOrder = () =>
      [...legend.shadowRoot!.querySelectorAll('[data-value]')].map((row) =>
        row.getAttribute('data-value'),
      );
    // UMAP 2: A (0.5) outranks B (0.2).
    expect(rowOrder().indexOf('A')).toBeLessThan(rowOrder().indexOf('B'));

    plot.selectedProjectionIndex = 1;
    controlBar.dispatchEvent(
      new CustomEvent('projection-change', {
        detail: { projection: 'PCA 2' },
        bubbles: true,
        composed: true,
      }),
    );
    // Same two-cycle wait as above: _categoryScores changes in the first cycle,
    // and updated() only re-derives _sortedLegendItems from it in the next one.
    await legend.updateComplete;
    await legend.updateComplete;

    // PCA 2: B (-0.1) outranks A (-0.3) -- the ranking must invert, not stay stale.
    expect(rowOrder().indexOf('B')).toBeLessThan(rowOrder().indexOf('A'));
  });

  it('fills both strips’ value gutters when a legend row is hovered', async () => {
    // The whole point of the gutter: hovering one row reads out that category on
    // every metric at once, so silhouette and Davies-Bouldin are read together
    // rather than one number at a time from separate dot tooltips.
    const { legend } = await setup();

    const gutters = () =>
      (Array.from(legend.shadowRoot!.querySelectorAll('protspace-score-strip')) as StripElement[])
        .map((strip) => strip.shadowRoot!.querySelector('.strip-value')!.textContent!.trim())
        .join(' / ');

    expect(gutters()).toBe('— / —');

    const rowA = legend.shadowRoot!.querySelector('[data-value="A"]')!;
    rowA.dispatchEvent(new Event('mouseenter'));
    await legend.updateComplete;
    // Category A on UMAP 2: silhouette 0.5, Davies-Bouldin 1.2 (see makeData).
    expect(gutters()).toBe('0.50 / 1.20');

    rowA.dispatchEvent(new Event('mouseleave'));
    await legend.updateComplete;
    expect(gutters()).toBe('— / —');
  });

  it('caveats the strips for an auto-clustering, and only for one', async () => {
    // A clustering is scored on the labels it drew itself, in the projection it drew
    // them in, so its strips read high by construction and must say so. An ordinary
    // annotation must not carry the same note.
    const plain = await setup();
    expect(plain.legend.shadowRoot!.querySelector('.score-strips-caveat')).toBeNull();
    document.body.innerHTML = '';

    const data = makeData();
    const cluster = await setup({
      data: {
        annotations: { 'cluster_elbow_UMAP 2': data.annotations.family },
        annotation_data: { 'cluster_elbow_UMAP 2': data.annotation_data!.family },
        statisticsRows: [
          ...data.statisticsRows!.map((r) => ({ ...r, annotation: 'cluster_elbow_UMAP 2' })),
          {
            space_kind: 'projection' as const,
            space_name: 'UMAP 2',
            annotation: '',
            stat_family: 'cluster_validity' as const,
            label_kind: 'kmeans_elbow',
            metric: 'n_clusters',
            metric_kind: 'meta' as const,
            value: 2,
          },
        ],
      },
      plot: { selectedAnnotation: 'cluster_elbow_UMAP 2' },
    });

    expect(cluster.legend.shadowRoot!.querySelector('protspace-score-strip')).not.toBeNull();
    expect(cluster.legend.shadowRoot!.querySelector('.score-strips-caveat')?.textContent).toContain(
      'optimistic',
    );
  });

  it('shows a note instead of the strips when filtering hides previously-visible scores', async () => {
    const { legend, plot, data } = await setup();
    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).not.toBeNull();

    // Mirrors what scatter-plot.ts's filtered-display path does: the payload's
    // statisticsRows is cleared (sliceVisualizationDataByIndices) and filtersActive flips
    // on, while the element's own unsliced `data` keeps its rows. The legend reads the
    // scores from the latter and decides to hide them from the former, so this asserts the
    // filter gate itself rather than the absence of data.
    plot.filtersActive = true;
    plot.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.DATA_CHANGE, {
        detail: { data: { ...data, statisticsRows: undefined } },
      }),
    );
    await legend.updateComplete;

    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).toBeNull();
    const note = legend.shadowRoot!.querySelector('.score-strips-note');
    expect(note?.textContent).toContain('hidden while the view is filtered');
  });

  it('stays silent when a stats-less dataset is filtered', async () => {
    // The "silent case": a dataset with no scores at all must stay silent, so the note
    // must not appear just because filtersActive is true from the very first render.
    const { legend } = await setup({
      data: { statisticsRows: [] },
      plot: { filtersActive: true, filteredProteinIds: ['p1'] },
    });

    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).toBeNull();
    expect(legend.shadowRoot!.querySelector('.score-strips-note')).toBeNull();
  });

  it('drops the note after switching to an annotation that was never scored', async () => {
    // The note is per annotation, not per dataset: a filtered view must not go on claiming
    // scores are "hidden" once the user recolours by something the run never scored.
    const { legend, plot, data } = await setup();
    expect(legend.shadowRoot!.querySelector('protspace-score-strip')).not.toBeNull();

    // Filter first, so the note is genuinely showing at this point.
    plot.filtersActive = true;
    plot.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.DATA_CHANGE, {
        detail: { data: { ...data, statisticsRows: undefined } },
      }),
    );
    await legend.updateComplete;
    expect(legend.shadowRoot!.querySelector('.score-strips-note')).not.toBeNull();

    // Now switch to an annotation the run never scored, still filtered.
    const withUnscored = {
      ...data,
      annotations: { ...data.annotations, unscored: data.annotations.family },
      annotation_data: { ...data.annotation_data, unscored: new Int32Array([0, 1]) },
      statisticsRows: undefined,
    };
    plot.selectedAnnotation = 'unscored';
    plot.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.DATA_CHANGE, { detail: { data: withUnscored } }),
    );
    await legend.updateComplete;

    expect(legend.shadowRoot!.querySelector('.score-strips-note')).toBeNull();
  });
});
