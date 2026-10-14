import { html, nothing, type TemplateResult } from 'lit';
import type { LegendLayout, LegendPosition } from '../publish-state';

interface LegendModel {
  legend: LegendLayout;
  dpi: number;
}

interface LegendHandlers {
  updateLegend(partial: Partial<LegendLayout>): void;
}

/** A range slider with its number box (and unit); both report through `onChange`. */
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
  return html`
    <div class="publish-input-group">
      <input
        type="range"
        class="publish-slider"
        aria-label=${label}
        min=${min}
        max=${max}
        step=${stepAttr}
        .value=${String(value)}
        @input=${(e: Event) => onChange(parse((e.target as HTMLInputElement).value) || value)}
      />
      <input
        type="number"
        class="publish-row-input"
        aria-label=${label}
        min=${min}
        max=${max}
        step=${stepAttr}
        .value=${String(value)}
        @change=${(e: Event) => onChange(parse((e.target as HTMLInputElement).value) || value)}
      />
      ${unit ? html`<span class="publish-unit">${unit}</span>` : nothing}
    </div>
  `;
}

/**
 * The legend font size in the unit the user edits. pt input keeps the float value so 8pt
 * round-trips as 8pt (rounding to integer px would clip 33.33 → 33 → 7.9pt); px input is
 * integer-only since that's what the user typed.
 */
function onFontChange(event: Event, model: LegendModel, handlers: LegendHandlers): void {
  const v = parseFloat((event.target as HTMLInputElement).value);
  if (!Number.isFinite(v) || v <= 0) return;
  const fontSizePx =
    model.legend.fontSizeUnit === 'pt'
      ? Math.max(0.1, (v / 72) * model.dpi)
      : Math.max(1, Math.round(v));
  handlers.updateLegend({ fontSizePx });
}

function renderFontInput(model: LegendModel, handlers: LegendHandlers) {
  const { fontSizePx, fontSizeUnit: unit } = model.legend;
  const isPt = unit === 'pt';
  const value = isPt ? ((fontSizePx / model.dpi) * 72).toFixed(1) : String(Math.round(fontSizePx));
  const min = isPt ? 1 : 8;
  const max = isPt ? 50 : 120;
  const step = isPt ? 0.5 : 1;
  return html`
    <div class="publish-input-group">
      <input
        type="range"
        class="publish-slider"
        aria-label="Legend font size"
        min=${min}
        max=${max}
        step=${step}
        .value=${value}
        @input=${(e: Event) => onFontChange(e, model, handlers)}
      />
      <input
        type="number"
        class="publish-row-input"
        data-publish-input="legend-font"
        aria-label="Legend font size"
        min=${min}
        max=${max}
        step=${step}
        .value=${value}
        @change=${(e: Event) => onFontChange(e, model, handlers)}
      />
      <select
        class="publish-select publish-unit-select"
        data-publish-input="legend-font-unit"
        aria-label="Legend font unit"
        .value=${unit}
        @change=${(e: Event) => {
          handlers.updateLegend({
            fontSizeUnit: (e.target as HTMLSelectElement).value as 'pt' | 'px',
          });
        }}
      >
        <option value="pt">pt</option>
        <option value="px">px</option>
      </select>
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
              <select
                class="publish-select"
                aria-label="Legend position"
                .value=${leg.position}
                @change=${(e: Event) => {
                  handlers.updateLegend({
                    position: (e.target as HTMLSelectElement).value as LegendPosition,
                  });
                }}
              >
                <option value="right">Right</option>
                <option value="left">Left</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="free">Free (drag to move)</option>
              </select>
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
