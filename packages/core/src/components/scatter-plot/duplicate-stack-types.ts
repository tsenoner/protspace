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
