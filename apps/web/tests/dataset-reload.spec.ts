import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  clickLegendItem,
  dismissTourIfPresent,
  getCurrentDatasetName,
  getFirstLegendItemValue,
  getProteinCount,
  importUserFile,
  isLegendItemHidden,
  openExplore,
  openImportMenu,
  waitForExploreDataLoad,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
import { TOXPROT_5181_FIXTURE, TOXPROT_5181_V3_FIXTURE } from './helpers/fixtures';
import { readStoredImport } from './helpers/opfs';

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const CUSTOM_5K_BUNDLE_PATH = TOXPROT_5181_FIXTURE;
const CUSTOM_5K_BUNDLE_NAME = path.basename(CUSTOM_5K_BUNDLE_PATH);
const CUSTOM_5K_PROTEIN_COUNT = 5181;

async function clearPersistedDataset(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storageWithDirectory = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof storageWithDirectory.getDirectory !== 'function') {
      return;
    }

    const root = await storageWithDirectory.getDirectory();
    try {
      await root.removeEntry('protspace-last-import', { recursive: true });
    } catch {
      // Ignore missing directory.
    }
  });
}

async function writeCorruptedPersistedDataset(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storageWithDirectory = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof storageWithDirectory.getDirectory !== 'function') {
      throw new Error('OPFS is unavailable in this browser context.');
    }

    const root = await storageWithDirectory.getDirectory();
    const store = await root.getDirectoryHandle('protspace-last-import', { create: true });
    const metadataHandle = await store.getFileHandle('metadata.json', { create: true });
    const writable = await metadataHandle.createWritable();
    await writable.write('{not-json');
    await writable.close();
  });
}

async function writeUnreadablePersistedDataset(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storageWithDirectory = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof storageWithDirectory.getDirectory !== 'function') {
      throw new Error('OPFS is unavailable in this browser context.');
    }

    const root = await storageWithDirectory.getDirectory();
    const store = await root.getDirectoryHandle('protspace-last-import', { create: true });

    const metadataHandle = await store.getFileHandle('metadata.json', { create: true });
    const metadataWritable = await metadataHandle.createWritable();
    await metadataWritable.write(
      JSON.stringify({
        schemaVersion: 1,
        name: 'corrupt.parquetbundle',
        type: 'application/octet-stream',
        size: 16,
        lastModified: Date.now(),
        storedAt: new Date().toISOString(),
      }),
    );
    await metadataWritable.close();

    const datasetHandle = await store.getFileHandle('dataset.bin', { create: true });
    const datasetWritable = await datasetHandle.createWritable();
    await datasetWritable.write(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    await datasetWritable.close();
  });
}

async function loadCustomDatasetFromImportMenu(
  page: Page,
  file: Parameters<typeof importUserFile>[1],
): Promise<void> {
  await openImportMenu(page);
  await importUserFile(page, file);
}

async function measureSingleImportLifecycle(
  page: Page,
  action: () => Promise<void>,
): Promise<{ loadingStarts: number; loadedEvents: number }> {
  await page.evaluate(() => {
    const loader = document.getElementById('myDataLoader');
    if (!(loader instanceof EventTarget)) {
      throw new Error('ProtSpace data loader was not found');
    }

    const win = window as Window & {
      __protspaceImportLifecycle?: {
        loadingStarts: number;
        loadedEvents: number;
        onStart: EventListener;
        onLoaded: EventListener;
      };
    };

    const onStart: EventListener = () => {
      if (win.__protspaceImportLifecycle) {
        win.__protspaceImportLifecycle.loadingStarts += 1;
      }
    };
    const onLoaded: EventListener = () => {
      if (win.__protspaceImportLifecycle) {
        win.__protspaceImportLifecycle.loadedEvents += 1;
      }
    };

    win.__protspaceImportLifecycle = {
      loadingStarts: 0,
      loadedEvents: 0,
      onStart,
      onLoaded,
    };

    loader.addEventListener('data-loading-start', onStart);
    loader.addEventListener('data-loaded', onLoaded);
  });

  await action();

  return page.evaluate(() => {
    const loader = document.getElementById('myDataLoader');
    const win = window as Window & {
      __protspaceImportLifecycle?: {
        loadingStarts: number;
        loadedEvents: number;
        onStart: EventListener;
        onLoaded: EventListener;
      };
    };
    const lifecycle = win.__protspaceImportLifecycle;

    if (loader && lifecycle) {
      loader.removeEventListener('data-loading-start', lifecycle.onStart);
      loader.removeEventListener('data-loaded', lifecycle.onLoaded);
    }

    return {
      loadingStarts: lifecycle?.loadingStarts ?? 0,
      loadedEvents: lifecycle?.loadedEvents ?? 0,
    };
  });
}

