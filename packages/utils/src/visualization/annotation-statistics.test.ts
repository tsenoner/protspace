import { describe, it, expect } from 'vitest';
import type { ProjectionStatisticRow } from '../types';
import {
  annotationStatSummary,
  annotationCategoryScores,
  clusterAgreement,
  formatStatValue,
  isAutoClusterColumn,
  metricDescription,
} from './annotation-statistics';

const row = (over: Partial<ProjectionStatisticRow>): ProjectionStatisticRow => ({
  space_kind: 'projection',
  space_name: 'UMAP 2',
  annotation: 'major_group',
  stat_family: 'annotation_validity',
  label_kind: 'annotation',
  metric: 'silhouette',
  metric_kind: 'validity',
  value: 0.326,
  ...over,
});

// Mirrors the shape of a real `--stats` bundle: validity in the projection, the same metrics on
// the source embedding, agreement rows per K-selection, and a `meta` n_clusters row.
const ROWS: ProjectionStatisticRow[] = [
  row({ metric: 'calinski_harabasz', value: 851.87 }),
  row({ metric: 'davies_bouldin', value: 1.281 }),
  row({ metric: 'silhouette', value: 0.326 }),
  row({ space_kind: 'embedding', space_name: 'prot_t5', metric: 'silhouette', value: 0.095 }),
  row({
    space_kind: 'embedding',
    space_name: 'prot_t5',
    metric: 'davies_bouldin',
    value: 2.958,
  }),
  row({ space_name: 'PCA 2', metric: 'silhouette', value: 0.039 }),
  row({
    stat_family: 'cluster_agreement',
    label_kind: 'kmeans_elbow',
    metric: 'normalized_mutual_info',
    metric_kind: 'agreement',
    value: 0.558,
  }),
  row({
    stat_family: 'cluster_agreement',
    label_kind: 'kmeans_elbow',
    metric: 'adjusted_rand',
    metric_kind: 'agreement',
    value: 0.362,
  }),
  row({
    annotation: '',
    stat_family: 'cluster_validity',
    label_kind: 'kmeans_elbow',
    metric: 'n_clusters',
    metric_kind: 'meta',
    value: 7,
  }),
];

