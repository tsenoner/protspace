import { css, unsafeCSS } from 'lit';
import { LANDSCAPE_PHONE_MEDIA, PHONE_MEDIA } from '../../utils/breakpoints';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/**
 * The figure editor inside its full-screen ps-dialog: the preview (canvas, then the tool strip)
 * beside a 340 px settings column, the settings under the preview on a phone held upright, and
 * the footer the dialog slots in.
 */
export const publishModalStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    /* ─── Layout ────────────────────────────────────────────── */
    .publish-container {
      display: flex;
      gap: var(--ps-space-5);
      height: 100%;
      min-height: 0;
    }

    .publish-preview {
      flex: 1 1 65%;
      min-width: 0;
      display: flex;
      flex-direction: column;
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-muted);
      overflow: hidden;
    }

    .publish-preview-canvas-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      padding: var(--ps-space-6);
      overflow: hidden;
      position: relative;
    }

    .publish-preview-canvas {
      max-width: 100%;
      max-height: 100%;
      box-shadow: var(--ps-shadow-lg);
      /* Behind a transparent figure only; a white one paints its own background. */
      background: var(--ps-surface);
      image-rendering: auto;
    }

    .publish-preview-toolbar {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
      padding: var(--ps-space-2) var(--ps-space-3);
      border-top: 1px solid var(--ps-border);
      background: var(--ps-surface);
      flex-shrink: 0;
    }

    .publish-sidebar {
      flex: 0 0 340px;
      min-width: 280px;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .publish-sidebar-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: var(--ps-space-1);
      scrollbar-width: thin;
    }

    /* ─── Toggle buttons: tools, presets, format ─────────────── */
    .publish-toggle-btn {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
      min-height: var(--ps-control-sm);
      padding: var(--ps-space-1) var(--ps-space-2);
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font-family: inherit;
      font-size: var(--ps-text-sm);
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        border-color var(--ps-duration-fast) var(--ps-ease);
    }

    .publish-toggle-btn:hover {
      background: var(--ps-surface-hover);
      border-color: var(--ps-border-strong);
    }

    .publish-toggle-btn.active {
      border-color: var(--ps-accent);
      color: var(--ps-accent-text);
      background: var(--ps-accent-tint);
    }

    .publish-tool-btn svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tool-separator {
      width: 1px;
      height: 20px;
      margin: 0 var(--ps-space-1);
      background: var(--ps-border);
    }

    /* ─── Sections ───────────────────────────────────────────── */
    .publish-section {
      margin-bottom: var(--ps-space-5);
    }

    .publish-section-title {
      margin-bottom: var(--ps-space-2);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .publish-preset-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--ps-space-1);
      margin-bottom: var(--ps-space-2);
    }

    .publish-preset-btn {
      justify-content: space-between;
      font-size: var(--ps-text-xs);
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .publish-preset-dims {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: normal;
    }

    .publish-preset-btn.active .publish-preset-dims {
      color: var(--ps-accent-text);
    }

    /* ─── Rows ───────────────────────────────────────────────── */
    .publish-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--ps-space-1);
    }

    .publish-row.publish-row-tight {
      margin-bottom: 0;
    }

    .publish-row.publish-row-text {
      margin-bottom: var(--ps-space-0-5);
    }

    .publish-row label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      white-space: nowrap;
    }

    /* Slider rows: label and slider sit together, and sliders share their start and end. */
    .publish-row:has(.publish-input-group) {
      justify-content: flex-start;
      gap: var(--ps-space-2);
    }

    .publish-row:has(.publish-input-group) > label {
      flex: 0 0 55px;
    }

    .publish-row > .publish-input-group {
      flex-wrap: nowrap;
      gap: var(--ps-space-1);
    }

    .publish-row > .publish-input-group > .publish-slider {
      flex: 0 0 110px;
    }

    .publish-row > .publish-input-group > .publish-row-input {
      width: 2.5rem;
    }

    .publish-input-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
    }

    .publish-row-input {
      width: 5rem;
      padding: var(--ps-space-0-5) var(--ps-space-1);
      border: 1px solid transparent;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-text);
      font-family: inherit;
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      text-align: right;
    }

    .publish-row-input:hover {
      background: var(--ps-surface-hover);
      border-color: var(--ps-border);
    }

    .publish-row-input:focus {
      background: var(--ps-surface);
      border-color: var(--ps-accent);
    }

    .publish-row-input.publish-label-input {
      width: 8rem;
      text-align: left;
    }

    /* Hide the number spinners. */
    .publish-row-input::-webkit-inner-spin-button,
    .publish-row-input::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .publish-row-input[type='number'] {
      -moz-appearance: textfield;
    }

    .publish-unit {
      margin-left: var(--ps-space-0-5);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .publish-select {
      padding: var(--ps-space-0-5) var(--ps-space-1-5);
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font-family: inherit;
      font-size: var(--ps-text-sm);
      cursor: pointer;
    }

    .publish-checkbox-label {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      margin-bottom: var(--ps-space-1);
      color: var(--ps-text);
      font-size: var(--ps-text-sm);
      cursor: pointer;
      user-select: none;
    }

    .publish-checkbox {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      accent-color: var(--ps-accent);
      cursor: pointer;
    }

    .publish-format-toggle {
      display: flex;
      gap: var(--ps-space-1);
    }

    .publish-format-toggle .publish-toggle-btn {
      flex: 1;
      justify-content: center;
    }

    .publish-slider {
      flex: 1;
      min-width: 60px;
      height: 4px;
      accent-color: var(--ps-accent);
      cursor: pointer;
    }

    /* ─── Overlay and inset rows ─────────────────────────────── */
    .publish-overlay-item {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--ps-space-1);
      margin-bottom: var(--ps-space-1);
      padding: var(--ps-space-1) var(--ps-space-2);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius);
      color: var(--ps-text);
      font-size: var(--ps-text-xs);
      cursor: pointer;
    }

    .publish-overlay-item:hover {
      background: var(--ps-surface-hover);
      border-color: var(--ps-border-strong);
    }

    .publish-overlay-item.selected {
      background: var(--ps-accent-tint);
      border-color: var(--ps-accent);
    }

    .publish-item-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .publish-overlay-item .delete-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-text-muted);
      cursor: pointer;
    }

    .publish-overlay-item .delete-btn:hover {
      background: var(--ps-surface-hover);
      color: var(--ps-danger);
    }

    .publish-empty-hint {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .publish-warning {
      margin-bottom: var(--ps-space-2);
      padding: var(--ps-space-1) var(--ps-space-2);
      border-radius: var(--ps-radius);
      background: color-mix(in srgb, var(--ps-danger) 8%, transparent);
      color: var(--ps-danger);
      font-size: var(--ps-text-xs);
    }

    .publish-warning a {
      color: var(--ps-danger);
      font-weight: var(--ps-weight-semibold);
      text-decoration: underline;
      cursor: pointer;
    }

    /* ─── Dimensions (Photoshop-style) ───────────────────────── */
    .publish-dim-readout {
      margin-bottom: var(--ps-space-2);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .publish-dim-readout strong {
      margin: 0 var(--ps-space-1);
      color: var(--ps-text);
    }

    .publish-dim-pair {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      grid-template-rows: auto auto;
      gap: var(--ps-space-1-5) var(--ps-space-2);
      align-items: center;
      margin-bottom: var(--ps-space-2);
    }

    .publish-dim-pair > .publish-dim-label {
      grid-column: 1;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      white-space: nowrap;
    }

    .publish-dim-pair > .publish-dim-control {
      grid-column: 2;
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
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
      font-size: var(--ps-text-xs);
    }

    .publish-aspect-lock {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
    }

    .publish-aspect-lock svg {
      display: block;
      overflow: visible;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Brackets: thin muted lines anchoring the chain to the Width and Height rows. */
    .publish-aspect-lock .aspect-lock-bracket {
      stroke: var(--ps-text-muted);
      stroke-width: 1.25;
    }

    /* The chain: a heavier stroke than the brackets, so the link reads as the focal point. */
    .publish-aspect-lock .aspect-lock-state-locked,
    .publish-aspect-lock .aspect-lock-state-unlocked {
      display: none;
      stroke: var(--ps-text-muted);
      stroke-width: 1.75;
      transition: stroke var(--ps-duration-fast) var(--ps-ease);
    }

    .publish-aspect-lock.locked .aspect-lock-state-locked {
      display: inline;
      stroke: var(--ps-accent);
    }

    .publish-aspect-lock:not(.locked) .aspect-lock-state-unlocked {
      display: inline;
    }

    .publish-aspect-lock:hover:not([disabled]) .aspect-lock-state-locked,
    .publish-aspect-lock:hover:not([disabled]) .aspect-lock-state-unlocked {
      stroke: var(--ps-accent);
    }

    .publish-aspect-lock[disabled] {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .publish-aspect-lock[disabled] .aspect-lock-state-locked,
    .publish-aspect-lock[disabled] .aspect-lock-state-unlocked,
    .publish-aspect-lock[disabled] .aspect-lock-bracket {
      stroke: var(--ps-text-muted);
    }

    .publish-dim-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--ps-space-1);
    }

    .publish-dim-row label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .publish-info {
      display: inline-flex;
      margin-left: var(--ps-space-1);
      color: var(--ps-text-muted);
      cursor: help;
    }

    .publish-resample-note {
      margin-top: var(--ps-space-1);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-xs);
    }

    /* ─── Footer (slotted into the dialog's footer) ──────────── */
    .publish-footer {
      display: flex;
      flex: 1;
      align-items: center;
      gap: var(--ps-space-2);
      min-width: 0;
    }

    .publish-footer-status {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: flex-end;
      gap: var(--ps-space-3);
      min-width: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
    }

    .publish-undo {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
    }

    .publish-undo-icon {
      display: inline-flex;
    }

    .publish-export-error {
      margin: 0;
      min-width: 0;
      color: var(--ps-danger);
      font-size: var(--ps-text-sm);
    }

    /* Tablets and narrow windows: the settings under the preview. */
    @media (max-width: 800px) {
      .publish-container {
        flex-direction: column;
      }
      .publish-sidebar {
        flex: 0 0 auto;
        max-width: none;
        max-height: 45vh;
      }
    }

    /* Phones: the preview takes the top 40% and the settings the rest, scrolling inside. */
    @media ${unsafeCSS(PHONE_MEDIA)} {
      .publish-container {
        flex-direction: column;
        gap: var(--ps-space-3);
      }
      .publish-preview {
        flex: 0 0 40%;
      }
      .publish-sidebar {
        flex: 1 1 auto;
        min-width: 0;
        max-width: none;
        max-height: none;
        overflow: auto;
      }
    }

    /* A phone on its side is too short to stack: preview and settings stay side by side. Last, so
       it wins over both rules above (a 640 × 360 phone matches all three). */
    @media ${unsafeCSS(LANDSCAPE_PHONE_MEDIA)} {
      .publish-container {
        flex-direction: row;
      }
      .publish-preview {
        flex: 1 1 auto;
      }
      .publish-sidebar {
        flex: 0 0 min(50vw, 340px);
        min-width: 0;
        max-width: none;
        max-height: none;
      }
    }
  `,
];
