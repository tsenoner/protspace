/**
 * The product tour's localStorage keys, and the choice between the full tour, What's new and no
 * tour (the Migration Plan).
 *
 * A leaf module on purpose. `product-tour.ts` imports `driver.js` and its CSS, so a Playwright
 * config cannot import from it; keeping the keys here lets the app that writes them and the
 * harness helper that seeds them share one definition instead of two literals that drift silently
 * — a stale copy in the harness means the tour runs over the measured window with nothing failing.
 */

/** Which tour a visitor was shown: the full tour or the short "What's new" tour. */
export type TourKind = 'full' | 'whats-new';

/** Holds the kind shown, as the bare string (not JSON), written when a tour starts. */
export const TOUR_STORAGE_KEY = 'protspace:tour:v2';

/**
 * The pre-workbench tour's key, `'true'` once seen. Read to spot a returning visitor; never written
 * or removed, so a rollback of this release does not replay the old tour to everyone.
 */
export const LEGACY_TOUR_STORAGE_KEY = 'driver.overviewTour';

/**
 * The tour this visit gets: none once a tour was recorded, What's new for a visitor who saw the old
 * tour, else the full tour. A `read` that throws (blocked storage) must be caught by the caller and
 * means no tour, or the tour would replay on every visit.
 */
export function chooseTour(read: (key: string) => string | null): TourKind | null {
  if (read(TOUR_STORAGE_KEY) !== null) return null;
  return read(LEGACY_TOUR_STORAGE_KEY) === 'true' ? 'whats-new' : 'full';
}
