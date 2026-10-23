import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Vitest reads this file instead of vite.config.ts, so the library build's plugins (dts) stay out
// of test runs. `unit` keeps every existing test (each file opts into jsdom with a docblock);
// `browser` runs *.browser.test.ts in Chromium, for code that needs the popover attribute,
// <dialog>, layout or constructable stylesheets.
export default defineConfig({
  worker: { format: 'es' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          setupFiles: ['src/test-support/browser-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            // Headless Chromium on Linux finds no pointing device, so (hover: hover) and
            // (pointer: fine) fail and the rows lay out for touch. Report a mouse, as macOS does.
            // Touch tests still switch to a coarse pointer through Emulation.setTouchEmulationEnabled.
            provider: playwright({
              launchOptions: {
                args: [
                  '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2',
                ],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
