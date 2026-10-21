import type { ProtspaceScatterplot, TouchTooltipInsets } from '@protspace/core';

type Boxed = Pick<Element, 'getBoundingClientRect'>;

/**
 * How much of the plot's bottom edge the selection bar can take besides the status corner's height,
 * from workbench.css's `--wb-status-lift` (a registered length, so computed in px): the bar above
 * the status corner, its highest spot. A tap selects its protein, so the bar shows; the inset
 * assumes it whether or not it does yet, because the selection reaches the bar only after the pin
 * is placed. Without a bar, or with the bar beside the status corner, the card only sits higher.
 */
const statusLift = (plotStatus: Element) =>
  parseFloat(getComputedStyle(plotStatus).getPropertyValue('--wb-status-lift')) || 0;

/**
 * The plot's edge strips that the workbench's chrome covers: the tool strip down the left, and
 * the status corner and the selection bar, `lift` px over it at most, along the bottom.
 */
export function measureTouchTooltipInsets(
  plot: Boxed,
  plotTools: Boxed,
  plotStatus: Boxed,
  lift: number,
): TouchTooltipInsets {
  const plotBox = plot.getBoundingClientRect();
  const toolsBox = plotTools.getBoundingClientRect();
  const left = toolsBox.width > 0 ? Math.max(0, Math.ceil(toolsBox.right - plotBox.left)) : 0;
  const bottom = Math.ceil(lift + plotStatus.getBoundingClientRect().height);
  return { top: 0, right: 0, bottom, left };
}

const sameInsets = (a: TouchTooltipInsets, b: TouchTooltipInsets) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/**
 * Keeps the plot's `touchTooltipInsets` on the workbench's chrome, so a tap-pinned tooltip is
 * never under the tool strip or the status corner. Re-measured when either changes size (a layout
 * mode change, a status line that wraps) or the pointer turns coarse or fine (the selection bar's
 * height, and so the lift, follows it); a write happens only when the insets change.
 */
export function bindTouchTooltipInsets(
  plotElement: Pick<ProtspaceScatterplot, 'touchTooltipInsets' | 'getBoundingClientRect'>,
  plotTools: Element,
  plotStatus: Element,
): () => void {
  const update = () => {
    const next = measureTouchTooltipInsets(
      plotElement,
      plotTools,
      plotStatus,
      statusLift(plotStatus),
    );
    if (!sameInsets(next, plotElement.touchTooltipInsets)) plotElement.touchTooltipInsets = next;
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(plotTools);
  observer.observe(plotStatus);
  const pointer = matchMedia('(pointer: coarse)');
  pointer.addEventListener('change', update);
  return () => {
    observer.disconnect();
    pointer.removeEventListener('change', update);
  };
}
