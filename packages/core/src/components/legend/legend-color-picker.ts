import {
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import type { PointShape } from '@protspace/utils';
import { SHAPE_PATH_GENERATORS, toDisplayValue } from './config';
import type { LegendItem } from './types';

/** A colour edit reaches the plot this long after the last input event of a drag in the picker. */
export const COLOR_COMMIT_DELAY_MS = 150;

const SHAPES: readonly PointShape[] = [
  'circle',
  'square',
  'diamond',
  'triangle-up',
  'triangle-down',
  'plus',
];

/** What the picker reads from the legend and hands back to it. */
interface ColorPickerOptions {
  getItem(value: string): LegendItem | undefined;
  /** Repaints the row while a colour is dragged; the plot follows when the edit commits. */
  preview(value: string, color: string): void;
  commitColor(value: string, color: string): void;
  commitShape(value: string, shape: PointShape): void;
  isMultilabel(): boolean;
  isNumeric(): boolean;
}

/**
 * The colour and shape picker of one legend row. It owns which row is open, the panel's position,
 * the shape dropdown, the colour commit delay and the outside-press listeners; the legend owns the
 * items and applies the edits it is handed.
 */
export class ColorPickerController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: ColorPickerOptions;
  private _value: string | null = null;
  private _position: { x: number; y: number } | null = null;
  private _showShapePicker = false;
  private _pending: { value: string; color: string } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _pressStartedOutside = false;
  private _listening = false;

  constructor(host: ReactiveControllerHost & HTMLElement, options: ColorPickerOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row whose picker is open, or null. */
  get value(): string | null {
    return this._value;
  }

  hostConnected(): void {
    if (this._value !== null) this._listen(true);
  }

  hostDisconnected(): void {
    // As before the split: a pending colour is dropped, not committed, when the legend leaves.
    this._cancelTimer();
    this._listen(false);
  }

  /** Opens the picker beside `trigger`; the open row's own trigger closes it again. */
  toggle(value: string, trigger: HTMLElement): void {
    if (this._value === value) {
      this.close();
      return;
    }
    // Another row's pending colour lands before this row opens.
    this.flush();
    const container = this.host.shadowRoot?.querySelector('.legend-container');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    this._position = {
      x: triggerRect.left - containerRect.left + triggerRect.width + 8,
      y: triggerRect.top - containerRect.top,
    };
    this._value = value;
    this._showShapePicker = false;
    this._listen(true);
    this.host.requestUpdate();
  }

  /** Commits a pending colour, then closes. */
  close(): void {
    this.flush();
    if (this._value === null) return;
    this._value = null;
    this._showShapePicker = false;
    this._listen(false);
    this.host.requestUpdate();
  }

  /** Commits a colour still waiting for its delay, at once. */
  flush(): void {
    const pending = this._pending;
    this._cancelTimer();
    if (pending) this.options.commitColor(pending.value, pending.color);
  }

  render(): TemplateResult | typeof nothing {
    const item = this._value === null ? undefined : this.options.getItem(this._value);
    if (!item || !this._position) return nothing;

    const displayLabel = item.displayValue ?? toDisplayValue(item.value);
    const isMultilabel = this.options.isMultilabel();
    const isNumeric = this.options.isNumeric();

    // Render shape swatch SVG (outline only, no fill)
    const renderShapeSwatch = (shape: string, disabled: boolean = false) => {
      const pathGenerator =
        SHAPE_PATH_GENERATORS[shape as PointShape] || SHAPE_PATH_GENERATORS.circle;
      const size = 20;
      const canvasSize = 28;
      const centerOffset = canvasSize / 2;
      const path = pathGenerator(size);
      const strokeColor = disabled ? '#999' : '#333';

      return html`
        <svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">
          <g transform="translate(${centerOffset}, ${centerOffset})">
            <path d="${path}" fill="none" stroke="${strokeColor}" stroke-width="1.5" />
          </g>
        </svg>
      `;
    };

    return html`
      <div
        class="color-picker-popover"
        style="left: ${this._position.x}px; top: ${this._position.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
        @mousedown=${(e: Event) => e.stopPropagation()}
      >
        <div class="color-picker-header">${displayLabel}</div>
        <div class="symbol-picker-sections">
          <!-- Color Section -->
          <div class="symbol-picker-section">
            <div class="symbol-picker-section-label">Color</div>
            <input
              type="color"
              class="color-picker-swatch"
              .value=${item.color}
              aria-label=${`Set color for ${displayLabel}`}
              @input=${(e: Event) =>
                this._onColorInput(item.value, (e.target as HTMLInputElement).value)}
            />
          </div>
          <!-- Shape Section -->
          <div class="symbol-picker-section">
            <div class="symbol-picker-section-label">Shape</div>
            <div class="shape-swatch-container">
              ${isMultilabel || isNumeric
                ? html`
                    <button
                      type="button"
                      class="shape-picker-swatch disabled"
                      aria-label="${isNumeric
                        ? 'Shape selection disabled for numeric annotations'
                        : 'Shape selection disabled for multilabel annotations'}"
                      title="${isNumeric
                        ? 'Shape selection disabled for numeric annotations'
                        : 'Shape selection disabled for multilabel annotations'}"
                      disabled
                    >
                      ${renderShapeSwatch(item.shape, true)}
                    </button>
                  `
                : html`
                    <button
                      type="button"
                      class="shape-picker-swatch ${this._showShapePicker ? 'active' : ''}"
                      aria-label=${`Change shape for ${displayLabel}`}
                      title="Click to change shape"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._showShapePicker = !this._showShapePicker;
                        this.host.requestUpdate();
                      }}
                    >
                      ${renderShapeSwatch(item.shape)}
                    </button>
                    ${this._showShapePicker
                      ? html`
                          <div class="shape-picker-dropdown">
                            <div class="shape-picker-grid">
                              ${SHAPES.map((shape) => {
                                const isSelected = item.shape === shape;
                                const pathGenerator = SHAPE_PATH_GENERATORS[shape];
                                const size = 14;
                                const canvasSize = 20;
                                const centerOffset = canvasSize / 2;
                                const path = pathGenerator(size);
                                const isOutlineOnly = shape === 'plus';

                                return html`
                                  <button
                                    type="button"
                                    class="shape-picker-item ${isSelected ? 'selected' : ''}"
                                    aria-label=${`Use ${shape} shape for ${displayLabel}`}
                                    title="${shape}"
                                    @click=${(e: Event) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      this._showShapePicker = false;
                                      this.options.commitShape(item.value, shape);
                                      this.host.requestUpdate();
                                    }}
                                  >
                                    <svg
                                      width="${canvasSize}"
                                      height="${canvasSize}"
                                      viewBox="0 0 ${canvasSize} ${canvasSize}"
                                    >
                                      <g transform="translate(${centerOffset}, ${centerOffset})">
                                        <path
                                          d="${path}"
                                          fill="${isOutlineOnly ? 'none' : 'currentColor'}"
                                          stroke="currentColor"
                                          stroke-width="${isOutlineOnly ? 1.5 : 1}"
                                        />
                                      </g>
                                    </svg>
                                  </button>
                                `;
                              })}
                            </div>
                          </div>
                        `
                      : null}
                  `}
            </div>
          </div>
        </div>
        ${isMultilabel || isNumeric
          ? html`<div class="symbol-picker-note">
              ${isNumeric
                ? 'Shapes unavailable for numeric annotations'
                : 'Shapes unavailable for multilabel annotations'}
            </div>`
          : null}
      </div>
    `;
  }

  /** The row repaints on every tick; the plot gets the colour once the drag pauses. */
  private _onColorInput(value: string, color: string): void {
    this._cancelTimer();
    this.options.preview(value, color);
    this._pending = { value, color };
    this._timer = setTimeout(() => {
      const pending = this._pending;
      this._timer = null;
      this._pending = null;
      if (pending) this.options.commitColor(pending.value, pending.color);
    }, COLOR_COMMIT_DELAY_MS);
  }

  private _cancelTimer(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
    this._pending = null;
  }

  private _listen(on: boolean): void {
    if (on === this._listening) return;
    this._listening = on;
    this._pressStartedOutside = false;
    if (on) {
      window.addEventListener('mousedown', this._onWindowMouseDown);
      window.addEventListener('mouseup', this._onWindowMouseUp);
    } else {
      window.removeEventListener('mousedown', this._onWindowMouseDown);
      window.removeEventListener('mouseup', this._onWindowMouseUp);
    }
  }

  // The panel stops its own mousedown, so one that reaches the window started outside it.
  private _onWindowMouseDown = (event: MouseEvent): void => {
    const panel = this.host.shadowRoot?.querySelector('.color-picker-popover');
    this._pressStartedOutside = !!panel && !panel.contains(event.target as Node);
  };

  // A press that started outside closes on release; a drag that started inside does not.
  private _onWindowMouseUp = (): void => {
    if (!this._pressStartedOutside) return;
    this._pressStartedOutside = false;
    this.close();
  };
}
