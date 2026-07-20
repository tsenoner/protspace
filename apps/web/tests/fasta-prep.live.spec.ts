import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

/**
 * Live end-to-end test for the FASTA prep flow. No `page.route` mocks: the
 * SPA hits protspace-prep directly, which calls the real Biocentral
 * embedding service.
 *
 * Prerequisites:
 *   - `docker compose up -d protspace-prep`
 *   - `pnpm --filter @protspace/app dev` (vite on http://localhost:8080)
 *   - `apps/web/.env.development` sets VITE_PREP_API_BASE=http://localhost:8000
 *
 * Run:
 *   cd apps/web && RUN_LIVE_E2E=1 npx playwright test --config=tests/playwright.config.ts \
 *     --project=fasta-prep-live
 */

const FIXTURE = fileURLToPath(new URL('../../prep/tests/fixtures/small.fasta', import.meta.url));

test('FASTA drop completes the prep flow against the live backend', async ({ page }) => {
  await page.goto('/explore');

  const bundleResponse = page.waitForResponse(
    (response) =>
      /\/api\/prepare\/[^/]+\/bundle$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'GET',
    { timeout: 5 * 60_000 },
  );

  await page.locator('protspace-data-loader').locator('input[type="file"]').setInputFiles(FIXTURE);

  expect((await bundleResponse).status()).toBe(200);
});
