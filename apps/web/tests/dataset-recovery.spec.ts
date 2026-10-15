import { test, expect } from '@playwright/test';
import {
  dismissTourIfPresent,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';
import { clearOpfs, seedOpfsState } from './helpers/opfs';

test.describe('dataset recovery banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    // Otherwise the first page's own startup load (demo, or restoring
    // whatever OPFS state a previous test left behind) can still be
    // writing when the seed/clear below runs, and the two writes race.
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await clearOpfs(page);
  });

  test('shows banner when persisted dataset is in pending state', async ({ page }) => {
    await seedOpfsState(page, {
      fileName: 'fake.parquetbundle',
      status: 'pending',
      failedAttempts: 1,
    });

    await page.reload();
    await dismissTourIfPresent(page);

    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('did not finish loading');
    await expect(banner.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(banner.getByRole('button', { name: 'Load default' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Clear stored data' })).toBeVisible();
  });

  test('does not show banner when persisted dataset is in success state', async ({ page }) => {
    await seedOpfsState(page, {
      fileName: '5K.parquetbundle',
      status: 'success',
      failedAttempts: 0,
    });

    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    await expect(page.locator('#protspace-recovery-banner')).toHaveCount(0);
  });

  test('upgrades message after 3 failed attempts', async ({ page }) => {
    await seedOpfsState(page, {
      fileName: 'persistent-fail.parquetbundle',
      status: 'pending',
      failedAttempts: 3,
    });

    await page.goto('/explore');
    await dismissTourIfPresent(page);

    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('failed to load multiple times');
    await expect(banner.getByRole('button', { name: /Try again/ })).toBeDisabled();
  });

  test('shows banner with last error when persisted dataset is in error state', async ({
    page,
  }) => {
    await seedOpfsState(page, {
      fileName: 'broken.parquetbundle',
      status: 'error',
      failedAttempts: 1,
      lastError: 'OOM during decode',
    });

    await page.reload();
    await dismissTourIfPresent(page);

    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText('did not finish loading');
    await expect(banner).toContainText('OOM during decode');
    await expect(banner.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  test('Clear stored data dismisses banner and clears OPFS', async ({ page }) => {
    await seedOpfsState(page, {
      fileName: 'broken.parquetbundle',
      status: 'pending',
      failedAttempts: 1,
    });

    await page.reload();
    await dismissTourIfPresent(page);

    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await banner.getByRole('button', { name: 'Clear stored data' }).click();

    await expect(banner).toHaveCount(0);
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    // OPFS should be cleared — reloading must not bring the banner back.
    await page.reload();
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await expect(page.locator('#protspace-recovery-banner')).toHaveCount(0);
  });
});
