import type { ProtspaceScatterplot } from '@protspace/core';
import { hasStructureSheet, type LayoutModeSource } from './layout-mode';

/** The plot's own fade of unselected points (core's DEFAULT_CONFIG.fadedOpacity). */
const PLOT_FADED_OPACITY = 0.15;
/**
 * A phone's: the mockup's tapped protein leaves the rest at about a quarter, so the clusters
 * around it stay readable on the small plot.
 */
const PHONE_FADED_OPACITY = 0.25;

/** Keeps the plot's fade of unselected points on the phone's while the layout is a phone's. */
export function bindPhoneDim(
  plot: Pick<ProtspaceScatterplot, 'config'>,
  layoutMode: LayoutModeSource,
): () => void {
  const update = () => {
    const fadedOpacity = hasStructureSheet(layoutMode.get())
      ? PHONE_FADED_OPACITY
      : PLOT_FADED_OPACITY;
    if ((plot.config?.fadedOpacity ?? PLOT_FADED_OPACITY) === fadedOpacity) return;
    plot.config = { ...(plot.config ?? {}), fadedOpacity };
  };
  update();
  return layoutMode.subscribe(update);
}
