import type { PlotDataPoint } from '@protspace/utils';

/**
 * A duplicate-stack as carried through the viewport pipeline: the helper-level
 * {@link DuplicateStack} shape (key/x/y/points in data space) plus the
 * pre-projected pixel coords (px/py) the badge/spiderfy renderers draw with.
 */
export interface ViewportDuplicateStack {
  key: string;
  x: number;
  y: number;
  /** scales.x(x) — base-pixel-space X (pre-zoom-transform). */
  px: number;
  /** scales.y(y) — base-pixel-space Y (pre-zoom-transform). */
  py: number;
  points: PlotDataPoint[];
}

/**
 * The render-time subset of {@link ViewportDuplicateStack} used by the badge
 * canvas cull/cap/draw path: screen-space `px`/`py` plus member `points`, keyed
 * by `key`. Structurally a slice of the canonical viewport stack.
 */
export type RenderDuplicateStack = Pick<ViewportDuplicateStack, 'key' | 'px' | 'py' | 'points'>;

/**
 * Output-geometry projection for a figure-export badge capture (#301/#302).
 * Built by the host from the export render it just performed:
 * - `scales`: the EXACT data→pixel mapping the exported dots used
 *   (ExportRenderer.createExportScales at the output's physical dims, via the
 *   WebGLRenderer facade) — never the live display scales;
 * - `width`/`height`: the output canvas's physical pixel dims — must equal
 *   `webglCanvas.width`/`.height` so the badge composite is 1:1;
 * - `badgeScale`: dpr × computeSizeScaleFactor(...), the same uniform factor
 *   the exported dots' sizes use; multiplies badge radius/offset/font/line
 *   width.
 */
export interface BadgeCaptureProjection {
  scales: { x: (dataX: number) => number; y: (dataY: number) => number };
  width: number;
  height: number;
  badgeScale: number;
}