describe('annotationStatSummary', () => {
  it('returns null when the bundle carries no statistics', () => {
    expect(annotationStatSummary(undefined, 'major_group', 'UMAP 2')).toBeNull();
    expect(annotationStatSummary([], 'major_group', 'UMAP 2')).toBeNull();
  });

  it('returns null for an annotation that was not scored', () => {
    expect(annotationStatSummary(ROWS, 'not_scored', 'UMAP 2')).toBeNull();
  });

  it('reports validity for the selected projection in a fixed metric order', () => {
    const summary = annotationStatSummary(ROWS, 'major_group', 'UMAP 2');
    expect(summary?.validity.map((m) => m.metric)).toEqual([
      'silhouette',
      'davies_bouldin',
      'calinski_harabasz',
    ]);
    expect(summary?.validity[0].value).toBe(0.326);
  });

  it('pairs each validity metric with its source-embedding ceiling', () => {
    const summary = annotationStatSummary(ROWS, 'major_group', 'UMAP 2');
    expect(summary?.validity.map((m) => m.embedding)).toEqual([0.095, 2.958, null]);
  });

  it('does not leak another projection‘s scores', () => {
    const summary = annotationStatSummary(ROWS, 'major_group', 'PCA 2');
    expect(summary?.validity).toHaveLength(1);
    expect(summary?.validity[0].value).toBe(0.039);
  });

  it('marks Davies-Bouldin as lower-is-better and the rest as higher-is-better', () => {
    const summary = annotationStatSummary(ROWS, 'major_group', 'UMAP 2');
    const byMetric = Object.fromEntries(summary!.validity.map((m) => [m.metric, m.higherIsBetter]));
    expect(byMetric).toEqual({
      silhouette: true,
      davies_bouldin: false,
      calinski_harabasz: true,
    });
  });

  it('never surfaces meta rows such as n_clusters', () => {
    const metrics = annotationStatSummary(ROWS, 'major_group', 'UMAP 2')!;
    expect(metrics.validity.some((m) => m.metric === 'n_clusters')).toBe(false);
    // The n_clusters row alone must not be enough to claim the annotation has statistics.
    const metaOnly = ROWS.filter((r) => r.metric_kind === 'meta');
    expect(annotationStatSummary(metaOnly, '', 'UMAP 2')).toBeNull();
  });

  it('returns null when the annotation is scored only in other projections', () => {
    const embeddingOnly = ROWS.filter((r) => r.space_kind === 'embedding');
    expect(annotationStatSummary(embeddingOnly, 'major_group', 'UMAP 2')).toBeNull();
  });

  it('drops the embedding ceiling when two embeddings scored the same metric', async () => {
    // A multi-embedding bundle has one embedding row per (annotation, metric, embedding), and
    // nothing in the tidy schema says which embedding this projection came from.
    const summary = annotationStatSummary(
      [
        row({ metric: 'silhouette', value: 0.326 }),
        row({ space_kind: 'embedding', space_name: 'prot_t5', metric: 'silhouette', value: 0.095 }),
        row({
          space_kind: 'embedding',
          space_name: 'esm2_650m',
          metric: 'silhouette',
          value: 0.41,
        }),
      ],
      'major_group',
      'UMAP 2',
    );

    expect(summary!.validity[0].value).toBe(0.326);
    expect(summary!.validity[0].embedding).toBeNull();
  });

  it('keeps the ceiling when a single embedding scored the metric twice-over rows', async () => {
    const summary = annotationStatSummary(
      [
        row({ metric: 'silhouette', value: 0.326 }),
        row({ space_kind: 'embedding', space_name: 'prot_t5', metric: 'silhouette', value: 0.095 }),
      ],
      'major_group',
      'UMAP 2',
    );

    expect(summary!.validity[0].embedding).toBe(0.095);
  });

  it('ignores non-finite rows entirely', () => {
    // A NaN double from a foreign writer is not a score: it must not switch the ⓘ icon on,
    // and as a ceiling it must not defeat the `embedding === null` column collapse.
    expect(annotationStatSummary([row({ value: Number.NaN })], 'major_group', 'UMAP 2')).toBeNull();

    const summary = annotationStatSummary(
      [
        row({ metric: 'silhouette', value: 0.326 }),
        row({
          space_kind: 'embedding',
          space_name: 'prot_t5',
          metric: 'silhouette',
          value: Number.NaN,
        }),
      ],
      'major_group',
      'UMAP 2',
    );
    expect(summary!.validity[0].embedding).toBeNull();
  });

  it('reports what the scores cover, from the validity row‘s provenance', () => {
    const summary = annotationStatSummary(
      [
        // A per-category row with a different n_labels, listed BEFORE the aggregate: if the
        // `category == null` filter that keeps per-category rows out of `forAnnotation` were
        // ever misplaced, this row would win `scopeRow`'s first-match search and the
        // assertions below would catch it.
        { ...row({}), category: 'Elapidae', extra_json: '{"n_labels": 3}' },
        row({ extra_json: '{"n_categories": 5, "n_labels": 1427, "sampled": false, "seed": 42}' }),
      ],
      'major_group',
      'UMAP 2',
    );

    expect(summary!.categories).toBe(5);
    expect(summary!.scored).toBe(1427);
  });

  it('leaves the coverage unknown when the provenance is missing or broken', () => {
    const unknown = (over: Partial<ProjectionStatisticRow>) =>
      annotationStatSummary([row(over)], 'major_group', 'UMAP 2')!;

    expect(unknown({}).categories).toBeNull();
    expect(unknown({ extra_json: 'not json' }).scored).toBeNull();
    expect(unknown({ extra_json: '{"n_categories": "five"}' }).categories).toBeNull();
  });

  it('returns null for an ordinary annotation with agreement rows but no validity row', () => {
    // Cluster agreement is no longer read by this function at all: an ordinary annotation
    // scored only by the (unsampled) agreement pass, with nothing in `validity`, must not
    // produce a summary. `hasAnnotationStats` is what makes a bare cluster_* column count
    // instead, by combining this result with `clusterAgreement` separately.
    const summary = annotationStatSummary(
      [
        row({
          stat_family: 'cluster_agreement',
          label_kind: 'kmeans_elbow',
          metric: 'adjusted_rand',
          metric_kind: 'agreement',
          value: 0.362,
          extra_json: '{"n_labels": 1427, "seed": 42}',
        }),
      ],
      'major_group',
      'UMAP 2',
    );

    expect(summary).toBeNull();
  });
});

