import type { TooltipView } from '@protspace/utils';
import { filterAnnotationValues } from './protein-tooltip-helpers';

/**
 * CSS-calibrated constants for estimating the rendered height of
 * <protspace-protein-tooltip> from its data model alone.
 *
 * All values are in CSS pixels at the default 16px root font size.
 *
 * Header section (.tooltip-header)
 *   padding: 0.625rem top + 0.625rem bottom = 10 + 10 = 20 px
 *   font-size: 0.75rem → 12 px, line-height default 1.2 → ~15 px
 *   border-bottom: 1 px
 *   Total: 20 + 15 + 1 = 36 px  → rounded up to 38 for safety
 *
 * Content wrapper (.tooltip-content)
 *   padding: 0.75rem top + 0.75rem bottom = 12 + 12 = 24 px
 *
 * Protein-name row (.tooltip-protein-name)
 *   font-size: 0.8125rem (13 px), line-height 1.4 → ~18 px
 *   margin-bottom: 0.125rem = 2 px
 *   Total: ~20 px
 *
 * Gene-name row (.tooltip-gene-name)
 *   font-size: 0.75rem (12 px), line-height default → ~15 px
 *   margin-bottom: 0.25rem = 4 px
 *   Total: ~19 px   → rounded to 20 for safety
 *
 * Per annotation block (.tooltip-annotations)
 *   top separator area: margin-top 0.5rem (8) + padding-top 0.5rem (8) + border-top 1 = 17 px
 *   block header row (.tooltip-annotation-header):
 *     font-size: 0.625rem (10 px), margin-bottom 0.125rem (2 px) → ~16 px
 *   "Value:" row (.tooltip-annotation with raw class):
 *     font-size: 0.75rem (12 px) → ~16 px (reuses the annotation row height)
 *   each displayValues row (.tooltip-annotation):
 *     font-size: 0.75rem (12 px), gap between rows 0.25rem (4 px) → ~16 px per row
 *
 * Minimum height floor: 160 px (the previous hard-coded fallback).
 */

const HEADER_HEIGHT = 38; // header padding + content + border-bottom
const CONTENT_PADDING_V = 24; // .tooltip-content top + bottom padding
const PROTEIN_NAME_ROW = 20; // .tooltip-protein-name row
const GENE_NAME_ROW = 20; // .tooltip-gene-name row
const BLOCK_SEPARATOR = 17; // margin-top + padding-top + border-top for .tooltip-annotations
const BLOCK_HEADER_ROW = 16; // .tooltip-annotation-header height
const ANNOTATION_ROW = 16; // each .tooltip-annotation row (value or displayValues entry)
const MINIMUM_HEIGHT = 160; // floor — short tooltips unaffected

/**
 * Estimate the rendered pixel height of a tooltip from its view model.
 *
 * The estimate intentionally biases slightly toward over-estimating because:
 * - A larger estimate clamps the tooltip further up, keeping it on-screen.
 * - Under-estimating risks the tooltip running off the bottom of the viewport.
 *
 * This is a pure function suitable for unit testing; no DOM access required.
 */
export function estimateTooltipHeight(view: TooltipView): number {
  let height = HEADER_HEIGHT + CONTENT_PADDING_V;

  const hasProteinName = filterAnnotationValues(view.proteinName) !== null;
  const hasGeneName = filterAnnotationValues(view.geneName) !== null;

  if (hasProteinName) height += PROTEIN_NAME_ROW;
  if (hasGeneName) height += GENE_NAME_ROW;

  for (const block of view.blocks) {
    height += BLOCK_SEPARATOR;
    height += BLOCK_HEADER_ROW;

    // "Value:" row is rendered when numericValue is not null
    if (block.numericValue !== null) {
      height += ANNOTATION_ROW;
    }

    // One row per displayValues entry
    height += block.displayValues.length * ANNOTATION_ROW;
  }

  return Math.max(MINIMUM_HEIGHT, height);
}