async function loadCustomDatasetFromPath(
  page: Page,
  datasetPath: string,
  fileName: string,
): Promise<void> {
  const bytes = Array.from(fs.readFileSync(datasetPath));

  await page.evaluate(
    async ({ byteValues, name }) => {
      const loader = document.getElementById('myDataLoader') as {
        loadFromFile?: (file: File, options?: { source?: 'user' | 'auto' }) => Promise<void>;
      } | null;

      if (!loader?.loadFromFile) {
        throw new Error('ProtSpace data loader was not found');
      }

      const file = new File([new Uint8Array(byteValues)], name, {
        type: 'application/octet-stream',
      });
      await loader.loadFromFile(file, { source: 'user' });
    },
    { byteValues: bytes, name: fileName },
  );
}

async function loadDemoDatasetFromImportMenu(page: Page): Promise<void> {
  await openImportMenu(page);
  await page.locator('protspace-control-bar [data-example-id="demo"]').click();
}

async function isImportChevronVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar');
    const chevron = controlBar?.shadowRoot?.querySelector(
      '[data-driver-id="import"] .chevron-down',
    );

    if (!(chevron instanceof Element)) {
      return false;
    }

    return getComputedStyle(chevron).display !== 'none';
  });
}

async function dispatchCustomEvent(
  page: Page,
  selector: string,
  eventName: string,
  detail: unknown,
): Promise<void> {
  await page.evaluate(
    ({ targetSelector, eventType, eventDetail }) => {
      const target = document.querySelector(targetSelector);
      if (!(target instanceof EventTarget)) {
        throw new Error(`No event target found for ${targetSelector}`);
      }

      target.dispatchEvent(
        new CustomEvent(eventType, {
          detail: eventDetail,
          bubbles: true,
          composed: true,
        }),
      );
    },
    { targetSelector: selector, eventType: eventName, eventDetail: detail },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Dataset reload resets state (#178)', () => {
  test.beforeEach(async ({ page }) => {
    // Each Playwright test receives a fresh context; shared storage state only
    // seeds the completed product-tour key, so OPFS starts empty here.
    await openExplore(page);
  });

  test('page reload restores default legend state and clears persisted hidden values', async ({
    page,
  }) => {
    const itemValue = await getFirstLegendItemValue(page);

    expect(await isLegendItemHidden(page, itemValue)).toBe(false);

    await clickLegendItem(page, itemValue);
    await expect.poll(() => isLegendItemHidden(page, itemValue)).toBe(true);

    // Persistence can lag the visibility change and there may be more than one
    // legend key, so poll across all keys for this specific value.
    const itemHiddenInStorage = () =>
      page.evaluate((value) => {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith('protspace:legend:')) continue;
          const settings = JSON.parse(localStorage.getItem(key) || '{}');
          if ((settings.hiddenValues ?? []).includes(value)) return true;
        }
        return false;
      }, itemValue);
    await expect.poll(itemHiddenInStorage).toBe(true);

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    expect(await isLegendItemHidden(page, itemValue)).toBe(false);
    expect(await itemHiddenInStorage()).toBe(false);
  });
});