describe('clusterAgreement', () => {
  // One clustering's agreement row against one recovered annotation, shaped exactly as
  // `ClusterValidityStatistic` emits it (validity.py): filed under the *recovered* annotation's
  // own name, never under the cluster column's name.
  type AgreementRowOverrides = Partial<ProjectionStatisticRow> & {
    labelKind: string;
    recovers: string;
  };
  const agreementRow = ({
    labelKind,
    recovers,
    ...over
  }: AgreementRowOverrides): ProjectionStatisticRow =>
    row({
      space_name: 'UMAP 2',
      stat_family: 'cluster_agreement',
      label_kind: labelKind,
      annotation: recovers,
      metric: 'adjusted_rand',
      metric_kind: 'agreement',
      value: 0.62,
      ...over,
    });

  it("ranks best-recovered first and reports K and each annotation's cardinality", () => {
    // The block answers "which known biology do these clusters correspond to?" — a ranking.
    // K and the category counts are not decoration: ARI's achievable maximum falls as an
    // annotation's cardinality diverges from K, so a bare ARI is not comparable across rows.
    const agree = (annotation: string, metric: string, value: number, scored = 811) => ({
      space_kind: 'projection' as const,
      space_name: 'UMAP 2',
      annotation,
      stat_family: 'cluster_agreement' as const,
      label_kind: 'kmeans_elbow',
      metric,
      metric_kind: 'validity' as const,
      value,
      extra_json: JSON.stringify({ n_labels: scored }),
    });
    const validity = (annotation: string, categories: number) => ({
      space_kind: 'projection' as const,
      space_name: 'UMAP 2',
      annotation,
      stat_family: 'annotation_validity' as const,
      label_kind: 'annotation',
      metric: 'silhouette',
      metric_kind: 'validity' as const,
      value: 0.1,
      extra_json: JSON.stringify({ n_categories: categories, n_labels: 811 }),
    });

    const rows: ProjectionStatisticRow[] = [
      agree('ec', 'adjusted_rand', 0.11, 192),
      agree('phylum', 'adjusted_rand', 0.22),
      agree('phylum', 'normalized_mutual_info', 0.37),
      validity('phylum', 4),
      validity('ec', 4),
      // The clustering's own cardinality is K.
      validity('cluster_elbow_UMAP 2', 6),
    ];

    const { clusters, entries } = clusterAgreement(rows, 'cluster_elbow_UMAP 2');

    expect(clusters).toBe(6);
    expect(entries.map((e) => e.annotation)).toEqual(['phylum', 'ec']);
    expect(entries[0].categories).toBe(4);
    // Coverage comes from the AGREEMENT row, not the validity row: the two passes can cover
    // different protein sets, and this must describe the comparison actually displayed.
    expect(entries[1].scored).toBe(192);
    expect(entries[0].scored).toBe(811);
  });

  it('keeps an annotation carrying only one of the two metrics, and ranks it by its ARI', () => {
    // Sorting looks the metric up by name rather than by index, so a group with only NMI
    // cannot be read as though its first metric were ARI.
    const row = (annotation: string, metric: string, value: number): ProjectionStatisticRow => ({
      space_kind: 'projection',
      space_name: 'UMAP 2',
      annotation,
      stat_family: 'cluster_agreement',
      label_kind: 'kmeans_elbow',
      metric,
      metric_kind: 'validity',
      value,
    });
    const { entries } = clusterAgreement(
      [row('nmi_only', 'normalized_mutual_info', 0.99), row('has_ari', 'adjusted_rand', 0.05)],
      'cluster_elbow_UMAP 2',
    );

    // 0.99 is an NMI, so it must not outrank a real ARI of 0.05.
    expect(entries.map((e) => e.annotation)).toEqual(['has_ari', 'nmi_only']);
  });

  it('returns an empty array for a column that is not a cluster column', () => {
    const rows = [agreementRow({ labelKind: 'kmeans_elbow', recovers: 'major_group' })];
    expect(clusterAgreement(rows, 'major_group').entries).toEqual([]);
  });

  it('returns an empty array when the bundle carries no statistics', () => {
    expect(clusterAgreement(undefined, 'cluster_elbow_UMAP 2').entries).toEqual([]);
    expect(clusterAgreement([], 'cluster_elbow_UMAP 2').entries).toEqual([]);
  });

  it('returns an empty array when no agreement row matches the selected clustering', () => {
    // Cluster-shaped name, but nothing in the bundle backs this particular projection.
    const rows = [agreementRow({ labelKind: 'kmeans_elbow', recovers: 'major_group' })];
    expect(clusterAgreement(rows, 'cluster_elbow_PCA 2').entries).toEqual([]);
  });

  it('groups multiple recovered annotations under the selected clustering', () => {
    const rows = [
      agreementRow({ labelKind: 'kmeans_elbow', recovers: 'major_group', value: 0.62 }),
      agreementRow({
        labelKind: 'kmeans_elbow',
        recovers: 'major_group',
        metric: 'normalized_mutual_info',
        value: 0.58,
      }),
      agreementRow({ labelKind: 'kmeans_elbow', recovers: 'ec_number', value: 0.31 }),
    ];

    const { entries } = clusterAgreement(rows, 'cluster_elbow_UMAP 2');

    expect(entries.map((e) => e.annotation)).toEqual(['major_group', 'ec_number']);
    expect(entries[0].metrics).toHaveLength(2);
    expect(entries[1].metrics).toHaveLength(1);
  });

  it('orders ARI before NMI within a group', () => {
    const rows = [
      agreementRow({
        labelKind: 'kmeans_elbow',
        recovers: 'major_group',
        metric: 'normalized_mutual_info',
        value: 0.58,
      }),
      agreementRow({
        labelKind: 'kmeans_elbow',
        recovers: 'major_group',
        metric: 'adjusted_rand',
        value: 0.62,
      }),
    ];

    const { entries } = clusterAgreement(rows, 'cluster_elbow_UMAP 2');

    expect(entries[0].metrics.map((m) => m.metric)).toEqual([
      'adjusted_rand',
      'normalized_mutual_info',
    ]);
  });

  it('matches the right clustering when a bundle carries both elbow and silhouette rows', () => {
    // `--cluster-selection both` emits one agreement row per K-selection for the same
    // annotation; a loose match (e.g. by space_name alone) would blend the two together.
    const rows = [
      agreementRow({ labelKind: 'kmeans_elbow', recovers: 'major_group', value: 0.2 }),
      agreementRow({ labelKind: 'kmeans_silhouette', recovers: 'major_group', value: 0.9 }),
    ];

    expect(clusterAgreement(rows, 'cluster_elbow_UMAP 2').entries[0].metrics[0].value).toBe(0.2);
    expect(clusterAgreement(rows, 'cluster_silhouette_UMAP 2').entries[0].metrics[0].value).toBe(
      0.9,
    );
  });

  it('does not match a cluster column from a different projection', () => {
    const rows = [
      agreementRow({ labelKind: 'kmeans_elbow', recovers: 'major_group', space_name: 'PCA 2' }),
    ];
    expect(clusterAgreement(rows, 'cluster_elbow_UMAP 2').entries).toEqual([]);
  });

  it('ignores rows outside cluster_agreement and non-finite values', () => {
    const rows = [
      // Same label_kind/space_name, wrong stat_family: must not be mistaken for agreement.
      row({
        space_name: 'UMAP 2',
        annotation: 'major_group',
        stat_family: 'annotation_validity',
        label_kind: 'kmeans_elbow',
        metric: 'adjusted_rand',
        metric_kind: 'validity',
        value: 0.99,
      }),
      agreementRow({ labelKind: 'kmeans_elbow', recovers: 'major_group', value: Number.NaN }),
    ];

    expect(clusterAgreement(rows, 'cluster_elbow_UMAP 2').entries).toEqual([]);
  });
});

