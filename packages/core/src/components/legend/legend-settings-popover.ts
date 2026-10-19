import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import {
  DEFAULT_CATEGORICAL_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  type NumericBinningStrategy,
} from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import type { PsButton } from '../kit/button';
import '../kit/input';
import type { PsInput } from '../kit/input';
import '../kit/popover';
import '../kit/select';
import type { PsSelect, SelectOption } from '../kit/select';
import '../kit/switch';
import type { PsSwitch } from '../kit/switch';
import { LEGEND_DEFAULTS } from './config';
import { legendSettingsPopoverStyles } from './legend-settings-popover.styles';
import {
  CATEGORICAL_PALETTE_IDS,
  GRADIENT_PALETTE_IDS,
  renderPaletteSwatches,
} from './palette-swatches';
import type { LegendDisplaySettings } from './types';

/**
 * A typed number commits this long after the last keystroke or arrow step, so "25" or a held arrow
 * re-bins the plot once, not once per key (design decision 12, Review Focus 3).
 */
export const SETTINGS_INPUT_DEBOUNCE_MS = 300;

type NumberField = 'maxVisibleValues' | 'shapeSize';

const NUMBER_FIELDS: readonly NumberField[] = ['maxVisibleValues', 'shapeSize'];

const FIELD_IDS: Record<NumberField, string> = {
  maxVisibleValues: 'max-visible-input',
  shapeSize: 'shape-size-input',
};

const DEFAULT_SETTINGS: LegendDisplaySettings = {
  maxVisibleValues: LEGEND_DEFAULTS.maxVisibleValues,
  shapeSize: null,
  enableDuplicateStackUI: LEGEND_DEFAULTS.enableDuplicateStackUI,
  paletteId: DEFAULT_CATEGORICAL_PALETTE_ID,
  numericStrategy: DEFAULT_NUMERIC_STRATEGY,
  reverseGradient: false,
};

const SETTINGS_KEYS: readonly (keyof LegendDisplaySettings)[] = [
  'maxVisibleValues',
  'shapeSize',
  'enableDuplicateStackUI',
  'paletteId',
  'numericStrategy',
  'reverseGradient',
];

/** Points a kit control's description at its hint, or at nothing; writes only on a change. */
function describe(control: PsButton | PsInput | PsSelect, hint: Element | null): void {
  const next: readonly Element[] = hint ? [hint] : [];
  if (control.describedBy.length !== next.length || control.describedBy[0] !== next[0]) {
    control.describedBy = next;
  }
}

/** The legend derives `settings` afresh at every render; only a changed value re-renders this. */
function sameSettings(next: LegendDisplaySettings, prev?: LegendDisplaySettings): boolean {
  return !!prev && SETTINGS_KEYS.every((key) => next[key] === prev[key]);
}

const DISTRIBUTIONS: Record<'withLog' | 'withoutLog', SelectOption[]> = {
  withLog: [
    { value: 'linear', label: 'Linear' },
    { value: 'quantile', label: 'Quantile' },
    { value: 'logarithmic', label: 'Logarithmic' },
  ],
  withoutLog: [
    { value: 'linear', label: 'Linear' },
    { value: 'quantile', label: 'Quantile' },
    { value: 'logarithmic', label: 'Logarithmic', disabled: true },
  ],
};

function parsePositiveInt(value: string): number | null {
  const parsed = parseInt(value, 10);
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
}

function fieldText(field: NumberField, settings: LegendDisplaySettings): string {
  const value = settings[field];
  return value === null ? '' : String(value);
}

/**
 * The legend's settings as a popover under its settings button (design decision 12). Every edit is
 * a `settings-change` the legend applies at once; there is no Save or Cancel. Reset is a
 * `settings-reset`. The legend owns `open`: it sets it, and clears it on `ps-close`.
 */
@customElement('protspace-legend-settings-popover')
export class ProtspaceLegendSettingsPopover extends LitElement {
  static styles = legendSettingsPopoverStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({
    attribute: false,
    hasChanged: (next: LegendDisplaySettings, prev: LegendDisplaySettings | undefined) =>
      !sameSettings(next, prev),
  })
  settings: LegendDisplaySettings = DEFAULT_SETTINGS;
  @property({ type: Boolean }) numeric = false;
  @property({ attribute: false }) defaultShapeSize: number = LEGEND_DEFAULTS.symbolSize;
  @property({ attribute: false }) logBinningAvailable = true;
  @property({ attribute: false }) canReset = false;
  @property({ attribute: false }) annotationLabel = '';

