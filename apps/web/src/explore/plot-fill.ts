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
 * Keeps the plot's config in step with the view bar's Fill switch (design decision 10). A filled
 * plot is at most as wide as beside the open sidebar, so collapsing the desktop sidebar centres it
 * in the freed area instead of stretching it; while the sidebar is open the cap is the plot's own
 * width and changes nothing. The plot and its exports read both from the config.
 */
export function bindPlotFill(plotElement: ProtspaceScatterplot): () => void {
  const body = plotElement.closest<HTMLElement>('[data-workbench="body"]');
  const sync = () => {
    const fillPlot = getLayout().plotFill;
    const fillMaxWidth = openPlotWidth(body);
    const config = plotElement.config ?? {};
    if ((config.fillPlot ?? false) === fillPlot && config.fillMaxWidth === fillMaxWidth) return;
    plotElement.config = { ...config, fillPlot, fillMaxWidth };
  };
  sync();
  // The body's width and the sidebar's: the plot's box changes with either.
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