describe('isAutoClusterColumn', () => {
  it('recognises a membership column from its own cluster_validity row', () => {
    expect(isAutoClusterColumn(ROWS, 'cluster_elbow_UMAP 2')).toBe(true);
  });

  it('rejects an ordinary annotation, and a clustering from another projection', () => {
    expect(isAutoClusterColumn(ROWS, 'major_group')).toBe(false);
    // Reconstructed name equality, not a `cluster_` prefix test: PCA 2 has no
    // n_clusters row here, so its column is not one of *this* bundle's clusterings.
    expect(isAutoClusterColumn(ROWS, 'cluster_elbow_PCA 2')).toBe(false);
    expect(isAutoClusterColumn(ROWS, 'cluster_silhouette_UMAP 2')).toBe(false);
  });

  it('answers from cluster_validity, not cluster_agreement', () => {
    // A bundle prepared with no scored annotations emits no agreement rows at all,
    // yet its clusterings are still clusterings. Keying off agreement would answer
    // "no" here and silently drop the caveat exactly where it is needed.
    const noAgreement = ROWS.filter((r) => r.stat_family !== 'cluster_agreement');
    expect(isAutoClusterColumn(noAgreement, 'cluster_elbow_UMAP 2')).toBe(true);
  });

  it('is false for an empty or absent statistics part', () => {
    expect(isAutoClusterColumn(undefined, 'cluster_elbow_UMAP 2')).toBe(false);
    expect(isAutoClusterColumn([], 'cluster_elbow_UMAP 2')).toBe(false);
    expect(isAutoClusterColumn(ROWS, '')).toBe(false);
  });
});

