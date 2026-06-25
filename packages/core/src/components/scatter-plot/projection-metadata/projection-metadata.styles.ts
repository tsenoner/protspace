import { css } from 'lit';

export const projectionMetadataStyles = css`
  :host {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
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
    min-width: 15rem;
    max-width: 20rem;
    background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95));
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
  .trigger:focus-visible + .content {
    pointer-events: auto;
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
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

  dl {
    margin: 0;
    padding: 0.625rem 0.75rem;
  }

  .item {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .item:last-child {
    margin-bottom: 0;
  }

  dt {
    font-weight: 500;
    color: #475569;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    color: #64748b;
    text-align: right;
    word-break: break-word;
  }
`;
