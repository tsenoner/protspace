import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { overlayMixins } from '../../styles/overlay-mixins';

const structureViewerStylesCore = css`
  :host {
    --protspace-viewer-width: 100%;
    --protspace-viewer-height: 100%;
    --protspace-viewer-bg: var(--surface);
    --protspace-viewer-border: var(--border);
    --protspace-viewer-border-radius: 6px;
    --protspace-viewer-header-bg: var(--disabled-bg);
    --protspace-viewer-text: var(--text-primary);
    --protspace-viewer-text-muted: var(--text-secondary);
    --protspace-viewer-error: #c53030;
    --protspace-viewer-loading: var(--primary);

    display: flex;
    flex-direction: column;
    width: 100%;

    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    position: relative;
    background: var(--protspace-viewer-bg);
    border: 1px solid var(--protspace-viewer-border);
    flex-shrink: 1;
    flex-grow: 1;
    min-height: 150px;
    border-radius: 6px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.4rem 0.4rem 0.4rem 1.2rem;
    background: var(--protspace-viewer-header-bg);
    border-bottom: 1px solid var(--protspace-viewer-border);
    border-radius: 6px 6px 0 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .title {
    font-size: 1rem;
    font-weight: 500;
    color: var(--protspace-viewer-text);
    margin: 0;
    text-decoration: none;
    cursor: pointer;
    transition:
      color 0.2s,
      text-decoration-color 0.2s;
  }

  .header-info {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .protein-id {
    font-size: 0.875rem;
    color: var(--protspace-viewer-text-muted);
  }

  .header-links {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 0.75rem;
  }

  .header-link {
    color: var(--protspace-viewer-text-muted);
    text-decoration: none;
    cursor: pointer;
    transition:
      color 0.2s,
      text-decoration-color 0.2s;
  }

  .header-link-separator {
    color: var(--protspace-viewer-text-muted);
    opacity: 0.5;
  }

  .title:hover,
  .title:focus-visible,
  .header-link:hover,
  .header-link:focus-visible {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .title:focus-visible,
  .header-link:focus-visible {
    outline: 2px solid var(--protspace-viewer-loading);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 1.25rem;
    color: var(--protspace-viewer-text-muted);
    cursor: pointer;
    padding: 0.5rem 0.7rem;
    line-height: 1;
    border-radius: 0.25rem;
    transition: color 0.2s;
  }

  .close-button:hover {
    color: var(--protspace-viewer-text);
    background: rgba(0, 0, 0, 0.04);
  }

  .viewer-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--protspace-viewer-bg);
    border-radius: 0 0 6px 6px;
  }

  /* Base loading overlay styles provided by overlayMixins */
  .loading-overlay {
    /* Extend with column layout for text */
    flex-direction: column;
    background: rgba(255, 255, 255, 0.9);
  }

  .loading-text {
    color: var(--protspace-viewer-text-muted);
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
    background: var(--protspace-viewer-bg);
    z-index: var(--z-overlay);
    padding: 2rem;
    border-radius: 0 0 6px 6px;
    text-align: center;
  }

  .error-title {
    color: var(--protspace-viewer-error);
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
    background: var(--protspace-viewer-bg);
    z-index: var(--z-canvas);
    padding: 2rem;
    text-align: center;
  }

  .empty-title {
    color: var(--protspace-viewer-text);
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .empty-message {
    color: var(--protspace-viewer-text-muted);
    font-size: 0.875rem;
  }

  .viewer-content {
    width: 100%;
    height: 100%;
    border-radius: 0 0 6px 6px;
  }

  .color-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    background: var(--disabled-bg);
    border-top: 1px solid var(--protspace-viewer-border);
    color: var(--protspace-viewer-text-muted);
    font-size: 0.75rem;
  }

  .color-toolbar-label {
    font-weight: 600;
  }

  .color-mode-group {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--protspace-viewer-border);
    border-radius: 0.3rem;
  }

  .color-mode-button {
    border: 0;
    border-left: 1px solid var(--protspace-viewer-border);
    padding: 0.25rem 0.55rem;
    background: var(--protspace-viewer-bg);
    color: var(--protspace-viewer-text-muted);
    font: inherit;
    cursor: pointer;
  }

  .color-mode-button:first-child {
    border-left: 0;
  }

  .color-mode-button[aria-pressed='true'] {
    background: var(--primary);
    color: white;
  }

  .color-mode-button:focus-visible {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--protspace-viewer-loading);
    outline-offset: -2px;
  }

  .color-mode-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .tips {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.5rem;
    background: var(--disabled-bg);
    column-gap: 5px;
    border-top: 1px solid var(--protspace-viewer-border);
    font-size: 0.75rem;
    color: var(--protspace-viewer-text-muted);
    border-radius: 0 0 6px 6px;
  }

  .tips strong {
    font-weight: 600;
  }

  /* Spin animation provided by overlayMixins */

  /* ----------------------------- Responsive ------------------------------------ */

  @media (max-width: 950px) {
    /* --breakpoint-lg */
    :host {
      width: calc(50% - 6px);
    }
  }

  @media (max-width: 550px) {
    /* --breakpoint-xs */
    :host {
      width: 100%;
    }
  }
`;

export const structureViewerStyles = [tokens, overlayMixins, structureViewerStylesCore];
