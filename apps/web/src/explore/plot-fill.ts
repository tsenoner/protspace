import type { ProtspaceScatterplot } from '@protspace/core';
import { RAIL_WIDTH } from './layout-defaults';
import { getLayout, subscribeLayout } from './layout-state';
import { getLayoutMode, subscribeLayoutMode } from './layout-mode';

/**
 * The plot's width beside the open desktop sidebar: the workbench body less the sidebar's rendered
 * width (the `--wb-sidebar-width` Workbench sets) and the rail. Undefined off desktop, where no
 * sidebar sits beside the plot.
 */
function openPlotWidth(body: HTMLElement | null): number | undefined {
  if (!body || getLayoutMode() !== 'desktop') return undefined;
  const sidebar = parseFloat(body.style.getPropertyValue('--wb-sidebar-width'));
  if (!Number.isFinite(sidebar)) return undefined;
  return Math.round(body.getBoundingClientRect().width - sidebar - RAIL_WIDTH);
}

/**
 * The explore plot always fills its area, each axis stretched (design decision 10). It is at most
 * as wide as beside the open sidebar, so collapsing the desktop sidebar centres it in the freed
 * area instead of stretching it. The plot and its exports read both from the config.
 *
 * With the sidebar open and the plot at its open width, the cap would be the plot's own width and
 * would follow every window resize, a second render behind the plot's own; there is no cap then.
 * It stays while the plot is still wider (a sidebar sliding open over it), and the plot draws
 * nothing for a cap move that reaches no edge.
 */
export function bindPlotFill(plotElement: ProtspaceScatterplot): () => void {
  const body = plotElement.closest<HTMLElement>('[data-workbench="body"]');
  const sync = () => {
    const open = openPlotWidth(body);
    const fillMaxWidth =
      open !== undefined && getLayout().sidebarOpen && plotElement.clientWidth <= open
        ? undefined
        : open;
    const config = plotElement.config ?? {};
    if (config.fillPlot && config.fillMaxWidth === fillMaxWidth) return;
    plotElement.config = { ...config, fillPlot: true, fillMaxWidth };
  };
  sync();
  // The body's width and the sidebar's (a layout change): the cap changes with either.
  const observer = new ResizeObserver(sync);
  if (body) observer.observe(body);
  observer.observe(plotElement);
  const stopLayout = subscribeLayout(sync);
  const stopMode = subscribeLayoutMode(sync);
  return () => {
    observer.disconnect();
    stopLayout();
    stopMode();
  };
}
