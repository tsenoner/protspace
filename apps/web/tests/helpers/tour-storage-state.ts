import type { BrowserContextOptions } from '@playwright/test';
import { LAYOUT_STORAGE_KEY, type LayoutState } from '../../src/explore/layout-defaults';
import { TOUR_STORAGE_KEY } from '../../src/tour/storage-key';
import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';

/**
 * Explore's local storage for a Playwright context: the product tour's "already seen" flag, and a
 * stored layout and theme when they are given.
 *
 * Playwright hands each run a fresh profile, so the tour's localStorage guard is always empty and
 * the tour auto-starts on `data-loaded`. Nothing dismisses it, so driver.js keeps a dimming overlay
 * and an animated popover composited over the canvas, which for the perf suite inflates the very
 * numbers it exists to produce (measured on 5K: clickPoint 28.35ms -> 7.00ms, zoomInOut 1.75ms ->
 * 1.17ms once suppressed). The perf suite also pins the layout: the sidebar's width sets the plot's
 * size, so an unpinned layout would make runs incomparable (design decision 4). It pins the
 * theme too, so a run never measures the dark plot or depends on the default theme.
 *
 * Lives here rather than inline in each config so the keys and the origin they are scoped to
 * cannot drift apart: storage state is matched by origin, so a config seeding the right key against
 * the wrong origin silently seeds nothing. The keys come from the app modules that own them.
 */
export function exploreStorageState(
  baseUrl: string,
  options: { layout?: LayoutState; theme?: ThemeChoice } = {},
): BrowserContextOptions['storageState'] {
  const localStorage = [{ name: TOUR_STORAGE_KEY, value: 'true' }];
  if (options.layout) {
    localStorage.push({ name: LAYOUT_STORAGE_KEY, value: JSON.stringify(options.layout) });
  }
  if (options.theme) {
    // JSON-encoded, as the theme store writes it through setStorageItem.
    localStorage.push({ name: THEME_STORAGE_KEY, value: JSON.stringify(options.theme) });
  }
  return { cookies: [], origins: [{ origin: new URL(baseUrl).origin, localStorage }] };
}

/** The tour already seen, and nothing else: what every e2e context starts with. */
export function tourCompletedStorageState(baseUrl: string): BrowserContextOptions['storageState'] {
  return exploreStorageState(baseUrl);
}
