import type { ProjectionStatisticRow } from '../types.js';

/**
 * Selects the per-annotation slice of the optional `statistics.parquet` bundle part, so the
 * annotation picker can answer "how well does colouring by this annotation actually separate
 * in the projection I'm looking at?".
 *
 * Everything here is defensive: a bundle may carry no statistics at all, statistics for only
 * some annotations, or only some metrics per annotation (the backend skips Davies–Bouldin and
 * Calinski–Harabasz for high-cardinality annotations). Rows that aren't scores (`metric_kind
 * === 'meta'`, e.g. `n_clusters`) are never surfaced.
 */

/**
 * Display name, optimisation direction and popover copy per metric, and the render order
 * within a group. `description` is required by the type, so a metric added here without one
 * is a compile error rather than a silently missing ⓘ icon.
 */
const METRIC_DISPLAY: Record<
  string,
  { label: string; higherIsBetter: boolean; description: string }
> = {
  silhouette: {
    label: 'Silhouette',
    higherIsBetter: true,
    description:
      'How well each protein sits inside its own group rather than a neighbouring one, ' +
      'averaged. Runs from -1 to 1: above 0.5 is a clear separation, near 0 means the ' +
      'groups overlap, and below 0 means proteins are typically closer to another group.',
  },
  davies_bouldin: {
    label: 'Davies–Bouldin',
    higherIsBetter: false,
    description:
      'The average overlap between each group and the group it is most confusable with. ' +
      'Lower is better, and 0 would be perfect separation. It has no upper bound, so read ' +
      'it by comparing projections rather than against a fixed threshold.',
  },
  calinski_harabasz: {
    label: 'Calinski–Harabasz',
    higherIsBetter: true,
    description:
      'The spread between groups divided by the spread within them. Higher is better. ' +
      'It has no upper bound and grows with dataset size, so compare it only across ' +
      'projections of the same data.',
  },
  adjusted_rand: {
    label: 'ARI',
    higherIsBetter: true,
    description:
      'How closely the automatic clustering reproduces this annotation, corrected for ' +
      'agreement that chance alone would produce. 1 is an exact match, 0 is no better than ' +
      'random, and it goes negative when the clustering disagrees with the annotation more ' +
      'than chance would.',
  },
  normalized_mutual_info: {
    label: 'NMI',
    higherIsBetter: true,
    description:
      'How much knowing the automatic cluster tells you about the annotation, on a 0 to 1 ' +
      'scale. Unlike ARI it is not corrected for chance, so it reads higher, and the gap ' +
      'between the two widens as the cluster count grows.',
  },

  // Faithfulness: how well the 2D picture reproduces the embedding it came from, independent
  // of any annotation. Same registry as the metrics above so every surface reads names,
  // directions and explanations from one place; they never share a sorted list, so their
  // position in `METRIC_ORDER` is immaterial.
  knn_overlap: {
    label: 'kNN Overlap',
    higherIsBetter: true,
    description:
      "The share of each protein's nearest neighbours in the full embedding that are still " +
      'among its nearest neighbours here, on a 0 to 1 scale. The strictest of the local ' +
      'measures: it asks for the same neighbours, not merely nearby ones.',
  },
  trustworthiness: {
    label: 'Trustworthiness',
    higherIsBetter: true,
    description:
      'How much you can trust the neighbours you see: it penalises proteins drawn close ' +
      'together here that are far apart in the full embedding. Near 1 means few such false ' +
      'neighbours, so clusters you see on screen are unlikely to be artefacts.',
  },
  continuity: {
    label: 'Continuity',
    higherIsBetter: true,
    description:
      "Trustworthiness' opposite: it penalises proteins that are neighbours in the full " +
      'embedding but got pulled apart here. Near 1 means little was torn apart, so a gap ' +
      'you see is unlikely to hide a real relationship.',
  },
  random_triplet: {
    label: 'Random Triplet',
    higherIsBetter: true,
    description:
      'Take three proteins at random: does this projection agree with the full embedding ' +
      'about which two are the closer pair? This is the share of such triplets it gets ' +
      'right, so 0.5 is a coin flip. It reads long-range layout, not local neighbourhoods.',
  },
  spearman_distance: {
    label: 'Spearman Distance',
    higherIsBetter: true,
    description:
      'The rank correlation between every pairwise distance here and the same distance in ' +
      'the full embedding. Near 1 means the overall spacing is preserved, so distances ' +
      'across the whole plot can be compared, not just within a cluster.',
  },
};

