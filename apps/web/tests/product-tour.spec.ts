import { test, expect, type Page } from '@playwright/test';
import { waitForExploreDataLoad } from './helpers/explore';

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
  'Filter, Export & Import',
  'Interactive Scatterplot',
  'Legend Panel',
  'Expand Hidden Categories',
  "You're All Set!",
];

const TOTAL_STEPS = STEP_TITLES.length;

/**
 * Describes where the highlighted element lives for each step.
 *
 * - `null`                          – centred popover, no element highlighted.
 * - `{ driverId: '…' }`            – regular DOM element with a `data-driver-id` attribute.
 * - `{ shadow: '…', host: '…' }`   – element inside a host's Shadow DOM,
 *                                     matched by the given CSS selector.
 */
type StepTarget = null | { driverId: string } | { shadow: string; host: string };

const STEP_TARGETS: StepTarget[] = [
  null, // Welcome
  { shadow: '[data-driver-id="import"]', host: '[data-driver-id="control-bar"]' }, // Import
  { shadow: '[data-driver-id="projections"]', host: '[data-driver-id="control-bar"]' }, // Projections & Annotations
  { shadow: '[data-driver-id="search"]', host: '[data-driver-id="control-bar"]' }, // Search
  { shadow: '[data-driver-id="selection"]', host: '[data-driver-id="control-bar"]' }, // Select & Isolate
  { shadow: '[data-driver-id="data-actions"]', host: '[data-driver-id="control-bar"]' }, // Filter & Export
  { driverId: 'scatterplot' }, // Scatterplot
  { driverId: 'legend' }, // Legend
  { shadow: '[data-driver-id="other-row"]', host: '[data-driver-id="legend"]' }, // Expand Hidden Categories
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
 * Assert that the correct element is highlighted for the given step target.
 *
 * For regular DOM elements we check `document.querySelector('.driver-active-element')`.
 * For Shadow DOM elements `document.querySelectorAll` cannot pierce the shadow
 * boundary, so we query the host's shadow root directly.
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

  if ('driverId' in target) {
    const highlightedId = await page.evaluate(() => {
      const active = document.querySelector('.driver-active-element');
      return active?.getAttribute('data-driver-id') ?? null;
    });
    expect(highlightedId).toBe(target.driverId);
    return;
  }

  // Shadow DOM element
  const hasShadowHighlight = await page.evaluate(
    ({ shadowSelector, hostSelector }) => {
      const host = document.querySelector(hostSelector);
      const el = host?.shadowRoot?.querySelector(shadowSelector);
      return el?.classList.contains('driver-active-element') ?? false;
    },
    { shadowSelector: target.shadow, hostSelector: target.host },
  );
  expect(hasShadowHighlight).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Product Tour', () => {
  test.beforeEach(async ({ page }) => {
    // Clear the localStorage key so the tour always auto-starts
    await page.goto('/explore');
    await page.evaluate(() => localStorage.removeItem('driver.overviewTour'));
    // Navigate again so the page initialises with a clean slate
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
    const storageValue = await page.evaluate(() => localStorage.getItem('driver.overviewTour'));
    expect(storageValue).toBe('true');

    // Navigate away and back
    await page.goto('/');
    await page.goto('/explore');
    await waitForExploreDataLoad(page);

    // Give the auto-start delay time to fire (800 ms + buffer)
    await page.waitForTimeout(1500);

    // The tour should NOT have started
    const popover = page.locator('.driver-popover');
    await expect(popover).toHaveCount(0);
  });

  // ── Re-trigger from tips popover ────────────────────────────

  test('can be re-triggered from tips popover', async ({ page }) => {
    // Dismiss the auto-started tour first
    await page.locator('.driver-tour-skip-btn').click();
    await waitForTourDismissed(page);

    // Hover over the tips button inside the scatterplot to open the popover.
    // The tips button is inside the scatterplot's Shadow DOM, so we need
    // to use evaluate to trigger hover/click.
    await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as any;
      if (!plot?.shadowRoot) return;

      const tips = plot.shadowRoot.querySelector('protspace-tips') as any;
      if (!tips?.shadowRoot) return;

      const trigger = tips.shadowRoot.querySelector('.trigger') as HTMLElement;
      trigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });

    // Wait for the tips popover to become visible (inside Shadow DOM)
    await page.waitForTimeout(300);

    // Click the "Take a Tour" button
    await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as any;
      if (!plot?.shadowRoot) return;

      const tips = plot.shadowRoot.querySelector('protspace-tips') as any;
      if (!tips?.shadowRoot) return;

      const tourBtn = tips.shadowRoot.querySelector('.tour-button') as HTMLElement;
      tourBtn?.click();
    });

    // The tour should restart
    await waitForTourPopover(page);
    const title = await getPopoverTitle(page);
    expect(title).toBe(STEP_TITLES[0]);
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
