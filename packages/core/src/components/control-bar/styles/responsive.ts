import { css } from 'lit';

/**
 * Responsive Styles
 *
 * Media queries and responsive adaptations for the control bar.
 * Handles layout changes at tablet/mobile breakpoints.
 * Progressively hides decorative elements (chevrons, icons) before content overlaps.
 */
export const responsiveStyles = css`
  /* Large screens: allow wrapping to multiple rows */
  @media (max-width: 1450px) {
    /* --breakpoint-2xl */
    .control-bar {
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      align-items: center;
    }

    .left-controls {
      flex: 0 0 auto;
      order: 1;
    }

    .search-group {
      flex: 1 1 300px;
      min-width: 250px;
      order: 2;
      margin: 0 var(--spacing-sm);
    }

    .right-controls {
      flex: 0 0 auto;
      order: 3;
    }

    /* Reduce minimum widths to allow more shrinking */
    .dropdown-trigger {
      min-width: 8rem;
    }
  }

  /* Progressive shrinking: reduce padding when space is tight */
  @media (max-width: 1300px) {
    /* Custom breakpoint (between --breakpoint-xl and --breakpoint-2xl) */
    .dropdown-trigger {
      min-width: 6rem;
      padding: var(--input-padding-y) var(--spacing-sm);
    }

    .left-controls .control-group {
      gap: var(--spacing-xs);
    }

    /* Ensure dropdowns can shrink to prevent overlap */
    .projection-container,
    protspace-annotation-select {
      max-width: 15rem;
    }
  }

  /* Trigger three-row layout earlier to prevent label hiding */
  @media (max-width: 1200px) {
    /* --breakpoint-xl */
    .control-bar {
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      overflow: visible;
    }

    .left-controls {
      flex: 1 1 100%;
      order: 1;
      gap: var(--spacing-sm);
    }

    .left-controls > .control-group {
      flex: 1 1 0;
      min-width: 0;
    }

    .left-controls .control-group > label {
      flex-shrink: 0;
      white-space: nowrap;
    }

    .left-controls .projection-container,
    .left-controls select,
    .left-controls protspace-annotation-select {
      flex: 1;
      min-width: 0;
      max-width: none;
    }

    /* Allow text truncation in dropdowns but not clip menus */
    .left-controls .dropdown-trigger {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .projection-container .dropdown-trigger,
    .left-controls select {
      width: 100%;
      min-width: 0;
    }

    .search-group {
      flex: 1 1 100%;
      order: 2;
      margin: 0;
    }

    .right-controls {
      flex: 1 1 100%;
      order: 3;
      gap: var(--spacing-sm);
    }

    .right-controls > * {
      flex: 1 1 0;
      min-width: 0;
    }

    .right-controls .data-actions-group {
      gap: var(--spacing-xs);
    }

    .right-controls .filter-container,
    .right-controls .export-container {
      display: flex;
      flex: 1;
      min-width: 0;
    }

    .right-controls .dropdown-trigger,
    .right-controls button {
      width: 100%;
      flex: 1;
      min-width: 0;
    }

    /* Allow text truncation in dropdown triggers but not clip menus */
    .right-controls .dropdown-trigger {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Reset minimum widths for full-width layout */
    .dropdown-trigger {
      min-width: 0;
    }

    /* Show chevrons again for right-controls */
    .right-controls .chevron-down {
      display: block;
    }
  }

  /* Hide icons FIRST when space gets tight (before chevrons) */
  @media (max-width: 800px) {
    /* --breakpoint-md */
    .right-controls .icon {
      display: none;
    }

    .right-controls button {
      justify-content: center;
      padding: var(--button-padding-y) var(--spacing-xs);
    }
  }

  /* Keep projection and annotation readable while giving the wider EAT fieldset its own row. */
  @media (max-width: 950px) {
    /* --breakpoint-lg */
    .left-controls {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      width: 100%;
    }

    .left-controls > .control-group {
      width: 100%;
    }

    .left-controls > .eat-controls {
      grid-column: 1 / -1;
      box-sizing: border-box;
      width: 100%;
    }
  }

  /* Keep right-side dropdown chevrons visible on compact screens so
     Import/Export still read as menus rather than immediate actions. */
  @media (max-width: 600px) {
    /* --breakpoint-sm */
    .control-bar {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }

    .left-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      width: 100%;
    }

    .left-controls > .control-group,
    .left-controls > .eat-controls {
      width: 100%;
    }

    .eat-controls {
      box-sizing: border-box;
      flex-wrap: wrap;
      row-gap: var(--spacing-xs);
    }

    .eat-threshold {
      display: grid;
      grid-template-columns: auto minmax(4rem, 1fr) auto auto auto;
      flex: 1 1 100%;
      min-width: 0;
    }

    .eat-threshold input[type='range'] {
      width: auto;
      min-width: 4rem;
    }

    .right-controls .dropdown-trigger {
      justify-content: space-between;
      gap: var(--spacing-2xs, 0.25rem);
      padding: var(--button-padding-y) var(--spacing-xs);
    }
  }

  /* Give the threshold caption its own row on the narrowest supported viewports. */
  @media (max-width: 400px) {
    .eat-threshold {
      grid-template-columns: minmax(4rem, 1fr) auto auto auto;
      width: 100%;
    }

    .eat-threshold > span:first-child {
      grid-column: 1 / -1;
    }
  }

  /* Hide left-controls chevrons only as last resort */
  @media (max-width: 550px) {
    /* --breakpoint-xs */
    .left-controls .chevron-down {
      display: none;
    }

    /* Keep text centered when chevron is hidden */
    .left-controls .dropdown-trigger {
      justify-content: center;
    }
  }

  /* Small screens: reduce margins to prevent search cutoff */
  @media (max-width: 950px) {
    /* --breakpoint-lg */
    .control-bar {
      min-width: 0;
      padding: var(--spacing-sm);
    }

    .search-group {
      margin: 0;
      min-width: 200px;
    }

    .search-container {
      margin: 0;
    }
  }
`;
