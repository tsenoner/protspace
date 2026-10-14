import { css } from 'lit';

/**
 * Legacy aliases from before the --ps-* tokens (packages/core/src/styles/theme.ts). Only modules in
 * style-lint.test.ts's LEGACY set compose this sheet, for its non-colour values: spacing,
 * breakpoints, radii, type sizes and weights, transitions, z-indexes and component sizing. It
 * holds no colour: colours are --ps-* tokens, which follow the page's theme, and the style lint
 * fails a colour here. Task 8.1 deletes this file.
 */
export const tokens = css`
  :host {
    display: block;
    font-family: var(--font-family);

    /* Spacing Scale (4px base unit) */
    --spacing-2xs: 0.125rem; /*  2px */
    --spacing-xs: 0.25rem; /*  4px */
    --spacing-sm: 0.5rem; /*  8px */
    --spacing-md: 0.75rem; /* 12px */
    --spacing-lg: 1rem; /* 16px */

    /* Breakpoints (mobile-first approach) */
    --breakpoint-xs: 550px; /* Mobile */
    --breakpoint-sm: 600px; /* Small tablets */
    --breakpoint-md: 800px; /* Tablets */
    --breakpoint-lg: 950px; /* Small desktop */
    --breakpoint-xl: 1200px; /* Desktop */
    --breakpoint-2xl: 1450px; /* Large desktop */

    /* Border & Radius */
    --border-width: 1px;
    --radius: 0.25rem; /* 4px */
    --radius-pill: 0.75rem; /* 12px */

    /* Typography Scale */
    --font-family: system-ui, -apple-system, sans-serif;
    --text-xs: 0.625rem; /* 10px */
    /* 11px. Named for its role, not slotted into the xs/sm/base/md ramp: it sits between
       --text-xs and --text-sm, so any scale name for it would read as the wrong size. */
    --text-caption: 0.6875rem;
    --text-sm: 0.75rem; /* 12px */
    --text-base: 0.875rem; /* 14px */
    --text-md: 1rem; /* 16px */

    /* Font Weights */
    --font-normal: 400;
    --font-medium: 500;
    --font-semibold: 600;
    --font-bold: 700;

    /* Animations */
    --transition-fast: all 0.1s ease;
    --transition: all 0.15s ease;

    /* Layout */
    --dropdown-offset: 0.3125rem; /* 5px */

    /* Z-Index Scale */
    --z-base: 1;
    --z-canvas: 1;
    --z-badges: 2;
    --z-svg: 3;
    --z-overlay: 10;
    --z-tooltip: 20;
    --z-dropdown: 100;
    --z-modal: 1000;
    --z-above-modal: 1001;

    /* Component sizing */
    --input-padding-y: 0.375rem; /* 6px */
    --input-padding-x: 0.5625rem; /* 9px */
    --button-padding-y: 0.3rem;
    --button-padding-x: 0.75rem;
  }
`;
