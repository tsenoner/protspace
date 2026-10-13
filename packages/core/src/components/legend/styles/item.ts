import { css } from 'lit';

/**
 * Legend colour and shape picker styles, until the picker moves to ps-popover and styles/picker.ts
 * (Task 3.8). The row rules moved to styles/row.ts.
 */
export const itemStyles = css`
  /* Color Picker Popover */
  .color-picker-popover {
    position: absolute;
    z-index: var(--z-modal);
    background: var(--legend-bg);
    border: 1px solid var(--legend-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 12px;
    min-width: 200px;
  }

  .color-picker-header {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--legend-text-color);
    margin-bottom: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-picker-swatch {
    width: 40px;
    height: 40px;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    cursor: pointer;
  }

  /* Symbol Picker Sections (Color + Shape side by side) */
  .symbol-picker-sections {
    display: flex;
    gap: 16px;
  }

  .symbol-picker-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .symbol-picker-section-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--legend-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Shape Swatch Container */
  .shape-swatch-container {
    position: relative;
  }

  /* Shape Picker Swatch (similar to color swatch) */
  .shape-picker-swatch {
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    background: var(--legend-bg);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background-color 0.15s ease,
      color 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .shape-picker-swatch:hover:not(:disabled) {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-alpha-20);
  }

  .shape-picker-swatch.active {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-alpha-30);
  }

  .shape-picker-swatch:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .shape-picker-swatch.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .shape-picker-swatch svg {
    display: block;
  }

  /* Shape Picker Dropdown */
  .shape-picker-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: calc(var(--z-modal) + 1);
    background: var(--legend-bg);
    border: 1px solid var(--legend-border);
    border-radius: 6px;
    padding: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* Shape Picker Grid */
  .shape-picker-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .shape-picker-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    background: var(--legend-bg);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease;
    color: var(--legend-text-secondary);
  }

  .shape-picker-item svg {
    display: block;
  }

  .shape-picker-item:hover {
    border-color: var(--primary);
    background: var(--legend-hover-bg);
    color: var(--primary);
  }

  .shape-picker-item.selected {
    border-color: var(--primary);
    background: var(--primary-alpha-10);
    color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-alpha-20);
  }

  .shape-picker-item:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  /* Note for disabled shape picker (multilabel) */
  .symbol-picker-note {
    font-size: 0.7rem;
    color: var(--legend-text-secondary);
    margin-top: 8px;
    font-style: italic;
  }
`;
