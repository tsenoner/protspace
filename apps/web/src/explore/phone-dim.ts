import type { ProtspaceScatterplot } from '@protspace/core';
import { hasStructureSheet, type LayoutModeSource } from './layout-mode';
import { getTheme, subscribeTheme } from './theme-state';

/** The plot's own fade of unselected points (core's DEFAULT_CONFIG.fadedOpacity). */
const PLOT_FADED_OPACITY = 0.15;
/**
 * A phone's: the mockup's tapped protein leaves the rest at about a quarter, so the clusters
 * around it stay readable on the small plot.
 */
const PHONE_FADED_OPACITY = 0.25;

/** A yes/no that can change, with its changes: whether the page is a touch screen in dark. */
type FlagSource = {
  get(): boolean;
  subscribe(listener: () => void): () => void;
};

/**
 * True while the pointer is coarse and the page is dark (the Dark choice, or System on a dark
 * OS). A tap selects on touch, and on the dark background the plot's own fade leaves the rest of
 * the plot almost invisible around the selection.
 */
export function touchDarkSource(): FlagSource {
  const coarse = matchMedia('(pointer: coarse)');
  const darkOs = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => {
    const theme = getTheme();
    return theme === 'dark' || (theme === 'system' && darkOs.matches);
  };
  return {
    get: () => coarse.matches && isDark(),
    subscribe(listener) {
      coarse.addEventListener('change', listener);
      darkOs.addEventListener('change', listener);
      const stopTheme = subscribeTheme(listener);
      return () => {
        coarse.removeEventListener('change', listener);
        darkOs.removeEventListener('change', listener);
        stopTheme();
      };
    },
  };
}

/**
 * Keeps the plot's fade of unselected points on the phone's while the layout is a phone's, or
 * while a touch screen is dark; elsewhere the plot's own fade.
 */
export function bindPhoneDim(
  plot: Pick<ProtspaceScatterplot, 'config'>,
  layoutMode: LayoutModeSource,
  touchDark: FlagSource,
): () => void {
  const update = () => {
    const fadedOpacity =
      hasStructureSheet(layoutMode.get()) || touchDark.get()
        ? PHONE_FADED_OPACITY
        : PLOT_FADED_OPACITY;
    if ((plot.config?.fadedOpacity ?? PLOT_FADED_OPACITY) === fadedOpacity) return;
    plot.config = { ...(plot.config ?? {}), fadedOpacity };
  };
  update();
  const stopMode = layoutMode.subscribe(update);
  const stopTouchDark = touchDark.subscribe(update);
  return () => {
    stopMode();
    stopTouchDark();
  };
}
