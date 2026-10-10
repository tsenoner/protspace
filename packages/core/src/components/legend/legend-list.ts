import { html, type TemplateResult } from 'lit';
import type { LegendItem } from './types';

/**
 * The rows in display order, or the empty state when there are none. The rows are the list's
 * direct children: Sortable moves them, and `role="listitem"` needs the list as parent.
 */
export function renderLegendList(
  items: readonly LegendItem[],
  renderRow: (item: LegendItem, index: number) => TemplateResult,
): TemplateResult {
  if (items.length === 0) {
    return html`<div class="legend-empty" part="empty">No data available</div>`;
  }

  return html`
    <div class="legend-items" part="items" role="list" aria-label="Legend items">
      ${items.map((item, index) => renderRow(item, index))}
    </div>
  `;
}
