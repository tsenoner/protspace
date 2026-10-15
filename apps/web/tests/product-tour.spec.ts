import { test, expect, type Page } from '@playwright/test';
import { TOUR_STORAGE_KEY } from '../src/tour/storage-key';
import { appBar, waitForExploreDataLoad } from './helpers/explore';
import { collapseSidebar } from './helpers/workbench';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expected tour step titles in order. */
const STEP_TITLES = [
  'Welcome to ProtSpace',
  'Import Your Data',
  'Projections & Annotations',
  'Search Proteins',
  'Selection Tools',
  'Export & Import',
  'Interactive Scatterplot',
  'Legend Panel',
  'Expand Hidden Categories',
  "You're All Set!",
];

const TOTAL_STEPS = STEP_TITLES.length;

/**
 * Where the highlighted element lives for each step: `null` for a centred popover with no element
 * highlighted, otherwise the element's `data-driver-id`. The check finds it through shadow roots,
 * so a step passes before and after its control moves out of the control bar.
 */
type StepTarget = null | { driverId: string };

const STEP_TARGETS: StepTarget[] = [
  null, // Welcome
  { driverId: 'import' }, // Import
  { driverId: 'projections' }, // Projections & Annotations
  { driverId: 'search' }, // Search
  { driverId: 'selection' }, // Select & Isolate
  { driverId: 'data-actions' }, // Export & Import
  { driverId: 'scatterplot' }, // Scatterplot
  { driverId: 'legend' }, // Legend
  { driverId: 'other-row' }, // Expand Hidden Categories
  null, // You're All Set!
];

/** Wait for the driver.js tour popover to appear. */
async function waitForTourPopover(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForSelector('.driver-popover', { state: 'visible', timeout });
}

/** Wait for the driver.js tour popover to disappear. */
async function waitForTourDismissed(page: Page, timeout = 5_000): Promise<void> {
  await page.waitForSelector('.driver-popover', { state: 'detached', timeout });
}

/** Get the currently visible popover title text. */
async function getPopoverTitle(page: Page): Promise<string> {
  return page
    .locator('.driver-popover .driver-popover-title')
    .textContent()
    .then((t) => t?.trim() ?? '');
}

/** Click the "Next" button in the driver.js popover. */
async function clickNext(page: Page): Promise<void> {
  await page.locator('.driver-popover-next-btn').click();
  // Small pause so driver.js can transition
  await page.waitForTimeout(400);
}

/** Click the "Back" / "Previous" button in the driver.js popover. */
async function clickPrev(page: Page): Promise<void> {
  await page.locator('.driver-popover-prev-btn').click();
  await page.waitForTimeout(400);
}

/**
 * Assert that the correct element is highlighted for the given step target. Playwright's CSS
 * locators pierce shadow roots, so one locator finds the target in a bar's light DOM or inside a
 * host's shadow root.
 */
