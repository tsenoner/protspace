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

/** A source's own values in words: `curated Type A`, `predicted Type B`, or '' without any. */
function valuesOf(view: EatCardView, protein: number): string {
  const { data, annotation, index } = view;
  const cell = data.annotation_predicted?.[annotation]?.[protein];
  if (cell) return `predicted ${getPredictedCellValues(cell).join(', ')}`;
  const labels: string[] = [];
  for (let h = index.curatedOffsets[protein]; h < index.curatedOffsets[protein + 1]; h++) {
    labels.push(index.labels[index.curatedHits[h]]);
  }
  return labels.length > 0 ? `curated ${labels.join(', ')}` : '';
}

const proteins = (count: number) => countNoun(count, 'protein', 'proteins');

/** `P01391 lent its label to 34 proteins ›`: draws the source's lines without selecting it. */
function lentLink(
  view: EatCardView,
  sourceId: string,
  sourceIndex: number,
  text: string,
): TemplateResult {
  return html`<button
    type="button"
    class="eat-card-link"
    @click=${() => view.onTraceSource({ sourceId, sourceIndex })}
  >
    ${text} <span aria-hidden="true">›</span>
  </button>`;
}

/**
 * The selected protein's card (Decision 4): for a prediction of the Color by annotation, its
 * label(s), the protein it was copied from, its reliability and rank, Go to source and how many
 * proteins that source lent to; for a source, its own value and its lent count. Anything else,
 * nothing.
 */
export function renderCard(view: EatCardView): TemplateResult | typeof nothing {
  const { data, annotation, index, protein, labelColors, facts } = view;
  const id = data.protein_ids[protein];
  if (id === undefined) return nothing;
  const cell = data.annotation_predicted?.[annotation]?.[protein] ?? null;
  const ownLent = index.lentCount.get(id) ?? 0;

  if (!cell) {
    if (ownLent === 0) return nothing;
    const values = valuesOf(view, protein);
    return html`<section class="eat-card" aria-label="Selected protein">
      <p class="eat-card-title">${id}${values ? ` · ${values}` : ''}</p>
      ${lentLink(view, id, protein, `lent its label to ${proteins(ownLent)}`)}
    </section>`;
  }

  const labels = getPredictedCellValues(cell);
  const color = swatchColor(labelColors, labels[0] ?? '');
  const sourceId = cell.source;
  const { rank, sourceIndex } = facts;
  const sourceValues = sourceIndex === null ? '' : valuesOf(view, sourceIndex);
  const copiedFrom =
    sourceIndex === null
      ? `${sourceId} (not in this dataset)`
      : `${sourceId}${sourceValues ? ` · ${sourceValues}` : ''}`;
  const sourceLent = index.lentCount.get(sourceId) ?? 0;
  const sourceLentText = `${sourceId} lent its label to ${proteins(sourceLent)}`;

  return html`<section class="eat-card" aria-label="Selected protein">
    <p class="eat-card-title">
      <span
        class="eat-ring"
        style=${color ? `border-color:${color}` : nothing}
        aria-hidden="true"
      ></span>
      <span class="eat-card-labels">${labels.join(', ')}</span>
      <span class="eat-card-id">${id}</span>
    </p>
    <p class="eat-card-line">Copied from ${copiedFrom}</p>
    <p class="eat-card-line">
      Reliability
      ${cell.confidence.toFixed(2)}${rank
        ? // Floored: the strongest of 659 is higher than 99 %, never than 100 %, of them.
          ` · higher than ${formatPercent(Math.floor((rank.below / rank.total) * 100) / 100)} of ${formatCount(rank.total)}`
        : ''}
    </p>
    <div class="eat-card-actions">
      <ps-button
        size="sm"
        class="eat-go-to-source"
        ?disabled=${sourceIndex === null}
        @click=${() => {
          if (sourceIndex !== null)
            view.onGoToSource({ targetId: id, targetIndex: protein, sourceId });
        }}
        >Go to source</ps-button
      >${sourceIndex === null ? html`<ps-tooltip text=${UNRESOLVED_REASON}></ps-tooltip>` : nothing}
    </div>
    ${sourceIndex === null
      ? html`<p class="eat-card-line">${sourceLentText}</p>`
      : lentLink(view, sourceId, sourceIndex, sourceLentText)}
    ${ownLent > 0
      ? lentLink(view, id, protein, `${id} lent its label to ${proteins(ownLent)}`)
      : nothing}
  </section>`;
}
