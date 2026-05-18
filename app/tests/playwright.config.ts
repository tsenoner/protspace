import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Playwright configuration for ProtSpace app e2e tests (product tour, etc.).
 *
 * Assumes the dev server is already running on port 8080.
 * Start it with: pnpm dev:app
 */
export default defineConfig({
  testDir: TEST_DIR,

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 1 : 0,

  workers: 1,

  reporter: 'list',

  timeout: 60_000,

  use: {
    baseURL: 'http://localhost:8080',
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
  ],

  outputDir: '../test-results/',
});