describe('per-category rows', () => {
  const aggregate: ProjectionStatisticRow = row({});

  it('ignores per-category rows when summarising the aggregate', () => {
    const withCategories: ProjectionStatisticRow[] = [
      aggregate,
      { ...aggregate, category: 'Elapidae', value: 0.81 },
      { ...aggregate, category: 'Viperidae', value: -0.15 },
    ];

    const bare = annotationStatSummary([aggregate], 'major_group', 'UMAP 2');
    const mixed = annotationStatSummary(withCategories, 'major_group', 'UMAP 2');

    // Adding per-category rows must not change the aggregate block at all.
    expect(mixed).toEqual(bare);
    expect(mixed!.validity).toHaveLength(1);
    expect(mixed!.validity[0].value).toBeCloseTo(0.326, 3);
  });

  it('does not let a per-category embedding row become the ceiling', () => {
    const rows: ProjectionStatisticRow[] = [
      aggregate,
      // Per-category row listed BEFORE the aggregate embedding row: if the `category == null`
      // filter were ever misplaced (e.g. applied to `inProjection` instead of `forAnnotation`),
      // this row would win the ceiling map's first-write-wins race and the test would catch it.
      {
        ...aggregate,
        space_kind: 'embedding',
        space_name: 'prot_t5',
        category: 'Elapidae',
        value: 0.99,
      },
      { ...aggregate, space_kind: 'embedding', space_name: 'prot_t5', value: 0.095 },
    ];

    const summary = annotationStatSummary(rows, 'major_group', 'UMAP 2');

    expect(summary!.validity[0].embedding).toBeCloseTo(0.095, 3);
  });
});

describe('formatStatValue', () => {
  it('keeps two decimals for bounded scores and drops them for unbounded ones', () => {
    // Two, not three: the third decimal sits below the noise of a subsampled estimate and
    // cost a character in every column of a panel that was wrapping onto second lines.
    expect(formatStatValue(0.326)).toBe('0.33');
    expect(formatStatValue(-0.65094)).toBe('-0.65');
    expect(formatStatValue(851.8693)).toBe('852');
  });

  it('renders a dash for non-finite values', () => {
    expect(formatStatValue(Number.NaN)).toBe('—');
  });

  it('never prints a signed zero', () => {
    expect(formatStatValue(-0.0003)).toBe('0.00');
    expect(formatStatValue(-0)).toBe('0.00');
    expect(formatStatValue(0.0003)).toBe('0.00');
  });

  it('applies the whole-number threshold after rounding', () => {
    expect(formatStatValue(-99.996)).toBe('-100');
    expect(formatStatValue(99.996)).toBe('100');
    expect(formatStatValue(99.4)).toBe('99.40');
  });
});

