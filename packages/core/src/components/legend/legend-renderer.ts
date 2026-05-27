import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import type { LegendItem } from './types';
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';

/**
 * Utility class for rendering legend components
 */
export class LegendRenderer {
  /**
   * Render a symbol using custom SVG paths that match WebGL shader geometry.
   */
  static renderSymbol(
    shape: string | null,
    color: string,
    size: number = LEGEND_DEFAULTS.symbolSize,
    isSelected: boolean = false,
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
    const strokeWidth = isSelected
      ? LEGEND_STYLES.strokeWidth.selected
      : LEGEND_STYLES.strokeWidth.default;

    // Determine stroke color based on selection state
    const strokeColor = isSelected
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
   * Render the legend header with title and customize button
   */
  static renderHeader(
    title: string,
    actions: {
      onReverse: () => void;
      reverseLabel: string;
      onCustomize: () => void;
    },
  ): TemplateResult {
    return html`
      <div class="legend-header" part="header">
        <h3 class="legend-title">${title}</h3>
        <div class="legend-header-actions">
          <button
            class="btn-icon customize-button reverse-button"
            title=${actions.reverseLabel}
            aria-label=${actions.reverseLabel}
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
    `;
  }

  /**
   * Render the main legend content or empty state
   */
  static renderLegendContent(
    sortedLegendItems: LegendItem[],
    renderItemCallback: (item: LegendItem, index: number) => TemplateResult,
  ): TemplateResult {
    if (sortedLegendItems.length === 0) {
      return html`<div class="legend-empty" part="empty">No data available</div>`;
    }

    return html`
      <div class="legend-items" part="items" role="list" aria-label="Legend items">
        ${sortedLegendItems.map((item, index) => renderItemCallback(item, index))}
      </div>
    `;
  }

  /**
   * Render the drag handle icon
   */
  static renderDragHandle(
    enabled: boolean,
    itemLabel: string,
    onKeyDown?: (e: KeyboardEvent) => void,
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
          onKeyDown?.(e);
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
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 8h16M4 16h16"
          />
        </svg>
      </button>
    `;
  }

  /**
   * Render the item symbol (either "Other" default or annotation-specific symbol)
   */
  static renderItemSymbol(
    item: LegendItem,
    isItemSelected: boolean,
    size: number = LEGEND_DEFAULTS.symbolSize,
    onSymbolClick?: (e: MouseEvent) => void,
  ): TemplateResult {
    // Always render the item's stored shape. Categories default to circle;
    // user-assigned shapes flow through unchanged.
    const symbolContent =
      item.value === LEGEND_VALUES.OTHER
        ? this.renderSymbol('circle', '#888', size)
        : this.renderSymbol(item.shape, item.color, size, isItemSelected);

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
  static renderItemText(item: LegendItem, otherItemsCount?: number): TemplateResult {
    const displayText = item.displayValue ?? toDisplayValue(item.value, otherItemsCount);
    return html`<span class="legend-text" part="text">${displayText}</span>`;
  }

  /**
   * Render item actions (like "view" button for "Other" category)
   */
  static renderItemActions(item: LegendItem, onViewOther: (e: Event) => void): TemplateResult {
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
  static renderLegendItem(
    item: LegendItem,
    itemClasses: string,
    isItemSelected: boolean,
    eventHandlers: {
      onClick: () => void;
      onDoubleClick: () => void;
      onViewOther: (e: Event) => void;
      onKeyDown?: (e: KeyboardEvent) => void;
      onDragHandleKeyDown?: (e: KeyboardEvent) => void;
      onSymbolClick?: (e: MouseEvent) => void;
    },
    symbolSize: number = LEGEND_DEFAULTS.symbolSize,
    otherItemsCount?: number,
    itemIndex?: number,
    dragEnabled: boolean = true,
  ): TemplateResult {
    const displayLabel = item.displayValue ?? toDisplayValue(item.value);

    return html`
      <div
        class="${itemClasses}"
        part="item"
        role="listitem"
        data-value="${item.value}"
        data-display-value="${displayLabel}"
        data-driver-id=${item.value === LEGEND_VALUES.OTHER ? 'other-row' : nothing}
      >
        <div class="legend-item-content">
          ${this.renderDragHandle(dragEnabled, displayLabel, eventHandlers.onDragHandleKeyDown)}
          ${this.renderItemSymbol(item, isItemSelected, symbolSize, eventHandlers.onSymbolClick)}
          <button
            type="button"
            class="legend-item-main"
            aria-label="${displayLabel}: ${item.count} items, ${item.isVisible
              ? 'shown'
              : 'hidden'}"
            aria-pressed="${item.isVisible ? 'true' : 'false'}"
            tabindex="${itemIndex === 0 ? '0' : '-1'}"
            @click=${eventHandlers.onClick}
            @dblclick=${eventHandlers.onDoubleClick}
            @keydown=${eventHandlers.onKeyDown}
          >
            ${this.renderItemText(item, otherItemsCount)}
          </button>
          ${this.renderItemActions(item, eventHandlers.onViewOther)}
        </div>
        <span class="legend-count" part="count">${item.count}</span>
      </div>
    `;
  }
}
