import { expect, test, type Page } from '@playwright/test';
import { appBar, openExplore, plotArea } from './helpers/explore';

/** The app bar's help menu (Task 2.4): documentation and the tour; and the Feedback menu. */

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

  test("Help no longer lists the keyboard shortcuts, which have the plot corner's button", async ({
    page,
  }) => {
    await openExplore(page);
    await help(page).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Documentation', 'Take the tour']);
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

test.describe('feedback menu', () => {
  const feedback = (page: Page) =>
    appBar(page).getByRole('button', { name: 'Feedback', exact: true });

  test('Feedback offers email, the address to copy, and a GitHub issue', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openExplore(page);
    await feedback(page).click();
    await expect(page.getByRole('menu', { name: 'Feedback' })).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Email hello@protspace.app',
      'Copy email address',
      'Open a GitHub issue',
    ]);

    await page.getByRole('menuitem', { name: 'Copy email address' }).click();
    await expect(page.getByText('Copied hello@protspace.app')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('hello@protspace.app');

    await context.route('https://github.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>issue</title>' }),
    );
    await feedback(page).click();
    const newPage = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Open a GitHub issue' }).click();
    const issue = await newPage;
    expect(issue.url()).toBe('https://github.com/tsenoner/protspace/issues/new');
    await issue.close();
  });

  test("Home's header offers the same Feedback menu, by keyboard too", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/privacy');
    const button = page.getByRole('banner').getByRole('button', { name: 'Feedback', exact: true });
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');

    await button.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Feedback' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Email hello@protspace.app',
      'Copy email address',
      'Open a GitHub issue',
    ]);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Copy email address' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await menu.getByRole('menuitem', { name: 'Copy email address' }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByText('Copied hello@protspace.app')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('hello@protspace.app');
  });
});
