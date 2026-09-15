import { defineConfig, devices, type Project } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { tourCompletedStorageState } from './helpers/tour-storage-state';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Playwright configuration for ProtSpace app e2e tests (product tour, etc.).
 *
 * The dev server on port 8080 is auto-started via the `webServer` block below
 * (and reused if already running locally). To run against an existing server,
 * just leave it up — Playwright will detect it.
 *
 * Some projects are excluded from the default suite and gated on an env flag — see `optIn`
 * below, and each project's own comment for what it needs.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const TOUR_COMPLETED_STORAGE_STATE = tourCompletedStorageState(BASE_URL);
const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };

/**
 * Include an opt-in project only when its env flag is set to '1'.
 *
 * Spreading `[]` is how Playwright configs express "not in the default suite"; this keeps the
 * three opt-in projects from repeating the same ternary-around-an-array-literal boilerplate.
 */
const optIn = (envVar: string, project: Project): Project[] =>
  process.env[envVar] === '1' ? [project] : [];

export default defineConfig({
  testDir: TEST_DIR,

  // Run tests in parallel (each test gets an isolated browser context). The
  // suite is otherwise a ~35-40 min serial run; parallelism cuts it to a few
  // minutes. Override with `--workers=N` (use `--workers=1` to debug ordering).
  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  // Retries capture diagnostics but must not allow an unstable test to pass CI.
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

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
    storageState: TOUR_COMPLETED_STORAGE_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'product-tour',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: EMPTY_STORAGE_STATE,
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
      grep: /@cross-browser|@opfs-browser/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /url-view-state\.spec\.ts/,
    },
    {
      name: 'url-view-state-webkit',
      grep: /@cross-browser/,
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
        trace: process.env.CI ? 'retain-on-first-failure' : 'off',
      },
      testMatch: /url-view-state\.spec\.ts/,
    },
    // Fixture-dependent 573k-protein regression — copy
    // protspace/data/other/sprot/sprot_50.parquetbundle to
    // app/tests/fixtures/, then opt in via RUN_LARGE_BUNDLE_E2E=1.
    ...optIn('RUN_LARGE_BUNDLE_E2E', {
      name: 'load-large-bundle',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /load-large-bundle\.spec\.ts/,
    }),
    {
      name: 'camera-no-restage',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /camera-no-restage\.spec\.ts/,
    },
    {
      name: 'label-atlas-limit',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /label-atlas-limit\.spec\.ts/,
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
    // Visual harness, not a CI gate: it asserts nothing beyond the shader compiling and its
    // only product is a gitignored PNG to look at. Opt in via RUN_GLYPH_HARNESS=1.
    ...optIn('RUN_GLYPH_HARNESS', {
      name: 'glyph-outline',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /glyph-outline\.spec\.ts/,
    }),
    {
      name: 'eat-visualization',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /eat-visualization\.spec\.ts/,
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
    ...optIn('RUN_LIVE_E2E', {
      name: 'fasta-prep-live',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /fasta-prep\.live\.spec\.ts/,
    }),
  ],

  outputDir: '../test-results/',
});
