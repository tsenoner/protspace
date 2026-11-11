import { css } from 'lit';

/** Font and colour every kit element starts from. */
export const kitHost = css`
  :host {
    font-family: var(--ps-font-sans);
    font-size: var(--ps-text-base);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text);
  }
`;

/** The one keyboard focus ring (design decision 8). */
export const focusRing = css`
  :focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }
  @media (forced-colors: active) {
    :focus-visible {
      outline-color: Highlight;
    }
  }
`;

/** Kit animations stop for people who asked for less motion. */
export const reducedMotion = css`
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition-duration: 0ms !important;
      animation-duration: 0ms !important;
    }
  }
`;

/** Hidden from view, still read by assistive technology: live regions and off-screen labels. */
export const srOnly = css`
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
