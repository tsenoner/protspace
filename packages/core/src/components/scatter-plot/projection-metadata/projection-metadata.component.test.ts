/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './projection-metadata';
import type { Projection, ProjectionStatisticRow } from '@protspace/utils';

type ProjectionMetadataElement = HTMLElement & {
  projection: Projection | null;
  statisticsRows?: readonly ProjectionStatisticRow[];
  selectedAnnotation: string;
  viewIsSubset: boolean;
  updateComplete: Promise<unknown>;
};

/** One faithfulness entry as the backend writes it: the value plus its provenance. */
function qualityEntry(value: number | null, scope: 'local' | 'global') {
  return { value, scope, k: 15, seed: 42, sampled: false, sample_size: 1428 };
}

/** One statistics row for `major_group`, scored in the projection the panel is showing. */
const statRow = (over: Partial<ProjectionStatisticRow> = {}): ProjectionStatisticRow => ({
  space_kind: 'projection',
  space_name: 'ProtT5 — UMAP 2',
  annotation: 'major_group',
  stat_family: 'annotation_validity',
  label_kind: 'annotation',
  metric: 'silhouette',
  metric_kind: 'validity',
  value: 0.326,
  ...over,
});

async function setup(
  metadata: Record<string, unknown>,
  stats?: { statistics: readonly ProjectionStatisticRow[]; selectedAnnotation: string },
): Promise<ProjectionMetadataElement> {
  const el = document.createElement('protspace-projection-metadata') as ProjectionMetadataElement;
  el.projection = { name: 'ProtT5 — UMAP 2', metadata };
  if (stats) {
    el.statisticsRows = stats.statistics;
    el.selectedAnnotation = stats.selectedAnnotation;
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** The annotation-quality section, present only when the bundle scored this pair. */
function statsBlock(el: ProjectionMetadataElement): HTMLElement | null {
  return el.shadowRoot!.querySelector('.annotation-stats');
}

function rows(el: ProjectionMetadataElement): Array<[string, string]> {
  return Array.from(el.shadowRoot!.querySelectorAll('.item')).map((item) => [
    item.querySelector('dt')?.textContent?.trim() ?? '',
    item.querySelector('dd')?.textContent?.trim() ?? '',
  ]);
}

describe('protspace-projection-metadata quality rows', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one labelled row per faithfulness metric instead of a JSON blob', async () => {
    const el = await setup({
      n_components: 2,
      quality: {
        knn_overlap: qualityEntry(0.5776844070961717, 'local'),
        trustworthiness: qualityEntry(0.9746417190838376, 'local'),
        random_triplet: qualityEntry(0.7109243697478992, 'global'),
      },
    });

    // Faithfulness before the reduction parameters. The card scrolls now, so it is ordered by
    // what the reader came for: the parameters never change and are reference material.
    expect(rows(el)).toEqual([
      // The registry's spelling, not the prettified column name: a known metric is named the
      // way it is written in the literature ("kNN"), which title-casing the key cannot do.
      ['kNN Overlap', '0.58'],
      ['Trustworthiness', '0.97'],
      ['Random Triplet', '0.71'],
      ['N Components', '2'],
    ]);
  });

  it('explains every faithfulness metric behind an info popover', async () => {
    // These names ("Random Triplet", "Spearman Distance") say least to a biologist of
    // anything in the panel, and the separation metrics below them already carry an ⓘ.
    // Leaving them bare made the section that most needed explaining the only one without it.
    const el = await setup({
      n_components: 2,
      quality: {
        knn_overlap: qualityEntry(0.57, 'local'),
        trustworthiness: qualityEntry(0.97, 'local'),
        continuity: qualityEntry(0.96, 'local'),
        random_triplet: qualityEntry(0.71, 'global'),
        spearman_distance: qualityEntry(0.53, 'global'),
      },
    });

    const qualityRows = [...el.shadowRoot!.querySelectorAll('[data-section="quality"] .item')];
    expect(qualityRows).toHaveLength(5);
    for (const row of qualityRows) {
      const popover = row.querySelector('protspace-info-popover') as
        | (HTMLElement & { description: string })
        | null;
      expect(popover, row.querySelector('dt')!.textContent!.trim()).not.toBeNull();
      expect(popover!.description.length).toBeGreaterThan(0);
    }

    // Reduction parameters are the reducer's own knobs and get no icon.
    const parameterRow = el.shadowRoot!.querySelector('[data-section="parameters"] .item');
    expect(parameterRow!.querySelector('protspace-info-popover')).toBeNull();
  });

  it('pins open on click and closes on Escape or an outside click', async () => {
    // Hover alone made the panel unusable for its own content: reading a metric's ⓘ, or
    // selecting a value, means moving the pointer off the card.
    const el = await setup({ n_components: 2 });
    const trigger = el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement;
    const content = () => el.shadowRoot!.querySelector('.content')!;

    expect(content().classList.contains('is-pinned')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    await el.updateComplete;
    expect(content().classList.contains('is-pinned')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // A pointerdown inside the panel must not dismiss it — that is the whole point.
    content().dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(content().classList.contains('is-pinned')).toBe(true);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(content().classList.contains('is-pinned')).toBe(false);

    trigger.click();
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(content().classList.contains('is-pinned')).toBe(false);
  });

  it('stops listening on the document once unpinned or removed', async () => {
    // The listeners are document-wide and this component exists per scatter-plot, so a leak
    // here dismisses unrelated panels and keeps a detached element alive.
    const el = await setup({ n_components: 2 });
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');

    (el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(added).toHaveBeenCalledTimes(2); // pointerdown + keydown

    el.remove();
    await el.updateComplete;
    expect(removed).toHaveBeenCalledTimes(2);

    added.mockRestore();
    removed.mockRestore();
  });

  it('says what the faithfulness metrics were computed over, and when it was a subsample', async () => {
    // The backend attaches sample_size/sampled to every faithfulness metric and the panel
    // dropped all of it, so a number computed on a 5,000-protein subsample of a 570k dataset
    // looked exactly like one computed on everything.
    const whole = await setup({
      quality: { knn_overlap: qualityEntry(0.62, 'local') },
    });
    const scope = (el: ProjectionMetadataElement) =>
      el.shadowRoot!.querySelector('[data-section="quality"] .section-scope')!.textContent!.trim();
    expect(scope(whole)).toBe('1,428 proteins compared');

    document.body.innerHTML = '';
    const sampled = await setup({
      quality: {
        knn_overlap: {
          value: 0.62,
          scope: 'local',
          k: 15,
          seed: 42,
          sampled: true,
          sample_size: 5000,
        },
      },
    });
    expect(scope(sampled)).toBe('5,000 proteins compared · subsampled');
  });

  it('never leaves a serialized object in a value', async () => {
    const el = await setup({
      quality: { spearman_distance: qualityEntry(0.53, 'global') },
    });

    for (const [, value] of rows(el)) {
      expect(value).not.toContain('{');
    }
  });

  it('marks a metric the backend skipped as not available', async () => {
    // A metric that raised is written as `value: null`, not omitted.
    const el = await setup({ quality: { continuity: qualityEntry(null, 'local') } });

    expect(rows(el)).toEqual([['Continuity', 'N/A']]);
  });
});

describe('protspace-projection-metadata annotation quality section', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stays absent when the bundle has no score for this annotation and projection', async () => {
    // The projection half of the panel must look untouched for a bundle prepared without --stats.
    const plain = await setup({ n_components: 2 });
    expect(statsBlock(plain)).toBeNull();

    const otherAnnotation = await setup(
      { n_components: 2 },
      { statistics: [statRow()], selectedAnnotation: 'seq_start' },
    );
    expect(statsBlock(otherAnnotation)).toBeNull();

    const otherProjection = await setup(
      { n_components: 2 },
      {
        statistics: [statRow({ space_name: 'ProtT5 — PCA 2' })],
        selectedAnnotation: 'major_group',
      },
    );
    expect(statsBlock(otherProjection)).toBeNull();
  });

  it('names the annotation and shows each metric against its embedding ceiling', async () => {
    const el = await setup(
      { n_components: 2 },
      {
        statistics: [
          statRow({ extra_json: '{"n_categories": 5, "n_labels": 1427}' }),
          statRow({ space_kind: 'embedding', space_name: 'prot_t5', value: 0.095 }),
          statRow({ metric: 'davies_bouldin', value: 1.281 }),
        ],
        selectedAnnotation: 'major_group',
      },
    );

    expect(el.shadowRoot!.querySelector('.stat-annotation-chip')!.textContent).toContain(
      'Major group',
    );
    const text = statsBlock(el)!.textContent!;
    expect(text).toContain('Separation, scored on');
    expect(text).toContain('0.33');
    expect(statsBlock(el)!.querySelector('.stat-metric-embedding')!.textContent).toContain('0.10');
    expect(text).not.toContain('emb 0.10');
    // The section states its own coverage; "full dataset" is card-level, because it is
    // equally true of the faithfulness block (see the subset test below).
    expect(text).toContain('5 categories · 1,427 proteins scored');
    expect(text).not.toContain('full dataset');
  });

  it('warns that the scores outrun the view only while the view is narrowed', async () => {
    // The scores are computed once over everything and never recomputed, so under a filter or
    // an isolation they describe a population the user is no longer looking at. Stated
    // unconditionally this said the same thing either way — no information in the common case,
    // and therefore easy to skip in the one case it matters.
    const stats = {
      statistics: [statRow({ extra_json: '{"n_categories": 5, "n_labels": 1427}' })],
      selectedAnnotation: 'major_group',
    };

    const cardScope = (el: ProjectionMetadataElement) =>
      el.shadowRoot!.querySelector('.card-scope')!.textContent!.trim();

    const whole = await setup({ n_components: 2 }, stats);
    expect(cardScope(whole)).toContain('full dataset');
    expect(cardScope(whole)).not.toContain('not this view');

    document.body.innerHTML = '';
    const filtered = await setup({ n_components: 2 }, stats);
    filtered.viewIsSubset = true;
    await filtered.updateComplete;

    // Stated once for the whole card, not per section: it governs the faithfulness numbers
    // just as much as the separation ones.
    expect(filtered.shadowRoot!.querySelectorAll('.card-scope')).toHaveLength(1);
    expect(cardScope(filtered)).toContain('full dataset, not this view');
    // The numbers themselves are untouched — only how they are described.
    expect(statsBlock(filtered)!.textContent).toContain('5 categories');
  });

  it('marks each metric with the direction that counts as better', async () => {
    const el = await setup(
      { n_components: 2 },
      {
        statistics: [statRow(), statRow({ metric: 'davies_bouldin', value: 1.281 })],
        selectedAnnotation: 'major_group',
      },
    );

    const arrows = Array.from(statsBlock(el)!.querySelectorAll('.stat-direction'));
    expect(arrows.map((a) => a.textContent)).toEqual(['↑', '↓']);
    // The glyphs alone reach neither screen readers nor touch users.
    expect(arrows.every((a) => a.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(statsBlock(el)!.textContent).toContain('lower is better');
  });

  it('attaches a registered info popover to every rendered metric row', async () => {
    const el = await setup(
      { n_components: 2 },
      {
        statistics: [statRow(), statRow({ metric: 'davies_bouldin', value: 1.281 })],
        selectedAnnotation: 'major_group',
      },
    );

    const labels = statsBlock(el)!.querySelectorAll('.stat-metric-label');
    const popovers = statsBlock(el)!.querySelectorAll<HTMLElement & { description: string }>(
      '.stat-metric-label protspace-info-popover',
    );
    expect(labels).toHaveLength(2);
    expect(popovers).toHaveLength(labels.length);
    expect(customElements.get('protspace-info-popover')).toBeDefined();
    // Counting elements alone would survive a broken binding: info-popover keeps its host element
    // and merely renders nothing when it has no copy, so check the copy actually arrived.
    expect(popovers[0].description.length).toBeGreaterThan(20);
    // A single shared description (e.g. every row bound to the same metric's copy) would
    // survive the length check above; the two rows must actually describe different metrics.
    expect(popovers[0].description).not.toBe(popovers[1].description);
  });

  it('collapses the ceiling column for a metric missing its embedding row', async () => {
    const el = await setup(
      { n_components: 2 },
      {
        statistics: [
          statRow(),
          statRow({ space_kind: 'embedding', space_name: 'prot_t5', value: 0.095 }),
          statRow({ metric: 'davies_bouldin', value: 1.281 }),
        ],
        selectedAnnotation: 'major_group',
      },
    );

    const cells = Array.from(statsBlock(el)!.querySelectorAll('.stat-metric-embedding'));
    // Silhouette has an embedding-space row (a ceiling); Davies-Bouldin has none here.
    // Asserted on the rendered text, which is what the reader sees: the cell is kept (the
    // row is display: contents, so dropping it would shift the grid) but left blank.
    expect(cells.map((cell) => cell.textContent!.trim() === '')).toEqual([false, true]);
  });
});

describe('metadata sections', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('separates reduction parameters from projection quality', async () => {
    const el = await setup({
      n_neighbors: 15,
      min_dist: 0.1,
      quality: {
        trustworthiness: qualityEntry(0.94, 'local'),
        continuity: qualityEntry(0.91, 'local'),
      },
    });

    const headings = Array.from(el.shadowRoot!.querySelectorAll('.section-heading')).map((node) =>
      node.textContent!.trim(),
    );
    expect(headings).toContain('How it was made');
    expect(headings).toContain('Faithfulness to the embedding');

    const parameters = el.shadowRoot!.querySelector('[data-section="parameters"]')!;
    expect(parameters.textContent).toContain('N Neighbors');
    expect(parameters.textContent).not.toContain('Trustworthiness');

    const quality = el.shadowRoot!.querySelector('[data-section="quality"]')!;
    expect(quality.textContent).toContain('Trustworthiness');
    expect(quality.textContent).not.toContain('N Neighbors');
  });

  it('labels the embedding ceiling instead of abbreviating it', async () => {
    const el = await setup(
      { n_neighbors: 15 },
      {
        statistics: [
          statRow(),
          statRow({ space_kind: 'embedding', space_name: 'prot_t5', value: 0.095 }),
        ],
        selectedAnnotation: 'major_group',
      },
    );

    const text = el.shadowRoot!.querySelector('.annotation-stats')!.textContent!;
    // One word. The two headings sit in the grid's auto-sized columns, so a longer phrase
    // ("Source embedding") set those widths from the heading rather than the number and
    // starved the metric-name column — measured at 36px against a 120px need. The heading's
    // own ⓘ carries the full explanation.
    expect(text).toContain('Embedding');
    expect(text).not.toContain('emb 0.10');
  });

  it('omits the quality section entirely when there is no faithfulness', async () => {
    const el = await setup({ n_neighbors: 15 });

    const headings = Array.from(el.shadowRoot!.querySelectorAll('.section-heading')).map((node) =>
      node.textContent!.trim(),
    );
    expect(headings).toContain('How it was made');
    expect(headings).not.toContain('Faithfulness to the embedding');
  });

  it('shows the embedding column header only when some metric has a ceiling', async () => {
    const withoutCeiling = await setup(
      { n_neighbors: 15 },
      { statistics: [statRow()], selectedAnnotation: 'major_group' },
    );
    expect(statsBlock(withoutCeiling)!.querySelector('.stat-columns')).toBeNull();
    expect(statsBlock(withoutCeiling)!.querySelector('.stat-metric-label')!.textContent).toContain(
      'Silhouette',
    );

    const withCeiling = await setup(
      { n_neighbors: 15 },
      {
        statistics: [
          statRow(),
          statRow({ space_kind: 'embedding', space_name: 'prot_t5', value: 0.095 }),
        ],
        selectedAnnotation: 'major_group',
      },
    );
    expect(statsBlock(withCeiling)!.querySelector('.stat-columns')).not.toBeNull();
  });

  it('expands a nested quality object inside a JSON field, keeping siblings as parameters', async () => {
    const el = await setup({
      info: JSON.stringify({
        n_neighbors: 15,
        quality: { trustworthiness: qualityEntry(0.94, 'local') },
      }),
    });

    const parameters = el.shadowRoot!.querySelector('[data-section="parameters"]')!;
    expect(parameters.textContent).toContain('N Neighbors');
    expect(parameters.textContent).not.toContain('Trustworthiness');

    const quality = el.shadowRoot!.querySelector('[data-section="quality"]')!;
    expect(quality.textContent).toContain('Trustworthiness');
    expect(quality.textContent).not.toContain('N Neighbors');
  });
});

