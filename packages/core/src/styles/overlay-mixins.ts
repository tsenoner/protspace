import { css } from 'lit';

/**
 * Overlay Utility Mixins
 *
 * Reusable patterns for overlays, modals, tooltips, and loading states.
 * These mixins eliminate duplication across components and ensure consistent
 * behavior for common UI patterns.
 *
 * @example
 * ```typescript
 * import { overlayMixins } from './styles/overlay-mixins';
 *
 * static styles = [tokens, overlayMixins, css`
 *   .my-container {
 *     position: relative;
 *   }
 * `];
 * ```
 */
export const overlayMixins = css`
  /* Loading overlay (used in scatter-plot, structure-viewer) */
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--ps-surface) 80%, transparent);
    z-index: var(--z-overlay);
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

  /* Modal overlay (legend modal) */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--ps-scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    overscroll-behavior: contain;
  }

  .modal-content {
    background: var(--ps-surface-raised);
    border-radius: var(--radius);
    box-shadow: var(--ps-shadow-lg);
    max-width: 90vw;
    max-height: 85vh;
  }

  /* Tooltip pattern */
  .tooltip {
    position: absolute;
    z-index: var(--z-tooltip);
    padding: var(--spacing-sm);
    background: var(--ps-surface-raised);
    border: var(--border-width) solid var(--ps-border);
    border-radius: var(--radius);
    box-shadow: var(--ps-shadow-md);
    font-size: var(--text-sm);
    max-width: 200px;
    word-wrap: break-word;
    pointer-events: none;
  }
`;
