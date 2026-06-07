import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  clickLegendItem,
  dismissTourIfPresent,
  getFirstLegendItemValue,
  isLegendItemHidden,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
  waitForPersistedExploreDataset,
} from './helpers/explore';

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const CUSTOM_5K_BUNDLE_PATH = path.resolve(SPEC_DIR, '../public/data/5K.parquetbundle');
const CUSTOM_5K_PROTEIN_COUNT = 5181;

async function getProteinCount(page: Page): Promise<number> {
  const count = await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    return plot?.data?.protein_ids?.length ?? 0;
  });

  return Number(count);
}

async function waitForProteinCount(page: Page, expected: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const plot = document.querySelector('#myPlot') as any;
      return plot?.data?.protein_ids?.length === target;
    },
    expected,
    { timeout, polling: 500 },
  );
  await page
    .locator('#progressive-loading')
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {});
}

/** Find a protspace legend localStorage key. */
async function findLegendStorageKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('protspace:legend:')) return key;
    }
    return null;
  });
}

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

async function openImportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const ownDataset = page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]');
  // Importing a custom dataset leaves the menu open (nothing closes it), so only
  // click the trigger when the menu is closed — re-clicking would toggle it shut.
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
  }
  await expect(ownDataset).toBeVisible();
}

async function loadCustomDatasetFromImportMenu(page: Page, datasetPath: string): Promise<void> {
  await openImportMenu(page);
  await page
    .locator('protspace-data-loader')
    .locator('input[type="file"]')
    .setInputFiles(datasetPath);
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

async function getCurrentDatasetName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const controlBar = document.getElementById('myControlBar') as {
      currentDatasetName?: string;
    } | null;
    return controlBar?.currentDatasetName ?? null;
  });
}

async function loadDemoDatasetFromImportMenu(page: Page): Promise<void> {
  await openImportMenu(page);
  await page.locator('protspace-control-bar [data-driver-id="import-demo-dataset"]').click();
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

async function hasLegacyNotificationHelperArtifacts(page: Page): Promise<boolean> {
  return page.evaluate(() => document.getElementById('protspace-notification-styles') !== null);
}

async function dispatchParquetExport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlBar = document.getElementById('myControlBar');
    controlBar?.dispatchEvent(
      new CustomEvent('export', {
        detail: {
          type: 'parquet',
        },
      }),
    );
  });
}

async function dispatchBrokenParquetExport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const plot = document.getElementById('myPlot') as {
      getCurrentData?: () => unknown;
    } | null;
    if (plot?.getCurrentData) {
      plot.getCurrentData = () => null;
    }

    const controlBar = document.getElementById('myControlBar');
    controlBar?.dispatchEvent(
      new CustomEvent('export', {
        detail: {
          type: 'parquet',
        },
      }),
    );
  });
}

