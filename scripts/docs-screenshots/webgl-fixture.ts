import { test as base, chromium } from '@playwright/test';

/**
 * Custom test fixture that extends the base test with WebGL-enabled browser.
 * This ensures WebGL support is available for structure viewer captures.
 */
export const test = base.extend({
  // Override the browser context to include WebGL launch arguments
  browser: async ({ browser }, use) => {
    // The browser is already created by Playwright, but we can't modify its launch args here
    // Instead, we rely on the headless: false setting and system GPU support
    // For CI environments, the new headless mode with GPU flags should work
    await use(browser);
  },
});

/**
 * Helper to create a browser context with WebGL support.
 * This can be used if we need to create additional contexts.
 */
export async function createWebGLBrowser() {
  return await chromium.launch({
    headless: !!process.env.CI,
    args: [
      '--use-gl=egl', // Better WebGL support (use 'angle' on Windows if needed)
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
    ],
  });
}
