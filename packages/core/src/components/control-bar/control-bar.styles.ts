/**
 * Control Bar Styles
 *
 * Composed from multiple style layers:
 * - Design tokens (colors, spacing, typography)
 * - Reusable mixins (buttons, inputs, dropdowns)
 * - Component-specific layouts and features
 * - Responsive adaptations
 *
 * This modular approach eliminates duplication and provides a single
 * source of truth for design patterns.
 */

import { tokens } from '../../styles/tokens';
import { buttonMixin, inputMixin, dropdownMixin, iconMixin } from '../../styles/mixins';
import { layoutStyles } from './styles/layout';
import { queryBuilderStyles } from './query-builder.styles';
import { exportStyles } from './styles/export';
import { responsiveStyles } from './styles/responsive';

/**
 * Export as an array of CSS style sheets.
 *
 * Order is load-bearing: several of these sheets collide at equal specificity
 * (`layoutStyles` restyles bare `select` and re-declares `.filter-container` /
 * `.export-container`, both of which `inputMixin` / `dropdownMixin` also own),
 * so the later sheet wins. `queryBuilderStyles` is itself an array that re-lists
 * the four foundation sheets, and Lit deduplicates a flattened style array by
 * keeping each sheet's *last* position — so listing it before `iconMixin` and
 * `layoutStyles` is what keeps those two after the mixins they override.
 */
export const controlBarStyles = [
  tokens,
  buttonMixin,
  inputMixin,
  dropdownMixin,
  queryBuilderStyles,
  iconMixin,
  layoutStyles,
  exportStyles,
  responsiveStyles,
];
