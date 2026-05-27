import { html, nothing, type TemplateResult } from 'lit';
import { LEGEND_DEFAULTS } from './config';
import type { LegendSortMode } from './types';
import { renderCloseIcon } from './legend-other-dialog';
import {
  GRADIENT_COLOR_SCHEME_IDS,
  COLOR_SCHEMES,
  createColorSchemeLinearGradient,
  COLOR_SCHEME_INFO,
  getColorSchemeInfo,
  type NumericBinningStrategy,
} from '@protspace/utils';

/**
 * Settings dialog state interface
 */
export interface SettingsDialogState {
  maxVisibleValues: number;
  shapeSize: number;
  enableDuplicateStackUI: boolean;
  selectedAnnotation: string;
  annotationSortModes: Record<string, LegendSortMode>;
  isNumericAnnotation: boolean;
  selectedNumericStrategy: NumericBinningStrategy;
  logBinningAvailable: boolean;
  hasPersistedSettings: boolean;
  selectedPaletteId: string;
  reverseGradient: boolean;
}

/**
 * Settings dialog callbacks interface
 */
export interface SettingsDialogCallbacks {
  onMaxVisibleValuesChange: (value: number) => void;
  onShapeSizeChange: (value: number) => void;
  onEnableDuplicateStackUIChange: (checked: boolean) => void;
  onSortModeChange: (annotation: string, mode: LegendSortMode) => void;
  onPaletteChange: (paletteId: string) => void;
  onNumericStrategyChange: (strategy: NumericBinningStrategy) => void;
  onReverseGradientChange: (checked: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  onReset: () => void;
  onKeydown: (e: KeyboardEvent) => void;
  onOverlayMouseDown: (e: MouseEvent) => void;
  onOverlayMouseUp: () => void;
}

/**
 * Parses an input value as a positive integer
 */
function parsePositiveInt(value: string): number | null {
  const parsed = parseInt(value, 10);
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
}

function renderSection(
  title: string,
  content: TemplateResult | TemplateResult[],
  description?: string,
  titleId?: string,
): TemplateResult {
  return html`
    <section class="settings-section">
      <div class="settings-section-header">
        <h4 class="settings-section-title" id=${titleId ?? nothing}>${title}</h4>
        ${description ? html`<p class="settings-section-description">${description}</p>` : nothing}
      </div>
      <div class="settings-section-content">${content}</div>
    </section>
  `;
}

function renderFieldCard(
  title: string,
  body: TemplateResult,
  hint?: string,
  extraClass = '',
  inputId?: string,
): TemplateResult {
  return html`
    <div class=${`other-items-list-item ${extraClass}`.trim()}>
      <label class="other-items-list-item-label" for=${inputId ?? nothing}>${title}</label>
      ${body} ${renderFieldHint(hint)}
    </div>
  `;
}

function renderFieldHint(hint?: string): TemplateResult {
  return hint ? html`<div class="settings-note">${hint}</div>` : html`${nothing}`;
}

/**
 * Renders the max visible values input
 */
function renderMaxVisibleInput(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
): TemplateResult {
  const onInput = (e: Event) => {
    const value = parsePositiveInt((e.target as HTMLInputElement).value);
    if (value !== null) callbacks.onMaxVisibleValuesChange(value);
  };

  return renderFieldCard(
    'Max legend items',
    html`
      <input
        id="max-visible-input"
        type="number"
        min="1"
        .value=${String(state.maxVisibleValues)}
        placeholder=${String(LEGEND_DEFAULTS.maxVisibleValues)}
        @input=${onInput}
        class="legend-form-control"
      />
    `,
    state.isNumericAnnotation
      ? 'Sets the upper limit for visible bins. Sparse ranges may show fewer bins.'
      : 'Sets how many legend items stay visible before the rest are grouped into Other.',
    '',
    'max-visible-input',
  );
}

/**
 * Renders the shape size input
 */
function renderShapeSizeInput(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
): TemplateResult {
  const onInput = (e: Event) => {
    const value = parsePositiveInt((e.target as HTMLInputElement).value);
    if (value !== null) callbacks.onShapeSizeChange(value);
  };

  return renderFieldCard(
    state.isNumericAnnotation ? 'Point size' : 'Shape size',
    html`
      <input
        class="legend-form-control"
        id="shape-size-input"
        type="number"
        min="6"
        max="64"
        .value=${String(state.shapeSize)}
        placeholder=${String(LEGEND_DEFAULTS.symbolSize)}
        @input=${onInput}
      />
    `,
    undefined,
    '',
    'shape-size-input',
  );
}

/**
 * Renders the checkbox options for the settings dialog.
 */
function renderCheckboxOptions(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
): TemplateResult {
  const renderCheckboxCard = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    options?: {
      disabled?: boolean;
      describedBy?: string;
      note?: string;
      noteId?: string;
    },
  ): TemplateResult => html`
    <label
      class=${`other-items-list-label ${options?.disabled ? 'other-items-list-label--disabled' : ''}`.trim()}
    >
      <input
        class="other-items-list-label-input"
        type="checkbox"
        .checked=${checked}
        .disabled=${options?.disabled ?? false}
        aria-describedby=${options?.describedBy ?? nothing}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
      />
      ${label}
    </label>
    ${options?.note
      ? html`<div
          class=${`settings-note ${options?.disabled ? 'settings-note--inline' : ''}`.trim()}
          id=${options?.noteId ?? nothing}
        >
          ${options.note}
        </div>`
      : nothing}
  `;

