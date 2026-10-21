/**
 * Helpers for the EAT panel: the EAT fixture bundle, the rail item, and the panel element.
 */
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { dismissTourIfPresent, waitForProteinCount } from './explore';
import { STARTUP_URL_GLOB } from './fixtures';
import { rail } from './workbench';

const PHOSPHATASE_EAT = fileURLToPath(
  new URL('../fixtures/phosphatase_eat.parquetbundle', import.meta.url),
);

/** Opens Explore on the phosphatase EAT bundle (832 proteins; `ec` carries predictions). */
export async function loadPhosphataseEat(page: Page): Promise<void> {
  await page.route(STARTUP_URL_GLOB, (route) => route.abort());
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.locator('protspace-data-loader input[type="file"]').setInputFiles(PHOSPHATASE_EAT);
  await waitForProteinCount(page, 832);
}

/** The `protspace-eat-panel` element. */
export const eatPanel = (page: Page): Locator => page.locator('#myEatPanel');

/** The rail's EAT item: its button, named by its tooltip. */
export const eatRailItem = (page: Page): Locator =>
  rail(page).locator('#wb-rail-eat').getByRole('button');

/** Opens the EAT panel from the rail and waits for it to show. */
export async function openEatPanel(page: Page): Promise<void> {
  await eatRailItem(page).click();
  await expect(eatPanel(page)).toBeVisible();
}
