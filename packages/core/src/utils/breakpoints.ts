/**
 * The app's layout breakpoints (design decision 17), for shadow-DOM styles, which cannot see the
 * workbench's data-layout attribute. apps/web/src/explore/layout-defaults.ts keeps its own copy as
 * a leaf module; its layout-defaults.test.ts keeps the two equal. Use a query in a `css` block as
 * `@media ${unsafeCSS(PHONE_MEDIA)} { … }`. Not under styles/: every export there must be a
 * stylesheet.
 */

/** The widest window that gets the phone layout. */
export const PHONE_MAX_WIDTH = 640;
/** The narrowest window that gets the desktop workbench. */
export const DESKTOP_MIN_WIDTH = 951;
/** The tallest landscape window that gets the landscape phone layout. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;

/** A phone held upright: the app's `phone` layout. */
export const PHONE_MEDIA = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/** A phone on its side: the app's `landscape` layout. */
export const LANDSCAPE_PHONE_MEDIA = `(orientation: landscape) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px) and (max-width: ${DESKTOP_MIN_WIDTH - 1}px)`;

/** A phone either way up: the app's `phone` or `landscape` layout. */
export const COMPACT_MEDIA = `${PHONE_MEDIA}, ${LANDSCAPE_PHONE_MEDIA}`;
