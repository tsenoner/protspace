import { css, unsafeCSS } from 'lit';
import { BELOW_DESKTOP_MEDIA } from '../../utils/breakpoints';

const structureViewerStylesCore = css`
  :host {
    /* Every colour comes from a --ps-* token (theme.ts), so an embedder restyles the viewer in both
       themes by setting those on :root. The frame is the panel's surface, the colour the Mol*
       canvas also takes, so frame and canvas meet without a seam. */
    display: flex;
    flex-direction: column;
    width: 100%;
    font-family: var(--ps-font-sans);

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

  /* Touch: the close and protein-pick buttons are 40 px targets (the app's header is 44 px). The
     colour control is ps-segmented, which sizes itself for touch. */
  @media (pointer: coarse) {
    .close-button,
    .protein-pick {
      min-width: var(--ps-touch-target);
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

  /* The veil over the viewer while a structure loads. */
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 10;
    background: color-mix(in srgb, var(--ps-surface) 90%, transparent);
  }

  .loading-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 2px solid var(--ps-border);
    border-top: 2px solid var(--ps-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .loading-text {
    color: var(--ps-text-muted);
    font-size: var(--ps-text-md);
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
    z-index: 10;
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
    z-index: 1;
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
    font-size: var(--ps-text-md);
  }

  .viewer-content,
  .molstar-mount {
    width: 100%;
    height: 100%;
    border-radius: 0 0 6px 6px;
  }

  /* Mol*'s layout is absolutely positioned: the mount holds it, so the canvas follows the mount's
     whole-pixel box (_snapMount). */
  .molstar-mount {
    position: relative;
  }

  /* Mol*'s stylesheet stays outside this shadow root, so its viewport buttons render unstyled
     under the canvas and show through while a resize clears it. Mol* 3.44 has no option for the
     camera and screenshot buttons, so the whole block goes. */
  .molstar-mount .msp-viewport-controls {
    display: none;
  }

  .color-toolbar,
  .tips {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface-muted);
    border-top: 1px solid var(--ps-border);
    color: var(--ps-text-muted);
    font-size: var(--ps-text-sm);
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

  /* ----------------------------- Responsive ------------------------------------ */

  /* Below desktop the viewer has half a panel row: keep only the colour legend. The host's size
     is the shell's to set (the workbench fills its structure section). */
  @media ${unsafeCSS(BELOW_DESKTOP_MEDIA)} {
    .interaction-tip {
      display: none;
    }
  }
`;

export const structureViewerStyles = [structureViewerStylesCore];