  return html`
    ${renderCheckboxCard(
      'Show duplicate counts and spread overlaps',
      state.enableDuplicateStackUI,
      (checked) => callbacks.onEnableDuplicateStackUIChange(checked),
    )}
  `;
}

function renderNumericPalettePreview(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
  selectedPaletteInfo: { label: string; description: string },
): TemplateResult {
  return html`
    <div class="color-palette-preview color-palette-preview--continuous">
      <div
        class="color-palette-swatch color-palette-swatch--gradient color-palette-gradient-bar"
        role="img"
        aria-label=${`${selectedPaletteInfo.label} continuous gradient preview`}
        style=${`background-image: ${createColorSchemeLinearGradient(
          state.selectedPaletteId,
          state.reverseGradient ? '270deg' : '90deg',
        )};`}
      ></div>
      <div class="color-palette-gradient-scale" aria-hidden="true">
        <span>Low</span>
        <span>High</span>
      </div>
      <label class="compact-checkbox-row color-palette-direction-toggle">
        <input
          class="other-items-list-label-input"
          id="reverse-gradient-toggle"
          type="checkbox"
          .checked=${state.reverseGradient}
          @change=${(e: Event) =>
            callbacks.onReverseGradientChange((e.target as HTMLInputElement).checked)}
        />
        Reverse gradient direction
      </label>
    </div>
  `;
}

function renderCategoricalPalettePreview(selectedPalette: readonly string[]): TemplateResult {
  return html`
    <div class="color-palette-preview">
      ${selectedPalette.map(
        (color) => html`
          <div class="color-palette-swatch" style="background-color: ${color}" title=${color}></div>
        `,
      )}
    </div>
  `;
}

/**
 * Returns the appropriate sort mode for a given category
 */
function getSortModeForCategory(category: 'size' | 'alpha' | 'manual'): LegendSortMode {
  switch (category) {
    case 'size':
      return 'size-asc';
    case 'alpha':
      return 'alpha-asc';
    case 'manual':
      return 'manual';
  }
}

/**
 * Renders the sorting options section
 * Note: Direction (asc/desc) is toggled via the "Reverse z-order" button in the legend header
 */
