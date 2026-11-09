/**
 * The explore page's theme choice (design decision 16): its storage key, its values and its
 * default. A leaf module with no imports, so the Playwright helpers can import it as well.
 * index.html's boot script repeats the key, the values and the default, because it runs before
 * any module; theme-boot.test.ts pins them to these.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Its own key, never a field of the layout: JSON-encoded through @protspace/utils storage. */
export const THEME_STORAGE_KEY = 'protspace:theme';

/**
 * In the order the switch offers them: the app bar's button steps through them (design decision
 * 16, as the Nov 4 review chose: start on System, then Dark, then Light), and the More sheet's
 * segments list them so.
 */
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'dark', 'light'];

/** The choice after `choice` in THEME_CHOICES, from the last back to the first. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
}

/** What the switch calls each choice: the app bar button's name and the More sheet's segments. */
export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** The choice with nothing (or nothing valid) stored: follow the OS (design decision 16). */
export const DEFAULT_THEME: ThemeChoice = 'system';

/**
 * The theme button's name and tooltip: the choice it shows, then what a press does, e.g.
 * "Theme: System. Switch to Dark". On a dark OS a press from System to Dark changes nothing on
 * screen, so the name says which mode is on.
 */
export function themeButtonLabel(choice: ThemeChoice): string {
  return `Theme: ${THEME_LABELS[choice]}. Switch to ${THEME_LABELS[nextTheme(choice)]}`;
}
