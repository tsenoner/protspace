import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { overlayMixins } from '../../styles/overlay-mixins';
import { segmentedControlMixin } from '../../styles/mixins';

const structureViewerStylesCore = css`
  :host {
    /* Sizes only: every colour comes from a --ps-* token (theme.ts), so an embedder restyles the
       viewer in both themes by setting those on :root. The frame is the panel's surface, the
       colour the Mol* canvas also takes, so frame and canvas meet without a seam. */
    --protspace-viewer-width: 100%;
    --protspace-viewer-height: 100%;
    --protspace-viewer-border-radius: 6px;

    display: flex;
    flex-direction: column;
    width: 100%;

    box-shadow: var(--ps-shadow-md);
    box-sizing: border-box;
    position: relative;
    background: var(--ps-surface);
    border: 1px solid var(--ps-border);
    flex-shrink: 1;
    flex-grow: 1;
    min-height: 150px;
    border-radius: 6px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.4rem 0.4rem 1.2rem;
    background: var(--ps-surface-muted);
    border-radius: 6px 6px 0 0;
  }

  .header-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-2);
    font-size: var(--ps-text-base);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text);
    margin: 0;
  }

  /* Two stacked rows: what this is, then where it goes. */
  .header-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .protein-id {
    font-size: var(--ps-text-base);
    color: var(--ps-text-muted);
  }

  /* With several selected proteins the id is a ghost button that opens the menu of them. */
  .protein-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-1);
    min-height: var(--ps-control-sm);
    padding: 0 var(--ps-space-1-5);
    border: 0;
    border-radius: var(--ps-radius);
    background: transparent;
    color: var(--ps-text-muted);
    font-family: inherit;
    font-size: var(--ps-text-base);
    cursor: pointer;
  }

  .protein-pick:hover,
  .protein-pick[aria-expanded='true'] {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
  }

  .protein-pick:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }

  /* The links row continues the header's band and ends it with the header's line. */
  .resource-links {
    background: var(--ps-surface-muted);
    border-bottom: 1px solid var(--ps-border);
  }

  .close-button {
    background: none;
    border: none;
    display: inline-grid;
    place-items: center;
    color: var(--ps-text-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 0.25rem;
    transition: color 0.2s;
  }

  .close-button:hover {
    color: var(--ps-text);
    background: var(--ps-surface-hover);
  }

  /* Touch: the close and protein-pick buttons are 40 px targets (the app's header is 44 px). */
  @media (pointer: coarse) {
    .close-button,
    .protein-pick {
      min-width: var(--ps-touch-target);
      min-height: var(--ps-touch-target);
    }

    .segmented > .segmented-btn {
      min-height: var(--ps-touch-target);
    }
  }

  .viewer-container {
    position: relative;
    width: 100%;
    /* Take only the height the header and footer leave, so the footer never overflows */
    flex: 1 1 0;
    min-height: 0;
    background: var(--ps-surface);
    border-radius: 0 0 6px 6px;
  }

  /* Base loading overlay styles provided by overlayMixins */
  .loading-overlay {
    /* Extend with column layout for text */
    flex-direction: column;
    background: color-mix(in srgb, var(--ps-surface) 90%, transparent);
  }

  .loading-text {
    color: var(--ps-text-muted);
    font-size: 0.875rem;
    margin-top: 1rem;
  }

  .error-container {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface);
    z-index: var(--z-overlay);
    padding: 2rem;
    border-radius: 0 0 6px 6px;
    text-align: center;
  }

  .error-title {
    color: var(--ps-danger);
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .empty-container {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface);
    z-index: var(--z-canvas);
    padding: 2rem;
    text-align: center;
  }

  .empty-title {
    color: var(--ps-text);
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .empty-message {
    color: var(--ps-text-muted);
    font-size: 0.875rem;
  }

  .viewer-content,
  .molstar-mount {
    width: 100%;
    height: 100%;
    border-radius: 0 0 6px 6px;
  }

  .color-toolbar,
  .tips {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface-muted);
    border-top: 1px solid var(--ps-border);
    color: var(--ps-text-muted);
    font-size: 0.75rem;
  }

  .color-toolbar {
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
  }

  /* Without tips the toolbar is the panel's last row, so it carries the bottom corners */
  .color-toolbar:last-child {
    border-radius: 0 0 6px 6px;
  }

  .color-toolbar-label {
    font-weight: 600;
  }

  /* The TED button's ps-tooltip follows it, so the mixin's :last-child misses its end corners. */
  .segmented > .segmented-btn:has(+ ps-tooltip:last-child) {
    border-top-right-radius: calc(var(--radius) - var(--border-width));
    border-bottom-right-radius: calc(var(--radius) - var(--border-width));
  }

  .tips {
    flex-direction: column;
    padding: 0.2rem 0.5rem;
    border-radius: 0 0 6px 6px;
  }

  .tips strong {
    font-weight: 600;
  }

  /* The body part only groups the rows for a host; it adds no box. */
  .body {
    display: contents;
  }

  /* Spin animation provided by overlayMixins */

  /* ----------------------------- Responsive ------------------------------------ */

  /* Below desktop the viewer has half a panel row: keep only the colour legend. The host's size
     is the shell's to set (the workbench fills its structure section). */
  @media (max-width: 950px) {
    .interaction-tip {
      display: none;
    }
  }
`;

export const structureViewerStyles = [
  tokens,
  overlayMixins,
  segmentedControlMixin,
  structureViewerStylesCore,
];
