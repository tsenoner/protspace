import { html, nothing, type TemplateResult } from 'lit';
import { AUTO_CLUSTER_SCORE_CAVEAT, metricDisplay, type CategoryScore } from '@protspace/utils';
import './category-score-strip';
import type { ScoreStripPoint } from './category-score-strip';
import type { LegendItem } from './types';

/**
 * A scored category grouped under Other has no row colour; its dot is grey. The point is flagged
 * `other`, and on screen the strip fills it with the themed --ps-plot-other.
 */
const OTHER_POINT_COLOR = '#888';

/** Silhouette's fixed axis. One array, so the strip's `.domain` binding does not change per render. */
const SILHOUETTE_DOMAIN: [number, number] = [-1, 1];

/** The dots of both strips and the Davies-Bouldin axis. */
export interface StripPoints {
  silhouette: ScoreStripPoint[];
  daviesBouldin: ScoreStripPoint[];
  daviesBouldinDomain: [number, number];
}

export const EMPTY_STRIP_POINTS: StripPoints = {
  silhouette: [],
  daviesBouldin: [],
  daviesBouldinDomain: [0, 1],
};

/** What the strips show. */
export interface ScoreStripsView {
  /** The annotation was scored; without scores nothing renders. */
  hasScores: boolean;
  /** The view shows a subset (a filter or an isolation): the strips step aside with a note. */
  filtered: boolean;
  points: StripPoints;
  /** The category under the pointer, from a row or a strip. */
  highlighted: string | null;
  /** The annotation is an auto-clustering column, whose scores are optimistic. */
  clusterCaveat: boolean;
}

/** What a strip's pointer events do. */
export interface ScoreStripsHandlers {
  onHover(category: string | null): void;
  onToggle(category: string): void;
}

/**
 * Dots for one metric, in the legend's own colours so the mapping to rows is legible before any
 * hover happens. A category swept into the "Other" bucket still gets a dot, greyed: the scores
 * are computed over the whole dataset regardless of what the legend chooses to show, and dropping
 * those dots would misstate the distribution.
 */
function stripPoints(
  colorByValue: Map<string, string>,
  scores: readonly CategoryScore[],
  pick: (score: CategoryScore) => number | null,
  pickEmbedding?: (score: CategoryScore) => number | null,
): ScoreStripPoint[] {
  const points: ScoreStripPoint[] = [];
  for (const score of scores) {
    const value = pick(score);
    if (value === null) continue;
    const rowColor = colorByValue.get(score.category);
    const point: ScoreStripPoint = {
      category: score.category,
      value,
      color: rowColor ?? OTHER_POINT_COLOR,
      embedding: pickEmbedding?.(score) ?? null,
    };
    if (rowColor === undefined) point.other = true;
    points.push(point);
  }
  return points;
}

/**
 * Strip geometry. The legend derives it in `willUpdate`, not in render: it depends only on the
 * legend items and the scores, while the most frequent cause of a legend re-render is a hover,
 * which changes neither.
 */
export function deriveStripPoints(
  items: readonly LegendItem[],
  scores: readonly CategoryScore[],
): StripPoints {
  // One map for both strips: it is keyed by the same legend items either way.
  const colorByValue = new Map(items.map((item) => [item.value, item.color]));
  // Davies-Bouldin has no embedding-space counterpart on CategoryScore, so only the
  // silhouette strip's tooltip carries an embedding reference.
  const silhouette = stripPoints(
    colorByValue,
    scores,
    (score) => score.silhouette,
    (score) => score.silhouetteEmbedding,
  );
  const daviesBouldin = stripPoints(colorByValue, scores, (score) => score.daviesBouldin);
  // Silhouette is bounded to [-1, 1], so its axis is fixed and comparable across datasets.
  // Davies-Bouldin is unbounded above, so it scales to the data at hand. Folded rather than
  // spread into Math.min/max: the argument list would grow with the category count, and a
  // high-cardinality annotation would blow the call-argument limit.
  let low = Infinity;
  let high = -Infinity;
  for (const point of daviesBouldin) {
    if (point.value < low) low = point.value;
    if (point.value > high) high = point.value;
  }
  return {
    silhouette,
    daviesBouldin,
    daviesBouldinDomain: daviesBouldin.length > 0 ? [low, high] : [0, 1],
  };
}

/**
 * One metric's strip. Name and optimisation direction come from `metricDisplay`, the same entry
 * the metadata panel's rows read, so the two panels cannot name a metric differently and a
 * metric added to that map arrives here already labelled.
 */
function renderScoreStrip(
  metric: string,
  points: ScoreStripPoint[],
  domain: [number, number],
  highlighted: string | null,
): TemplateResult {
  const { label, higherIsBetter, description } = metricDisplay(metric);
  return html`
    <protspace-score-strip
      label=${label}
      .description=${description}
      .higherIsBetter=${higherIsBetter}
      .points=${points}
      .domain=${domain}
      .highlighted=${highlighted}
    ></protspace-score-strip>
  `;
}

/**
 * The separation strips. Nothing when the annotation was never scored or the bundle carries no
 * statistics. While the view shows a subset the numbers, which describe the whole dataset and do
 * not recompute, would misdescribe what is on screen, so the strips step aside and say so.
 */
export function renderScoreStrips(
  view: ScoreStripsView,
  handlers: ScoreStripsHandlers,
): TemplateResult | typeof nothing {
  if (!view.hasScores) return nothing;
  if (view.filtered) {
    return html`<p class="score-strips-note">
      Separation scores are hidden while the view is filtered.
    </p>`;
  }

  const { silhouette, daviesBouldin, daviesBouldinDomain } = view.points;
  // The caveat is stated here rather than only in the projection-metadata panel: this is where
  // the per-category numbers are actually read, and a user hovering rows may never open that
  // panel.
  return html`
    <section
      class="score-strips"
      aria-label="Separation by category"
      @strip-hover=${(event: CustomEvent<{ category: string | null }>) =>
        handlers.onHover(event.detail.category)}
      @strip-click=${(event: CustomEvent<{ category: string }>) =>
        handlers.onToggle(event.detail.category)}
    >
      ${renderScoreStrip('silhouette', silhouette, SILHOUETTE_DOMAIN, view.highlighted)}
      ${daviesBouldin.length > 0
        ? renderScoreStrip('davies_bouldin', daviesBouldin, daviesBouldinDomain, view.highlighted)
        : nothing}
      ${view.clusterCaveat
        ? html`<p class="score-strips-caveat">${AUTO_CLUSTER_SCORE_CAVEAT}</p>`
        : nothing}
    </section>
  `;
}
