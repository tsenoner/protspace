import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 15 * 60_000,
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    headless: false,
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          args: [
            // GPU — ensure hardware acceleration
            '--ignore-gpu-blocklist',
            '--disable-software-rasterizer',
            '--use-gl=angle',
            '--use-angle=default',
            // Performance — prevent throttling during benchmarks
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            '--disable-frame-rate-limit',
            // Memory — make performance.memory byte-accurate instead of bucketed
            '--enable-precise-memory-info',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          args: ['-disable-background-timer-throttling'],
          firefoxUserPrefs: {
            // GPU — ensure hardware-accelerated WebGL
            'webgl.force-enabled': true,
            'webgl.forbid-software': true,
            'layers.acceleration.force-enabled': true,
            'gfx.webrender.all': true,
            // Performance — prevent throttling
            'dom.timeout.enable_budget_timer_throttling': false,
            'dom.timeout.throttling_delay': 0,
          },
        },
      },
    },
    {
      name: 'safari',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: false,
  },
  outputDir: path.join(__dirname, 'test-results'),
});
