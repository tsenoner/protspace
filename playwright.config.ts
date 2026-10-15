import { defineConfig, devices } from '@playwright/test';

/**
 * The docs media captures in scripts/docs-screenshots/ (`pnpm docs:screenshots`, and
 * `pnpm docs:animations` until the GIF runner replaces it): the runner turns each manifest entry
 * into one test per output file, and docs/explore/images/README.md describes the pipeline.
 *
 * It starts its own dev server on DOCS_CAPTURE_PORT (default 8096), with this checkout's packages
 * built first and without VITE_STARTUP_DATASET_URL, so the captures show the product demo, never
 * the fixture an e2e server pins. It never reuses a running server. PLAYWRIGHT_BASE_URL points the
 * captures at one instead, and starts nothing.
 */
const PORT = process.env.DOCS_CAPTURE_PORT ?? '8096';
if (!/^\d+$/.test(PORT)) {
  throw new Error(`DOCS_CAPTURE_PORT must be a port number, got "${PORT}"`);
}
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './scripts/docs-screenshots',

  // One capture at a time, in manifest order, never retried: a failure is a broken scene.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',

  // Each capture sets its own; this covers the old animation captures.
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The runner shoots each image itself.
    screenshot: 'off',
    // Headed on macOS for the system GPU's WebGL; CI runs headless on SwiftShader.
    headless: !!process.env.CI,
    // Video recording for the old animation captures.
    video: {
      mode: 'on',
      size: { width: 1536, height: 864 },
    },
  },

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm turbo run build --filter=@protspace/app^... && pnpm --filter @protspace/app exec vite --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // Set empty, so a value in the caller's shell cannot pin the startup demo to a fixture.
        env: { VITE_STARTUP_DATASET_URL: '' },
        gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 },
      },

  projects: [
    {
      // Screenshots: one test per PNG in the manifest (runner.ts sets each one's device).
      name: 'docs-png',
      use: { ...devices['Desktop Chrome'], video: 'off' },
      testMatch: /capture-png\.spec\.ts$/,
    },
    {
      name: 'animations',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 864 },
        video: {
          mode: 'on',
          size: { width: 1536, height: 864 },
        },
      },
      // Any `capture-*animations.spec.ts` registers itself; no per-file listing.
      testMatch: /animations\.spec\.ts$/,
    },
  ],

  outputDir: './test-results/',
});