/**
 * How a metric presents itself. The single accessor for `METRIC_DISPLAY`, so a surface that
 * renders a metric — the metadata panel's rows, the legend's score strips — names it and states
 * its direction from the same entry rather than restating either. An unknown metric (a newer
 * backend adding one) falls back to its raw name, higher-is-better, and no explanation.
 */
export function metricDisplay(metric: string): {
  label: string;
  higherIsBetter: boolean;
  description: string;
} {
  return METRIC_DISPLAY[metric] ?? { label: metric, higherIsBetter: true, description: '' };
}

/** Explanation for a metric, shown behind the ⓘ icon, or '' when there is none (render no popover). */
export function metricDescription(metric: string): string {
  return metricDisplay(metric).description;
}

/**
 * Render order, derived from the display map rather than restated: a metric added to
 * `METRIC_DISPLAY` alone would otherwise silently sort last. Validity and agreement metrics
 * never share a list, so one order covers both.
 */
const METRIC_ORDER = Object.keys(METRIC_DISPLAY);

export interface AnnotationStatMetric {
  metric: string;
  /** Human-readable metric name. */
  label: string;
  value: number;
  /**
   * The same metric scored on the source embedding, the separability "ceiling" a 2D
   * projection is measured against. `null` when the bundle has no embedding-space row.
   */
  embedding: number | null;
  /** False for Davies–Bouldin; true for every other metric currently emitted. */
  higherIsBetter: boolean;
}

export interface AnnotationStatSummary {
  /** How cleanly the annotation's own categories separate in this projection. */
  validity: AnnotationStatMetric[];
  /** Categories the scores were computed over; `null` when the bundle omits the provenance. */
  categories: number | null;
  /** Proteins the scores were computed over, which can be fewer than the dataset holds. */
  scored: number | null;
}

/**
 * A count from a row's `extra_json` provenance. That column is written by a separate toolchain, so
 * a missing, malformed or non-numeric entry means "unknown", never an exception.
 */