async function dispatchSelectionDisabledNotification(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlBar = document.getElementById('myControlBar');
    controlBar?.dispatchEvent(
      new CustomEvent('selection-disabled-notification', {
        detail: {
          message: 'Selection mode disabled: Only 1 point remaining',
          severity: 'warning',
          source: 'control-bar',
          context: {
            reason: 'insufficient-data',
            dataSize: 1,
          },
        },
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Dataset reload resets state (#178)', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the product tour so it doesn't interfere
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await clearPersistedDataset(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
  });

  test('page reload restores default legend state', async ({ page }) => {
    const itemValue = await getFirstLegendItemValue(page);

    // Item should start visible
    expect(await isLegendItemHidden(page, itemValue)).toBe(false);

    // Click to hide the item
    await clickLegendItem(page, itemValue);
    await expect.poll(() => isLegendItemHidden(page, itemValue)).toBe(true);

    // Verify localStorage was written
    await expect.poll(() => findLegendStorageKey(page)).not.toBeNull();

    // Reload the page
    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    // After reload, the item should be visible again (default state restored)
    expect(await isLegendItemHidden(page, itemValue)).toBe(false);
  });

  test('legend localStorage is cleared on reload', async ({ page }) => {
    const itemValue = await getFirstLegendItemValue(page);

    // Modify legend state
    await clickLegendItem(page, itemValue);
    await expect.poll(() => isLegendItemHidden(page, itemValue)).toBe(true);

    // Verify localStorage has legend entries
    await expect.poll(() => findLegendStorageKey(page)).not.toBeNull();
    const storageKey = await findLegendStorageKey(page);

    const savedSettings = await page.evaluate((key) => {
      return JSON.parse(localStorage.getItem(key!) || '{}');
    }, storageKey);
    expect(savedSettings.hiddenValues).toContain(itemValue);

    // Reload the page
    await page.reload();
    await waitForExploreDataLoad(page);

    // After reload + file settings applied, hiddenValues should not contain our item
    const reloadedKey = await findLegendStorageKey(page);
    if (reloadedKey) {
      const reloadedSettings = await page.evaluate((key) => {
        return JSON.parse(localStorage.getItem(key!) || '{}');
      }, reloadedKey);
      expect(reloadedSettings.hiddenValues ?? []).not.toContain(itemValue);
    }
  });
});

test.describe('Persisted custom datasets in OPFS (#176)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await clearPersistedDataset(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
  });

  test('reload restores the last imported custom dataset and its local settings', async ({
    page,
  }) => {
    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await page.waitForFunction(
      (originalCount) => {
        const plot = document.querySelector('#myPlot') as any;
        return (
          plot?.data?.protein_ids?.length > 0 && plot.data.protein_ids.length !== originalCount
        );
      },
      defaultCount,
      { polling: 500, timeout: 30_000 },
    );
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

  test('reset to demo clears the persisted custom dataset', async ({ page }) => {
    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await page.waitForFunction(
      (originalCount) => {
        const plot = document.querySelector('#myPlot') as any;
        return (
          plot?.data?.protein_ids?.length > 0 && plot.data.protein_ids.length !== originalCount
        );
      },
      defaultCount,
      { polling: 500, timeout: 30_000 },
    );
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
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    const lifecycle = await measureSingleImportLifecycle(page, async () => {
      await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
      await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);
    });

    expect(lifecycle.loadingStarts).toBe(1);
    expect(lifecycle.loadedEvents).toBe(1);
    expect(await getCurrentDatasetName(page)).toBe('5K.parquetbundle');
  });
});

