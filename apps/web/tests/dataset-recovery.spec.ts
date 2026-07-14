import { test, expect, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';

const FIXTURE_PUBLIC_PATH = '/data/5K.parquetbundle';

interface SeedOpfsParams {
  fileName: string;
  status: 'pending' | 'success' | 'error';
  failedAttempts: number;
  lastError?: string;
}

async function seedOpfsState(page: Page, params: SeedOpfsParams): Promise<void> {
  await page.evaluate(
    async ({ fileName, status, failedAttempts, lastError, publicPath }) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('protspace-last-import', { create: true });

      const blob = await fetch(publicPath).then((r) => r.blob());
      const dataHandle = await dir.getFileHandle('dataset.bin', { create: true });
      const dataWritable = await dataHandle.createWritable();
      await dataWritable.write(blob);
      await dataWritable.close();

      const metaHandle = await dir.getFileHandle('metadata.json', { create: true });
      const metaWritable = await metaHandle.createWritable();
      await metaWritable.write(
        JSON.stringify({
          schemaVersion: 2,
          name: fileName,
          type: '',
          size: blob.size,
          lastModified: 0,
          storedAt: '2026-05-02T00:00:00.000Z',
          lastLoadStatus: status,
          failedAttempts,
          lastError,
        }),
      );
      await metaWritable.close();
    },
    {
      fileName: params.fileName,
      status: params.status,
      failedAttempts: params.failedAttempts,
      lastError: params.lastError,
      publicPath: FIXTURE_PUBLIC_PATH,
    },
  );
}

async function clearOpfs(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('protspace-last-import', { recursive: true });
    } catch {
      // OPFS may not exist yet; that's fine.
    }
  });
}

test.describe('dataset recovery banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
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
