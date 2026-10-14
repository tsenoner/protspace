/**
 * Pure tooltip-positioning math, extracted from ProtspaceScatterplot._getTooltipStyle.
 *
 * Given the cursor anchor (x, y), the tooltip's resolved height, and the
 * viewport (config.width/height), it returns the inline CSS `left/top[/transform]`
 * string that keeps the tooltip on-screen: anchored lower-right of the cursor,
 * flipped to the left when it would overflow the right edge, and clamped to the
 * viewport on all four sides. No DOM access — unit-testable in isolation.
 * computeTouchTooltipStyle places a tooltip a tap pinned, wholly inside the plot.
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

/** Gap (px) between a tap-pinned tooltip and its protein, so the finger does not cover the card. */
const TOUCH_TOOLTIP_CLEARANCE = 16;

/**
 * Space (px) a tap-pinned tooltip leaves free at the plot's bottom: the selection bar a tap's
 * selection shows there, 50 px tall under a coarse pointer and 12 px up, sits over the plot and
 * would cover the card's actions.
 */
export const TOUCH_TOOLTIP_BOTTOM_RESERVE = 62;

/**
 * Placement for a tooltip a tap pinned. A finger has no cursor to sit beside, and on a phone the
 * plot is barely wider than the card, so the card is centred on the protein and kept wholly inside
 * the plot (TOOLTIP_EDGE_PADDING from every edge, TOUCH_TOOLTIP_BOTTOM_RESERVE from the bottom):
 * above the protein when it fits, else below it, else against the plot edge farther from it. It takes the hover tooltip's width.
 */
export function computeTouchTooltipStyle(input: TooltipStyleInput): string {
  const { x, y, height, viewportWidth, viewportHeight } = input;
  const width = effectiveTooltipWidth(viewportWidth);
  const pad = TOOLTIP_EDGE_PADDING;

  const left = Math.max(pad, Math.min(x - width / 2, viewportWidth - width - pad));

  const floor = viewportHeight - TOUCH_TOOLTIP_BOTTOM_RESERVE;
  const above = y - TOUCH_TOOLTIP_CLEARANCE - height;
  const below = y + TOUCH_TOOLTIP_CLEARANCE;
  let top: number;
  // Above a protein inside the bar's strip, the card still ends on the strip.
  if (above >= pad) top = Math.min(above, floor - height);
  else if (below + height <= floor) top = below;
  else top = y > viewportHeight / 2 ? pad : floor - height;
  top = Math.max(pad, top);

  return `left: ${left}px; top: ${top}px; --protspace-tooltip-effective-width: ${width}px;`;
}
