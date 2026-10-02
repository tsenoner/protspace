import { TOUR_STORAGE_KEY } from '../../src/tour/storage-key';

/**
 * Seed for the product tour's "already seen" flag, shared by every Playwright
 * config that must not have the tour running over what it measures or asserts.
 *
 * Playwright hands each run a fresh profile, so the tour's localStorage guard is
 * always empty and the tour auto-starts on `data-loaded`. Nothing dismisses it,
 * so driver.js keeps a dimming overlay and an animated popover composited over
 * the canvas — which for the perf suite inflates the very numbers it exists to
 * produce (measured on 5K: clickPoint 28.35ms -> 7.00ms, zoomInOut 1.75ms ->
 * 1.17ms once suppressed).
 *
 * Lives here rather than inline in each config so the key and the origin it is
 * scoped to cannot drift apart: storage state is matched by origin, so a config
 * seeding the right key against the wrong origin silently seeds nothing. The key
 * itself comes from the app module that writes it, so it cannot drift either.
 */
export function tourCompletedStorageState(baseUrl: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseUrl).origin,
        localStorage: [{ name: TOUR_STORAGE_KEY, value: 'true' }],
      },
    ],
  };
}