describe('annotationCategoryScores', () => {
  const base: ProjectionStatisticRow = {
    space_kind: 'projection',
    space_name: 'UMAP 2',
    annotation: 'major_group',
    stat_family: 'annotation_validity',
    label_kind: 'annotation',
    metric: 'silhouette',
    metric_kind: 'validity',
    value: 0,
  };

  it('returns one entry per scored category, with both metrics', () => {
    const rows: ProjectionStatisticRow[] = [
      { ...base, category: 'Elapidae', value: 0.81 },
      { ...base, category: 'Viperidae', value: -0.15 },
      { ...base, metric: 'davies_bouldin', category: 'Elapidae', value: 0.42 },
      { ...base, metric: 'davies_bouldin', category: 'Viperidae', value: 3.9 },
    ];

    const scores = annotationCategoryScores(rows, 'major_group', 'UMAP 2');

    expect(scores).toEqual([
      {
        category: 'Elapidae',
        silhouette: 0.81,
        silhouetteEmbedding: null,
        daviesBouldin: 0.42,
      },
      {
        category: 'Viperidae',
        silhouette: -0.15,
        silhouetteEmbedding: null,
        daviesBouldin: 3.9,
      },
    ]);
  });

  it('picks up the embedding ceiling per category', () => {
    const rows: ProjectionStatisticRow[] = [
      { ...base, category: 'Elapidae', value: 0.44 },
      {
        ...base,
        space_kind: 'embedding',
        space_name: 'prot_t5',
        category: 'Elapidae',
        value: 0.9,
      },
    ];

    const scores = annotationCategoryScores(rows, 'major_group', 'UMAP 2');

    expect(scores[0].silhouetteEmbedding).toBe(0.9);
  });

  it('drops the ceiling when the bundle carries more than one embedding', () => {
    // Nothing links a projection back to the embedding it came from, so a metric
    // scored on two embeddings has no ceiling we can attribute to this projection.
    const rows: ProjectionStatisticRow[] = [
      { ...base, category: 'Elapidae', value: 0.44 },
      {
        ...base,
        space_kind: 'embedding',
        space_name: 'prot_t5',
        category: 'Elapidae',
        value: 0.9,
      },
      {
        ...base,
        space_kind: 'embedding',
        space_name: 'esm2_650m',
        category: 'Elapidae',
        value: 0.2,
      },
    ];

    const scores = annotationCategoryScores(rows, 'major_group', 'UMAP 2');

    expect(scores[0].silhouetteEmbedding).toBeNull();
  });

  it('ignores aggregate rows, other projections and other annotations', () => {
    const rows: ProjectionStatisticRow[] = [
      { ...base, value: 0.326 },
      { ...base, annotation: 'ec_number', category: 'Elapidae', value: 0.2 },
      { ...base, category: 'Elapidae', value: 0.81 },
      // Listed AFTER the correct UMAP 2 row: if the `space_name !== projectionName` guard
      // were ever dropped, this row would win the last-write race and the assertion below
      // would catch it (a PCA 2 row before the UMAP 2 row cannot tell the two apart).
      { ...base, space_name: 'PCA 2', category: 'Elapidae', value: 0.1 },
    ];

    const scores = annotationCategoryScores(rows, 'major_group', 'UMAP 2');

    expect(scores).toHaveLength(1);
    expect(scores[0].silhouette).toBe(0.81);
  });

  it('returns an empty array when there is nothing to plot', () => {
    expect(annotationCategoryScores(undefined, 'major_group', 'UMAP 2')).toEqual([]);
    expect(annotationCategoryScores([], 'major_group', 'UMAP 2')).toEqual([]);
    // Aggregates only: a bundle from before per-category scoring existed.
    expect(annotationCategoryScores([base], 'major_group', 'UMAP 2')).toEqual([]);
  });

  it('skips a category scored only in the embedding', () => {
    // No projection value means no position on the projection axis, so no dot.
    const rows: ProjectionStatisticRow[] = [
      { ...base, category: 'Elapidae', value: 0.44 },
      {
        ...base,
        space_kind: 'embedding',
        space_name: 'prot_t5',
        category: 'Ghost',
        value: 0.7,
      },
    ];

    expect(annotationCategoryScores(rows, 'major_group', 'UMAP 2')).toHaveLength(1);
  });
});

describe('metricDescription', () => {
  it('describes every metric the panel can display', () => {
    // Not "every metric the backend emits" (there are ten): `annotationStatSummary` only ever
    // builds rows from two stat families, `annotation_validity` (silhouette, Davies-Bouldin,
    // Calinski-Harabasz) and `cluster_agreement` (ARI, NMI). Faithfulness metrics live in a
    // different family and n_clusters is filtered out as `metric_kind === 'meta'`, so none of
    // the other five can ever reach `_renderStatMetric`.
    for (const metric of [
      'silhouette',
      'davies_bouldin',
      'calinski_harabasz',
      'adjusted_rand',
      'normalized_mutual_info',
    ]) {
      expect(metricDescription(metric).length).toBeGreaterThan(20);
    }
  });

  it('returns an empty string for an unknown metric', () => {
    // A newer backend metric must render without a popover, not with an empty one.
    expect(metricDescription('some_future_metric')).toBe('');
  });
});
