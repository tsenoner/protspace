import { html, nothing, type TemplateResult } from 'lit';
import type { LegendSortMode } from './types';

/** What the header shows. */
export interface LegendHeaderView {
  /** The annotation's display name, or "Legend" with no annotation. */
  title: string;
  /** A predicted annotation: shows the badge and the note line. */
  predicted: boolean;
  /** The annotation's documentation popover, when it has any. */
  info?: TemplateResult;
  /** The reverse button's accessible name, from `legendReverseLabel`. */
  reverseLabel: string;
}

/** What the header's buttons do. */
export interface LegendHeaderActions {
  onReverse(): void;
  onCustomize(): void;
}

const PREDICTED_NOTE = 'Computationally predicted, not experimentally curated.';

/**
 * The reverse button's name. A categorical legend reverses its rows and keeps Other last; a
 * numeric one flips between low-to-high and high-to-low, or reverses a manual order.
 */
export function legendReverseLabel(isNumeric: boolean, sortMode: LegendSortMode): string {
  if (!isNumeric) return 'Reverse z-order (keep Other last)';
  if (sortMode.startsWith('manual')) return 'Reverse manual order';
  return sortMode === 'alpha-desc' ? 'Show low to high' : 'Show high to low';
}

/**
 * The legend header: title, the "⚡ Predicted" badge and the info popover, then the reverse and
 * settings buttons; a predicted annotation adds a note line beneath the header.
 */
export function renderLegendHeader(
  view: LegendHeaderView,
  actions: LegendHeaderActions,
): TemplateResult {
  return html`
    <div class="legend-header" part="header">
      <div class="legend-title-row">
        <h3 class="legend-title">${view.title}</h3>
        ${view.predicted
          ? html`<span
              class="legend-predicted-badge"
              title="Computationally predicted, not experimentally curated"
              >⚡ Predicted</span
            >`
          : nothing}
        ${view.info ?? nothing}
      </div>
      <div class="legend-header-actions">
        <button
          class="btn-icon customize-button reverse-button"
          title=${view.reverseLabel}
          aria-label=${view.reverseLabel}
          @click=${actions.onReverse}
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16V4m0 0L3 8m4-4l4 4m6-2v12m0 0l4-4m-4 4l-4-4"
            />
          </svg>
        </button>
        <button
          class="btn-icon customize-button"
          title="Legend settings"
          aria-label="Legend settings"
          @click=${actions.onCustomize}
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </div>
    ${view.predicted
      ? html`<p class="legend-predicted-note" part="predicted-note">${PREDICTED_NOTE}</p>`
      : nothing}
  `;
}
