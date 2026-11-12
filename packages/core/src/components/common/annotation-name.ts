import { html, nothing, type TemplateResult } from 'lit';
import { annotationLabel, isPredictedAnnotation, type Annotation } from '@protspace/utils';
import '../kit/tooltip';

/** What PRED means, in its tooltip wherever it appears. */
export const PREDICTED_NOTE = 'Predicted: computational, not experimentally curated';

/**
 * The PRED badge (annotation-name.styles.ts draws it as the Color by list's EAT and STATS chips)
 * with its note as a tooltip. Its name, "Predicted annotation", joins the name of whatever holds
 * it, a button or a list option. The tooltip is hidden from assistive technology so its text
 * does not join that name too; it still describes the badge. `hostClass` places the badge in its
 * host (the legend header's `legend-predicted`).
 */
export function predictedBadge(hostClass?: string): TemplateResult {
  return html`<span
      class="predicted-mark ${hostClass ?? ''}"
      role="img"
      aria-label="Predicted annotation"
      >PRED</span
    ><ps-tooltip text=${PREDICTED_NOTE} aria-hidden="true"></ps-tooltip>`;
}

/**
 * The PRED badge for a predicted annotation, or nothing. Two annotations can share a label
 * ("Subcellular location" is both a UniProt and a Biocentral column), so every place that names
 * an annotation carries it.
 */
export function predictedMark(column: string): TemplateResult | typeof nothing {
  return isPredictedAnnotation(column) ? predictedBadge() : nothing;
}

/**
 * An annotation as the reader sees it: its friendly label, then its predicted
 * mark. The column name stays the key; this only draws it.
 *
 * `labelClass` places the label in its host — `dropdown-item-label` in a list
 * row, `dropdown-trigger-text` on a trigger button — so the text truncates
 * without taking the mark with it.
 */
export function renderAnnotationName(
  column: string,
  definition: Pick<Annotation, 'runtime'> | undefined,
  labelClass: 'dropdown-item-label' | 'dropdown-trigger-text',
): TemplateResult {
  return html`<span class=${labelClass}>${annotationLabel(column, definition)}</span
    >${predictedMark(column)}`;
}
