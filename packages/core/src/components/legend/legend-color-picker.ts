import {
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import type { PointShape } from '@protspace/utils';
import '../kit/popover';
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
}

/** One shape as its radio draws it: filled in the text colour, the plus as an outline. */
function shapeIcon(shape: PointShape): TemplateResult {
  const size = 14;
  const canvas = 20;
  const centre = canvas / 2;
  const outline = shape === 'plus';
  return html`<svg
    width=${canvas}
    height=${canvas}
    viewBox="0 0 ${canvas} ${canvas}"
    aria-hidden="true"
    focusable="false"
  >
    <g transform="translate(${centre}, ${centre})">
      <path
        d=${SHAPE_PATH_GENERATORS[shape](size)}
        fill=${outline ? 'none' : 'currentColor'}
        stroke="currentColor"
        stroke-width=${outline ? 1.5 : 1}
      ></path>
    </g>
  </svg>`;
}

/**
 * The colour and shape picker of one legend row, a ps-popover anchored to the row and placed to its
 * left, over the plot. The layer stack closes it on Escape or a press outside (design decision 11);
 * either way a colour still waiting for its commit delay lands first. The legend owns the items and
 * applies the edits it is handed.
 */
export class ColorPickerController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: ColorPickerOptions;
  private _value: string | null = null;
  private _anchor: HTMLElement | null = null;
  private _pending: { value: string; color: string } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: ColorPickerOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row whose picker is open, or null. */
  get value(): string | null {
    return this._value;
  }

  hostDisconnected(): void {
    // As before: a pending colour is dropped, not committed, when the legend leaves the page.
    this._cancelTimer();
  }

  /** Opens the picker beside `anchor`, the row element; another row's pending colour lands first. */
  open(value: string, anchor: HTMLElement): void {
    this.flush();
    this._value = value;
    this._anchor = anchor;
    this.host.requestUpdate();
  }

  /** Commits a pending colour, then closes. */
  close(): void {
    this.flush();
    if (this._value === null) return;
    this._value = null;
    this._anchor = null;
    this.host.requestUpdate();
  }

  /** Commits a colour still waiting for its delay, at once. */
  flush(): void {
    const pending = this._pending;
    this._cancelTimer();
    if (pending) this.options.commitColor(pending.value, pending.color);
  }

  /** The popover is always rendered: closing it, not removing it, hands focus back. */
  render(): TemplateResult {
    const item = this._value === null ? undefined : this.options.getItem(this._value);
    const open = item !== undefined && this._anchor !== null;
    const label = item ? (item.displayValue ?? toDisplayValue(item.value)) : '';
    return html`<ps-popover
      class="color-picker"
      .anchor=${this._anchor}
      .open=${open}
      placement="left-start"
      panel-label=${open ? `Colour and shape: ${label}` : 'Colour and shape'}
      @ps-open=${this._onOpen}
      @ps-close=${this._onClose}
      >${item && open ? this._renderBody(item, label) : nothing}</ps-popover
    >`;
  }

  private _renderBody(item: LegendItem, label: string): TemplateResult {
    // The row menu offers no picker on numeric annotations, so only multilabel disables shapes.
    const shapesDisabled = this.options.isMultilabel();
    const current: PointShape = SHAPES.includes(item.shape as PointShape)
      ? (item.shape as PointShape)
      : 'circle';
    return html`<div class="color-picker-body">
      <div class="color-picker-header">${label}</div>
      <div class="color-picker-field">
        <span class="color-picker-caption" aria-hidden="true">Colour</span>
        <input
          type="color"
          class="color-picker-swatch"
          .value=${item.color}
          aria-label=${`Set color for ${label}`}
          @input=${(e: Event) =>
            this._onColorInput(item.value, (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="color-picker-field">
        <span class="color-picker-caption" aria-hidden="true">Shape</span>
        <div
          class="shape-picker"
          role="radiogroup"
          aria-label="Shape"
          aria-describedby=${shapesDisabled ? 'shape-note' : nothing}
          @keydown=${(e: KeyboardEvent) =>
            this._onShapeKeyDown(e, item.value, current, shapesDisabled)}
        >
          ${SHAPES.map(
            (shape) =>
              html`<button
                type="button"
                class="shape-picker-item"
                role="radio"
                aria-checked=${shape === current ? 'true' : 'false'}
                aria-label=${`Use ${shape} shape for ${label}`}
                tabindex=${shape === current ? '0' : '-1'}
                ?disabled=${shapesDisabled}
                @click=${() => this.options.commitShape(item.value, shape)}
              >
                ${shapeIcon(shape)}
              </button>`,
          )}
        </div>
      </div>
      ${shapesDisabled
        ? html`<p id="shape-note" class="symbol-picker-note">
            Shapes unavailable for multilabel annotations
          </p>`
        : nothing}
    </div>`;
  }

  // Keyboard users land in the picker; on close the popover hands focus back to where it was.
  private _onOpen = (event: Event): void => {
    event.stopPropagation();
    this.host.shadowRoot?.querySelector<HTMLInputElement>('.color-picker-swatch')?.focus();
  };

  // Escape or a press outside closed the popover; the pending colour lands, then the state follows.
  private _onClose = (event: Event): void => {
    event.stopPropagation();
    this.close();
  };

  /** Radio-group keys: the arrows, Home and End pick a shape, and focus stays on the checked one. */
  private _onShapeKeyDown(
    e: KeyboardEvent,
    value: string,
    current: PointShape,
    disabled: boolean,
  ): void {
    if (disabled) return;
    const index = SHAPES.indexOf(current);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? SHAPES[(index + 1) % SHAPES.length]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? SHAPES[(index - 1 + SHAPES.length) % SHAPES.length]
          : e.key === 'Home'
            ? SHAPES[0]
            : e.key === 'End'
              ? SHAPES[SHAPES.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    this.options.commitShape(value, next);
    void this.host.updateComplete.then(() =>
      this.host.shadowRoot
        ?.querySelector<HTMLElement>('.shape-picker-item[aria-checked="true"]')
        ?.focus(),
    );
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
}
