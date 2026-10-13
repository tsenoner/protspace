import { css } from 'lit';

/**
 * Legend Modal Styles
 *
 * Styles for the legend customization modal including:
 * - Modal content and layout
 * - Other items list
 * - Sorting UI
 * - Form inputs and controls
 *
 * Note: Base modal overlay styles are provided by overlayMixins
 */
export const modalStyles = css`
  :host {
    --legend-settings-section-gap: 0.875rem;
    --legend-settings-card-padding: 0.95rem 1rem;
    --legend-settings-surface: var(--legend-hover-bg);
    --legend-settings-text-muted: var(--legend-text-secondary);
  }

  /* ----------------------------- Modal styles -------------------------------------- */
  /* Base modal styles provided by overlayMixins */

  .modal-content {
    /* Override and extend base modal-content from overlayMixins */
    padding: 1.5rem 1.75rem 1.25rem;
    display: flex;
    width: min(90vw, 32rem);
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    position: relative;
  }

  .modal-content > div:not(.color-palette-toast) {
    width: 100%;
  }

  .other-items-list {
    box-sizing: border-box;
    display: flex;
    margin-bottom: 1rem;
    overflow-y: auto;
    padding: 0;
    flex-direction: column;
    flex-grow: 1;
    row-gap: 1.1rem;
    scrollbar-width: thin;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .settings-section-header {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .settings-section-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--legend-text-color);
  }

  .settings-section-description {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--legend-settings-text-muted);
  }

  .settings-section-content {
    display: flex;
    flex-direction: column;
    gap: var(--legend-settings-section-gap);
  }

  .other-items-list-item {
    display: flex;
    flex-direction: column;
    padding: var(--legend-settings-card-padding);
    background: var(--legend-settings-surface);
    border-radius: 8px;
    border: 1px solid var(--legend-border);
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .other-items-list-item:hover {
    background: var(--hover-bg-alt);
    border-color: var(--border-hover);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .other-items-list-item:focus-within {
    background: var(--hover-bg-alt);
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .other-items-list-item--grouped {
    gap: 0.95rem;
  }

  .other-items-list-item-label {
    color: var(--legend-text-color);
    margin-bottom: 0.55rem;
    font-weight: 600;
    font-size: 0.84rem;
    letter-spacing: -0.01em;
  }

  .legend-form-control {
    width: 100%;
    box-sizing: border-box;
    min-height: 2.9rem;
    padding: 0.8rem 0.95rem;
    border-radius: 6px;
    border: 1px solid var(--legend-border);
    background: white;
    font-size: 0.88rem;
    color: var(--legend-text-color);
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .legend-form-control:hover {
    border-color: var(--border-hover);
  }

  .legend-form-control:focus,
  .legend-form-control:focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .other-items-list-label {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    padding: 0.95rem 1rem;
    justify-content: space-between;
    background: var(--legend-settings-surface);
    border-radius: 8px;
    border: 1px solid var(--legend-border);
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      box-shadow 0.2s ease;
    user-select: none;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--legend-text-color);
  }

  .other-items-list-label:hover {
    background: var(--hover-bg-alt);
    border-color: var(--border-hover);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .other-items-list-label:focus-within {
    background: var(--hover-bg-alt);
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .other-items-list-label input[type='checkbox'] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: var(--primary);
  }

  .other-items-list-label input[type='checkbox']:disabled {
    cursor: not-allowed;
  }

  .other-items-list-item-sorting-container-item-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 0.6rem 0.85rem;
  }

  .other-items-list-item-sorting-container {
    display: flex;
    flex-direction: column;
  }

  .other-items-list-item-sorting-container:focus-within
    .other-items-list-item-sorting-container-item-container-label:has(input:checked) {
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .other-items-list-item-sorting-container-item-container-label {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    cursor: pointer;
    padding: 0.55rem 0.85rem;
    border-radius: 6px;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
    font-size: 0.88rem;
    color: var(--text-tertiary);
    user-select: none;
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .other-items-list-item-sorting-container-item-container-label:hover {
    background: var(--focus-ring);
    color: var(--primary);
  }

  .other-items-list-item-sorting-container-item-container-input {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--primary);
  }

  /* Visual feedback when option is selected */
  .other-items-list-item-sorting-container-item-container-label:has(input:checked) {
    background: var(--primary-light);
    color: var(--primary);
    font-weight: 500;
    border-color: rgba(0, 153, 255, 0.12);
  }

  .other-items-list-item-sorting-container-item-container-label:has(input:focus-visible) {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.9rem;
  }

  .modal-title {
    font-size: 1.2rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--legend-text-color);
    margin: 0;
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .modal-description {
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--legend-text-secondary);
    margin: 0 0 1.15rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    width: 100%;
    padding-top: 1rem;
    border-top: 1px solid rgba(31, 41, 55, 0.08);
  }

  .modal-reset-button {
    margin-inline-end: auto;
  }

  /* ----------------------------- Color Palette Section -------------------------------------- */
  .color-palette-section {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .color-palette-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .color-palette-preview {
    --color-palette-chip-gap: 8px;
    --color-palette-chip-min-size: 32px;
    --color-palette-chip-radius: 6px;
    --color-palette-chip-border: 1px solid var(--legend-border);
    --color-palette-chip-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--color-palette-chip-min-size), 1fr));
    gap: var(--color-palette-chip-gap);
    padding: 14px;
    background: var(--legend-hover-bg);
    border-radius: 8px;
    border: 1px solid var(--legend-border);
    overflow: hidden;
  }

  .color-palette-preview--continuous {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: visible;
  }

  .color-palette-gradient-scale {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--legend-text-secondary);
  }

  .color-palette-preview-caption {
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--legend-text-secondary);
  }

  .color-palette-swatch {
    width: 100%;
    aspect-ratio: 1;
    height: auto;
    border-radius: var(--color-palette-chip-radius);
    border: var(--color-palette-chip-border);
    cursor: default;
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
    box-shadow: var(--color-palette-chip-shadow);
  }

  .color-palette-swatch--gradient {
    width: 100%;
    height: 36px;
    flex: none;
    transform-origin: center;
    display: block;
  }

  .color-palette-swatch:hover {
    transform: scale(1.08);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    z-index: 1;
  }

  .color-palette-swatch--gradient:hover,
  .color-palette-preview--continuous:hover .color-palette-swatch--gradient {
    transform: translateY(-1px) scale3d(1.02, 1.04, 1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }

  .color-palette-preview--continuous:focus-within .color-palette-swatch--gradient {
    transform: translateY(-1px) scale3d(1.02, 1.04, 1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }

  .settings-note {
    margin-top: 0.55rem;
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--legend-settings-text-muted);
  }

  .settings-note--compact {
    margin-top: 0;
  }

  .settings-note--inline {
    margin-top: -0.2rem;
    margin-left: 0.25rem;
  }

  .other-items-list-label--disabled {
    color: var(--legend-settings-text-muted);
    cursor: not-allowed;
  }

  .other-items-list-label--disabled:hover {
    background: var(--legend-settings-surface);
    border-color: var(--legend-border);
    box-shadow: none;
  }

  .other-items-list-label--disabled:focus-within {
    border-color: var(--legend-border);
    box-shadow: none;
    background: var(--legend-settings-surface);
  }

  .settings-subfield {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding-top: 0.3rem;
    border-top: 1px solid rgba(31, 41, 55, 0.08);
  }

  .compact-checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.84rem;
    font-weight: 500;
    color: var(--legend-text-color);
    user-select: none;
    cursor: pointer;
  }

  .compact-checkbox-row input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: var(--primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .color-palette-swatch {
      transition: none;
    }

    .color-palette-swatch:hover,
    .color-palette-swatch--gradient:hover,
    .color-palette-preview--continuous:hover .color-palette-swatch--gradient,
    .color-palette-preview--continuous:focus-within .color-palette-swatch--gradient {
      transform: none;
      box-shadow: var(--color-palette-chip-shadow);
    }
  }
`;
