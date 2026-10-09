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
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
