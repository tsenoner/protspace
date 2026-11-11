/**
 * The site's theme choice (design decision 16): its storage, its values and the rule a press
 * follows. Pure functions only, so the Playwright helpers can import it as well. The key is
 * shared with the docs (config/theme.ts); index.html's boot script repeats it, and
 * theme-boot.test.ts pins the two.
 */
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '../../../../config/theme';

export { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY };

/** What the page follows: the system, or an override. Written as is to <html data-theme>. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** What the page shows. */
export type ThemeMode = 'light' | 'dark';

/** The choice with nothing (or nothing valid) stored: follow the OS. */
export const DEFAULT_THEME: ThemeChoice = 'system';

export const THEME_MODE_LABELS: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark' };

/** The choice a stored raw value means: 'dark' or 'light', else (VueUse's 'auto', nothing) the system. */
export function parseStoredTheme(raw: string | null): ThemeChoice {
  return raw === 'dark' || raw === 'light' ? raw : DEFAULT_THEME;
}

/** What to store for a choice: null (remove the key) to follow the system. */
export function storedTheme(choice: ThemeChoice): string | null {
  return choice === 'system' ? null : choice;
}

/** The mode a choice shows while the OS is dark (`osDark`) or light. */
export function resolveTheme(choice: ThemeChoice, osDark: boolean): ThemeMode {
  if (choice !== 'system') return choice;
  return osDark ? 'dark' : 'light';
}

const other = (mode: ThemeMode): ThemeMode => (mode === 'dark' ? 'light' : 'dark');

/**
 * The choice that shows `mode`: an override, unless the OS already shows it, when the page goes
 * back to following the system (VitePress's and VueUse's useDark rule).
 */
export function chooseMode(mode: ThemeMode, osDark: boolean): ThemeChoice {
  return mode === (osDark ? 'dark' : 'light') ? 'system' : mode;
}

/** A press of the theme button: the other mode, by chooseMode's rule. */
export function toggleTheme(choice: ThemeChoice, osDark: boolean): ThemeChoice {
  return chooseMode(other(resolveTheme(choice, osDark)), osDark);
}

/** The theme button's name and tooltip: the mode shown, then what a press does. */
export function themeButtonLabel(mode: ThemeMode): string {
  return `Theme: ${THEME_MODE_LABELS[mode]}. Switch to ${THEME_MODE_LABELS[other(mode)]}`;
}
