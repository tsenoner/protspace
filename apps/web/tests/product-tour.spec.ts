import { test, expect, type Page } from '@playwright/test';
import { TOUR_STORAGE_KEY } from '../src/tour/storage-key';
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

/** Click a popover navigation button and wait for the step it leads to. */
async function goToStep(page: Page, button: 'next' | 'prev', stepIndex: number): Promise<void> {
  await page.locator(`.driver-popover-${button}-btn`).click();
  await expect(page.locator('.driver-popover .driver-popover-title')).toHaveText(
    STEP_TITLES[stepIndex],
  );
}

/**
 * Whether the step target carries driver.js's `driver-active-element` class.
 *
 * The check is positive — the target is active — rather than "the first active
 * element is the target": driver.js only strips the class from the element of
 * the last *finished* transition, so a Next click inside the 400 ms animation
 * (which a test makes and a person rarely does) leaves the previous light-DOM
 * target marked too until the tour ends.
 *
 * A centred step activates driver.js's invisible `#driver-dummy-element`, but the
 * walk's fast first step leaves that class on the reused dummy for the whole tour,
 * so a centred step must also show the popover placed "over" the dummy: driver.js
 * rebuilds the arrow's classes on every render and adds `-side-over` only for the
 * dummy. Shadow DOM targets are read through the host's shadow root, which
 * `document.querySelector` cannot pierce.
 */
async function isHighlighted(page: Page, target: StepTarget): Promise<boolean> {
  return page.evaluate((stepTarget) => {
    const isActive = (el: Element | null | undefined) =>
      el?.classList.contains('driver-active-element') ?? false;

    if (stepTarget === null) {
      return (
        isActive(document.getElementById('driver-dummy-element')) &&
        (document
          .querySelector('.driver-popover .driver-popover-arrow')
          ?.classList.contains('driver-popover-arrow-side-over') ??
          false)
      );
    }
    if ('driverId' in stepTarget) {
      return isActive(document.querySelector(`[data-driver-id="${stepTarget.driverId}"]`));
    }
    return isActive(
      document.querySelector(stepTarget.host)?.shadowRoot?.querySelector(stepTarget.shadow),
    );
  }, target);
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

  // ── One full walk ───────────────────────────────────────────

  test('auto-starts on first visit and walks every step to Finish', async ({ page }) => {
    const popover = page.locator('.driver-popover');
    const nextBtn = popover.locator('.driver-popover-next-btn');

    for (let i = 0; i < TOTAL_STEPS; i++) {
      await test.step(STEP_TITLES[i], async () => {
        await expect(popover.locator('.driver-popover-title')).toHaveText(STEP_TITLES[i]);
        await expect(popover.locator('.driver-popover-description')).toHaveText(/\S/);
        // driver.js renders the progress as "N of 10".
        await expect(popover.locator('.driver-popover-progress-text')).toHaveText(
          `${i + 1} of ${TOTAL_STEPS}`,
        );
        await expect
          .poll(() => isHighlighted(page, STEP_TARGETS[i]), {
            message: `step ${i + 1} highlights ${JSON.stringify(STEP_TARGETS[i])}`,
          })
          .toBe(true);
      });

      if (i < TOTAL_STEPS - 1) {
        await nextBtn.click();
      }
    }

    // The last step's next button is the "Finish" button, and it closes the tour.
    await expect(nextBtn).toHaveText('Finish');
    await nextBtn.click();
    await waitForTourDismissed(page);
  });

  // ── Navigation backward ─────────────────────────────────────

  test('can navigate backward', async ({ page }) => {
    // Go forward to step 3 (Projections & Annotations), then back one step.
    await goToStep(page, 'next', 1);
    await goToStep(page, 'next', 2);
    await goToStep(page, 'prev', 1);
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
    await goToStep(page, 'next', 1);
    await page.locator('.driver-popover-close-btn').click();

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
});
