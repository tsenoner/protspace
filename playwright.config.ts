import { defineConfig, devices } from '@playwright/test';

/**
 * The docs media captures in scripts/docs-screenshots/ (`pnpm docs:screenshots` for the PNGs,
 * `pnpm docs:animations` for the video recordings, which `pnpm docs:videos` encodes): the runner
 * turns each manifest entry into one test per theme, and docs/explore/images/README.md describes
 * the pipeline.
 *
 * Every capture runs headless, so nothing takes focus. Screenshots use the installed Google Chrome
 * (`channel: 'chrome'`), whose headless mode still draws WebGL on the system GPU. Videos use
 * Playwright's headless Chromium (on the GPU through ANGLE's Metal backend): Chrome's headless mode
 * on macOS records only the top 632 px of a 720 px viewport (its screencast leaves room for a
 * toolbar it does not draw), the headless shell records all of it. CI, which never captures docs media, would use the headless shell for both.
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
    headless: true,
    // The docs are English: numbers read 3.6, not the capturing machine's 3,6.
    locale: 'en-US',
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
      // Screenshots: one test per PNG and theme (runner.ts sets each one's device).
      name: 'docs-png',
      use: {
        ...devices['Desktop Chrome'],
        ...(!process.env.CI && { channel: 'chrome' }),
        video: 'off',
      },
      testMatch: /capture-png\.spec\.ts$/,
    },
    {
      // Videos: one test per video and theme; runner.ts records each in a context of its own.
      // On a Mac the headless shell draws WebGL on the GPU through ANGLE's Metal backend; its
      // SwiftShader default cannot start Mol*'s context beside the plot's, so the structure
      // viewer would show "WebGL does not seem to be available".
      name: 'docs-video',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.platform === 'darwin' && { launchOptions: { args: ['--use-angle=metal'] } }),
      },
      testMatch: /capture-video\.spec\.ts$/,
    },
  ],

  outputDir: './test-results/',
});
