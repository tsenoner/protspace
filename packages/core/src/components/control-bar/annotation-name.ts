import { html, nothing, type TemplateResult } from 'lit';
import { annotationLabel, isPredictedAnnotation, type Annotation } from '@protspace/utils';

/**
 * The ⚡ marker for a predicted annotation, or nothing. Two annotations can share
 * a label ("Subcellular location" is both a UniProt and a Biocentral column), so
 * every place that names an annotation carries it. Styled by `dropdownMixin`.
 */
export function predictedBadge(column: string): TemplateResult | typeof nothing {
  return isPredictedAnnotation(column)
    ? html`<span
        class="predicted-badge"
        title="Predicted: computational, not experimentally curated"
        aria-label="Predicted"
        >⚡</span
      >`
    : nothing;
}

/**
 * An annotation as the reader sees it: its friendly label, then its predicted
 * badge. The column name stays the key; this only draws it.
 *
 * `labelClass` places the label in its host — `dropdown-item-label` in a list
 * row, `dropdown-trigger-text` on a trigger button — so the text truncates
 * without taking the badge with it.
 */
export function renderAnnotationName(
  column: string,
  definition: Pick<Annotation, 'runtime'> | undefined,
  labelClass: 'dropdown-item-label' | 'dropdown-trigger-text',
): TemplateResult {
  return html`<span class=${labelClass}>${annotationLabel(column, definition)}</span
    >${predictedBadge(column)}`;
}
