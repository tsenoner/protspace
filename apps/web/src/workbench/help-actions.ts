import { DOCS_URL } from '@/config';

/**
 * What the app bar's Help menu and the More sheet's Help & shortcuts both do (design decisions 1
 * and 17). Call each inside the user's click or key press: the browser allows the new tab then.
 */

/** Opens the documentation in a new tab. */
export function openDocumentation(): void {
  window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
}

/** Starts the full product tour from its first step; its code loads on first use. */
export function startTour(): void {
  void import('../tour/product-tour').then((tour) => tour.startTour('full', { force: true }));
}
