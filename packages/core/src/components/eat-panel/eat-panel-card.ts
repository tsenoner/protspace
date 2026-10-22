import { html, nothing, type TemplateResult } from 'lit';
import {
  countNoun,
  formatCount,
  getPredictedCellValues,
  type VisualizationData,
} from '@protspace/utils';
import '../kit/button';
import '../kit/tooltip';
import { formatPercent } from '../query-builder/eat-reliability';
import { swatchColor } from './eat-panel-breakdown';
import { rankOf, type EatIndex } from './eat-summary';

const UNRESOLVED_REASON = 'The source is not in this dataset';

/** What the card shows that does not move with the threshold, worked out once per selection. */
export interface EatCardFacts {
  /** The prediction's rank in the whole dataset; null for a protein without one. */
  rank: { below: number; total: number } | null;
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
  onGoToSource(detail: { targetId: string; targetIndex: number; sourceId: string }): void;
  onTraceSource(detail: { sourceId: string; sourceIndex: number }): void;
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

const proteins = (count: number) => countNoun(count, 'protein', 'proteins');

/** `lent to 34`: draws the source's lines without selecting it. Its name says it in full. */
function lentLink(
  view: EatCardView,
  sourceId: string,
  sourceIndex: number,
  count: number,
): TemplateResult {
  return html`<button
    type="button"
    class="eat-card-link"
    aria-label=${`${sourceId} lent its label to ${proteins(count)}`}
    @click=${() => view.onTraceSource({ sourceId, sourceIndex })}
  >
    lent to ${formatCount(count)}
  </button>`;
}

const eyebrow = html`<p class="eat-card-eyebrow" aria-hidden="true">Selected protein</p>`;

/**
 * The selected protein's strip, docked at the bottom of the panel (Decision 4, U21): for a
 * prediction of the Color by annotation, a ring in its label's colour, its id, label(s) and
 * reliability; the protein it came from, whether that one is curated or predicted, how many it
 * lent to (a link that draws them) and Go to source; then its rank. For a source, its own labels
 * and its lent count. Anything else, nothing.
 */
export function renderCard(view: EatCardView): TemplateResult | typeof nothing {
  const { data, annotation, index, protein, labelColors, facts } = view;
  const id = data.protein_ids[protein];
  if (id === undefined) return nothing;
  const cell = data.annotation_predicted?.[annotation]?.[protein] ?? null;
  const ownLent = index.lentCount.get(id) ?? 0;

  if (!cell) {
    if (ownLent === 0) return nothing;
    const labels = curatedLabels(index, protein);
    const color = swatchColor(labelColors, labels[0] ?? '');
    return html`<section class="eat-card" aria-label="Selected protein">
      ${eyebrow}
      <p class="eat-card-title">
        <span
          class="eat-swatch"
          style=${color ? `background:${color}` : nothing}
          aria-hidden="true"
        ></span>
        <span class="eat-card-id">${id}</span>
        <span class="eat-card-labels" title=${labels.join(', ')}>${labels.join(', ')}</span>
      </p>
      <p class="eat-card-line">
        ${labels.length > 0 ? 'Curated · ' : ''}${lentLink(view, id, protein, ownLent)}
      </p>
    </section>`;
  }

  const labels = getPredictedCellValues(cell);
  const labelText = labels.join(', ');
  const color = swatchColor(labelColors, labels[0] ?? '');
  const sourceId = cell.source;
  const { rank, sourceIndex } = facts;
  const origin = sourceIndex === null ? 'not in this dataset' : originOf(view, sourceIndex);
  const sourceLent = index.lentCount.get(sourceId) ?? 0;

  return html`<section class="eat-card" aria-label="Selected protein">
    ${eyebrow}
    <p class="eat-card-title">
      <span
        class="eat-ring"
        style=${color ? `border-color:${color}` : nothing}
        aria-hidden="true"
      ></span>
      <span class="eat-card-id">${id}</span>
      <span class="eat-card-labels" title=${labelText}>${labelText}</span>
      <span class="eat-card-reliability">${formatPercent(cell.confidence)}</span>
    </p>
    <div class="eat-card-source-row">
      <p class="eat-card-line">
        from <span class="eat-card-source">${sourceId}</span>${origin ? `, ${origin}` : ''}
        <span class="eat-card-lent"
          >${sourceIndex === null
            ? `· lent to ${formatCount(sourceLent)}`
            : html`· ${lentLink(view, sourceId, sourceIndex, sourceLent)}`}</span
        >
        ${ownLent > 0
          ? html`<span class="eat-card-lent">· ${id} ${lentLink(view, id, protein, ownLent)}</span>`
          : nothing}
      </p>
      <span class="eat-card-actions">
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
        >${sourceIndex === null
          ? html`<ps-tooltip text=${UNRESOLVED_REASON}></ps-tooltip>`
          : nothing}
      </span>
    </div>
    ${rank
      ? html`<p class="eat-card-rank">
          ${
            // Floored: the strongest of 659 is higher than 99 %, never than 100 %, of them.
            `Higher than ${formatPercent(Math.floor((rank.below / rank.total) * 100) / 100)} of ${formatCount(rank.total)} predictions`
          }
        </p>`
      : nothing}
  </section>`;
}
