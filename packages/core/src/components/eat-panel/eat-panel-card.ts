import { html, nothing, type TemplateResult } from 'lit';
import {
  countNoun,
  formatCount,
  getPredictedCellValues,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import '../kit/button';
import '../kit/tooltip';
import { formatPercent, formatReliabilityIn, rangeText } from '../query-builder/eat-reliability';
import { swatchColor } from './eat-panel-breakdown';
import { isKept, rankOf, type EatIndex } from './eat-summary';

const UNRESOLVED_REASON = 'The source is not in this dataset';

/** What the card shows that does not move with the threshold, worked out once per selection. */
export interface EatCardFacts {
  /** The prediction's rank in the whole dataset; null for a protein without one. */
  rank: { below: number; above: number; total: number } | null;
  /** The source's protein index; null when it is not in the dataset or there is no prediction. */
  sourceIndex: number | null;
}

export function cardFacts(
  data: VisualizationData,
  annotation: string,
  index: EatIndex,
  protein: number,
): EatCardFacts {
  const cell = data.annotation_predicted?.[annotation]?.[protein];
  if (!cell) return { rank: null, sourceIndex: null };
  const found = cell.sourceIndex ?? data.protein_ids.indexOf(cell.source);
  return { rank: rankOf(index, protein), sourceIndex: found >= 0 ? found : null };
}

interface EatCardView {
  data: VisualizationData;
  annotation: string;
  index: EatIndex;
  /** The single selected protein's index. */
  protein: number;
  facts: EatCardFacts;
  labelColors: ReadonlyMap<string, string>;
  /** The phone's strip: one row, no eyebrow, no label text, no rank. */
  compact: boolean;
  /** The reliability range, and what the map does with a prediction outside it. */
  reliability: EatReliabilityState;
  /** Show predictions: off, no prediction is hidden or faded, all show as N/A. */
  shown: boolean;
  faded: boolean;
  onGoToSource(detail: { targetId: string; targetIndex: number; sourceId: string }): void;
  onTraceSource(detail: { sourceId: string; sourceIndex: number }): void;
  /** `Show faded`: switch the outcome to Fade. */
  onShowFaded(): void;
}

/** Whether a source's own value is curated or predicted; '' when it has none. */
function originOf(view: EatCardView, protein: number): string {
  const { data, annotation, index } = view;
  if (data.annotation_predicted?.[annotation]?.[protein]) return 'predicted';
  return index.curatedOffsets[protein] < index.curatedOffsets[protein + 1] ? 'curated' : '';
}

/** A curated protein's own labels. */
function curatedLabels(index: EatIndex, protein: number): string[] {
  const labels: string[] = [];
  for (let h = index.curatedOffsets[protein]; h < index.curatedOffsets[protein + 1]; h++) {
    labels.push(index.labels[index.curatedHits[h]]);
  }
  return labels;
}

const sourceOf = (count: number) => `source of ${countNoun(count, 'prediction', 'predictions')}`;

/** `source of 9 predictions`: draws the source's lines without selecting it. */
function sourceLink(
  view: EatCardView,
  sourceId: string,
  sourceIndex: number,
  count: number,
): TemplateResult {
  return html`<button
    type="button"
    class="eat-card-link"
    aria-label=${`${sourceId} is the ${sourceOf(count)}`}
    @click=${() => view.onTraceSource({ sourceId, sourceIndex })}
  >
    ${sourceOf(count)}
  </button>`;
}

/**
 * `More reliable than 72 % of the 659 predictions` at or above the middle, `Less reliable than
 * 99 % of …` below it. Floored, so the strongest is never more reliable than 100 % of them; a
 * share that floors to 0 says nothing and is left out.
 */
function rankText(rank: { below: number; above: number; total: number }): string | null {
  const more = rank.below / rank.total >= 0.5;
  const share = Math.floor(((more ? rank.below : rank.above) * 100) / rank.total);
  if (share === 0) return null;
  return `${more ? 'More' : 'Less'} reliable than ${share}\u202f% of the ${formatCount(rank.total)} predictions`;
}

/**
 * `Hidden on the map: outside the 50–100 % range · Show faded` (Fade: `Faded on the map: …`),
 * for a prediction the range leaves out; nothing while it is in range or Show is off.
 */
function renderOutside(view: EatCardView, confidence: number): TemplateResult | typeof nothing {
  if (!view.shown || isKept(view.reliability, confidence)) return nothing;
  const range = `outside the ${rangeText(view.reliability)} range`;
  return html`<p class="eat-card-outside eat-card-facts">
    ${view.faded
      ? `Faded on the map: ${range}`
      : html`<span class="eat-card-fact">Hidden on the map: ${range}</span>
          <span class="eat-card-fact"
            >${SEP}<button type="button" class="eat-card-link" @click=${() => view.onShowFaded()}>
              Show faded
            </button></span
          >`}
  </p>`;
}

/**
 * The dot between two facts of a line (`.eat-card-facts`). A fact never breaks; when the next
 * one does not fit beside it, the panel marks the line wrapped: each fact takes a line of its
 * own, without the dot, and a fact about the source names it (`.eat-card-subject`).
 */
const SEP = html`<span class="eat-card-sep">· </span>`;

const subject = (id: string) =>
  html`<span class="eat-card-subject" aria-hidden="true">${id} is the </span>`;

const eyebrow = html`<p class="eat-card-eyebrow" aria-hidden="true">Selected protein</p>`;

/**
 * The selected protein's strip, a footer under the panel's scroll area (Decision 4, U21, U22):
 * for a prediction of the Color by annotation, a ring in its label's colour, its id, label(s) and
 * reliability; the protein it was copied from, whether that one is curated or predicted, how many
 * it is the source of (a link that draws them) and Go to source; its rank; and, when the range
 * leaves it out, what the map does with it. For a source, its own labels and its count. Anything
 * else, nothing. Compact, it is one row: id, reliability, source and Go to source.
 */
export function renderCard(view: EatCardView): TemplateResult | typeof nothing {
  const { data, annotation, index, protein, labelColors, facts, compact } = view;
  const id = data.protein_ids[protein];
  if (id === undefined) return nothing;
  const cell = data.annotation_predicted?.[annotation]?.[protein] ?? null;
  const ownLent = index.lentCount.get(id) ?? 0;

  if (!cell) {
    if (ownLent === 0) return nothing;
    const labels = curatedLabels(index, protein);
    const color = swatchColor(labelColors, labels[0] ?? '');
    const facts = html`${labels.length > 0
        ? html`<span class="eat-card-fact">Curated</span> `
        : nothing}<span class="eat-card-fact"
        >${labels.length > 0 ? SEP : nothing}${sourceLink(view, id, protein, ownLent)}</span
      >`;
    return html`<section class="eat-card" aria-label="Selected protein">
      ${compact ? nothing : eyebrow}
      <p class="eat-card-title">
        <span
          class="eat-swatch"
          style=${color ? `background:${color}` : nothing}
          aria-hidden="true"
        ></span>
        <span class="eat-card-id">${id}</span>
        <span class=${compact ? 'sr-only' : 'eat-card-labels'} title=${labels.join(', ')}
          >${labels.join(', ')}</span
        >
        ${compact ? html`<span class="eat-card-line">· ${facts}</span>` : nothing}
      </p>
      ${compact ? nothing : html`<p class="eat-card-line eat-card-facts">${facts}</p>`}
    </section>`;
  }

  const labels = getPredictedCellValues(cell);
  const labelText = labels.join(', ');
  const color = swatchColor(labelColors, labels[0] ?? '');
  const sourceId = cell.source;
  const { rank, sourceIndex } = facts;
  const origin = sourceIndex === null ? 'not in this dataset' : originOf(view, sourceIndex);
  const sourceLent = index.lentCount.get(sourceId) ?? 0;
  const reliability = `reliability ${
    view.shown
      ? formatReliabilityIn(cell.confidence, view.reliability)
      : formatPercent(cell.confidence)
  }`;
  const goToSource = html`<span class="eat-card-actions">
    <ps-button
      size="sm"
      variant="primary"
      class="eat-go-to-source"
      ?disabled=${sourceIndex === null}
      @click=${() => {
        if (sourceIndex !== null)
          view.onGoToSource({ targetId: id, targetIndex: protein, sourceId });
      }}
      >Go to source</ps-button
    >${sourceIndex === null ? html`<ps-tooltip text=${UNRESOLVED_REASON}></ps-tooltip>` : nothing}
  </span>`;
  const ring = html`<span
    class="eat-ring"
    style=${color ? `border-color:${color}` : nothing}
    aria-hidden="true"
  ></span>`;

  if (compact) {
    return html`<section class="eat-card" aria-label="Selected protein">
      <div class="eat-card-row">
        <p class="eat-card-title">
          ${ring}
          <span class="eat-card-id">${id}</span>
          <span class="sr-only">${labelText}</span>
          <span class="eat-card-line"
            >· ${reliability} · from <span class="eat-card-source">${sourceId}</span></span
          >
        </p>
        ${goToSource}
      </div>
      ${renderOutside(view, cell.confidence)}
    </section>`;
  }

  const rankLine = rank ? rankText(rank) : null;
  return html`<section class="eat-card" aria-label="Selected protein">
    <div class="eat-card-row">${eyebrow} ${goToSource}</div>
    <p class="eat-card-title">
      ${ring}
      <span class="eat-card-id">${id}</span>
      <span class="eat-card-labels" title=${labelText}>${labelText}</span>
      <span class="eat-card-reliability">${reliability}</span>
    </p>
    <p class="eat-card-line eat-card-facts">
      <span class="eat-card-fact"
        >copied from <span class="eat-card-source">${sourceId}</span>${origin
          ? ` (${origin})`
          : ''}</span
      >
      <span class="eat-card-fact"
        >${SEP}${subject(sourceId)}${sourceIndex === null
          ? sourceOf(sourceLent)
          : sourceLink(view, sourceId, sourceIndex, sourceLent)}</span
      >
      ${ownLent > 0
        ? html`<span class="eat-card-fact"
            >${SEP}${id} is the ${sourceLink(view, id, protein, ownLent)}</span
          >`
        : nothing}
    </p>
    ${rankLine ? html`<p class="eat-card-rank">${rankLine}</p>` : nothing}
    ${renderOutside(view, cell.confidence)}
  </section>`;
}
