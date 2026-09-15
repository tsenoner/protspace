import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { tourCompletedStorageState } from '../apps/web/tests/helpers/tour-storage-state';

const BASE_URL = 'http://localhost:8080';
const REPO_ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // The spec calls test.setTimeout(45 min) for the sweep itself, which overrides
  // this; kept in step so the config does not read as contradicting it.
  timeout: 45 * 60_000,
  use: {
    baseURL: BASE_URL,
    // Keep the product tour off the canvas for the whole measured window; see
    // the helper for what it costs when it runs.
    storageState: tourCompletedStorageState(BASE_URL),
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    headless: false,
    acceptDownloads: true,
  },
  // outputDir is per project, never shared. Playwright deletes the outputDir of
  // every SELECTED project at run start, so with one shared directory the
  // documented `pnpm perf -- --project=chrome` destroyed the firefox and safari
  // results from the previous full run, and the plotter silently drew
  // single-browser charts.
  projects: [
    {
      name: 'chrome',
      outputDir: path.join(__dirname, 'test-results', 'chrome'),
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
      outputDir: path.join(__dirname, 'test-results', 'firefox'),
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
      outputDir: path.join(__dirname, 'test-results', 'safari'),
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: {
    // `pnpm dev:app`, not `npm run dev`: the root `dev` script is
    // `concurrently "pnpm dev:app" "pnpm dev:docs"`, so it also boots the
    // VitePress docs server on :5174 — a second node process competing for CPU
    // inside the window this suite measures, for a server /explore never touches.
    command: 'pnpm dev:app',
    // Playwright defaults a webServer's cwd to the config's directory, and perf/
    // has no package.json; pin it like the e2e config does.
    cwd: REPO_ROOT,
    // `url`, not `port`: a port check is a raw TCP connect, which Vite's socket
    // accepts before it can serve anything. A GET proves the origin is live.
    url: BASE_URL,
    // Deliberately not `!process.env.CI`. Turbo's `dev` task dependsOn `^build`
    // and the app resolves @protspace/core and @protspace/utils through their
    // dist entry points, so a dev server someone left running was built from
    // whatever was checked out then — reusing it would benchmark stale package
    // code, the same silent-wrong-result class this harness is being fixed for.
    reuseExistingServer: false,
    // The 60s default is not enough for a cold Vite start on this workspace.
    timeout: 180_000,
    // Without this the dev server outlives the run and holds :8080, so the next
    // run dies on "already used". Playwright does kill its own process group,
    // but turbo spawns each task into a NEW group, so Vite is not in the group
    // that gets the SIGKILL. SIGINT to the group is what Ctrl-C sends, and turbo
    // stops its task group on it; Playwright still falls back to SIGKILL after
    // the timeout.
    gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 },
    // Vite announces "Port 8080 is in use, trying another one!" on stdout, and
    // apps/web's vite config sets no strictPort — without piping stdout that
    // silent move to :8081 is invisible.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
