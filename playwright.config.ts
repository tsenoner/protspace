import { defineConfig, devices } from '@playwright/test';

/**
 * The docs media captures in scripts/docs-screenshots/ (`pnpm docs:screenshots` for the PNGs,
 * `pnpm docs:animations` for the GIF recordings, which `pnpm docs:gifs` converts): the runner
 * turns each manifest entry into one test per output file, and docs/explore/images/README.md
 * describes the pipeline.
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

  use: {
    baseURL: BASE_URL,
    // The runner shoots each image itself.
    screenshot: 'off',
    // Headed on macOS for the system GPU's WebGL; CI runs headless on SwiftShader.
    headless: !!process.env.CI,
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
      // GIFs: one test per GIF in the manifest; runner.ts records each in a context of its own.
      name: 'docs-gif',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /capture-gif\.spec\.ts$/,
    },
  ],

  outputDir: './test-results/',
});