test.describe('Persisted dataset failure handling', () => {
  test('corrupted persisted datasets are cleared and replaced with the demo dataset', async ({
    page,
  }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await clearPersistedDataset(page);
    await writeCorruptedPersistedDataset(page);

    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await expect(page.getByText('Saved dataset was cleared.')).toBeVisible();
    await expect(page.getByText(/loaded the default demo dataset instead/i)).toBeVisible();
    expect(await getProteinCount(page)).toBeGreaterThan(0);
  });

  test('queued user imports win over corrupted OPFS fallback recovery', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('driver.overviewTour', 'true');

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
      '5K.parquetbundle',
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
    await expect.poll(() => getCurrentDatasetName(page)).toBe('5K.parquetbundle');
    await dismissTourIfPresent(page);

    expect(await getProteinCount(page)).toBe(CUSTOM_5K_PROTEIN_COUNT);
    expect(await getCurrentDatasetName(page)).toBe('5K.parquetbundle');
  });

  test('OPFS access restrictions show a toast without blocking the current session load', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('driver.overviewTour', 'true');
      Object.defineProperty(navigator.storage, 'getDirectory', {
        configurable: true,
        value: async () => {
          throw new DOMException('Security error when calling GetDirectory', 'SecurityError');
        },
      });
    });

    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await page.waitForFunction(
      (originalCount) => {
        const plot = document.querySelector('#myPlot') as any;
        return (
          plot?.data?.protein_ids?.length > 0 && plot.data.protein_ids.length !== originalCount
        );
      },
      defaultCount,
      { polling: 500, timeout: 30_000 },
    );

    await expect(
      page.getByText('Dataset loaded, but automatic reload is unavailable.'),
    ).toBeVisible();
    await expect(page.getByText(/private\/incognito mode/i)).toBeVisible();
    await expect(page.getByText(/browser storage is restricted/i)).toBeVisible();

    expect(await getProteinCount(page)).not.toBe(defaultCount);
  });

  test('unsupported browsers show an OPFS support toast without blocking the current session load', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('driver.overviewTour', 'true');
      Object.defineProperty(navigator.storage, 'getDirectory', {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    const defaultCount = await getProteinCount(page);

    await loadCustomDatasetFromImportMenu(page, CUSTOM_5K_BUNDLE_PATH);
    await page.waitForFunction(
      (originalCount) => {
        const plot = document.querySelector('#myPlot') as any;
        return (
          plot?.data?.protein_ids?.length > 0 && plot.data.protein_ids.length !== originalCount
        );
      },
      defaultCount,
      { polling: 500, timeout: 30_000 },
    );

    await expect(
      page.getByText('Dataset loaded, but automatic reload is unavailable.'),
    ).toBeVisible();
    await expect(page.getByText(/does not support the Origin Private File System/i)).toBeVisible();

    expect(await getProteinCount(page)).not.toBe(defaultCount);
  });

  test('corrupted persisted datasets fall back to the demo and show a toast instead of a browser dialog', async ({
    page,
  }) => {
    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    const defaultCount = await getProteinCount(page);
    await writeCorruptedPersistedDataset(page);

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await expect(page.getByText('Saved dataset was cleared.')).toBeVisible();
    await expect(page.getByText(/loaded the default demo dataset instead/i)).toBeVisible();
    expect(await getProteinCount(page)).toBe(defaultCount);
    expect(dialogSeen).toBe(false);
  });

  test('dataset load failures show a toast instead of a browser dialog', async ({ page }) => {
    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await page.evaluate(async () => {
      const loader = document.getElementById('myDataLoader') as unknown as {
        loadFromFile: (file: File) => Promise<void>;
      } | null;
      if (!loader) {
        throw new Error('Missing data loader');
      }

      const file = new File(['not-a-valid-bundle'], 'broken.parquetbundle', {
        type: 'application/octet-stream',
      });
      await loader.loadFromFile(file);
    });

    await expect(page.getByText('Dataset import failed.')).toBeVisible();
    expect(dialogSeen).toBe(false);
  });

  test('successful parquet exports show a Sonner toast', async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await dispatchParquetExport(page);

    await expect(page.getByText('Export ready.')).toBeVisible();
    await expect(page.getByText(/\.parquetbundle/i)).toBeVisible();
  });

  test('failed parquet exports show a toast instead of a browser dialog', async ({ page }) => {
    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await dispatchBrokenParquetExport(page);

    await expect(page.getByText('Export failed.')).toBeVisible();
    await expect(page.getByText('No data available for export')).toBeVisible();
    expect(dialogSeen).toBe(false);
  });

  test('selection-disabled notifications use the shared Sonner path', async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    await dispatchSelectionDisabledNotification(page);

    await expect(page.getByText('Selection mode disabled.')).toBeVisible();
    await expect(page.getByText('Selection mode disabled: Only 1 point remaining')).toBeVisible();
  });
});

test.describe('Unified app notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await clearPersistedDataset(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
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
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
  });

  test('normalized data-error events surface a toast instead of a browser dialog', async ({
    page,
  }) => {
    const dialogMessages: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.dismiss();
    });

    await dispatchCustomEvent(page, '#myDataLoader', 'data-error', {
      message: 'Invalid parquet bundle',
      severity: 'error',
      source: 'data-loader',
      context: {
        operation: 'load',
      },
    });

    await expect(page.getByText('Dataset import failed.')).toBeVisible();
    await expect(page.getByText('Invalid parquet bundle')).toBeVisible();
    expect(dialogMessages).toEqual([]);
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
  });

  test('selection-disabled-notification uses the unified warning toast path', async ({ page }) => {
    await dispatchCustomEvent(page, '#myControlBar', 'selection-disabled-notification', {
      message: 'Selection mode disabled: Only 1 point remaining',
      severity: 'warning',
      source: 'control-bar',
      context: {
        reason: 'insufficient-data',
        dataSize: 1,
      },
    });

    await expect(page.getByText('Selection mode disabled.')).toBeVisible();
    await expect(page.getByText('Selection mode disabled: Only 1 point remaining')).toBeVisible();
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
  });

  test('structure-error events stay inline and do not create global toasts', async ({ page }) => {
    await dispatchCustomEvent(page, '#myStructureViewer', 'structure-error', {
      message: 'No 3D structure was found for P12345.',
      severity: 'error',
      source: 'structure-viewer',
      context: {
        proteinId: 'P12345',
      },
    });

    await page.waitForTimeout(500);

    await expect(page.getByText('Structure could not be loaded.')).toHaveCount(0);
    await expect(page.getByText('No 3D structure was found for P12345.')).toHaveCount(0);
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
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
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
  });

  test('failed exports show the unified error toast', async ({ page }) => {
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
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
  });
});
