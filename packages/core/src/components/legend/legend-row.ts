import { html, nothing, type TemplateResult } from 'lit';
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';
import type { LegendItem } from './types';

/** What a row shows besides its item. */
export interface LegendRowView {
  /** The row's class list: `getItemClasses` plus the score-hover class. */
  classes: string;
  selected: boolean;
  /** The legend symbol's size in px. */
  symbolSize: number;
  /** How many categories the Other row groups; undefined on every other row. */
  otherCount?: number;
  /** The row's place in display order; the first row's main button is the tab stop. */
  index: number;
  /** Whether the row's handle can move it (every row but Other). */
  draggable: boolean;
}

/** What a row's controls do. */
export interface LegendRowHandlers {
  onClick(e: MouseEvent): void;
  onDoubleClick(): void;
  onViewOther(e: Event): void;
  onKeyDown(e: KeyboardEvent): void;
  onHandleKeyDown(e: KeyboardEvent): void;
  onHover(category: string | null): void;
  /** Opens the colour and shape picker; absent for Other and for numeric rows. */
  onSymbolClick?(e: MouseEvent): void;
}

/**
 * Render a symbol using custom SVG paths that match WebGL shader geometry.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
  selected: boolean = false,
): TemplateResult {
  // Add padding to accommodate shapes that extend beyond circles
  const padding = 6;
  const canvasSize = size + padding * 2;
  const centerOffset = canvasSize / 2;

  // Safely handle null or undefined shape
  const shapeKey = (shape || 'circle').toLowerCase();

  // Get the path generator (default to circle if not found)
  const pathGenerator = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;

  // Generate the SVG path
  const path = pathGenerator(size);

  // Some symbol types should be rendered as outlines only (plus sign)
  const isOutlineOnly = LEGEND_STYLES.outlineShapes.has(shapeKey);

  // Determine stroke width based on selection state
  const strokeWidth = selected
    ? LEGEND_STYLES.strokeWidth.selected
    : LEGEND_STYLES.strokeWidth.default;

  // Determine stroke color based on selection state
  const strokeColor = selected
    ? LEGEND_STYLES.colors.selectedStroke
    : LEGEND_STYLES.colors.defaultStroke;

  // Ensure we have a valid color
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

/**
 * Render the drag handle icon
 */
function renderDragHandle(
  enabled: boolean,
  itemLabel: string,
  onKeyDown: (e: KeyboardEvent) => void,
): TemplateResult {
  const ariaLabel = enabled ? `Reorder ${itemLabel}` : `${itemLabel} cannot be reordered`;
  return html`
    <button
      type="button"
      class="drag-handle ${enabled ? '' : 'drag-handle-disabled'}"
      ?disabled=${!enabled}
      aria-label=${ariaLabel}
      @click=${(e: Event) => e.stopPropagation()}
      @mousedown=${(e: Event) => e.stopPropagation()}
      @keydown=${(e: KeyboardEvent) => {
        e.stopPropagation();
        onKeyDown(e);
      }}
    >
      <svg
        width="16"
        height="16"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" />
      </svg>
    </button>
  `;
}

/**
 * Render the item symbol (either "Other" default or annotation-specific symbol)
 */
function renderItemSymbol(
  item: LegendItem,
  isItemSelected: boolean,
  size: number,
  onSymbolClick?: (e: MouseEvent) => void,
): TemplateResult {
  // Always render the item's stored shape. Categories default to circle;
  // user-assigned shapes flow through unchanged.
  const symbolContent =
    item.value === LEGEND_VALUES.OTHER
      ? renderLegendSymbol('circle', '#888', size)
      : renderLegendSymbol(item.shape, item.color, size, isItemSelected);

  if (onSymbolClick) {
    return html`
      <button
        type="button"
        class="mr-2 legend-symbol-button legend-symbol-clickable"
        part="symbol"
        aria-label=${`Customize ${toDisplayValue(item.value)}`}
        @click=${onSymbolClick}
      >
        ${symbolContent}
      </button>
    `;
  }

  return html` <div class="mr-2" part="symbol">${symbolContent}</div> `;
}

/**
 * Render the item text label.
 * N/A items have '__NA__' as value and display as 'N/A'.
 */
function renderItemText(item: LegendItem, otherItemsCount?: number): TemplateResult {
  const displayText = item.displayValue ?? toDisplayValue(item.value, otherItemsCount);
  return html`<span class="legend-text" part="text">${displayText}</span>`;
}

/**
 * Render item actions (like "view" button for "Other" category)
 */
function renderItemActions(item: LegendItem, onViewOther: (e: Event) => void): TemplateResult {
  if (item.value === LEGEND_VALUES.OTHER) {
    return html`
      <span class="legend-item-actions">
        <button
          class="btn-link view-button"
          @click=${onViewOther}
          title="View items grouped under Other"
          aria-label="View items grouped under Other"
        >
          View
        </button>
      </span>
    `;
  }

  return html``;
}

/**
 * Render a complete legend item.
 * N/A items have '__NA__' as value and display as 'N/A'.
 */
export function renderLegendRow(
  item: LegendItem,
  view: LegendRowView,
  handlers: LegendRowHandlers,
): TemplateResult {
  const displayLabel = item.displayValue ?? toDisplayValue(item.value);

  return html`
    <div
      class="${view.classes}"
      part="item"
      role="listitem"
      data-value="${item.value}"
      data-display-value="${displayLabel}"
      data-driver-id=${item.value === LEGEND_VALUES.OTHER ? 'other-row' : nothing}
      @mouseenter=${() => handlers.onHover(item.value)}
      @mouseleave=${() => handlers.onHover(null)}
    >
      <div class="legend-item-content">
        ${renderDragHandle(view.draggable, displayLabel, handlers.onHandleKeyDown)}
        ${renderItemSymbol(item, view.selected, view.symbolSize, handlers.onSymbolClick)}
        <button
          type="button"
          class="legend-item-main"
          aria-label="${displayLabel}: ${item.count} items, ${item.isVisible ? 'shown' : 'hidden'}"
          aria-pressed="${item.isVisible ? 'true' : 'false'}"
          tabindex="${view.index === 0 ? '0' : '-1'}"
          @click=${handlers.onClick}
          @dblclick=${handlers.onDoubleClick}
          @keydown=${handlers.onKeyDown}
        >
          ${renderItemText(item, view.otherCount)}
        </button>
        ${renderItemActions(item, handlers.onViewOther)}
      </div>
      <span class="legend-count" part="count">${item.count}</span>
    </div>
  `;
}
