/**
 * The site's theme (design decision 16): seeding the stored choice, reading the one on <html>,
 * and the colours the specs compare against. The key comes from the app's leaf module.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  storedTheme,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  type ThemeMode,
} from '../../src/explore/theme-defaults';
import { appBar } from './explore';

/** Dark --ps-surface (#0f172a, slate-900) as getComputedStyle reports it. */
export const DARK_SURFACE = 'rgb(15, 23, 42)';

/**
 * Stores `value` as the theme choice before any page script runs, raw as the app and the docs
 * write it ('system' stores nothing). Only when the key is absent, so a reload keeps what the page
 * itself stored since. Any other string is stored as is, so a spec can store an invalid one.
 */
export async function seedTheme(page: Page, value: ThemeChoice | string): Promise<void> {
  const stored =
    value === 'system' || value === 'light' || value === 'dark' ? storedTheme(value) : value;
  if (stored === null) return;
  await page.addInitScript(
    ({ key, stored }) => {
      try {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, stored);
      } catch {
        // about:blank and opaque origins have no storage.
      }
    },
    { key: THEME_STORAGE_KEY, stored },
  );
}

/** `<html>`'s data-theme, or null when the page has none. */
export async function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

/** The mode the page shows: its data-theme, with System resolved against the OS. */
export async function shownTheme(page: Page): Promise<ThemeMode> {
  return page.evaluate(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark' || theme === 'light') return theme;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
}

/**
 * The app bar's Theme button (desktop and tablet; hidden on phones and in landscape). Its name
 * says the mode shown and what a press does, "Theme: Light. Switch to Dark".
 */
export const themeButton = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: /^Theme: / });

/**
 * Presses the app bar's Theme button if the page does not show `label` yet (one press flips the
 * mode), and checks the button names it.
 */
export async function chooseTheme(page: Page, label: 'Light' | 'Dark'): Promise<void> {
  const mode = label.toLowerCase();
  if ((await shownTheme(page)) !== mode) await themeButton(page).click();
  expect(await shownTheme(page)).toBe(mode);
  await expect(themeButton(page)).toHaveAccessibleName(new RegExp(`^Theme: ${label}\\.`));
}
