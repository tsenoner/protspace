import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { overlayMixins } from '../../styles/overlay-mixins';

const scatterplotStylesCore = css`
  :host {
    /* Sizes, opacities and timings only: every colour comes from a --ps-* token (theme.ts), so an
       embedder restyles the plot in both themes by setting those on :root. */

    /* Layout */
    --protspace-width: 100%;
    --protspace-height: 600px;
    --protspace-border-radius: 6px;

    /* Points */
    --protspace-point-size: 80px;
    --protspace-point-size-highlighted: 120px;
    --protspace-point-size-selected: 150px;
    --protspace-point-opacity-base: 0.8;
    --protspace-point-opacity-selected: 1;
    --protspace-point-opacity-faded: 0.2;

    /* Selection */
    --protspace-stroke-width-base: 1px;
    --protspace-stroke-width-highlighted: 2px;
    --protspace-stroke-width-selected: 3px;

    /* Transitions */
    --protspace-transition-duration: 0.2s;
    --protspace-transition-easing: ease-in-out;

    /* Brush */
    --protspace-brush-stroke-width: 1px;

    display: block;
    width: var(--protspace-width);
    height: var(--protspace-height);
    position: relative;
    background: var(--ps-plot-bg);
    border: 1px solid var(--ps-border);
    border-radius: var(--protspace-border-radius);
    overflow: hidden;
    margin: 0;
    padding: 0;
  }

  .container {
    width: 100%;
    height: 100%;
    position: relative;
    margin: 0;
    padding: 0;
  }

  svg,
  canvas {
    position: absolute;
    top: 0;
    left: 0;
  }

  svg {
    z-index: var(--z-svg);
    pointer-events: all;
    /* d3-zoom pans and pinches the plot; the browser must not also scroll or zoom the page. */
    touch-action: none;
  }

  canvas {
    z-index: var(--z-canvas);
    pointer-events: none;
  }

  /* Duplicate badges, spiderfied stacks and EAT connectors already sit at the
     new projection's positions; hide them while the points glide there. */
  :host([data-morphing]) .badges-canvas,
  :host([data-morphing]) .overlay-container {
    opacity: 0;
  }

  /* D3 brush (drag-to-select rectangle). The fill is the accent at 15 %, not --ps-accent-tint:
     the light tint is opaque and would hide the points under the brush. */
  .brush-container rect.selection {
    fill: color-mix(in srgb, var(--ps-accent) 15%, transparent);
    stroke: var(--ps-accent);
    stroke-width: var(--protspace-brush-stroke-width);
    /* Keep the outline thin even when the brush group is scaled by zoom transforms */
    vector-effect: non-scaling-stroke;
    shape-rendering: crispEdges;
  }

  .brush-container rect.overlay {
    cursor: crosshair;
  }

  .brush-container .handle {
    /* If anything renders, hide it — selection should be just a simple rectangle. */
    display: none;
  }

  /* Lasso (freeform selection path) */
  .lasso-path {
    fill: color-mix(in srgb, var(--ps-accent) 15%, transparent);
    stroke: var(--ps-accent);
    stroke-width: var(--protspace-brush-stroke-width);
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
    vector-effect: non-scaling-stroke;
  }

  /* Base loading overlay styles provided by overlayMixins */
  .loading-spinner {
    /* Override size from base mixin */
    width: 3rem;
    height: 3rem;
  }

  /* Small status chips overlaid on the plot (visible point count bottom-left,
     numeric recompute notice bottom-right). Same card look as the top-left
     projection-metadata trigger. */
  .plot-indicator {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    height: 2rem;
    padding: 0 0.625rem;
    box-sizing: border-box;
    background: var(--ps-surface-raised);
    border: 1px solid var(--ps-border);
    box-shadow: var(--ps-shadow-md);
    color: var(--ps-text-muted);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    letter-spacing: 0.01em;
    border-radius: 0.375rem;
    pointer-events: none;
    user-select: none;
  }

  /* Duplicate stack spiderfy UI (SVG overlay) */

  .dup-spiderfy {
    pointer-events: all;
  }

  .dup-spiderfy-line {
    stroke: color-mix(in srgb, var(--ps-text) 35%, transparent);
    stroke-width: 1px;
    pointer-events: none;
  }

  .dup-spiderfy-node {
    cursor: pointer;
    pointer-events: all;
  }

  /* The rim separates a node from the points behind it, so it is the plot's own background. */
  .dup-spiderfy-node-circle {
    stroke: var(--ps-plot-bg);
    stroke-width: 1.5px;
    pointer-events: all;
    cursor: pointer;
  }

  /* EAT provenance connectors (SVG overlay). Positions inherit the parent zoom transform. */
  .connector-lines-layer {
    pointer-events: none;
  }

  .eat-provenance-connector {
    stroke: var(--ps-plot-connector);
    stroke-linecap: round;
    opacity: 0.82;
  }

  .eat-provenance-endpoint {
    fill: none;
    stroke: var(--ps-eat-endpoint);
    stroke-width: 2.5px;
    vector-effect: non-scaling-stroke;
  }

  .connector-status {
    position: absolute;
    top: var(--ps-space-2);
    left: 50%;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    max-width: min(32rem, calc(100% - 2rem));
    padding: 0.25rem 0.375rem 0.25rem 0.625rem;
    box-sizing: border-box;
    transform: translateX(-50%);
    background: var(--ps-surface-raised);
    border: 1px solid var(--ps-border);
    box-shadow: var(--ps-shadow-md);
    color: var(--ps-text);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    border-radius: 0.375rem;
  }

  .connector-status span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connector-status button {
    display: grid;
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 auto;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--ps-text-muted);
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .connector-status button:hover,
  .connector-status button:focus-visible {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
  }

  /* The hover fill alone barely differs from the chip (1.1:1 in dark): focus takes the library ring */
  .connector-status button:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }
`;

export const scatterplotStyles = [tokens, overlayMixins, scatterplotStylesCore];
