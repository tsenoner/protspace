import { html, nothing, type TemplateResult } from 'lit';
import { countNoun, formatCount } from '../../utils/count-text';
import { icon } from '../kit/icon';
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';
import type { LegendItem } from './types';

/** Other's dot. A literal until phase 6 adds the neutral point tokens. */
const OTHER_SYMBOL_COLOR = '#888';

/**
 * A legend symbol drawn with the same paths as the WebGL shader's shapes. The SVG is the size plus
 * 3 px on each side, room for the selected outline. The outline colour of a selected row comes from
 * CSS (`.legend-item.selected .legend-symbol path`), which beats these attributes.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
  selected: boolean = false,
): TemplateResult {
  const padding = 3;
  const canvasSize = size + padding * 2;
  const centerOffset = canvasSize / 2;
  const shapeKey = (shape || 'circle').toLowerCase();
  const pathGenerator = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;
  const path = pathGenerator(size);
  // Some symbol types are drawn as outlines only.
  const isOutlineOnly = LEGEND_STYLES.outlineShapes.has(shapeKey);
  const strokeWidth = selected
    ? LEGEND_STYLES.strokeWidth.selected
    : LEGEND_STYLES.strokeWidth.default;
  const strokeColor = selected
    ? LEGEND_STYLES.colors.selectedStroke
    : LEGEND_STYLES.colors.defaultStroke;
  const validColor = color || '#888888';

  return html`
    <svg
      width="${canvasSize}"
      height="${canvasSize}"
      viewBox="0 0 ${canvasSize} ${canvasSize}"
      class="legend-symbol"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(${centerOffset}, ${centerOffset})">
        <path
          d="${path}"
          fill="${isOutlineOnly ? 'none' : validColor}"
          stroke="${isOutlineOnly ? validColor : strokeColor}"
          stroke-width="${isOutlineOnly ? LEGEND_STYLES.strokeWidth.outline : strokeWidth}"
        />
      </g>
    </svg>
  `;
}

/** What one row shows, decided by the legend. */
export interface LegendRowView {
  classes: string;
  selected: boolean;
  symbolSize: number;
  /** The number of categories in Other; only the Other row has it. */
  otherCount?: number;
  /** The list's one Tab stop is in this row. */
  tabbable: boolean;
  draggable: boolean;
  /** Picked up for a keyboard reorder. */
  picked: boolean;
  /** Shows "⋯" (every row but Other). */
  hasMenu: boolean;
}

export interface LegendRowHandlers {
  onClick(e: MouseEvent): void;
  onDoubleClick(): void;
  onKeyDown(e: KeyboardEvent): void;
  onHandleKeyDown(e: KeyboardEvent): void;
  onHover(category: string | null): void;
  onToggle(): void;
  onMenu(e: MouseEvent): void;
  onViewOther(e: Event): void;
}

/** A row's own controls keep their presses: the row and the container never see them. */
const stop = (e: Event) => e.stopPropagation();

/**
 * One legend row (design decision 12). The main button holds the swatch and the name and toggles
 * the category; its accessible name carries the full name, the count and the state. The eye, the
 * drag handle and "⋯" sit in an overlay the stylesheet reveals on hover and focus, so they never
 * reflow the name. Rows stay plain elements in the legend's shadow root: Sortable needs them as
 * direct children of the list, and a list can hold hundreds.
 */
export function renderLegendRow(
  item: LegendItem,
  view: LegendRowView,
  handlers: LegendRowHandlers,
): TemplateResult {
  const isOther = item.value === LEGEND_VALUES.OTHER;
  const displayValue = item.displayValue ?? toDisplayValue(item.value);
  const label = isOther
    ? `Other · ${countNoun(view.otherCount ?? 0, 'category', 'categories')}`
    : displayValue;
  const tabindex = view.tabbable ? '0' : '-1';

  return html`
    <div
      class=${view.classes}
      part="item"
      role="listitem"
      data-value=${item.value}
      data-display-value=${displayValue}
      data-driver-id=${isOther ? 'other-row' : nothing}
      @mouseenter=${() => handlers.onHover(item.value)}
      @mouseleave=${() => handlers.onHover(null)}
    >
      <button
        type="button"
        class="legend-item-main"
        aria-label=${`${label}: ${countNoun(item.count, 'protein', 'proteins')}, ${
          item.isVisible ? 'shown' : 'hidden'
        }`}
        aria-pressed=${item.isVisible ? 'true' : 'false'}
        tabindex=${tabindex}
        @click=${handlers.onClick}
        @dblclick=${handlers.onDoubleClick}
        @keydown=${handlers.onKeyDown}
      >
        <span class="legend-swatch" part="symbol"
          >${isOther
            ? renderLegendSymbol('circle', OTHER_SYMBOL_COLOR, view.symbolSize)
            : renderLegendSymbol(item.shape, item.color, view.symbolSize, view.selected)}</span
        >
        <span class="legend-text" part="text">${label}</span>
      </button>
      ${isOther
        ? html`<button
            type="button"
            class="view-button"
            aria-label="View items grouped under Other"
            tabindex=${tabindex}
            @click=${handlers.onViewOther}
            @dblclick=${stop}
            @mousedown=${stop}
          >
            View
          </button>`
        : nothing}
      ${item.isVisible
        ? nothing
        : html`<span class="legend-hidden-mark" aria-hidden="true">${icon('eye-off', 14)}</span>`}
      <span class="legend-count" part="count">${formatCount(item.count)}</span>
      <span class="legend-item-actions">
        <button
          type="button"
          class="legend-action legend-eye"
          aria-label=${`${item.isVisible ? 'Hide' : 'Show'} ${displayValue}`}
          tabindex=${tabindex}
          @click=${(e: Event) => {
            e.stopPropagation();
            handlers.onToggle();
          }}
          @dblclick=${stop}
          @mousedown=${stop}
        >
          ${icon(item.isVisible ? 'eye' : 'eye-off', 14)}
        </button>
        <button
          type="button"
          class="drag-handle${view.draggable ? '' : ' drag-handle-disabled'}"
          ?disabled=${!view.draggable}
          aria-label=${view.draggable
            ? `Reorder ${displayValue}`
            : `${displayValue} cannot be reordered`}
          aria-pressed=${view.draggable ? (view.picked ? 'true' : 'false') : nothing}
          tabindex=${tabindex}
          @click=${stop}
          @dblclick=${stop}
          @mousedown=${stop}
          @keydown=${(e: KeyboardEvent) => {
            e.stopPropagation();
            handlers.onHandleKeyDown(e);
          }}
        >
          ${icon('grip-vertical', 14)}
        </button>
        ${view.hasMenu
          ? html`<button
              type="button"
              class="legend-action legend-more"
              aria-label=${`More actions for ${displayValue}`}
              tabindex=${tabindex}
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                handlers.onMenu(e);
              }}
              @dblclick=${stop}
              @mousedown=${stop}
            >
              ${icon('ellipsis', 14)}
            </button>`
          : nothing}
      </span>
    </div>
  `;
}
