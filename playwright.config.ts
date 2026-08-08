import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for documentation screenshot automation.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './scripts/docs-screenshots',

  // Run tests sequentially for consistent screenshots
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // No retries for screenshot generation
  retries: 0,

  // Single worker for consistent captures
  workers: 1,

  // Reporter
  reporter: 'list',

  // Timeout for each test (60s)
  timeout: 60000,

  // Shared settings for all projects
  use: {
    // Base URL for the app
    baseURL: 'http://localhost:8080',

    // Capture trace on failure for debugging
    trace: 'on-first-retry',

    // Screenshot settings
    screenshot: 'off', // We handle screenshots manually

    // Video recording for GIF animations
    video: {
      mode: 'on',
      size: { width: 1536, height: 864 },
    },
  },

  // Configure projects
  projects: [
    {
      name: 'screenshots',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 864 },
        // Disable video for static screenshots
        video: 'off',
        // WebGL support: use headless mode based on environment
        // On macOS, headless: false uses system GPU for better WebGL support
        // On CI, headless: true uses SwiftShader (software rendering)
        // For better WebGL on CI, consider using xvfb with headless: false
        headless: !!process.env.CI,
      },
      testMatch: /capture-(?:helpers|static)\.spec\.ts/,
    },
    {
      name: 'animations',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 864 },
        // Enable video recording for animations
        video: {
          mode: 'on',
          size: { width: 1536, height: 864 },
        },
        // WebGL support: use headless mode based on environment
        // On macOS, headless: false uses system GPU for better WebGL support
        // On CI, headless: true uses SwiftShader (software rendering)
        // For better WebGL on CI, consider using xvfb with headless: false
        headless: !!process.env.CI,
      },
      testMatch: /capture-animations\.spec\.ts/,
    },
  ],

  // Output directories
  outputDir: './test-results/',

  // Don't start a web server - assume dev server is already running
  // Run `pnpm dev:app` before running screenshot generation
});
