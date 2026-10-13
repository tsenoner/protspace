import { html, nothing } from 'lit';
import { toDisplayValue } from '@protspace/utils';
import { ANY_VALUE } from './query-types';

/**
 * Display label for the `ANY_VALUE` sentinel, the companion of `NA_DISPLAY`.
 *
 * Lives here rather than in query-types.ts, which stays presentation-free, and
 * rather than in any one of the three components that render it — the picker,
 * the categorical chip row and the numeric chip row must all read a sentinel
 * the same way, so none of them owns the label. Reached only through
 * `displayFilterValue`, so there is exactly one way to render a sentinel.
 */
const ANY_DISPLAY = 'Any value';

/**
 * Display text for a filter value: either presence sentinel, or a real value.
 *
 * The N/A half delegates to `toDisplayValue`, the codebase's existing
 * internal → display mapping, so filter chips and the legend stay in step.
 */
export function displayFilterValue(value: string): string {
  return value === ANY_VALUE ? ANY_DISPLAY : toDisplayValue(value);
}

/**
 * The removable value chip. Stated once because two rows render exactly the same
 * markup against the same shared `queryBuilderStyles`: the categorical row for a
 * selected value, the numeric row for a presence sentinel. `presenceTag` is the
 * `data-presence` hook the numeric row needs to address a specific chip; the
 * categorical row omits it and Lit's `nothing` drops the attribute entirely
 * rather than stamping a meaningless one.
 */
export function renderValueChip(value: string, onRemove: () => void, presenceTag?: string) {
  return html`
    <span class="value-chip">
      <span class="value-chip-text">${displayFilterValue(value)}</span>
      <button
        class="value-chip-remove"
        data-presence=${presenceTag ?? nothing}
        @click=${onRemove}
        title="Remove value"
      >
        ×
      </button>
    </span>
  `;
}
