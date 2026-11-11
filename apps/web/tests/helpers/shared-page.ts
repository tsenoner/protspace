/**
 * One loaded page shared by the read-only tests of a describe block, so a block of N such tests
 * pays for one Explore load instead of N.
 *
 * Only for tests that look and put back what they open: no imports or dataset swaps, no selection,
 * filter, annotation or theme change, no URL state, no viewport change. Whatever a test opens
 * (a menu, a popover, a dialog, a sheet) it closes again, by Escape or by its own `close` step;
 * after each test the page is checked to be back where it started, and a test that leaves it
 * changed fails there rather than misleading the next one.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

/** Anything a test may have opened over the workbench: menus, popovers, dialogs, sheets, tours. */
const OPEN_OVERLAYS = [
  'dialog[open]',
  '[popover]:popover-open',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  'ps-popover[open]',
  '.driver-popover',
  '.driver-overlay',
].join(', ');

const openOverlays = (page: Page): Locator => page.locator(OPEN_OVERLAYS).locator('visible=true');

/**
 * Loads `open` once for the block's tests, in a context with the same options as the built-in
 * `page` fixture (the project's `use` and the block's `test.use`), and returns a getter for it.
 * Call it at the top of a `test.describe`.
 *
 * The block runs in order on one worker (`mode: 'default'`). A failed test discards that worker,
 * and the tests after it continue on a fresh worker with a fresh page, so one failure neither
 * skips nor taints the rest; a retry re-runs only the failed test, on a fresh page too.
 */
export function useSharedPage(open: (page: Page) => Promise<void>): () => Page {
  test.describe.configure({ mode: 'default' });

  let page: Page | undefined;
  let url = '';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await open(page);
    url = page.url();
  });

  test.afterEach(async () => {
    if (!page) return;
    // Escape closes the top overlay; a nested one (a menu over a panel) takes another press.
    for (let press = 0; press < 4 && (await openOverlays(page).count()) > 0; press++) {
      await page.keyboard.press('Escape');
    }
    await expect(openOverlays(page), 'the test closed everything it opened').toHaveCount(0);
    expect(page.url(), 'the test changed no URL state').toBe(url);
    // A fresh page has nothing focused or hovered: put the pointer and the focus back there.
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  return () => {
    if (!page) throw new Error('useSharedPage: the shared page is not loaded yet');
    return page;
  };
}
