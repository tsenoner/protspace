import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { overlayMixins } from '../../styles/overlay-mixins';

const scatterplotStylesCore = css`
  :host {
    /* Layout */
    --protspace-width: 100%;
    --protspace-height: 600px;
    --protspace-bg-color: var(--surface);
    --protspace-border-color: var(--border);
    --protspace-border-radius: 6px;

    /* Points */
    --protspace-point-size: 80px;
    --protspace-point-size-highlighted: 120px;
    --protspace-point-size-selected: 150px;
    --protspace-point-opacity-base: 0.8;
    --protspace-point-opacity-selected: 1;
    --protspace-point-opacity-faded: 0.2;

    /* Selection */
    --protspace-selection-color: #ff8a3d; /* warmer but softer */
    --protspace-highlight-color: var(--primary);
    --protspace-default-stroke: #3a3a3a;
    --protspace-stroke-width-base: 1px;
    --protspace-stroke-width-highlighted: 2px;
    --protspace-stroke-width-selected: 3px;

    /* Transitions */
    --protspace-transition-duration: 0.2s;
    --protspace-transition-easing: ease-in-out;

    /* Tooltip */
    --protspace-tooltip-bg: rgba(255, 255, 255, 0.95);
    --protspace-tooltip-border: var(--border);
    --protspace-tooltip-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);

    /* Brush */
    --protspace-brush-stroke: #0072b5;
    --protspace-brush-fill: rgba(0, 114, 181, 0.15);
    --protspace-brush-stroke-width: 1px;

    display: block;
    width: var(--protspace-width);
    height: var(--protspace-height);
    position: relative;
    background: var(--protspace-bg-color);
    border: 1px solid var(--protspace-border-color);
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
  }

  canvas {
    z-index: var(--z-canvas);
    pointer-events: none;
  }

  /* D3 brush (drag-to-select rectangle) */
  .brush-container rect.selection {
    fill: var(--protspace-brush-fill);
    stroke: var(--protspace-brush-stroke);
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
    fill: var(--protspace-brush-fill);
    stroke: var(--protspace-brush-stroke);
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

  .mode-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: var(--z-overlay);
    padding: 0.5rem;
    background: var(--primary);
    color: white;
    font-size: 0.75rem;
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* Small status chips overlaid on the plot (visible point count bottom-left,
     numeric recompute notice bottom-right). Same card look as the top-left
     hover buttons (projection-metadata / protspace-tips triggers). */
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
    background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95));
    border: 1px solid var(--protspace-tooltip-border, #d9e2ec);
    box-shadow: var(--protspace-tooltip-shadow, 0 6px 16px rgba(0, 0, 0, 0.08));
    color: #475569;
    font-size: 0.6875rem;
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
    stroke: rgba(15, 23, 42, 0.35);
    stroke-width: 1px;
    pointer-events: none;
  }

  .dup-spiderfy-node {
    cursor: pointer;
    pointer-events: all;
  }

  .dup-spiderfy-node-circle {
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 1.5px;
    pointer-events: all;
    cursor: pointer;
  }
`;

export const scatterplotStyles = [tokens, overlayMixins, scatterplotStylesCore];
