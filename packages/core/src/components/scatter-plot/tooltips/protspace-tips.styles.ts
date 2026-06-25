import { css } from 'lit';

export const protspaceTipsStyles = css`
  :host {
    position: absolute;
    top: 0.5rem;
    left: 3rem;
    z-index: 10;
  }

  .trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95));
    border: 1px solid var(--protspace-tooltip-border, #d9e2ec);
    border-radius: 0.375rem;
    cursor: pointer;
    box-shadow: var(--protspace-tooltip-shadow, 0 6px 16px rgba(0, 0, 0, 0.08));
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .trigger:hover {
    background: rgba(255, 255, 255, 1);
    border-color: var(--protspace-highlight-color, #00a3e0);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
    transform: scale(1.05);
  }

  .trigger:focus-visible {
    outline: 2px solid var(--primary-alpha-30);
    outline-offset: 2px;
  }

  .trigger.active {
    background: rgba(255, 255, 255, 1);
    border-color: var(--protspace-highlight-color, #00a3e0);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
    transform: scale(1.05);
  }

  .trigger .icon {
    width: 1rem;
    height: 1rem;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
    color: #475569;
    transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .trigger:hover .icon,
  .trigger:focus-visible .icon {
    color: var(--protspace-highlight-color, #00a3e0);
  }

  .content {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    min-width: 18rem;
    max-width: min(24rem, calc(100vw - 2rem));
    background: var(--protspace-tooltip-bg, #ffffff);
    border: 1px solid var(--protspace-tooltip-border, #d9e2ec);
    border-radius: 0.5rem;
    box-shadow:
      var(--protspace-tooltip-shadow, 0 6px 16px rgba(0, 0, 0, 0.08)),
      0 10px 40px rgba(0, 0, 0, 0.1);
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-0.25rem);
    transition:
      opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      visibility 0.2s;
    z-index: 1000;
  }

  /* Invisible bridge that covers the gap between trigger and popover so
     the mouse can travel from the button into the popover without losing
     :host(:hover). */
  .content::before {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 0;
    width: 100%;
    height: 0.5rem; /* matches the gap: top: calc(100% + 0.5rem) */
  }

  :host(:hover) .content,
  .content.visible {
    pointer-events: auto;
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  /* Responsive design for mobile */
  @media (max-width: 640px) {
    :host {
      left: 0.5rem;
      top: 0.5rem;
    }

    .content {
      left: -0.5rem;
      min-width: calc(100vw - 1rem);
      max-width: calc(100vw - 1rem);
    }
  }

  .header {
    padding: 0.625rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: #334155;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 0.5rem 0.5rem 0 0;
  }

  /* ── Shortcuts table ───────────────────────────────────────── */

  .shortcuts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .shortcuts-table td {
    padding: 0.25rem 0.75rem;
    color: #64748b;
    vertical-align: baseline;
  }

  .shortcuts-table td:first-child {
    white-space: nowrap;
    color: #475569;
    width: 1%;
    padding-right: 0.5rem;
  }

  .shortcuts-table td:last-child {
    padding-right: 0.75rem;
  }

  .section-label td {
    padding-top: 0.625rem;
    padding-bottom: 0.1875rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Remove top padding on the very first section label */
  .shortcuts-table tr:first-child.section-label td {
    padding-top: 0.375rem;
  }

  .mod-key {
    font-size: 0.875rem;
    line-height: 0;
    vertical-align: -0.0625rem;
  }

  kbd {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 0.25rem;
    padding: 0.0625rem 0.3125rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: #475569;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
  }

  /* ── Tour button section ─────────────────────────────────── */

  .tour-section {
    border-top: 1px solid #e2e8f0;
    padding: 0.625rem 0.75rem;
  }

  .tour-button {
    width: 100%;
    padding: 0.4375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: #fff;
    background: var(--protspace-highlight-color, #00a3e0);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tour-button:hover {
    background: #0090c7;
    box-shadow: 0 2px 6px rgba(0, 163, 224, 0.3);
  }

  .tour-button:active {
    transform: scale(0.98);
  }
`;