test.describe('Persisted custom datasets in OPFS (#176)', () => {
  test.beforeEach(async ({ page }) => {
    await openExplore(page);
  });

  test('reload restores the last imported custom dataset and its local settings', async ({
    page,
  }) => {
    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    await waitForPersistedExploreDataset(page);

    const customCount = await getProteinCount(page);
    expect(customCount).not.toBe(defaultCount);

    const itemValue = await getFirstLegendItemValue(page);
    await clickLegendItem(page, itemValue);
    expect(await isLegendItemHidden(page, itemValue)).toBe(true);

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    expect(await getProteinCount(page)).toBe(customCount);
    expect(await isLegendItemHidden(page, itemValue)).toBe(true);
  });

  test('a failed import shows a toast, not a dialog, and leaves the stored import to restore on reload', async ({
    page,
  }) => {
    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    await waitForPersistedExploreDataset(page);

    // A file that fails to decode is never saved, so it must not mark the healthy
    // import still in OPFS as failed.
    await loadCustomDatasetFromImportMenu(page, {
      name: 'broken.parquetbundle',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not-a-valid-bundle'),
    });
    await expect(page.getByText('Dataset import failed.')).toBeVisible();
    // The failed load must not leave its full-screen loading overlay behind.
    await expect(page.locator('#progressive-loading')).toHaveCount(0);
    expect(dialogSeen).toBe(false);
    expect(await readStoredImport(page)).toEqual({
      name: CUSTOM_5K_BUNDLE_NAME,
      lastLoadStatus: 'success',
    });

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    expect(await getCurrentDatasetName(page)).toBe(CUSTOM_5K_BUNDLE_NAME);
    await expect(page.locator('#protspace-recovery-banner')).toHaveCount(0);
  });

  test('reset to demo clears the persisted custom dataset', async ({ page }) => {
    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    await waitForPersistedExploreDataset(page);

    await loadDemoDatasetFromImportMenu(page);
    await waitForProteinCount(page, defaultCount);

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    expect(await getProteinCount(page)).toBe(defaultCount);
  });

  test('compact layout still shows the import dropdown affordance', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 527 });
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    expect(await isImportChevronVisible(page)).toBe(true);
  });

  test('remounting Explore keeps a single queued import path active', async ({ page }) => {
    await page.goto('/privacy');
    await openExplore(page);

    const lifecycle = await measureSingleImportLifecycle(page, async () => {
      await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
      await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    });

    expect(lifecycle.loadingStarts).toBe(1);
    expect(lifecycle.loadedEvents).toBe(1);
    expect(await getCurrentDatasetName(page)).toBe(CUSTOM_5K_BUNDLE_NAME);
  });
});

test.describe('Persisted dataset failure handling', () => {
  test('queued user imports win over corrupted OPFS fallback recovery', async ({ page }) => {
    await page.addInitScript(() => {
      const originalDefine = customElements.define.bind(customElements);
      customElements.define = (name, constructor, options) => {
        if (name === 'protspace-data-loader') {
          const proto = constructor.prototype as {
            __queuedLoadHoldPatched?: boolean;
            loadFromFile?: (...args: unknown[]) => Promise<unknown>;
          };

          if (!proto.__queuedLoadHoldPatched && typeof proto.loadFromFile === 'function') {
            proto.__queuedLoadHoldPatched = true;
            const originalLoadFromFile = proto.loadFromFile;
            let releaseFirstLoad!: () => void;
            const firstLoadGate = new Promise<void>((resolve) => {
              releaseFirstLoad = resolve;
            });

            (
              window as Window & { __releaseFirstProtspaceLoad?: () => void }
            ).__releaseFirstProtspaceLoad = () => {
              releaseFirstLoad();
            };

            proto.loadFromFile = async function (...args: unknown[]) {
              const state = window as Window & { __firstProtspaceLoadHeld?: boolean };
              if (!state.__firstProtspaceLoadHeld) {
                state.__firstProtspaceLoadHeld = true;
                await firstLoadGate;
              }

              return originalLoadFromFile.apply(this, args);
            };
          }
        }

        return originalDefine(name, constructor, options);
      };
    });

    await page.goto('/explore');
    await clearPersistedDataset(page);
    await writeUnreadablePersistedDataset(page);

    await page.goto('/explore');
    await page.waitForFunction(() => {
      const loader = document.getElementById('myDataLoader') as {
        loadFromFile?: (file: File, options?: { source?: 'user' | 'auto' }) => Promise<void>;
      } | null;
      return typeof loader?.loadFromFile === 'function';
    });

    const userLoadPromise = loadCustomDatasetFromPath(
      page,
      CUSTOM_5K_BUNDLE_PATH,
      CUSTOM_5K_BUNDLE_NAME,
    );
    await page.waitForFunction(
      () => (window as Window & { __firstProtspaceLoadHeld?: boolean }).__firstProtspaceLoadHeld,
    );
    await page.evaluate(() => {
      (
        window as Window & { __releaseFirstProtspaceLoad?: () => void }
      ).__releaseFirstProtspaceLoad?.();
    });
    await userLoadPromise;
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    await expect.poll(() => getCurrentDatasetName(page)).toBe(CUSTOM_5K_BUNDLE_NAME);
    await dismissTourIfPresent(page);

    expect(await getProteinCount(page)).toBe(CUSTOM_5K_PROTEIN_COUNT);
    expect(await getCurrentDatasetName(page)).toBe(CUSTOM_5K_BUNDLE_NAME);
  });

  test('OPFS access restrictions show a toast without blocking the current session load', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.storage, 'getDirectory', {
        configurable: true,
        value: async () => {
          throw new DOMException('Security error when calling GetDirectory', 'SecurityError');
        },
      });
    });

    await openExplore(page);

    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);

    await expect(
      page.getByText('Dataset loaded, but automatic reload is unavailable.'),
    ).toBeVisible();
    await expect(page.getByText(/private\/incognito mode/i)).toBeVisible();
    await expect(page.getByText(/browser storage is restricted/i)).toBeVisible();

    expect(await getProteinCount(page)).not.toBe(defaultCount);
  });
});

