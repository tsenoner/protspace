import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEGACY_TOUR_STORAGE_KEY, TOUR_STORAGE_KEY } from '../src/tour/storage-key';
import {
  appBar,
  getSelectedProteinIds,
  openFilter,
  waitForExploreDataLoad,
} from './helpers/explore';
import { box } from './helpers/mobile';
import { seedTourSeen } from './helpers/tour-storage-state';
import {
  clickProteinNearPlotCentre,
  collapseSidebar,
  stubStructureRequests,
} from './helpers/workbench';

/**
 * The product tour on a 1280×720 desktop and an 800×1000 tablet (project `product-tour`, empty
 * storage, so the first visit starts it). The phone tours are mobile-bars.spec.ts's.
 */

type Step = { title: string; target: string | null };

/** The full desktop tour: each step's title and the data-driver-id it highlights (null: centred). */
const FULL: readonly Step[] = [
  { title: 'Welcome to ProtSpace', target: null },
  { title: 'Import & Export', target: 'data-actions' },
  { title: 'The View Bar', target: 'view-bar' },
  { title: 'Search Proteins', target: 'search' },
  { title: 'Interactive Scatterplot', target: 'scatterplot' },
  { title: 'Selection Tools', target: 'selection' },
  { title: 'Legend Panel', target: 'legend' },
  { title: 'Expand Hidden Categories', target: 'other-row' },
  { title: 'The Sidebar', target: 'rail' },
  { title: 'Light or Dark', target: 'theme' },
  { title: "You're All Set!", target: null },
];

const WHATS_NEW: readonly Step[] = [
  { title: "What's new in ProtSpace", target: null },
  { title: 'The View Bar', target: 'view-bar' },
  { title: 'The Sidebar', target: 'rail' },
  { title: 'Selection Tools', target: 'selection' },
  { title: 'Light or Dark', target: 'theme' },
  { title: "That's it", target: null },
];

const popover = (page: Page): Locator => page.locator('.driver-popover');
const title = (page: Page): Locator => popover(page).locator('.driver-popover-title');
const progress = (page: Page): Locator => popover(page).locator('.driver-popover-progress-text');
const nextButton = (page: Page): Locator => popover(page).locator('.driver-popover-next-btn');

/** Opens Explore and waits for the tour, which starts 800 ms after the first load. */
async function openWithTour(page: Page): Promise<void> {
  await stubStructureRequests(page);
  await page.goto('/explore');
  await waitForExploreDataLoad(page);
  await expect(popover(page)).toBeVisible({ timeout: 10_000 });
}

async function next(page: Page, expected: string): Promise<void> {
  await nextButton(page).click();
  await expect(title(page)).toHaveText(expected);
}

async function expectHighlighted(page: Page, target: string | null): Promise<void> {
  if (target === null) {
    // A centred step anchors to driver.js's own #driver-dummy-element; nothing else is lit.
    await expect(page.locator('.driver-active-element:not(#driver-dummy-element)')).toHaveCount(0);
    return;
  }
  // CSS locators pierce shadow roots, so this finds the Other row inside the legend too.
  await expect(page.locator(`[data-driver-id="${target}"]`)).toHaveClass(
    /(^|\s)driver-active-element(\s|$)/,
  );
}

/** From the first step to the last, checking each title and highlight; stays on the last. */
async function walk(page: Page, steps: readonly Step[]): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    await expect(title(page)).toHaveText(steps[i].title);
    await expectHighlighted(page, steps[i].target);
    if (i < steps.length - 1) await next(page, steps[i + 1].title);
  }
}

async function skip(page: Page): Promise<void> {
  await popover(page).locator('.driver-tour-skip-btn').click();
  await expect(popover(page)).toHaveCount(0);
}

async function takeTheTour(page: Page): Promise<void> {
  await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  await expect(popover(page)).toBeVisible();
}

