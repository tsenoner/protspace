import { css } from 'lit';

/**
 * Legend Item Styles
 *
 * Styles for individual legend items including:
 * - Base legend item
 * - Item states (hover, active, hidden, selected, dragging)
 * - Drag handle
 * - Symbol, text, and count
 */
export const itemStyles = css`
  .legend-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px 6px 2px;
    border-radius: 0.5rem;
    cursor: default;
    transition:
      box-shadow 0.2s ease,
      background-color 0.2s ease,
      opacity 0.2s ease,
      transform 0.2s ease,
      border-color 0.2s ease;
    background: var(--legend-hover-bg);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    position: relative;
    width: 100%;
    box-sizing: border-box;
  }

  .legend-item.hidden {
    opacity: var(--legend-hidden-opacity);
    background: var(--legend-hidden-bg);
  }

  /* Drag-and-drop visual hints - consolidated single definition */
  .legend-item.dragging {
    background: var(--legend-drag-bg);
    transform: scale(1.02);
    box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.15);
    border: 2px solid var(--primary) !important;
    border-radius: 0.5rem;
    opacity: 0.8;
    z-index: var(--z-modal);
    position: relative;
  }

  /* Sortable.js classes for enhanced drag and drop UX */

  /* Ghost class - placeholder/gap shown where item will be dropped */
  .legend-item-ghost {
    opacity: 0.4;
    background: var(--primary);
    border: 2px dashed var(--primary);
    border-radius: 0.5rem;
    box-shadow: none !important;
  }

  /* Chosen class - applied to the item when it's picked up */
  .legend-item-chosen {
    background: var(--legend-hover-bg);
    cursor: grabbing;
  }

  /* Drag class - applied to the dragging element (ghost) */
  .legend-item-drag {
    background: var(--legend-bg);
    box-shadow: 0 8px 16px 0 rgba(0, 0, 0, 0.2);
    border: 2px solid var(--primary);
    border-radius: 0.5rem;
    opacity: 0.95;
    cursor: grabbing;
    transform: rotate(2deg);
  }

  /* Merge target highlight - shown on "Other" when dragging an item over it */
  .legend-item-merge-target {
    background: var(--focus-ring);
    border: 2px dashed var(--primary);
    border-radius: 0.5rem;
    box-shadow: 0 0 0 2px var(--primary-alpha-20);
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  /* Just-dropped highlight - brief flash on the item after drag-and-drop reorder */
  .legend-item-just-dropped {
    animation: drop-highlight 0.6s ease-out;
  }

  @keyframes drop-highlight {
    0% {
      background: var(--primary-alpha-20);
      box-shadow: 0 0 0 3px var(--primary-alpha-50);
    }
    100% {
      background: var(--legend-hover-bg);
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
  }

  /* Fallback class - for older browsers */
  .legend-item-fallback {
    background: var(--legend-bg);
    box-shadow: 0 8px 16px 0 rgba(0, 0, 0, 0.2);
    border: 2px solid var(--primary);
    border-radius: 0.5rem;
    opacity: 0.95;
  }

  .legend-item.selected {
    box-shadow: 0 0 0 2px var(--legend-selected-ring);
  }

  .legend-item:focus-within {
    outline: none;
    box-shadow: 0 0 0 2px var(--legend-selected-ring);
  }

  .legend-item-content {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
  }

  .legend-item-main {
    display: block;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .legend-item-main:hover {
    color: inherit;
  }

  .legend-item-main:focus-visible {
    outline: 2px solid var(--legend-selected-ring);
    outline-offset: 2px;
    border-radius: 0.375rem;
  }

  .drag-handle {
    display: flex;
    align-items: center;
    padding: 0.25rem;
    border: none;
    background: transparent;
    border-radius: 0.25rem;
    cursor: grab;
    color: var(--legend-text-secondary);
    transition:
      color 0.15s ease,
      background-color 0.15s ease,
      opacity 0.15s ease;
  }

  .drag-handle:hover {
    color: var(--primary);
    background: var(--primary-alpha-10);
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .drag-handle:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .drag-handle-disabled {
    cursor: default;
    opacity: 0.45;
  }

  .drag-handle-disabled:hover {
    color: var(--legend-text-secondary);
    background: transparent;
  }

  .legend-symbol {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
    flex: 0 0 auto;
  }

  .legend-symbol-clickable {
    cursor: pointer;
    border-radius: 4px;
    transition:
      background-color 0.15s ease,
      transform 0.15s ease;
  }

  .legend-symbol-button {
    border: none;
    background: transparent;
    padding: 0;
    display: flex;
    align-items: center;
  }

  .legend-symbol-clickable:hover {
    background: rgba(0, 0, 0, 0.05);
    transform: scale(1.1);
  }

  .mr-2 {
    margin-right: 0.5rem;
  }

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

  .color-picker-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-picker-swatch {
    width: 40px;
    height: 40px;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    cursor: pointer;
  }

  .color-picker-input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    font-size: 0.875rem;
    font-family: monospace;
    background: var(--legend-bg);
    color: var(--legend-text-color);
  }

  .color-picker-input:focus {
    outline: none;
    border-color: var(--primary);
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

  .legend-text {
    display: block;
    font-size: 0.875rem;
    line-height: 1.35;
    color: var(--legend-text-color);
    width: 100%;
    min-width: 0;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .legend-item-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .legend-item-actions protspace-color-picker {
    flex-shrink: 0;
  }

  .legend-count {
    font-size: 0.875rem;
    color: var(--legend-text-secondary);
    font-weight: 500;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0 0 0 9px;
  }

  .legend-item-score-hover {
    box-shadow:
      0 1px 2px 0 rgba(0, 0, 0, 0.05),
      inset 2px 0 0 var(--legend-text-color);
  }
`;