function renderSortingSection(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
): TemplateResult {
  if (!state.selectedAnnotation) return html``;

  const aname = state.selectedAnnotation;
  const sectionTitle = state.isNumericAnnotation ? 'Bin order' : 'Category order';
  const currentMode =
    state.annotationSortModes[aname] || (state.isNumericAnnotation ? 'alpha-asc' : 'size-desc');

  const isSize = currentMode.startsWith('size');
  const isAlphabetic = currentMode.startsWith('alpha');
  const isManual = currentMode.startsWith('manual');

  const handleTypeChange = (category: 'size' | 'alpha' | 'manual') => {
    callbacks.onSortModeChange(aname, getSortModeForCategory(category));
  };

  const sortOptions = state.isNumericAnnotation
    ? [
        { checked: isAlphabetic, label: 'By numeric value', category: 'alpha' as const },
        { checked: isManual, label: 'Manual order', category: 'manual' as const },
      ]
    : [
        { checked: isSize, label: 'By category size', category: 'size' as const },
        { checked: isAlphabetic, label: 'Alphabetical', category: 'alpha' as const },
        { checked: isManual, label: 'Manual order', category: 'manual' as const },
      ];

  return renderSection(
    sectionTitle,
    html`
      <div
        class="other-items-list-item other-items-list-item--grouped other-items-list-item-sorting"
      >
        <div
          class="other-items-list-item-sorting-container"
          role="radiogroup"
          aria-labelledby="legend-sorting-section-title"
        >
          <div class="other-items-list-item-sorting-container-item-container">
            ${sortOptions.map(
              (option) => html`
                <label class="other-items-list-item-sorting-container-item-container-label">
                  <input
                    class="other-items-list-item-sorting-container-item-container-input"
                    type="radio"
                    name=${`sort-type-${aname}`}
                    .checked=${option.checked}
                    @change=${() => handleTypeChange(option.category)}
                  />
                  ${option.label}
                </label>
              `,
            )}
          </div>
        </div>
        <div class="settings-note settings-note--compact">
          Dragging any item switches this annotation to Manual order.
          ${state.isNumericAnnotation
            ? ' Use the legend header arrows to flip low-to-high or reverse manual order.'
            : ' Use the legend header arrows to reverse the current category order.'}
        </div>
      </div>
    `,
    undefined,
    'legend-sorting-section-title',
  );
}

/**
 * Renders the color palette section
 */
