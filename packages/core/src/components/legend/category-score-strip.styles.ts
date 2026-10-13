import { css } from 'lit';
import { srOnly } from '../kit/kit-shared.styles';

export const categoryScoreStripStyles = [
  srOnly,
  css`
    :host {
      display: block;
    }

    .strip-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: var(--ps-text-sm);
      color: var(--ps-text-muted);
      padding: 0 var(--ps-space-1);
    }

    .strip-label {
      font-weight: var(--ps-weight-semibold);
      color: var(--ps-text);
      /* Keeps the ⓘ on the label's baseline rather than letting the 18px button
         stretch the header row. */
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-0-5);
    }

    /* Centring lands the readout on the axis line: the svg's layout box is
     STRIP_HEIGHT tall and the axis sits at its midpoint. */
    .strip-body {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
    }

    svg {
      display: block;
      width: 100%;
      overflow: visible;
      /* Without a zero min-width the intrinsic svg width would keep the flex item
       from shrinking, and the gutter would push the axis out of the panel. */
      flex: 1;
      min-width: 0;
    }

    /* Fixed width and tabular figures: the gutter must not resize as the hover
     moves between categories, or every dot would shift with it. */
    .strip-value {
      flex: none;
      min-width: 3rem;
      text-align: right;
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text);
    }

    .strip-value.is-empty {
      color: var(--ps-text-muted);
    }

    .axis {
      stroke: var(--ps-border);
      stroke-width: 1;
    }

    circle {
      stroke: var(--ps-surface);
      stroke-width: 1;
      cursor: pointer;
    }

    circle.is-highlighted {
      stroke: var(--ps-text);
      stroke-width: 2;
    }

    .bound {
      font-size: var(--ps-text-xs);
      fill: var(--ps-text-muted);
    }
  `,
];
