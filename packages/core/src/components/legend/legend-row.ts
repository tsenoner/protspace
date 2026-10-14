import { html, nothing, type TemplateResult } from 'lit';
import { countNoun, formatCount } from '@protspace/utils';
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
 * 3 px on each side, room for the selected outline. A selected row's outline comes from CSS
 * (`.legend-item.selected .legend-symbol path`), which beats these attributes.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
): TemplateResult {
  const padding = 3;
  const canvasSize = size + padding * 2;
  const centerOffset = canvasSize / 2;
  const shapeKey = (shape || 'circle').toLowerCase();
  const pathGenerator = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;
  const path = pathGenerator(size);
  // Some symbol types are drawn as outlines only.
  const isOutlineOnly = LEGEND_STYLES.outlineShapes.has(shapeKey);
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
          stroke="${isOutlineOnly ? validColor : LEGEND_STYLES.colors.defaultStroke}"
          stroke-width="${isOutlineOnly
            ? LEGEND_STYLES.strokeWidth.outline
            : LEGEND_STYLES.strokeWidth.default}"
        />
      </g>
    </svg>
  `;
}

/** What one row shows, decided by the legend. */
export interface LegendRowView {
  classes: string;
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
  /** The Other popover is open: the View button's `aria-expanded`. */
  otherExpanded?: boolean;
}

export interface LegendRowHandlers {
  onClick(e: MouseEvent): void;
  onDoubleClick(): void;
  onKeyDown(e: KeyboardEvent): void;
  onHandleKeyDown(e: KeyboardEvent): void;
  onHover(category: string | null): void;
  /** Focus entered the row: it takes the list's Tab stop. */
  onFocus(): void;
  onToggle(): void;
  onMenu(e: MouseEvent): void;
  onViewOther(e: Event): void;
  /** The pointer reached the main button: a truncated name may show in full. */
  onNamePointerEnter(e: PointerEvent): void;
  /** A press on the main button: tells a tap from a click, and starts a long press on the name. */
  onPointerDown(e: PointerEvent): void;
}

/** A row's own controls keep their presses: the row and the container never see them. */
const stop = (e: Event) => e.stopPropagation();

/**
 * One legend row (design decision 12). The main button holds the swatch and the name and toggles
 * the category; its accessible name carries the full name, the count and the state. The eye, the
 * drag handle and "⋯" sit before the count; the stylesheet reveals them on hover and focus, and the
 * name gives way to them. Rows stay plain elements in the legend's shadow root: Sortable needs them as
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
      @pointerenter=${(e: PointerEvent) => {
        // A finger has no hover: a tap's highlight would stay until the next tap elsewhere.
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') handlers.onHover(item.value);
      }}
      @pointerleave=${() => handlers.onHover(null)}
      @focusin=${() => handlers.onFocus()}
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
        @pointerenter=${handlers.onNamePointerEnter}
        @pointerdown=${handlers.onPointerDown}
      >
        <span class="legend-swatch" part="symbol"
          >${isOther
            ? renderLegendSymbol('circle', OTHER_SYMBOL_COLOR, view.symbolSize)
            : renderLegendSymbol(item.shape, item.color, view.symbolSize)}</span
        >
        <span class="legend-text" part="text">${label}</span>
      </button>
      ${isOther
        ? html`<button
            type="button"
            class="view-button"
            aria-label="View items grouped under Other"
            aria-haspopup="dialog"
            aria-expanded=${view.otherExpanded ? 'true' : 'false'}
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
          part="row-handle"
          ?disabled=${!view.draggable}
          aria-hidden=${view.draggable ? nothing : 'true'}
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
              part="row-menu"
              aria-haspopup="menu"
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
      <span class="legend-count" part="count">${formatCount(item.count)}</span>
    </div>
  `;
}
