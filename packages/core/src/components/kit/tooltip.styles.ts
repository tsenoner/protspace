import { css } from 'lit';

export const tooltipStyles = css`
  :host {
    display: contents;
  }
  .tip {
    position: fixed;
    inset: auto;
    margin: 0;
    /* Its own width, not the room left where it sits: Floating UI's shift would widen it each frame. */
    width: max-content;
    max-width: 280px;
    padding: var(--ps-space-1) var(--ps-space-2);
    border: 0;
    border-radius: var(--ps-radius);
    background: var(--ps-tooltip-bg);
    color: var(--ps-tooltip-text);
    font-family: var(--ps-font-sans);
    font-size: var(--ps-text-sm);
    line-height: var(--ps-leading-tight);
    box-shadow: var(--ps-shadow-md);
    pointer-events: none;
  }
`;
