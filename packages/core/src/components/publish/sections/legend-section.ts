import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import '../../kit/select';
import type { PsSelect, SelectOption } from '../../kit/select';
import type { LegendLayout, LegendPosition } from '../publish-state';

const FONT_UNIT_OPTIONS: SelectOption[] = [
  { value: 'pt', label: 'pt' },
  { value: 'px', label: 'px' },
];

const POSITION_OPTIONS: SelectOption[] = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'free', label: 'Free (drag to move)' },
];

interface LegendModel {
  legend: LegendLayout;
  dpi: number;
}

interface LegendHandlers {
  updateLegend(partial: Partial<LegendLayout>): void;
}

/** `value` within `min`..`max`. */
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A range slider with its number box (and unit); both report through `onChange`. A typed number
 * is held to the slider's range (a negative stroke, or a legend wider than the figure, would
 * break the drawing), and one that is not a number keeps `value`. Every edit re-renders, and
 * `live()` then puts a clamped or kept entry back to what applies.
 */
export function renderSliderInput(opts: {
  /** Names the slider and its number box; the row's `<label>` is not tied to them. */
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
}): TemplateResult {
  const { label, min, max, step, value, unit, onChange } = opts;
  const stepAttr = step ?? 1;
  const parse = step && step < 1 ? parseFloat : parseInt;
  const commit = (e: Event) => {
    const parsed = parse((e.target as HTMLInputElement).value);
    onChange(Number.isFinite(parsed) ? clamp(parsed, min, max) : value);
  };
  return html`
    <div class="publish-input-group">
      <input
        type="range"
        class="publish-slider"
        aria-label=${label}
        min=${min}
        max=${max}
        step=${stepAttr}
        .value=${live(String(value))}
        @input=${commit}
      />
      <input
        type="number"
        class="publish-row-input"
        aria-label=${label}
        min=${min}
        max=${max}
        step=${stepAttr}
        .value=${live(String(value))}
        @change=${commit}
      />
      ${unit ? html`<span class="publish-unit">${unit}</span>` : nothing}
    </div>
  `;
}

/**
 * The legend font size in the unit the user edits, held to the box's range. pt input keeps the
 * float value so 8pt round-trips as 8pt (rounding to integer px would clip 33.33 → 33 → 7.9pt);
 * px input is integer-only since that's what the user typed.
 */
function onFontChange(
  event: Event,
  range: { min: number; max: number },
  model: LegendModel,
  handlers: LegendHandlers,
): void {
  const typed = parseFloat((event.target as HTMLInputElement).value);
  // Not a number keeps the size; the edit still re-renders, which puts the box back.
  if (!Number.isFinite(typed)) {
    handlers.updateLegend({ fontSizePx: model.legend.fontSizePx });
    return;
  }
  const v = clamp(typed, range.min, range.max);
  const fontSizePx = model.legend.fontSizeUnit === 'pt' ? (v / 72) * model.dpi : Math.round(v);
  handlers.updateLegend({ fontSizePx });
}

function renderFontInput(model: LegendModel, handlers: LegendHandlers) {
  const { fontSizePx, fontSizeUnit: unit } = model.legend;
  const isPt = unit === 'pt';
  const value = isPt ? ((fontSizePx / model.dpi) * 72).toFixed(1) : String(Math.round(fontSizePx));
  const range = isPt ? { min: 1, max: 50 } : { min: 8, max: 120 };
  const step = isPt ? 0.5 : 1;
  const onChange = (e: Event) => onFontChange(e, range, model, handlers);
  return html`
    <div class="publish-input-group">
      <input
        type="range"
        class="publish-slider"
        aria-label="Legend font size"
        min=${range.min}
        max=${range.max}
        step=${step}
        .value=${live(value)}
        @input=${onChange}
      />
      <input
        type="number"
        class="publish-row-input"
        data-publish-input="legend-font"
        aria-label="Legend font size"
        min=${range.min}
        max=${range.max}
        step=${step}
        .value=${live(value)}
        @change=${onChange}
      />
      <ps-select
        class="publish-select publish-unit-select"
        size="sm"
        data-publish-input="legend-font-unit"
        label="Legend font unit"
        .options=${FONT_UNIT_OPTIONS}
        .value=${unit}
        @change=${(e: Event) => {
          handlers.updateLegend({
            fontSizeUnit: (e.target as PsSelect).value as 'pt' | 'px',
          });
        }}
      ></ps-select>
    </div>
  `;
}

/** Show legend, then (when shown) its position, size, font size and columns. */
export function renderLegendSection(model: LegendModel, handlers: LegendHandlers): TemplateResult {
  const leg = model.legend;
  return html`
    <div class="publish-section">
      <div class="publish-section-title">Legend</div>

      <label class="publish-checkbox-label">
        <input
          type="checkbox"
          class="publish-checkbox"
          .checked=${leg.visible}
          @change=${(e: Event) => {
            handlers.updateLegend({ visible: (e.target as HTMLInputElement).checked });
          }}
        />
        Show legend
      </label>

      ${leg.visible
        ? html`
            <div class="publish-row">
              <label>Position</label>
              <ps-select
                class="publish-select"
                size="sm"
                label="Legend position"
                .options=${POSITION_OPTIONS}
                .value=${leg.position}
                @change=${(e: Event) => {
                  handlers.updateLegend({
                    position: (e.target as PsSelect).value as LegendPosition,
                  });
                }}
              ></ps-select>
            </div>

            <div class="publish-row">
              <label>Size %</label>
              ${renderSliderInput({
                label: 'Legend size',
                min: 10,
                max: 100,
                value: leg.widthPercent,
                unit: '%',
                onChange: (v) => handlers.updateLegend({ widthPercent: v }),
              })}
            </div>

            <div class="publish-row">
              <label>Font size</label>
              ${renderFontInput(model, handlers)}
            </div>

            <div class="publish-row">
              <label>Columns</label>
              ${renderSliderInput({
                label: 'Legend columns',
                min: 1,
                max: 6,
                value: leg.columns,
                onChange: (v) => handlers.updateLegend({ columns: v }),
              })}
            </div>
          `
        : nothing}
    </div>
  `;
}
