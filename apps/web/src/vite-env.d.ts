/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * E2E only: the startup demo's URL. The Playwright web server sets it to a
   * pinned test fixture (`apps/web/tests/playwright.config.ts`); unset, the demo
   * loads from `./data.parquetbundle`.
   */
  readonly VITE_STARTUP_DATASET_URL?: string;
}

declare const __DOCS_URL__: string;
