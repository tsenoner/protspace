/**
 * The explore page's theme (design decision 16): seeding the stored choice, reading the one on
 * <html>, and the colours the specs compare against. The key comes from the app's leaf module.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';
import { appBar } from './explore';

/** Dark --ps-surface (#0f172a, slate-900) as getComputedStyle reports it. */
export const DARK_SURFACE = 'rgb(15, 23, 42)';

/**
 * Stores `value` as the theme choice before any page script runs, JSON-encoded as the app writes
 * it. Only when the key is absent, so a reload keeps what the page itself stored since. Any
 * string is accepted, so a spec can store an invalid one.
 */
export async function seedTheme(page: Page, value: ThemeChoice | string): Promise<void> {
  await page.addInitScript(
    ({ key, stored }) => {
      try {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, stored);
      } catch {
        // about:blank and opaque origins have no storage.
      }
    },
    { key: THEME_STORAGE_KEY, stored: JSON.stringify(value) },
  );
}

/** `<html>`'s data-theme, or null when the page has none. */
export async function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

/** The app bar's Theme button (desktop and tablet; hidden on phones and in landscape). */
export const themeButton = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: 'Theme', exact: true });

/** Picks a theme from the app bar's Theme menu and waits for the menu to close. */
export async function chooseTheme(page: Page, label: 'System' | 'Light' | 'Dark'): Promise<void> {
  const menu = page.getByRole('menu', { name: 'Theme', exact: true });
  await themeButton(page).click();
  await expect(menu).toBeVisible();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(menu).toBeHidden();
}