describe('auto-cluster agreement placement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * One clustering's agreement row against one recovered annotation, shaped exactly as the
   * backend emits it: filed under the *recovered* annotation's own name (`major_group`), never
   * under the cluster column's name (`cluster_elbow_...`). Selecting the cluster column is what
   * the panel matches against, not the row's `annotation` field.
   */
  const agreementRow = (over: Partial<ProjectionStatisticRow> = {}) =>
    statRow({
      stat_family: 'cluster_agreement',
      label_kind: 'kmeans_elbow',
      metric: 'adjusted_rand',
      metric_kind: 'agreement',
      value: 0.62,
      ...over,
    });

  it('hides agreement while an ordinary annotation is selected', async () => {
    const el = await setup(
      { n_neighbors: 15 },
      { statistics: [statRow(), agreementRow()], selectedAnnotation: 'major_group' },
    );

    const text = el.shadowRoot!.querySelector('.annotation-stats')!.textContent!;
    expect(text).toContain('Separation, scored on');
    expect(text).not.toContain('Recovers');
  });

  it('renders no stats block for an ordinary annotation with agreement but no validity', async () => {
    // A category can vanish from validity under subsampling while the (unsampled) agreement
    // pass still recovers it (annotation_validity.py:117): annotationStatSummary stays non-null
    // on the agreement row alone, but a summary with zero validity rows is not itself a metric
    // row worth a block for.
    const el = await setup(
      { n_neighbors: 15 },
      { statistics: [agreementRow()], selectedAnnotation: 'major_group' },
    );

    expect(statsBlock(el)).toBeNull();
  });

  it('shows one group per recovered annotation when the clustering itself is selected', async () => {
    const rows = [
      agreementRow({ annotation: 'major_group', metric: 'adjusted_rand', value: 0.62 }),
      agreementRow({
        annotation: 'major_group',
        metric: 'normalized_mutual_info',
        value: 0.58,
      }),
      agreementRow({ annotation: 'ec_number', metric: 'adjusted_rand', value: 0.31 }),
      agreementRow({
        annotation: 'ec_number',
        metric: 'normalized_mutual_info',
        value: 0.44,
      }),
    ];
    const el = await setup(
      { n_neighbors: 15 },
      { statistics: rows, selectedAnnotation: 'cluster_elbow_ProtT5 — UMAP 2' },
    );

    const text = el.shadowRoot!.querySelector('.annotation-stats')!.textContent!;
    expect(text).toContain('Recovers');
    // Both recovered annotations get their own named group, not a bare "elbow K" label.
    expect(text).toContain('Major group');
    expect(text).toContain('Ec number');
    // Both metrics rendered for each group, not just a stray heading string.
    expect(text).toContain('0.62');
    expect(text).toContain('0.58');
    expect(text).toContain('0.31');
    expect(text).toContain('0.44');

    // One ROW per annotation now, not a heading plus a metric line each. The metric names,
    // their direction arrows and their ⓘ live in a single header, so a block of ten
    // annotations costs ten lines and two icons rather than thirty and twenty.
    const names = Array.from(statsBlock(el)!.querySelectorAll('.stat-metric-name'))
      .map((node) => node.textContent!.replace(/\s+/g, ' ').trim())
      .filter((name) => /Major group|Ec number/.test(name));
    // Best-recovered first: the fixture's ARI is 0.62 for major_group and 0.31 for ec.
    expect(names).toEqual(['Major group', 'Ec number']);
    expect(statsBlock(el)!.querySelectorAll('.stat-group-label')).toHaveLength(0);
  });

  it('shows agreement for the selected clustering even from a different projection panel', async () => {
    // An explicit human decision (projection-metadata.ts): agreement describes the
    // clustering itself, never the panel it happens to be open on. `setup()` always opens
    // the panel on "ProtT5 — UMAP 2"; the selected column here names PCA 2's clustering, so
    // scoping agreement to `this.projection` would wrongly leave this block empty.
    const rows = [agreementRow({ space_name: 'ProtT5 — PCA 2', annotation: 'major_group' })];
    const el = await setup(
      { n_neighbors: 15 },
      { statistics: rows, selectedAnnotation: 'cluster_elbow_ProtT5 — PCA 2' },
    );

    const text = el.shadowRoot!.querySelector('.annotation-stats')!.textContent!;
    expect(text).toContain('Recovers');
    expect(text).toContain('Major group');
  });

  it('renders a clustering’s own separation scores above what it recovers', async () => {
    // The backend files a clustering's validity under the membership column's own name, so
    // the panel shows both halves for one selection: how separated it is (optimistic, it drew
    // its own boundaries) and what it recovers (independent).
    const el = await setup(
      { n_neighbors: 15 },
      {
        statistics: [
          statRow({ annotation: 'cluster_elbow_ProtT5 — UMAP 2', label_kind: 'kmeans_elbow' }),
          agreementRow({ annotation: 'major_group' }),
          statRow({
            annotation: '',
            stat_family: 'cluster_validity',
            label_kind: 'kmeans_elbow',
            metric: 'n_clusters',
            metric_kind: 'meta',
            value: 7,
          }),
        ],
        selectedAnnotation: 'cluster_elbow_ProtT5 — UMAP 2',
      },
    );

    const text = statsBlock(el)!.textContent!;
    expect(text).toContain('Separation, scored on');
    expect(text).toContain('Recovers');
    expect(text).toContain('optimistic');
  });

  it('does not caveat an ordinary annotation', async () => {
    const el = await setup(
      { n_neighbors: 15 },
      { statistics: [statRow(), agreementRow()], selectedAnnotation: 'major_group' },
    );

    expect(statsBlock(el)!.textContent).not.toContain('optimistic');
  });
});
