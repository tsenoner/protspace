import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Playwright configuration for ProtSpace app e2e tests (product tour, etc.).
 *
 * The dev server on port 8080 is auto-started via the `webServer` block below
 * (and reused if already running locally). To run against an existing server,
 * just leave it up — Playwright will detect it.
 *
 * The `fasta-prep-live` project requires the real prep backend and is opt-in:
 * set RUN_LIVE_E2E=1 to include it.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: TEST_DIR,

  // Run tests in parallel (each test gets an isolated browser context). The
  // suite is otherwise a ~35-40 min serial run; parallelism cuts it to a few
  // minutes. Override with `--workers=N` (use `--workers=1` to debug ordering).
  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  // One retry locally absorbs the occasional WebGL/OPFS flake under parallel load.
  retries: 1,

  // Headless WebGL (SwiftShader) is CPU-bound, so leave cores free for the dev
  // server and OS; 50% of cores is a good balance. CI runners are smaller.
  workers: process.env.CI ? 2 : '50%',

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  timeout: 60_000,

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev:app',
        cwd: REPO_ROOT,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'product-tour',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /product-tour\.spec\.ts/,
    },
    {
      name: 'dataset-reload',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /dataset-reload\.spec\.ts/,
    },
    {
      name: 'dataset-recovery',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /dataset-recovery\.spec\.ts/,
    },
    {
      name: 'numeric-binning',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /numeric-binning\.spec\.ts/,
    },
    {
      name: 'brush-selection',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /brush-selection\.spec\.ts/,
    },
    {
      name: 'url-view-state',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /url-view-state\.spec\.ts/,
    },
    {
      name: 'url-view-state-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /url-view-state\.spec\.ts/,
    },
    {
      name: 'url-view-state-webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /url-view-state\.spec\.ts/,
    },
    {
      name: 'load-large-bundle',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /load-large-bundle\.spec\.ts/,
    },
    {
      name: 'figure-editor',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /figure-editor\.spec\.ts/,
    },
    {
      name: 'isolation-dataset-swap',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /isolation-dataset-swap\.spec\.ts/,
    },
    {
      name: 'multi-annotation-tooltip',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /multi-annotation-tooltip\.spec\.ts/,
    },
    {
      // Mocked prep API (no backend); the live variant below is opt-in.
      name: 'fasta-prep',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /fasta-prep\.spec\.ts/,
    },
    // Live FASTA-prep flow against a real backend — opt-in via RUN_LIVE_E2E=1
    // (requires `docker compose up -d protspace-prep`; see fasta-prep.live.spec.ts
    // for the full prerequisites). Excluded from the default suite.
    ...(process.env.RUN_LIVE_E2E
      ? [
          {
            name: 'fasta-prep-live',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1280, height: 720 },
            },
            testMatch: /fasta-prep\.live\.spec\.ts/,
          },
        ]
      : []),
  ],

  outputDir: '../test-results/',
});
