import { expect, test, type Page } from '@playwright/test';
import { appBar, openExplore, plotArea } from './helpers/explore';

/** The app bar's help menu (Task 2.4): documentation, keyboard shortcuts and the tour. */

const help = (page: Page) => appBar(page).getByRole('button', { name: 'Help', exact: true });

test.describe('help menu', () => {
  test('Help opens a keyboard-navigable menu and Escape returns focus to Help', async ({
    page,
  }) => {
    await openExplore(page);
    await help(page).focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: 'Help' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Documentation' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Take the tour' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(help(page)).toBeFocused();
  });

  test('Documentation opens the docs in a new tab', async ({ page, context }) => {
    // No docs server runs during e2e: answer the docs URL here.
    await context.route(/\/docs\/$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>ProtSpace docs</title>',
      }),
    );
    await openExplore(page);
    await help(page).click();

    const newPage = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Documentation' }).click();
    const docs = await newPage;
    await docs.waitForLoadState();
    expect(new URL(docs.url()).pathname).toBe('/docs/');
    // noopener: the docs tab cannot reach back into the explore page.
    expect(await docs.evaluate(() => window.opener)).toBeNull();
    await docs.close();
  });

  test('Keyboard shortcuts opens a dialog listing the search shortcut; Escape closes it and returns focus to Help', async ({
    page,
  }) => {
    await openExplore(page);
    await help(page).click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    // The list is the dialog's slotted content, so it is found through the ps-dialog host.
    const shortcuts = page.locator('ps-dialog', { has: dialog });
    await expect(shortcuts.getByRole('heading', { name: 'Search' })).toBeVisible();
    await expect(shortcuts.getByText('Focus the search box')).toBeVisible();
    await expect(shortcuts.getByText(/^(⌘K|Ctrl\+K)$/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(help(page)).toBeFocused();
  });

  test('Take the tour starts the tour', async ({ page }) => {
    await openExplore(page);
    await help(page).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    await expect(page.locator('.driver-popover')).toBeVisible();
    await expect(page.locator('.driver-popover .driver-popover-title')).toHaveText(
      'Welcome to ProtSpace',
    );
    await expect(page.getByRole('menu', { name: 'Help' })).toBeHidden();
  });

  test('the plot has no tips button', async ({ page }) => {
    await openExplore(page);
    await expect(page.locator('protspace-tips')).toHaveCount(0);
    await expect(plotArea(page).getByRole('button', { name: 'Tips & shortcuts' })).toHaveCount(0);
  });
});