const storedTour = (page: Page): Promise<string | null> =>
  page.evaluate((key) => localStorage.getItem(key), TOUR_STORAGE_KEY);

/**
 * A tour that stays off leaves no signal: watch for its popover for 2 s after the load, which
 * covers the 800 ms start delay and the lazy load of the tour's code.
 */
async function expectNoTourStarts(page: Page): Promise<void> {
  const started = await popover(page)
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(
      () => true,
      () => false,
    );
  expect(started, 'a tour started').toBe(false);
}

/** The pre-workbench tour seen: what a returning visitor's browser holds. */
async function seedLegacyTourSeen(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, 'true');
    } catch {
      // about:blank has no storage.
    }
  }, LEGACY_TOUR_STORAGE_KEY);
}

test.describe('Product Tour', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTour(page);
  });

  test('auto-starts on the first visit with the full tour', async ({ page }) => {
    await expect(title(page)).toHaveText('Welcome to ProtSpace');
    await expect(progress(page)).toHaveText(`1 of ${FULL.length}`);
    await expect(popover(page).locator('.driver-tour-full-btn')).toHaveCount(0);
  });

  test('walks forward through every desktop step, each on its control', async ({ page }) => {
    await walk(page, FULL);
  });

  test('goes back a step', async ({ page }) => {
    await next(page, FULL[1].title);
    await next(page, FULL[2].title);
    await popover(page).locator('.driver-popover-prev-btn').click();
    await expect(title(page)).toHaveText(FULL[1].title);
  });

  test('Skip on the first step ends it', async ({ page }) => {
    await skip(page);
  });

  test('the close button ends it', async ({ page }) => {
    await next(page, FULL[1].title);
    await popover(page).locator('.driver-popover-close-btn').click();
    await expect(popover(page)).toHaveCount(0);
  });

  test('Finish on the last step ends it', async ({ page }) => {
    await walk(page, FULL);
    await expect(nextButton(page)).toHaveText('Finish');
    await nextButton(page).click();
    await expect(popover(page)).toHaveCount(0);
  });

  test('records the full tour and does not start again', async ({ page }) => {
    await skip(page);
    expect(await storedTour(page)).toBe('full');

    await page.goto('/');
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });

  test('Help → Take the tour starts it again', async ({ page }) => {
    await skip(page);
    await takeTheTour(page);
    await expect(title(page)).toHaveText('Welcome to ProtSpace');
    await expect(progress(page)).toHaveText(`1 of ${FULL.length}`);
  });

  test('starting the tour opens a collapsed sidebar', async ({ page }) => {
    await skip(page);
    await collapseSidebar(page);

    await takeTheTour(page);

    // Its legend steps need the legend on screen.
    await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'open');
    await expect(page.locator('#myLegend')).toBeVisible();
  });

  test('with the Filter panel open, Take the tour shows the legend', async ({ page }) => {
    await skip(page);
    await openFilter(page);
    await expect(page.locator('#myLegend')).toBeHidden();

    await takeTheTour(page);

    await expect(page.locator('#myLegend')).toBeVisible();
    for (const step of FULL.slice(1, 7)) await next(page, step.title);
    await expectHighlighted(page, 'legend');
  });

  test('the welcome step spotlights Help', async ({ page }) => {
    // Lifted above the tour's overlay while the welcome step shows, and put back after it.
    const helpHost = page.locator('[data-driver-id="help"]');
    await expect(helpHost).toHaveCSS('z-index', '100001');
    // Drawn above the overlay: Help is the topmost element at its own centre. driver.js turns off
    // pointer events on the page while a tour runs, and hit testing skips such elements, so Help
    // takes them back for the probe.
    const helpBox = (await helpHost.boundingBox())!;
    expect(
      await page.evaluate(
        ({ x, y }) => {
          const host = document.querySelector<HTMLElement>('[data-driver-id="help"]')!;
          host.style.setProperty('pointer-events', 'auto', 'important');
          const top = document.elementFromPoint(x, y);
          host.style.removeProperty('pointer-events');
          return top?.closest('[data-driver-id="help"]') !== null;
        },
        { x: helpBox.x + helpBox.width / 2, y: helpBox.y + helpBox.height / 2 },
      ),
    ).toBe(true);
    await next(page, FULL[1].title);
    await expect(helpHost).not.toHaveCSS('z-index', '100001');
  });

  test('Escape right after the tour starts leaves no spotlight on Help', async ({ page }) => {
    await skip(page);

    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    // Inside the welcome step's 400 ms highlight transition, when driver.js skips onDeselected.
    await page.locator('.driver-tour-skip-btn').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);

    await expect(page.locator('[data-driver-id="help"]')).not.toHaveAttribute('style', /z-index/);
    await expect(page.locator('[data-driver-id="help"] button')).toHaveCSS('box-shadow', 'none');
  });

  test('Escape during a tour started from Help keeps the selection', async ({ page }) => {
    await skip(page);
    const id = await clickProteinNearPlotCentre(page);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    await takeTheTour(page);
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);

    // The tour was the top layer: that Escape closed it and reached nothing else.
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });
});

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the tour does not animate', async ({ page }) => {
    await openWithTour(page);
    const body = page.locator('body');
    await expect(body).toHaveClass(/(^|\s)driver-simple(\s|$)/);
    await expect(body).not.toHaveClass(/(^|\s)driver-fade(\s|$)/);
  });
});