async function assertHighlightedElement(page: Page, target: StepTarget): Promise<void> {
  if (target === null) {
    // Centred popover – no real element should be highlighted.
    // driver.js creates an invisible `#driver-dummy-element` for centred steps,
    // so we exclude it and verify no other element is active.
    const count = await page.locator('.driver-active-element:not(#driver-dummy-element)').count();
    expect(count).toBe(0);
    return;
  }

  await expect(page.locator(`[data-driver-id="${target.driverId}"]`)).toHaveClass(
    /(^|\s)driver-active-element(\s|$)/,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Product Tour', () => {
  test.beforeEach(async ({ page }) => {
    // This project's empty storage state lets the first navigation exercise
    // the real first-visit path without a preparatory localStorage mutation.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    // Wait for the tour to auto-start (there's an 800 ms delay after data-loaded)
    await waitForTourPopover(page);
  });

  // ── Basic lifecycle ─────────────────────────────────────────

  test('auto-starts on first visit', async ({ page }) => {
    const popover = page.locator('.driver-popover');
    await expect(popover).toBeVisible();

    const title = await getPopoverTitle(page);
    expect(title).toBe(STEP_TITLES[0]);
  });

  test('shows correct number of steps via progress text', async ({ page }) => {
    // driver.js renders progress text like "1 of 10"
    const progressText = await page.locator('.driver-popover-progress-text').textContent();
    expect(progressText).toContain(`${TOTAL_STEPS}`);
  });

  // ── Navigation forward ──────────────────────────────────────

  test('can navigate forward through all steps', async ({ page }) => {
    for (let i = 0; i < TOTAL_STEPS - 1; i++) {
      const title = await getPopoverTitle(page);
      expect(title).toBe(STEP_TITLES[i]);
      await clickNext(page);
    }

    // Last step
    const lastTitle = await getPopoverTitle(page);
    expect(lastTitle).toBe(STEP_TITLES[TOTAL_STEPS - 1]);
  });

  // ── Navigation backward ─────────────────────────────────────

  test('can navigate backward', async ({ page }) => {
    // Go forward to step 3 (Projections & Annotations)
    await clickNext(page);
    await clickNext(page);

    const thirdTitle = await getPopoverTitle(page);
    expect(thirdTitle).toBe(STEP_TITLES[2]);

    // Go back one step
    await clickPrev(page);
    const secondTitle = await getPopoverTitle(page);
    expect(secondTitle).toBe(STEP_TITLES[1]);
  });

  // ── Skip / dismiss ──────────────────────────────────────────

  test('can be skipped from first step', async ({ page }) => {
    // The first step has a custom "Skip" button
    const skipBtn = page.locator('.driver-tour-skip-btn');
    await expect(skipBtn).toBeVisible();
    await skipBtn.click();

    await waitForTourDismissed(page);
  });

  test('can be dismissed via close button', async ({ page }) => {
    // Move to step 2 so there's no skip button, then close
    await clickNext(page);
    await page.locator('.driver-popover-close-btn').click();

    await waitForTourDismissed(page);
  });

  // ── Finish button on last step ──────────────────────────────

  test('last step has a Finish button that closes the tour', async ({ page }) => {
    // Navigate to the last step
    for (let i = 0; i < TOTAL_STEPS - 1; i++) {
      await clickNext(page);
    }

    const lastTitle = await getPopoverTitle(page);
    expect(lastTitle).toBe(STEP_TITLES[TOTAL_STEPS - 1]);

    // The last step should have a "Finish" button (rendered as the next button)
    const finishBtn = page.locator('.driver-popover-next-btn');
    await expect(finishBtn).toBeVisible();
    await expect(finishBtn).toHaveText('Finish');

    // Click Finish and verify the tour closes
    await finishBtn.click();
    await waitForTourDismissed(page);
  });

  // ── localStorage gating ─────────────────────────────────────

  test('does not auto-start on subsequent visits', async ({ page }) => {
    // The tour is visible from beforeEach. Dismiss it.
    await page.locator('.driver-tour-skip-btn').click();
    await waitForTourDismissed(page);

    // Verify localStorage was set
    const storageValue = await page.evaluate((key) => localStorage.getItem(key), TOUR_STORAGE_KEY);
    expect(storageValue).toBe('true');

    // Navigate away and back
    await page.goto('/');
    await page.goto('/explore');
    await waitForExploreDataLoad(page);

    // A negative check needs a fixed wait: the tour auto-starts 800 ms after the first
    // `data-loaded`, and a tour that decides not to start leaves no signal to wait on.
    // 1500 ms covers the 800 ms timer with margin, measured from the load settling.
    await page.waitForTimeout(1500);

    // The tour should NOT have started
    const popover = page.locator('.driver-popover');
    await expect(popover).toHaveCount(0);
  });

  // ── Re-trigger from the help menu ───────────────────────────

  test('can be re-triggered from the help menu', async ({ page }) => {
    // Dismiss the auto-started tour first
    await page.locator('.driver-tour-skip-btn').click();
    await waitForTourDismissed(page);

    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    // The tour should restart
    await waitForTourPopover(page);
    const title = await getPopoverTitle(page);
    expect(title).toBe(STEP_TITLES[0]);
  });

  test('starting the tour opens a collapsed sidebar', async ({ page }) => {
    await page.locator('.driver-tour-skip-btn').click();
    await waitForTourDismissed(page);
    await collapseSidebar(page);

    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    // Its legend steps need the legend on screen.
    await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'open');
    await expect(page.locator('#myLegend')).toBeVisible();
  });

  test('the welcome step spotlights Help', async ({ page }) => {
    // Lifted above the tour's overlay while the welcome step shows, and put back after it.
    const helpHost = page.locator('[data-driver-id="help"]');
    await expect(helpHost).toHaveCSS('z-index', '100001');
    // Drawn above the overlay: Help is the topmost element at its own centre. driver.js turns off
    // pointer events on the page while a tour runs, and hit testing skips such elements, so Help
    // takes them back for the probe.
    const box = (await helpHost.boundingBox())!;
    expect(
      await page.evaluate(
        ({ x, y }) => {
          const host = document.querySelector<HTMLElement>('[data-driver-id="help"]')!;
          host.style.setProperty('pointer-events', 'auto', 'important');
          const top = document.elementFromPoint(x, y);
          host.style.removeProperty('pointer-events');
          return top?.closest('[data-driver-id="help"]') !== null;
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      ),
    ).toBe(true);
    await clickNext(page);
    await expect(helpHost).not.toHaveCSS('z-index', '100001');
  });

  test('Escape right after the tour starts leaves no spotlight on Help', async ({ page }) => {
    await page.locator('.driver-tour-skip-btn').click();
    await waitForTourDismissed(page);

    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    // Inside the welcome step's 400 ms highlight transition, when driver.js skips onDeselected.
    await page.locator('.driver-tour-skip-btn').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await waitForTourDismissed(page);

    await expect(page.locator('[data-driver-id="help"]')).not.toHaveAttribute('style', /z-index/);
    await expect(page.locator('[data-driver-id="help"] button')).toHaveCSS('box-shadow', 'none');
  });

  // ── Step highlights correct element ─────────────────────────

  test('each step highlights the correct element', async ({ page }) => {
    for (let i = 0; i < TOTAL_STEPS; i++) {
      await assertHighlightedElement(page, STEP_TARGETS[i]);

      // Move to next step (except on the last step)
      if (i < TOTAL_STEPS - 1) {
        await clickNext(page);
      }
    }
  });

  // ── Popover content matches expected titles ─────────────────

  test('popover content matches expected titles', async ({ page }) => {
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const title = await getPopoverTitle(page);
      expect(title).toBe(STEP_TITLES[i]);

      // Also verify the description is non-empty
      const description = await page
        .locator('.driver-popover .driver-popover-description')
        .textContent();
      expect(description?.trim().length).toBeGreaterThan(0);

      if (i < TOTAL_STEPS - 1) {
        await clickNext(page);
      }
    }
  });
});