  @state() private _invalid: ReadonlySet<NumberField> = new Set();
  @query('#numeric-distribution-select') private _strategySelect?: PsSelect;
  @query('#numeric-log-disabled-note') private _logNote?: HTMLElement;

  private _pending: { field: NumberField; value: number | null } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  render() {
    const settings = this.settings;
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement="bottom-end"
      panel-role="dialog"
      panel-label=${`Legend settings: ${this.annotationLabel}`}
      @ps-close=${this._onClose}
    >
      <div class="settings">
        <h3 class="title">${this.annotationLabel}</h3>
        <div class="group">
          <span class="label" aria-hidden="true">Palette</span>
          ${renderPaletteSwatches(
            {
              ids: this.numeric ? GRADIENT_PALETTE_IDS : CATEGORICAL_PALETTE_IDS,
              selected: settings.paletteId,
              gradient: this.numeric,
              reverse: settings.reverseGradient,
            },
            this._onPalette,
          )}
          ${this.numeric ? this._renderNumericControls(settings) : nothing}
        </div>
        ${this._renderNumberField(
          'maxVisibleValues',
          this.numeric ? 'Bins' : 'Max legend items',
          String(LEGEND_DEFAULTS.maxVisibleValues),
          this.numeric
            ? 'An upper limit: sparse ranges may show fewer bins.'
            : 'Categories past this are grouped into Other.',
        )}
        ${this._renderNumberField(
          'shapeSize',
          this.numeric ? 'Point size' : 'Shape size',
          String(this.defaultShapeSize),
          `Default for this dataset: ${this.defaultShapeSize}; clear the field to use it.`,
        )}
        <ps-switch
          label="Show duplicate counts and spread overlaps"
          .checked=${settings.enableDuplicateStackUI}
          @change=${this._onDuplicates}
          >Show duplicate counts and spread overlaps</ps-switch
        >
        <div class="footer">
          <ps-button
            id="reset-button"
            variant="ghost"
            size="sm"
            ?disabled=${!this.canReset}
            @click=${this._onReset}
            >Reset</ps-button
          >
          <p class="hint" id="reset-hint">
            Resets this annotation's colours, order, hidden categories, palette and item count, and
            the dataset's point size
          </p>
        </div>
      </div>
    </ps-popover>`;
  }

  protected updated(changed: PropertyValues<this>): void {
    // The owner closed it (its settings button): keep what was typed.
    if (changed.has('open') && !this.open && changed.get('open') === true) {
      this.flush();
      this._syncFields();
    }
    const select = this._strategySelect;
    if (select) describe(select, this._logNote ?? null);
    for (const field of NUMBER_FIELDS) {
      const input = this.renderRoot.querySelector<PsInput>(`#${FIELD_IDS[field]}`);
      if (input) describe(input, this.renderRoot.querySelector(`#${FIELD_IDS[field]}-hint`));
    }
    const reset = this.renderRoot.querySelector<PsButton>('#reset-button');
    if (reset) describe(reset, this.renderRoot.querySelector('#reset-hint'));
  }

  disconnectedCallback(): void {
    this.flush();
    super.disconnectedCallback();
  }

  /** Dispatches a number edit still waiting on its debounce, at once. */
  flush(): void {
    this._clearTimer();
    const pending = this._pending;
    this._pending = null;
    if (!pending || this.settings[pending.field] === pending.value) return;
    // Only the size field reads null (emptied); Max legend items is always a number here.
    this._emit(
      pending.field === 'shapeSize'
        ? { shapeSize: pending.value }
        : { maxVisibleValues: pending.value as number },
    );
  }

  /** Focuses the checked palette swatch, the panel's first stop. */
  focusFirst(): void {
    const swatches = [...this.renderRoot.querySelectorAll<HTMLElement>('[role="radio"]')];
    (
      swatches.find((swatch) => swatch.getAttribute('aria-checked') === 'true') ?? swatches[0]
    )?.focus();
  }

  private _renderNumericControls(settings: LegendDisplaySettings): TemplateResult {
    return html`<ps-switch
        id="reverse-gradient-toggle"
        label="Reverse gradient"
        .checked=${settings.reverseGradient}
        @change=${this._onReverse}
        >Reverse gradient</ps-switch
      >
      <div class="field">
        <span class="label" aria-hidden="true">Bin distribution</span>
        <ps-select
          id="numeric-distribution-select"
          label="Bin distribution"
          .options=${this.logBinningAvailable ? DISTRIBUTIONS.withLog : DISTRIBUTIONS.withoutLog}
          .value=${settings.numericStrategy}
          @change=${this._onStrategy}
        ></ps-select>
        ${this.logBinningAvailable
          ? nothing
          : html`<p
              class="hint"
              id="numeric-log-disabled-note"
              data-driver-id="numeric-log-disabled-note"
            >
              Logarithmic distribution is only available for positive values.
            </p>`}
      </div>`;
  }

  private _renderNumberField(
    field: NumberField,
    label: string,
    placeholder: string,
    hint: string,
  ): TemplateResult {
    return html`<div class="field">
      <span class="label" aria-hidden="true">${label}</span>
      <ps-input
        id=${FIELD_IDS[field]}
        type="number"
        label=${label}
        placeholder=${placeholder}
        .value=${fieldText(field, this.settings)}
        ?invalid=${this._invalid.has(field)}
        @input=${(event: Event) => this._onNumberInput(field, event)}
        @keydown=${this._onNumberKeydown}
        @focusout=${this._onNumberFocusOut}
      ></ps-input>
      <p class="hint" id="${FIELD_IDS[field]}-hint">${hint}</p>
    </div>`;
  }

  private _onNumberInput(field: NumberField, event: Event): void {
    const input = event.composedPath()[0] as HTMLInputElement;
    const value = this._readNumber(field, input, event.currentTarget as PsInput);
    this._setInvalid(field, value === undefined);
    if (value === undefined) {
      if (this._pending?.field === field) this.cancel();
      return;
    }
    if (this._pending && this._pending.field !== field) this.flush();
    this._pending = { field, value };
    this._clearTimer();
    this._timer = setTimeout(() => this.flush(), SETTINGS_INPUT_DEBOUNCE_MS);
  }

  /** A positive whole number, null for an emptied size, undefined for anything else. */
  private _readNumber(
    field: NumberField,
    input: HTMLInputElement,
    host: PsInput,
  ): number | null | undefined {
    // A number field also reads '' while it holds text it cannot parse; only an empty one asks
    // for the default.
    if (field === 'shapeSize' && input.value === '' && !input.validity.badInput) return null;
    const value = parsePositiveInt(input.value);
    if (value === null) return undefined;
    if (field === 'shapeSize' && value > LEGEND_DEFAULTS.maxSymbolSize) {
      // Written back, so the field never shows a size that is not the one applied.
      input.value = String(LEGEND_DEFAULTS.maxSymbolSize);
      host.value = input.value;
      return LEGEND_DEFAULTS.maxSymbolSize;
    }
    return value;
  }

  private _onNumberKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') this.flush();
  };

  private _onNumberFocusOut = () => this.flush();

  private _onPalette = (paletteId: string) => {
    if (paletteId !== this.settings.paletteId) this._change({ paletteId });
  };

  private _onReverse = (event: Event) =>
    this._change({ reverseGradient: (event.currentTarget as PsSwitch).checked });

  private _onDuplicates = (event: Event) =>
    this._change({ enableDuplicateStackUI: (event.currentTarget as PsSwitch).checked });

  private _onStrategy = (event: Event) =>
    this._change({
      numericStrategy: (event.currentTarget as PsSelect).value as NumericBinningStrategy,
    });

  private _onReset = () => {
    if (!this.canReset) return;
    this.cancel();
    this._syncFields();
    this.dispatchEvent(new Event('settings-reset'));
  };

  // Runs on the inner popover, before ps-close bubbles on to the owner.
  private _onClose = () => {
    this.flush();
    this._syncFields();
  };

  /** A discrete edit: anything typed before it goes first. */
  private _change(patch: Partial<LegendDisplaySettings>): void {
    this.flush();
    this._emit(patch);
  }

  private _emit(patch: Partial<LegendDisplaySettings>): void {
    this.dispatchEvent(
      new CustomEvent<Partial<LegendDisplaySettings>>('settings-change', { detail: patch }),
    );
  }

  private _setInvalid(field: NumberField, invalid: boolean): void {
    if (this._invalid.has(field) === invalid) return;
    const next = new Set(this._invalid);
    if (invalid) next.add(field);
    else next.delete(field);
    this._invalid = next;
  }

  /** Puts the settings back into both fields, dropping text that was never applied. */
  private _syncFields(): void {
    for (const field of NUMBER_FIELDS) {
      const input = this.renderRoot.querySelector<PsInput>(`#${FIELD_IDS[field]}`);
      if (input) input.value = fieldText(field, this.settings);
    }
    if (this._invalid.size > 0) this._invalid = new Set();
  }

  /** Drops a number edit still waiting on its debounce. */
  cancel(): void {
    this._clearTimer();
    this._pending = null;
  }

  private _clearTimer(): void {
    if (this._timer === null) return;
    clearTimeout(this._timer);
    this._timer = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend-settings-popover': ProtspaceLegendSettingsPopover;
  }
}