test.describe('on a tablet', () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test('every step points at a control on screen, with no Sidebar step', async ({ page }) => {
    await openWithTour(page);
    const expected = FULL.map((step) => step.title).filter((name) => name !== 'The Sidebar');
    await expect(progress(page)).toHaveText(`1 of ${expected.length}`);

    const titles: string[] = [];
    for (let i = 0; i < expected.length + 2; i++) {
      const current = ((await title(page).textContent()) ?? '').trim();
      titles.push(current);
      const lit = page.locator('.driver-active-element:not(#driver-dummy-element)');
      if ((await lit.count()) > 0) {
        const target = await box(lit.first());
        expect(target.width, `step "${current}" highlights a shown control`).toBeGreaterThan(0);
        expect(target.height).toBeGreaterThan(0);
      }
      if (((await nextButton(page).textContent()) ?? '').trim() === 'Finish') break;
      await nextButton(page).click();
      await expect(title(page)).not.toHaveText(current);
    }
    expect(titles).toEqual(expected);
  });
});

test.describe("What's new", () => {
  test.beforeEach(async ({ page }) => {
    await seedLegacyTourSeen(page);
    await openWithTour(page);
  });

  test('a returning visitor gets it once, each step on its control', async ({ page }) => {
    await expect(popover(page).locator('.driver-tour-skip-btn')).toBeVisible();
    await expect(popover(page).locator('.driver-tour-full-btn')).toHaveText('Full tour');
    await expect(progress(page)).toHaveText(`1 of ${WHATS_NEW.length}`);

    await walk(page, WHATS_NEW);
    await expect(nextButton(page)).toHaveText('Finish');
    await nextButton(page).click();
    await expect(popover(page)).toHaveCount(0);
    expect(await storedTour(page)).toBe('whats-new');

    await page.reload();
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });

  test('Full tour switches to the full tour', async ({ page }) => {
    await popover(page).locator('.driver-tour-full-btn').click();
    await expect(title(page)).toHaveText('Welcome to ProtSpace');
    await expect(progress(page)).toHaveText(`1 of ${FULL.length}`);
    expect(await storedTour(page)).toBe('full');
  });
});

test.describe('with a tour already recorded', () => {
  test('nothing starts', async ({ page }) => {
    await seedTourSeen(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });

  test('nothing starts, even with the old key there too', async ({ page }) => {
    await seedTourSeen(page);
    await seedLegacyTourSeen(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });
});
