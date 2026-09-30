import { css } from 'lit';
import { srOnlyMixin } from '../../styles/mixins';

export const categoryScoreStripStyles = [
  srOnlyMixin,
  css`
    :host {
      display: block;
    }

    .strip-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: var(--text-sm);
      color: var(--legend-text-secondary);
      padding: 0 0.25rem;
    }

    .strip-label {
      font-weight: 600;
      color: var(--legend-text-color);
      /* Keeps the ⓘ on the label's baseline rather than letting the 18px button
         stretch the header row. */
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
    }

    /* Centring lands the readout on the axis line: the svg's layout box is
     STRIP_HEIGHT tall and the axis sits at its midpoint. */
    .strip-body {
      display: flex;
      align-items: center;
      gap: 0.5rem;
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
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--legend-text-color);
    }

    .strip-value.is-empty {
      color: var(--legend-text-secondary);
    }

    .axis {
      stroke: var(--legend-border);
      stroke-width: 1;
    }

    circle {
      stroke: var(--legend-bg);
      stroke-width: 1;
      cursor: pointer;
    }

    circle.is-highlighted {
      stroke: var(--legend-text-color);
      stroke-width: 2;
    }

    .bound {
      font-size: var(--text-caption);
      fill: var(--legend-text-secondary);
    }
  `,
];
