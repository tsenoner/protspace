/**
 * Pure tooltip-positioning math, extracted from ProtspaceScatterplot._getTooltipStyle.
 *
 * Given the cursor anchor (x, y), the tooltip's resolved height, and the
 * viewport (config.width/height), it returns the inline CSS `left/top[/transform]`
 * string that keeps the tooltip on-screen: anchored lower-right of the cursor,
 * flipped to the left when it would overflow the right edge, and clamped to the
 * viewport on all four sides. No DOM access — unit-testable in isolation.
 */

/** Min gap (px) kept between the tooltip and any viewport edge. */
export const TOOLTIP_EDGE_PADDING = 15;
/** Assumed max tooltip width (px) used for right/left overflow decisions. */
export const TOOLTIP_MAX_WIDTH = 350;
/** Horizontal offset (px) of the tooltip anchor from the cursor. */
export const TOOLTIP_ANCHOR_OFFSET_X = 15;
/** Vertical offset (px): tooltip top sits this far ABOVE the cursor. */
export const TOOLTIP_ANCHOR_OFFSET_Y = 60;
/** Fallback height (px) when no measured/estimated height is available. */
export const TOOLTIP_FALLBACK_HEIGHT = 160;

export interface TooltipStyleInput {
  /** Cursor x in viewport (local) px. */
  x: number;
  /** Cursor y in viewport (local) px. */
  y: number;
  /** Resolved tooltip height (measured, else estimated) in px. */
  height: number;
  /** Viewport width (config.width) in px. */
  viewportWidth: number;
  /** Viewport height (config.height) in px. */
  viewportHeight: number;
}

/**
 * Resolve the tooltip's border-box width from the same viewport constraint used by its CSS.
 * Keeping this value shared prevents positioning from assuming 350 px while the rendered tooltip
 * has responsively narrowed (or, previously, remained 352 px including its border).
 */
export function effectiveTooltipWidth(viewportWidth: number): number {
  return Math.max(0, Math.min(TOOLTIP_MAX_WIDTH, viewportWidth - 2 * TOOLTIP_EDGE_PADDING));
}

export function computeTooltipStyle(input: TooltipStyleInput): string {
  const { x, y, height: tooltipHeight, viewportWidth, viewportHeight } = input;
  const tooltipWidth = effectiveTooltipWidth(viewportWidth);

  let left = x + TOOLTIP_ANCHOR_OFFSET_X;
  let top = y - TOOLTIP_ANCHOR_OFFSET_Y;
  let transform = '';

  // Horizontal: if it would overflow the right edge, flip to the left side.
  if (left + tooltipWidth > viewportWidth) {
    left = x - TOOLTIP_ANCHOR_OFFSET_X;
    transform = 'translateX(-100%)';
  }

  // Keep within horizontal bounds.
  if (!transform && left < TOOLTIP_EDGE_PADDING) {
    left = TOOLTIP_EDGE_PADDING;
  } else if (transform && left - tooltipWidth < TOOLTIP_EDGE_PADDING) {
    left = tooltipWidth + TOOLTIP_EDGE_PADDING;
  }

  // Vertical: clamp to the viewport using the resolved height.
  if (top + tooltipHeight > viewportHeight - TOOLTIP_EDGE_PADDING) {
    top = viewportHeight - tooltipHeight - TOOLTIP_EDGE_PADDING;
  }
  if (top < TOOLTIP_EDGE_PADDING) {
    top = TOOLTIP_EDGE_PADDING;
  }

  return `left: ${left}px; top: ${top}px; --protspace-tooltip-effective-width: ${tooltipWidth}px;${
    transform ? ` transform: ${transform};` : ''
  }`;
}
