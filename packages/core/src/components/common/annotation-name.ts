import { html, nothing, type TemplateResult } from 'lit';
import { annotationLabel, isPredictedAnnotation, type Annotation } from '@protspace/utils';
import { icon } from '../kit/icon';

/**
 * The predicted mark (Lucide sparkles, as the legend header draws it) for a predicted annotation,
 * or nothing. Two annotations can share a label ("Subcellular location" is both a UniProt and a
 * Biocentral column), so every place that names an annotation carries it, and its name,
 * "Predicted annotation", joins the name of whatever holds it.
 */
export function predictedMark(column: string): TemplateResult | typeof nothing {
  return isPredictedAnnotation(column)
    ? html`<span class="predicted-mark" role="img" aria-label="Predicted annotation"
        >${icon('sparkles', 14)}</span
      >`
    : nothing;
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