function renderPaletteSection(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
): TemplateResult {
  const handlePaletteChange = (e: Event) => {
    const select = e.target as HTMLSelectElement;
    callbacks.onPaletteChange(select.value);
  };

  const paletteEntries = Object.entries(COLOR_SCHEME_INFO)
    .filter(([id]) =>
      state.isNumericAnnotation
        ? GRADIENT_COLOR_SCHEME_IDS.has(id)
        : !GRADIENT_COLOR_SCHEME_IDS.has(id),
    )
    .sort(([, left], [, right]) => left.label.localeCompare(right.label));
  const selectedPalette =
    COLOR_SCHEMES[state.selectedPaletteId as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES.kellys;
  const showNumericDistribution =
    state.isNumericAnnotation && GRADIENT_COLOR_SCHEME_IDS.has(state.selectedPaletteId);
  const selectedPaletteInfo = getColorSchemeInfo(state.selectedPaletteId) ?? {
    label: state.selectedPaletteId,
    description: 'Color palette',
  };

  return renderSection(
    'Color palette',
    html`
      <div class="other-items-list-item other-items-list-item--grouped">
        <div class="color-palette-row">
          <label id="palette-select-label" for="palette-select" class="other-items-list-item-label">
            Palette
          </label>
          <select
            id="palette-select"
            class="color-palette-select legend-form-control"
            .value=${state.selectedPaletteId}
            @change=${handlePaletteChange}
          >
            ${paletteEntries.map(
              ([id, info]) => html`
                <option value=${id} .selected=${state.selectedPaletteId === id}>
                  ${info.label} - ${info.description}
                </option>
              `,
            )}
          </select>
        </div>
        ${state.isNumericAnnotation
          ? renderNumericPalettePreview(state, callbacks, selectedPaletteInfo)
          : renderCategoricalPalettePreview(selectedPalette)}
        ${showNumericDistribution
          ? html`
              <div class="settings-subfield">
                <label for="numeric-distribution-select" class="other-items-list-item-label">
                  Bin distribution
                </label>
                <select
                  id="numeric-distribution-select"
                  class="color-palette-select legend-form-control"
                  aria-describedby=${!state.logBinningAvailable
                    ? 'numeric-log-disabled-note'
                    : nothing}
                  .value=${state.selectedNumericStrategy}
                  @change=${(e: Event) =>
                    callbacks.onNumericStrategyChange(
                      (e.target as HTMLSelectElement).value as NumericBinningStrategy,
                    )}
                >
                  <option value="linear">Linear</option>
                  <option value="quantile">Quantile</option>
                  <option value="logarithmic" ?disabled=${!state.logBinningAvailable}>
                    Logarithmic
                  </option>
                </select>
                ${state.logBinningAvailable
                  ? html`<div class="settings-note settings-note--compact">
                      Controls how bin boundaries are spaced across the value range.
                    </div>`
                  : html`
                      <div
                        class="settings-note settings-note--compact"
                        id="numeric-log-disabled-note"
                        data-driver-id="numeric-log-disabled-note"
                      >
                        Logarithmic distribution is only available for positive values.
                      </div>
                    `}
              </div>
            `
          : nothing}
      </div>
    `,
    undefined,
    'legend-palette-section-title',
  );
}

/**
 * Renders the dialog header with close button
 */
function renderDialogHeader(title: string, onClose: () => void): TemplateResult {
  return html`
    <div class="modal-header">
      <h3 class="modal-title" id="legend-settings-title">${title}</h3>
      <button
        class="btn-close close-button"
        title="Close settings"
        aria-label="Close settings"
        @click=${onClose}
      >
        ${renderCloseIcon()}
      </button>
    </div>
  `;
}

/**
 * Renders the dialog footer with action buttons
 */
function renderDialogFooter(
  callbacks: SettingsDialogCallbacks,
  hasPersistedSettings: boolean,
): TemplateResult {
  return html`
    <div class="modal-footer">
      ${hasPersistedSettings
        ? html`<button
            class="btn-danger modal-reset-button"
            @click=${callbacks.onReset}
            title="Reset all settings to defaults and clear saved preferences"
          >
            Reset
          </button>`
        : nothing}
      <button class="btn-secondary modal-close-button" @click=${callbacks.onClose}>Cancel</button>
      <button class="btn-primary extract-button" @click=${callbacks.onSave}>Save</button>
    </div>
  `;
}

/**
 * Initializes sort mode for an annotation if not already set
 */
export function initializeAnnotationSortMode(
  annotationSortModes: Record<string, LegendSortMode>,
  selectedAnnotation: string,
  currentAnnotationSortModes: Record<string, LegendSortMode>,
): Record<string, LegendSortMode> {
  if (!selectedAnnotation || annotationSortModes[selectedAnnotation]) {
    return annotationSortModes;
  }

  const existingMode = currentAnnotationSortModes[selectedAnnotation];
  const mode: LegendSortMode = existingMode || 'size-desc';

  return {
    ...annotationSortModes,
    [selectedAnnotation]: mode,
  };
}

/**
 * Renders the complete settings dialog
 */
export function renderSettingsDialog(
  state: SettingsDialogState,
  callbacks: SettingsDialogCallbacks,
): TemplateResult {
  return html`
    <div
      class="modal-overlay"
      part="dialog-overlay"
      @mousedown=${callbacks.onOverlayMouseDown}
      @mouseup=${callbacks.onOverlayMouseUp}
      @keydown=${callbacks.onKeydown}
    >
      <div
        id="legend-settings-dialog"
        class="modal-content"
        part="dialog-content"
        tabindex="-1"
        @mousedown=${(e: Event) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legend-settings-title"
      >
        ${renderDialogHeader(`Legend settings: ${state.selectedAnnotation}`, callbacks.onClose)}

        <div class="other-items-list">
          ${renderSection(
            'Display',
            html`
              ${renderMaxVisibleInput(state, callbacks)} ${renderShapeSizeInput(state, callbacks)}
              ${renderCheckboxOptions(state, callbacks)}
            `,
          )}
          ${renderPaletteSection(state, callbacks)} ${renderSortingSection(state, callbacks)}
        </div>

        ${renderDialogFooter(callbacks, state.hasPersistedSettings)}
      </div>
    </div>
  `;
}
