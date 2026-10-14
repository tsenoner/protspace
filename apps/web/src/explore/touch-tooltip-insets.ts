import type { ProtspaceScatterplot, TouchTooltipInsets } from '@protspace/core';

type Boxed = Pick<Element, 'getBoundingClientRect'>;

/**
 * How far above the plot's bottom the status corner's bottom sits while the selection bar shows
 * under a coarse pointer: 12 px margin, the 50 px bar, 8 px gap (workbench.css). A tap selects
 * its protein, so the bar shows; the inset assumes it whether or not it does yet, because the
 * selection reaches the bar only after the pin is placed. Without a bar the card only sits higher.
 */
const LIFTED_STATUS_BOTTOM = 12 + 50 + 8;

/**
 * The plot's edge strips that the workbench's chrome covers: the tool strip down the left, and
 * the status corner, lifted over the selection bar, along the bottom.
 */
export function measureTouchTooltipInsets(
  plot: Boxed,
  plotTools: Boxed,
  plotStatus: Boxed,
): TouchTooltipInsets {
  const plotBox = plot.getBoundingClientRect();
  const toolsBox = plotTools.getBoundingClientRect();
  const left = toolsBox.width > 0 ? Math.max(0, Math.ceil(toolsBox.right - plotBox.left)) : 0;
  const bottom = LIFTED_STATUS_BOTTOM + Math.ceil(plotStatus.getBoundingClientRect().height);
  return { top: 0, right: 0, bottom, left };
}

const sameInsets = (a: TouchTooltipInsets, b: TouchTooltipInsets) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/**
 * Keeps the plot's `touchTooltipInsets` on the workbench's chrome, so a tap-pinned tooltip is
 * never under the tool strip or the status corner. Re-measured when either changes size (a layout
 * mode change, a status line that wraps); a write happens only when the insets change.
 */
export function bindTouchTooltipInsets(
  plotElement: Pick<ProtspaceScatterplot, 'touchTooltipInsets' | 'getBoundingClientRect'>,
  plotTools: Element,
  plotStatus: Element,
): () => void {
  const update = () => {
    const next = measureTouchTooltipInsets(plotElement, plotTools, plotStatus);
    if (!sameInsets(next, plotElement.touchTooltipInsets)) plotElement.touchTooltipInsets = next;
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(plotTools);
  observer.observe(plotStatus);
  return () => observer.disconnect();
}
