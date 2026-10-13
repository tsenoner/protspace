import { html, type TemplateResult } from 'lit';
import '../../kit/tooltip';
import { JOURNAL_PRESETS, type PresetId } from '../journal-presets';
import type { PublishState } from '../publish-state';

interface PresetsModel {
  preset: PublishState['preset'];
}

interface PresetsHandlers {
  applyPreset(id: PresetId): void;
}

interface OptionsModel {
  format: PublishState['format'];
  background: PublishState['background'];
}

interface OptionsHandlers {
  update(partial: Partial<PublishState>): void;
}

/** The journal presets grid: the sidebar's first section. */
export function renderPresets(model: PresetsModel, handlers: PresetsHandlers): TemplateResult {
  return html`
    <div class="publish-section">
      <div class="publish-section-title">Presets</div>
      <div class="publish-preset-grid">
        ${JOURNAL_PRESETS.map((p) => {
          const preset = p as { widthMm?: number; widthPx?: number; heightPx?: number };
          const dims =
            preset.widthMm !== undefined
              ? `${preset.widthMm} mm`
              : `${preset.widthPx}×${preset.heightPx}`;
          return html`
            <button
              class="publish-toggle-btn publish-preset-btn ${model.preset === p.id ? 'active' : ''}"
              @click=${() => handlers.applyPreset(p.id)}
              type="button"
            >
              ${p.label}<span class="publish-preset-dims">${dims}</span>
            </button>
            <ps-tooltip text="${p.label} (${dims})"></ps-tooltip>
          `;
        })}
      </div>
    </div>
  `;
}

/** Format and background: the sidebar's last section. */
export function renderOptions(model: OptionsModel, handlers: OptionsHandlers): TemplateResult {
  return html`
    <div class="publish-section">
      <div class="publish-section-title">Options</div>

      <div class="publish-row">
        <label>Format</label>
        <div class="publish-format-toggle">
          <button
            type="button"
            class="publish-toggle-btn ${model.format === 'png' ? 'active' : ''}"
            aria-pressed=${model.format === 'png' ? 'true' : 'false'}
            @click=${() => handlers.update({ format: 'png' })}
          >
            PNG
          </button>
          <button
            type="button"
            class="publish-toggle-btn ${model.format === 'pdf' ? 'active' : ''}"
            aria-pressed=${model.format === 'pdf' ? 'true' : 'false'}
            @click=${() => handlers.update({ format: 'pdf' })}
          >
            PDF
          </button>
        </div>
      </div>

      <div class="publish-row">
        <label>Background</label>
        <select
          class="publish-select"
          .value=${model.background}
          @change=${(e: Event) => {
            handlers.update({
              background: (e.target as HTMLSelectElement).value as 'white' | 'transparent',
            });
          }}
        >
          <option value="white">White</option>
          <option value="transparent">Transparent</option>
        </select>
      </div>
    </div>
  `;
}
