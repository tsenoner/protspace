/**
 * The explore page's theme choice (design decision 16): its storage key, its values and its
 * default. A leaf module with no imports, so the Playwright helpers can import it as well.
 * index.html's boot script repeats the key, the values and the default, because it runs before
 * any module; theme-boot.test.ts pins them to these.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Its own key, never a field of the layout: JSON-encoded through @protspace/utils storage. */
export const THEME_STORAGE_KEY = 'protspace:theme';

/** In the order the switch offers them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/**
 * The choice with nothing (or nothing valid) stored. Light while the phase's surfaces turn dark;
 * Task 6.13 flips it to 'system', together with the boot script's literal in index.html.
 */
export const DEFAULT_THEME: ThemeChoice = 'light';