test.describe('Unified app notifications', () => {
  test.beforeEach(async ({ page }) => {
    await openExplore(page);
  });

  test('corrupted persisted datasets fall back to the demo with an in-app warning', async ({
    page,
  }) => {
    const dialogMessages: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.dismiss();
    });

    const defaultCount = await getProteinCount(page);
    await writeCorruptedPersistedDataset(page);

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await expect(page.getByText('Saved dataset was cleared.')).toBeVisible();
    await expect(page.getByText(/loaded the default demo dataset/i)).toBeVisible();
    expect(await getProteinCount(page)).toBe(defaultCount);
    expect(dialogMessages).toEqual([]);
  });

  test('an unreadable persisted dataset falls back to the demo and then clears the overlay', async ({
    page,
  }) => {
    const defaultCount = await getProteinCount(page);
    await writeUnreadablePersistedDataset(page);

    await page.reload();
    // The overlay stays up through the demo fetch and must be gone once the demo has loaded.
    await waitForExploreDataLoad(page, { proteinCount: defaultCount });
    await dismissTourIfPresent(page);

    await expect(page.getByText('Saved dataset was cleared.')).toBeVisible();
    expect(await getCurrentDatasetName(page)).not.toBe('corrupt.parquetbundle');
  });

  test('successful parquet exports show the unified success toast', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');

    await dispatchCustomEvent(page, '#myControlBar', 'export', {
      type: 'parquet',
      includeLegendSettings: false,
      includeExportOptions: false,
    });

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.parquetbundle');
    await expect(page.getByText('Export ready.')).toBeVisible();
    await expect(page.getByText(/\.parquetbundle/i)).toBeVisible();
  });

  test('failed exports show the unified error toast', async ({ page }) => {
    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    await page.evaluate(() => {
      const plot = document.getElementById('myPlot') as { getCurrentData?: () => unknown } | null;
      if (!plot) {
        throw new Error('Scatterplot element not found');
      }

      plot.getCurrentData = () => null;
    });

    await dispatchCustomEvent(page, '#myControlBar', 'export', {
      type: 'parquet',
      includeLegendSettings: false,
      includeExportOptions: false,
    });

    await expect(page.getByText('Export failed.')).toBeVisible();
    await expect(page.getByText('No data available for export')).toBeVisible();
    expect(dialogSeen).toBe(false);
  });
});

test.describe('Bundle format notice', () => {
  const LEGACY_BUNDLES = [
    { version: 1, path: path.resolve(SPEC_DIR, 'fixtures/raw_numeric_test.parquetbundle') },
    {
      version: 2,
      path: path.resolve(
        SPEC_DIR,
        '../../../packages/core/src/components/data-loader/utils/__fixtures__/v2-sample.parquetbundle',
      ),
    },
  ];
  const NOTICE = 'This file uses an older bundle format.';

  test.beforeEach(async ({ page }) => {
    await openExplore(page);
  });

  async function importAndWait(page: Page, datasetPath: string): Promise<void> {
    const defaultCount = await getProteinCount(page);
    await loadCustomDatasetFromImportMenu(page, datasetPath);
    await waitForExploreDataLoad(page, { changedFrom: defaultCount });
  }

  for (const { version, path: bundlePath } of LEGACY_BUNDLES) {
    test(`importing a v${version} bundle points to re-export and protspace convert`, async ({
      page,
    }) => {
      await importAndWait(page, bundlePath);

      await expect(page.getByText(NOTICE)).toBeVisible();
      await expect(page.getByText(`Format v${version} bundles will stop opening`)).toBeVisible();
      await expect(page.getByText(/protspace convert/)).toBeVisible();
    });
  }

  test('neither the startup demo nor an imported v3 bundle shows the notice', async ({ page }) => {
    // The demo loaded in beforeEach; the import is the 5K bundle as `protspace convert` wrote it.
    await importAndWait(page, TOXPROT_5181_V3_FIXTURE);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);

    await expect(page.getByText(NOTICE)).toHaveCount(0);
  });
});
