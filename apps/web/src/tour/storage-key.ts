/**
 * localStorage key recording that the overview tour has already been seen.
 *
 * A leaf module on purpose. `product-tour.ts` imports `driver.js` and its CSS,
 * so a Playwright config cannot import from it; keeping the key here lets the
 * app that writes it and the harness helper that seeds it share one definition
 * instead of two literals that drift silently — a stale copy in the harness
 * means the tour runs over the measured window with nothing failing.
 */
export const TOUR_STORAGE_KEY = 'driver.overviewTour';
