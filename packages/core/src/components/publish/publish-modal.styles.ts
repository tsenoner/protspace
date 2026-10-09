import { css } from 'lit';

/**
 * Publish Modal Styles
 *
 * Full-screen modal with 65/35 preview-to-sidebar split.
 * Follows the same token / overlay mixin pattern as the legend modal.
 */
export const publishModalStyles = css`
  /* ─── Full-screen modal overlay ─────────────────────────── */
  .publish-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: stretch;
    justify-content: center;
    z-index: var(--z-modal);
    overscroll-behavior: contain;
  }

  .publish-container {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--surface);
    overflow: hidden;
  }

  /* ─── Preview area (left 65%) ───────────────────────────── */
  .publish-preview {
    flex: 1 1 65%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #f0f2f5;
    position: relative;
  }

  .publish-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }

  .publish-preview-header h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--font-semibold);
    color: var(--text-dark);
  }

  .publish-preview-info {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .publish-preview-canvas-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-lg);
    overflow: hidden;
    position: relative;
  }

  .publish-preview-canvas {
    max-width: 100%;
    max-height: 100%;
    box-shadow: var(--shadow-lg);
    background: #ffffff;
    image-rendering: auto;
  }

  .publish-preview-toolbar {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    border-top: var(--border-width) solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }

  /* Shared toggle button base — used for tool buttons, preset grid.
   * Mirrors the shared dropdown-trigger pattern (styles/mixins.ts). */
  .publish-toggle-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .publish-toggle-btn:hover {
    background: var(--hover-bg);
    border-color: var(--border-hover);
  }

  /* Active = blue border only, same hover as unselected.
   * Matches filter-active in query-builder.styles.ts.
   * Double class to beat global button.active specificity. */
  .publish-toggle-btn.publish-toggle-btn.active {
    border-color: var(--primary);
    color: var(--primary);
    background: var(--surface);
  }

  .publish-toggle-btn.publish-toggle-btn.active:hover {
    background: var(--hover-bg);
    border-color: var(--primary);
  }

  .publish-tool-btn {
    font-size: var(--text-sm);
  }

  .publish-tool-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tool-separator {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 var(--spacing-xs);
  }

  /* ─── Sidebar (right 35%) ───────────────────────────────── */
  .publish-sidebar {
    flex: 0 0 340px;
    min-width: 280px;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    border-left: var(--border-width) solid var(--border);
    background: var(--surface);
    overflow: hidden;
  }

  .publish-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: var(--border-width) solid var(--border);
    flex-shrink: 0;
  }

  .publish-sidebar-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--text-dark);
  }

  .publish-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .publish-close-btn:hover {
    background: var(--hover-bg);
    color: var(--text-dark);
  }

  .publish-close-btn svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .publish-sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--spacing-md);
    scrollbar-width: thin;
  }

  .publish-sidebar-footer {
    padding: var(--spacing-sm) var(--spacing-md);
    border-top: var(--border-width) solid var(--border);
    display: flex;
    gap: var(--spacing-xs);
    flex-shrink: 0;
  }

  .publish-sidebar-footer button {
    flex: 1;
  }

  .publish-sidebar-footer button.btn-danger {
    flex: 0 0 auto;
  }

  /* ─── Sidebar sections ──────────────────────────────────── */
  .publish-section {
    margin-bottom: var(--spacing-md);
  }

  .publish-section-title {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--spacing-sm);
  }

  /* ─── Preset grid ───────────────────────────────────────── */
  .publish-preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-sm);
  }

  .publish-preset-btn {
    justify-content: space-between;
    padding: 6px 8px;
    font-size: var(--text-xs);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .publish-preset-dims {
    font-size: 10px;
    color: var(--muted);
    font-weight: var(--font-normal);
  }

  .publish-preset-btn.active .publish-preset-dims {
    color: var(--primary);
    opacity: 0.7;
  }

  /* ─── Form rows ─────────────────────────────────────────── */
  .publish-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-xs);
  }

  .publish-row label {
    font-size: var(--text-sm);
    color: var(--muted);
    white-space: nowrap;
  }

  /*
   * Slider rows (Size %, Font size, Columns, Stroke, etc.):
   *   - Override the row's space-between so label and slider sit close together,
   *     not at opposite ends of the row.
   *   - Fix label-cell width to the longest label so sliders share a left start
   *     across rows. Tight 8px gap to the slider.
   *   - Fix slider width so sliders also share a right end.
   *   - Narrow the number input (default 5rem is wider than these small values
   *     ever need).
   */
  .publish-row:has(.publish-input-group) {
    justify-content: flex-start;
    gap: 8px;
  }

  .publish-row:has(.publish-input-group) > label {
    flex: 0 0 55px;
  }

  .publish-row > .publish-input-group {
    flex-wrap: nowrap;
    gap: 4px;
  }

  .publish-row > .publish-input-group > .publish-slider {
    flex: 0 0 110px;
  }

  .publish-row > .publish-input-group > .publish-row-input {
    width: 2.5rem;
  }

  .publish-row-input {
    width: 5rem;
    padding: 2px 4px;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-dark);
    background: transparent;
    border: 1px solid transparent;
    border-radius: calc(var(--radius) / 2);
    text-align: right;
    transition: var(--transition-fast);
  }

  .publish-row-input:hover {
    background: var(--hover-bg);
    border-color: var(--border);
  }

  .publish-row-input:focus {
    outline: none;
    background: var(--surface);
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  /* Hide spinner */
  .publish-row-input::-webkit-inner-spin-button,
  .publish-row-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .publish-row-input[type='number'] {
    -moz-appearance: textfield;
  }

  .publish-unit {
    font-size: var(--text-xs);
    color: var(--muted);
    margin-left: 2px;
  }

  .publish-input-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  /* ─── Select (dropdown) ─────────────────────────────────── */
  .publish-select {
    padding: 3px 6px;
    font-size: var(--text-sm);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-primary);
    cursor: pointer;
  }

  .publish-select:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  /* ─── Checkbox ──────────────────────────────────────────── */
  .publish-checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
    user-select: none;
    margin-bottom: var(--spacing-xs);
  }

  .publish-checkbox {
    width: 14px;
    height: 14px;
    cursor: pointer;
    accent-color: var(--primary);
    flex-shrink: 0;
  }

  /* ─── Format toggle ─────────────────────────────────────── */
  .publish-format-toggle {
    display: flex;
    gap: var(--spacing-xs);
  }

  .publish-format-toggle button {
    flex: 1;
    padding: 4px 8px;
    font-size: var(--text-sm);
  }

  /* ─── Overlays list ─────────────────────────────────────── */
  .publish-overlay-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    margin-bottom: var(--spacing-xs);
    font-size: var(--text-xs);
    color: var(--text-primary);
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .publish-overlay-item:hover {
    background: var(--hover-bg);
    border-color: var(--border-hover);
  }

  .publish-overlay-item.selected {
    background: var(--primary-light);
    border-color: var(--primary);
  }

  .publish-overlay-item .delete-btn {
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
  }

  .publish-overlay-item .delete-btn:hover {
    background: var(--hover-bg);
    color: var(--danger);
  }

  .publish-overlay-item .delete-btn svg {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
  }

  /* ─── Warning message ───────────────────────────────────── */
  .publish-warning {
    font-size: var(--text-xs);
    color: var(--danger);
    padding: 4px 8px;
    background: rgba(228, 33, 33, 0.06);
    border-radius: var(--radius);
    margin-bottom: var(--spacing-xs);
  }

  .publish-warning a {
    color: var(--danger);
    font-weight: var(--font-semibold);
    text-decoration: underline;
    cursor: pointer;
  }

  /* ─── Slider ─────────────────────────────────────────── */
  .publish-slider {
    flex: 1;
    min-width: 60px;
    height: 4px;
    accent-color: var(--primary);
    cursor: pointer;
  }

  /* ─── Responsive ────────────────────────────────────────── */
  @media (max-width: 800px) {
    .publish-container {
      flex-direction: column;
    }
    .publish-sidebar {
      flex: 0 0 auto;
      max-width: none;
      max-height: 45vh;
      border-left: none;
      border-top: var(--border-width) solid var(--border);
    }
  }

  /* ─── Dimensions panel (Photoshop-style) ────────────────── */
  .publish-dim-readout {
    font-size: var(--text-xs);
    color: var(--muted);
    margin-bottom: 8px;
  }

  .publish-dim-readout strong {
    color: var(--fg);
    margin: 0 4px;
  }

  .publish-dim-pair {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    grid-template-rows: auto auto;
    gap: 6px 8px;
    align-items: center;
    margin-bottom: 8px;
  }

  .publish-dim-pair > .publish-dim-label {
    grid-column: 1;
    font-size: var(--text-xs);
    color: var(--muted);
    white-space: nowrap;
  }

  .publish-dim-pair > .publish-dim-control {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .publish-dim-control > .publish-slider {
    flex: 1;
    min-width: 50px;
  }

  .publish-dim-value {
    width: 3.5rem;
    flex: 0 0 auto;
  }

  .publish-dim-pair > .publish-aspect-lock {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: stretch;
  }

  .publish-dim-pair > .publish-unit-select {
    grid-column: 4;
    grid-row: 1 / span 2;
    align-self: center;
  }

  .publish-unit-select {
    width: 64px;
    font-size: var(--text-xs);
  }

  .publish-aspect-lock {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .publish-aspect-lock svg {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    display: block;
    overflow: visible;
  }

  /* Brackets — thin always-muted lines anchoring the chain to W and H rows. */
  .publish-aspect-lock .aspect-lock-bracket {
    stroke: var(--muted);
    stroke-width: 1.25;
  }

  /* Chain — heavier stroke than brackets so the link reads as the focal point. */
  .publish-aspect-lock .aspect-lock-state-locked,
  .publish-aspect-lock .aspect-lock-state-unlocked {
    stroke: var(--muted);
    stroke-width: 1.75;
    transition: stroke 120ms;
  }

  .publish-aspect-lock.locked .aspect-lock-state-locked {
    stroke: var(--primary, #3b82f6);
  }

  /* CSS toggles which chain state group is rendered. */
  .publish-aspect-lock .aspect-lock-state-locked,
  .publish-aspect-lock .aspect-lock-state-unlocked {
    display: none;
  }

  .publish-aspect-lock.locked .aspect-lock-state-locked {
    display: inline;
  }

  .publish-aspect-lock:not(.locked) .aspect-lock-state-unlocked {
    display: inline;
  }

  .publish-aspect-lock:hover:not([disabled]) .aspect-lock-state-locked,
  .publish-aspect-lock:hover:not([disabled]) .aspect-lock-state-unlocked {
    stroke: var(--primary, #3b82f6);
  }

  .publish-aspect-lock[disabled] {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .publish-aspect-lock[disabled] .aspect-lock-state-locked,
  .publish-aspect-lock[disabled] .aspect-lock-state-unlocked,
  .publish-aspect-lock[disabled] .aspect-lock-bracket {
    stroke: var(--muted);
  }

  .publish-dim-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-xs);
  }

  .publish-dim-row label {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .publish-info {
    cursor: help;
    margin-left: 4px;
    color: var(--muted);
  }

  .publish-resample-note {
    font-size: var(--text-xs);
    color: var(--primary, #3b82f6);
    margin-top: 4px;
  }
`;