function extraCount(row: ProjectionStatisticRow | undefined, key: string): number | null {
  if (!row?.extra_json) return null;
  try {
    const value = (JSON.parse(row.extra_json) as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function toMetric(
  row: ProjectionStatisticRow,
  embeddingValue: number | null,
): AnnotationStatMetric {
  const display = metricDisplay(row.metric);
  return {
    metric: row.metric,
    label: display.label,
    value: row.value,
    embedding: embeddingValue,
    higherIsBetter: display.higherIsBetter,
  };
}

/**
 * The source-embedding ceiling per metric: the same metric scored on the embedding a 2D
 * projection is measured against, keyed by metric.
 *
 * A bundle prepared from several embeddings carries one row per (annotation, metric, embedding) —
 * the driver runs the embedding pass once per embedding set — and nothing in the tidy schema links
 * a projection back to the embedding it came from. A metric scored on more than one embedding
 * therefore has no ceiling that can be attributed to this projection: it maps to `null` rather
 * than to some other embedding's number. A metric with no embedding row at all is simply absent.
 *
 * Shared by the aggregate and per-category selectors so the rule is written once and both scope it
 * the same way — per metric, not per annotation, so one metric scored on two embeddings cannot
 * suppress the ceiling of a metric scored on one. Per-category rows carry one embedding row per
 * (metric, embedding, category), which the same-source check tolerates.
 */
function embeddingCeilings(
  rows: readonly ProjectionStatisticRow[],
): Map<string, { source: string; value: number } | null> {
  const ceilings = new Map<string, { source: string; value: number } | null>();
  for (const row of rows) {
    if (row.space_kind !== 'embedding' || row.stat_family !== 'annotation_validity') continue;
    const entry = ceilings.get(row.metric);
    if (entry === undefined) {
      ceilings.set(row.metric, { source: row.space_name, value: row.value });
    } else if (entry !== null && entry.source !== row.space_name) {
      ceilings.set(row.metric, null);
    }
  }
  return ceilings;
}

/** Position of `key` in `order`; unknown keys (a newer backend adding one) sort last. */
function orderIndex(order: string[], key: string): number {
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
}

const byMetricOrder = (a: AnnotationStatMetric, b: AnnotationStatMetric) =>
  orderIndex(METRIC_ORDER, a.metric) - orderIndex(METRIC_ORDER, b.metric);

/**
 * Build the statistics shown behind an annotation's ⓘ icon, or `null` when the bundle has no
 * score for this (annotation, projection) pair, which is also the "should we show the icon at
 * all?" test.
 *
 * @param statistics Rows from the bundle's statistics part, if any.
 * @param annotation Annotation column name, matched against `statistics.annotation`.
 * @param projectionName Currently selected projection, matched against `statistics.space_name`.
 */
export function annotationStatSummary(
  statistics: readonly ProjectionStatisticRow[] | undefined,
  annotation: string,
  projectionName: string,
): AnnotationStatSummary | null {
  if (!statistics?.length || !annotation) return null;

  // A non-finite value (NaN/null from a foreign writer) is not a score: it must not switch
  // the ⓘ icon on, and a NaN ceiling would defeat the `embedding === null` column collapse.
  // Per-category rows are excluded here rather than at each use: this summary is the
  // whole-annotation view, and `annotationCategoryScores` is the per-category one.
  const forAnnotation = statistics.filter(
    (row) =>
      row.annotation === annotation &&
      row.metric_kind !== 'meta' &&
      row.category == null &&
      Number.isFinite(row.value),
  );
  if (forAnnotation.length === 0) return null;

  const ceilings = embeddingCeilings(forAnnotation);

  const inProjection = forAnnotation.filter(
    (row) => row.space_kind === 'projection' && row.space_name === projectionName,
  );

  const validity = inProjection
    .filter((row) => row.stat_family === 'annotation_validity')
    .map((row) => toMetric(row, ceilings.get(row.metric)?.value ?? null))
    .sort(byMetricOrder);

  if (validity.length === 0) return null;

  // What the scores cover, from the validity rows' own provenance. `inProjection` only ever
  // holds aggregate rows (per-category rows were already filtered out of `forAnnotation`
  // above), and `validity` is non-empty past the guard above, so this always finds a row.
  const scopeRow = inProjection.find((row) => row.stat_family === 'annotation_validity');
  return {
    validity,
    categories: extraCount(scopeRow, 'n_categories'),
    scored: extraCount(scopeRow, 'n_labels'),
  };
}

/**
 * The column name the backend gives one K-selection's auto-clustering, reconstructed (never
 * parsed) from a `cluster_agreement` row's own `label_kind` + `space_name`
 * (`ClusterValidityStatistic` in `apps/protspace/src/protspace/stats/metrics/validity.py`).
 * A projection name can itself contain underscores, so splitting a column name apart is
 * ambiguous; rebuilding the name and comparing for equality is exact. `null` for any other
 * `label_kind`, so an unrecognised one can never accidentally match.
 */
function clusterColumnName(labelKind: string, spaceName: string): string | null {
  if (labelKind === 'kmeans_elbow') return `cluster_elbow_${spaceName}`;
  if (labelKind === 'kmeans_silhouette') return `cluster_silhouette_${spaceName}`;
  return null;
}

/**
 * Whether `annotation` is one of the backend's auto-clustering membership columns.
 *
 * Tested against the `cluster_validity` rows (`n_clusters`), which are emitted for every
 * labelling unconditionally -- unlike `cluster_agreement`, which needs at least one scored
 * annotation to compare against, so a bundle prepared without annotations would answer
 * "no" for a column that plainly is one.
 *
 * Callers use it to caveat separation scores: KMeans drew the boundaries being scored, and
 * a `cluster_silhouette_*` column's K was chosen by maximising that very silhouette.
 */
export function isAutoClusterColumn(
  statistics: readonly ProjectionStatisticRow[] | undefined,
  annotation: string,
): boolean {
  if (!statistics?.length || !annotation) return false;
  return statistics.some(
    (row) =>
      row.stat_family === 'cluster_validity' &&
      clusterColumnName(row.label_kind, row.space_name) === annotation,
  );
}

/**
 * Whether a column *name* is one the backend generates for an auto-clustering, judged from the
 * name alone.
 *
 * The counterpart to `isAutoClusterColumn`, for the callers that only need to know what kind of
 * column this is rather than which statistics rows describe it. Two reasons it must not consult
 * the rows:
 *
 * - The rows are not always there. `sliceVisualizationDataByIndices` clears them for a filtered
 *   or isolated view, and a bundle re-exported from that view carries the `cluster_*` column and
 *   its per-point payload but no statistics part at all. A rows-based test answers "no" there and
 *   the caller then treats a generated column as a curated one.
 * - The rows are long-format and now carry a row per category, so scanning them to answer a
 *   question about a string costs a full table pass on paths that run per hovered point.
 *
 * `isAutoClusterColumn` stays the right test wherever a row must actually be *matched* — the
 * caveat surfaces, which are asking "did this run score this clustering?", not "what is this
 * column?". A projection name may itself contain underscores, so this deliberately tests the
 * generated prefixes rather than trying to split the suffix back apart.
 */
export function isAutoClusterColumnName(annotation: string): boolean {
  return annotation.startsWith('cluster_elbow_') || annotation.startsWith('cluster_silhouette_');
}

/**
 * The caveat every surface must print alongside an auto-cluster column's own separation scores,
 * gated on `isAutoClusterColumn` above. One string rather than one per surface: it exists to stop
 * a number being misread, so the legend strips and the metadata panel must not be able to word it
 * differently, or to have it corrected in only one of the two.
 */
export const AUTO_CLUSTER_SCORE_CAVEAT =
  'K-means found these clusters in this projection, so these scores are optimistic.';

/** One annotation, and how well the selected auto-clustering recovers it. */
export interface ClusterAgreementEntry {
  annotation: string;
  metrics: AnnotationStatMetric[];
  /**
   * How many categories this annotation has. Not decoration: ARI's achievable maximum depends on
   * the annotation's cardinality relative to K, so a bare ARI is not comparable between a
   * 4-category and a 42-category annotation. `null` when the bundle carries no provenance.
   */
  categories: number | null;
  /**
   * Proteins this comparison covered. An annotation that labels only part of the dataset is
   * scored on that part — the demo's headline `ec` row at ARI 0.91 covers 192 of 811 proteins —
   * and without it thin coverage is indistinguishable from a genuinely strong match.
   */
  scored: number | null;
}

/** The selected auto-clustering, and every annotation it was compared against. */
export interface ClusterAgreement {
  /** Clusters this labelling produced (K). The denominator each ARI is implicitly measured against. */
  clusters: number | null;
  /** Best-recovered first, by ARI. */
  entries: ClusterAgreementEntry[];
}

/**
 * ARI/NMI agreement for the auto-clustering the caller has selected, against every annotation
 * the backend compared it to, read in its natural direction: this clustering, at this K,
 * recovers each annotation at this ARI and NMI.
 *
 * The backend never files a `cluster_agreement` row under the cluster column's own name: like
 * every other stat, it's filed under the annotation being *scored* (`major_group`, `ec_number`,
 * …; see `annotationStatSummary` above). So the only way to find "this clustering"'s rows is to
 * reconstruct each row's column name via `clusterColumnName` and test it against what's
 * selected, never by filtering on `row.annotation`. That is specific to `cluster_agreement`:
 * a clustering's own `annotation_validity` rows ARE filed under the column's name, and
 * `annotationStatSummary` / `annotationCategoryScores` find them the ordinary way.
 *
 * Returns `[]` for anything that isn't one of the backend's `cluster_elbow_*` /
 * `cluster_silhouette_*` shapes, which doubles as the "should the block render at all" test.
 *
 * @param statistics Rows from the bundle's statistics part, if any.
 * @param clusterColumn Selected annotation column.
 */
export function clusterAgreement(
  statistics: readonly ProjectionStatisticRow[] | undefined,
  clusterColumn: string,
): ClusterAgreement {
  if (!statistics?.length || !clusterColumn) return { clusters: null, entries: [] };

  const byAnnotation = new Map<string, AnnotationStatMetric[]>();
  for (const row of statistics) {
    if (row.stat_family !== 'cluster_agreement' || !Number.isFinite(row.value)) continue;
    if (clusterColumnName(row.label_kind, row.space_name) !== clusterColumn) continue;
    const metrics = byAnnotation.get(row.annotation) ?? [];
    metrics.push(toMetric(row, null));
    byAnnotation.set(row.annotation, metrics);
  }
  if (byAnnotation.size === 0) return { clusters: null, entries: [] };

  // The counts the agreement rows themselves do not carry. `cluster_agreement` provenance holds
  // only {n_labels, seed}; the annotation's cardinality lives on its own `annotation_validity`
  // rows, and the clustering's K is the cardinality of the cluster column, which is filed as an
  // annotation in its own right. Both are a join away in this same table, so neither needs a
  // backend change — and a bundle missing either simply renders without it.
  const validityProvenance = (annotation: string): ProjectionStatisticRow | undefined =>
    statistics.find(
      (row) =>
        row.stat_family === 'annotation_validity' &&
        row.annotation === annotation &&
        row.category == null &&
        !!row.extra_json,
    );

  const entries = [...byAnnotation.entries()].map(([annotation, metrics]) => {
    const provenance = validityProvenance(annotation);
    const agreementRow = statistics.find(
      (row) =>
        row.stat_family === 'cluster_agreement' &&
        row.annotation === annotation &&
        clusterColumnName(row.label_kind, row.space_name) === clusterColumn,
    );
    return {
      annotation,
      metrics: metrics.sort(byMetricOrder),
      categories: extraCount(provenance, 'n_categories'),
      // From the agreement row, not the validity row: the two passes can cover different
      // protein sets, and this number must describe the comparison actually shown.
      scored: extraCount(agreementRow, 'n_labels'),
    };
  });

  // Best-recovered first. The block answers "which known biology do these clusters correspond
  // to?", which is a ranking question — read in row order it was a lookup table you had to scan.
  // Keyed on the metric by NAME, not by index: an annotation can carry only one of the two.
  // Ties fall back to the name so the order is stable across renders and across bundles.
  const ariOf = (entry: ClusterAgreementEntry): number =>
    entry.metrics.find((metric) => metric.metric === 'adjusted_rand')?.value ??
    Number.NEGATIVE_INFINITY;
  entries.sort((a, b) => ariOf(b) - ariOf(a) || a.annotation.localeCompare(b.annotation));

  return { clusters: extraCount(validityProvenance(clusterColumn), 'n_categories'), entries };
}

/**
 * Whether an (annotation, projection) pair has at least one metric row worth rendering: the one
 * test the dropdown's "has stats" badge and the panel's render gate must share, so the two
 * cannot drift the way `annotationStatSummary(...) !== null` and `stats || agreement.length > 0`
 * once did. `summary` can be non-null with zero validity rows (a category a subsampled validity
 * pass drops while the unsampled agreement pass still recovers it), which is content-free on its
 * own; `agreement` (from `clusterAgreement`) is what makes a `cluster_*` column count when its
 * own separation scores are missing, as in a bundle written before clusterings were self-scored.
 */
export function hasAnnotationStats(
  summary: AnnotationStatSummary | null,
  agreement: ClusterAgreement,
): boolean {
  return (summary?.validity.length ?? 0) > 0 || agreement.entries.length > 0;
}

/**
 * Format a statistic for display. Calinski–Harabasz is unbounded and runs into the hundreds or
 * thousands, so it would waste the popover's width at 3 decimals; bounded scores keep them.
 */
export function formatStatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  // Two decimals, not three. Silhouette spans -1..1 and Davies-Bouldin single digits, so the
  // third decimal is below the noise these estimates carry — they are computed on a subsample
  // — and it cost a character in every column of a panel already wrapping onto second lines.
  // Round before testing the threshold, so -99.996 renders as "-100" and not "-100.00"; and
  // drop the sign `toFixed` keeps on a value that rounded to zero, which reads as a glitch.
  const decimals = value.toFixed(2);
  const rounded = Number(decimals);
  const text = Math.abs(rounded) >= 100 ? value.toFixed(0) : decimals;
  return rounded === 0 ? text.replace('-', '') : text;
}

/** One category's separation scores, as plotted on the legend's score strips. */
export interface CategoryScore {
  category: string;
  /** Silhouette in the selected projection. Never null for a returned entry. */
  silhouette: number | null;
  /** The same metric on the source embedding: this category's ceiling. */
  silhouetteEmbedding: number | null;
  /** Per-cluster Davies-Bouldin: overlap with the single worst rival category. */
  daviesBouldin: number | null;
}

/**
 * Per-category scores for the legend strips, the counterpart to
 * `annotationStatSummary`'s whole-annotation view.
 *
 * Returns an empty array whenever there is nothing to plot: no statistics part, an
 * annotation the run did not score, or a bundle written before per-category rows
 * existed. That emptiness is also the "should the strips render at all" test.
 */
export function annotationCategoryScores(
  statistics: readonly ProjectionStatisticRow[] | undefined,
  annotation: string,
  projectionName: string,
): CategoryScore[] {
  if (!statistics?.length || !annotation) return [];

  const rows = statistics.filter(
    (row) =>
      row.annotation === annotation &&
      row.stat_family === 'annotation_validity' &&
      typeof row.category === 'string' &&
      row.category.length > 0 &&
      Number.isFinite(row.value),
  );
  if (rows.length === 0) return [];

  // Literally the same rule as the aggregate summary, via the same helper.
  const ceilings = embeddingCeilings(rows);

  const byCategory = new Map<string, CategoryScore>();
  const entryFor = (category: string): CategoryScore => {
    let entry = byCategory.get(category);
    if (!entry) {
      entry = {
        category,
        silhouette: null,
        silhouetteEmbedding: null,
        daviesBouldin: null,
      };
      byCategory.set(category, entry);
    }
    return entry;
  };

  for (const row of rows) {
    const entry = entryFor(row.category as string);
    if (row.space_kind === 'embedding') {
      if (row.metric === 'silhouette' && ceilings.get('silhouette') !== null) {
        entry.silhouetteEmbedding = row.value;
      }
      continue;
    }
    if (row.space_name !== projectionName) continue;
    if (row.metric === 'silhouette') entry.silhouette = row.value;
    else if (row.metric === 'davies_bouldin') entry.daviesBouldin = row.value;
  }

  // A category scored only in the embedding has no position on the projection axis.
  return [...byCategory.values()].filter((entry) => entry.silhouette !== null);
}
