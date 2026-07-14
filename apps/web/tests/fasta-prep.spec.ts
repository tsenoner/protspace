import { test, expect } from '@playwright/test';

// The prep flow rejects FASTA files with fewer than MIN_SEQUENCES (20) before
// it ever calls /api/prepare, so use 25 sequences to exercise the real path.
const FASTA = Array.from({ length: 25 }, (_, i) => `>P${10000 + i}\nMKTAYIAKQRQ`).join('\n') + '\n';
const FAKE_BUNDLE_BYTES = new Uint8Array([0x50, 0x41, 0x52, 0x51]); // "PARQ"

test('FASTA prep can be cancelled from the loading overlay', async ({ page }) => {
  await page.route('**/api/prepare', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: 'cancel-job' }),
    });
  });

  let bundleRequested = false;
  await page.route('**/api/prepare/cancel-job/bundle', async (route) => {
    bundleRequested = true;
    await route.abort();
  });

  // Keep the SSE request genuinely pending: the prep must stay "in progress" so
  // the overlay and its cancel button remain until we click cancel. Fulfilling
  // with a body would close the stream, end the prep early, and remove the
  // overlay before we can interact with it. The pending promise is abandoned
  // when the client aborts this request on cancel.
  await page.route('**/api/prepare/cancel-job/events', async () => {
    await new Promise<void>(() => {
      /* never resolves */
    });
  });

  await page.goto('/explore');

  await page
    .locator('protspace-data-loader')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'cancel.fasta',
      mimeType: 'text/plain',
      buffer: Buffer.from(FASTA),
    });

  const overlay = page.locator('#progressive-loading');
  await expect(overlay).toBeVisible();

  const cancelButton = overlay.locator('#progressive-loading-cancel');
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  await expect(overlay).toBeHidden();

  // Cancellation is observed by the overlay disappearing and — critically — the
  // bundle never being fetched. Whether the client also tears down the SSE
  // EventSource is intentionally not asserted: Playwright does not reliably
  // surface the client-side abort across browsers, so any such check would be a
  // tautology rather than a real signal.
  expect(bundleRequested).toBe(false);
});

test('FASTA drop completes the prep flow end-to-end', async ({ page }) => {
  await page.route('**/api/prepare', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: 'test-job' }),
    });
  });

  await page.route('**/api/prepare/test-job/events', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        'event: queued\ndata: {"job_id":"test-job"}\n\n' +
        'event: progress\ndata: {"stage":"embedding"}\n\n' +
        'event: done\ndata: {"download_url":"/api/prepare/test-job/bundle"}\n\n',
    });
  });

  await page.route('**/api/prepare/test-job/bundle', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: Buffer.from(FAKE_BUNDLE_BYTES),
    });
  });

  await page.goto('/explore');

  const bundleResponse = page.waitForResponse('**/api/prepare/test-job/bundle');

  await page
    .locator('protspace-data-loader')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'test.fasta',
      mimeType: 'text/plain',
      buffer: Buffer.from(FASTA),
    });

  expect((await bundleResponse).status()).toBe(200);
});
