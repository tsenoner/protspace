import { expect, type Page } from '@playwright/test';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function dismissTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole('dialog', { name: 'Welcome to ProtSpace' });
  const skipButton = page.getByRole('button', { name: 'Skip' });
  const closeButton = page.getByRole('button', { name: 'Close' }).first();

  if (await tourDialog.isVisible()) {
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
    } else if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    }

    await expect(tourDialog).toBeHidden();
    return;
  }

  const legacySkipButton = page.locator('.driver-tour-skip-btn');
  if ((await legacySkipButton.count()) > 0) {
    await legacySkipButton.click();
    await page.waitForSelector('.driver-popover', { state: 'detached', timeout: 5_000 });
  }
}

export async function waitForExploreDataLoad(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForSelector('#myPlot', { timeout });
  await page.waitForFunction(
    () => {
      const plot = document.querySelector('#myPlot') as
        | (Element & {
            data?: { protein_ids?: string[] };
          })
        | null;
      return (plot?.data?.protein_ids?.length ?? 0) > 0;
    },
    undefined,
    { timeout, polling: 500 },
  );
  await page
    .locator('#progressive-loading')
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {});
}

export async function waitForExploreInteractionReady(page: Page, timeout = 10_000): Promise<void> {
  await page
    .locator('#progressive-loading')
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {});
  await dismissTourIfPresent(page);
  await page
    .locator('.driver-overlay')
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {});
}

export async function getProteinCount(page: Page): Promise<number> {
  const count = await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as { data?: { protein_ids?: string[] } } | null;
    return plot?.data?.protein_ids?.length ?? 0;
  });
  return Number(count);
}

export async function waitForProteinCount(
  page: Page,
  expected: number,
  timeout = 30_000,
): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const plot = document.querySelector('#myPlot') as {
        data?: { protein_ids?: string[] };
      } | null;
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

/** The view the control bar shows: colour-by annotation, projection and tooltip annotations. */
export interface ControlBarView {
  annotation: string | null;
  projection: string | null;
  tooltip: string[];
}

export async function getControlBarView(page: Page): Promise<ControlBarView> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & {
          selectedAnnotation?: string;
          selectedProjection?: string;
          tooltipAnnotations?: string[];
        })
      | null;
    return {
      annotation: controlBar?.selectedAnnotation ?? null,
      projection: controlBar?.selectedProjection ?? null,
      tooltip: [...(controlBar?.tooltipAnnotations ?? [])],
    };
  });
}

/** A catalog entry's curated view, in the shape `getControlBarView` reads. */
export function curatedViewOf(entry: {
  defaultView: { projection: string; annotation: string; tooltip?: readonly string[] };
}): ControlBarView {
  return {
    annotation: entry.defaultView.annotation,
    projection: entry.defaultView.projection,
    tooltip: [...(entry.defaultView.tooltip ?? [])],
  };
}

/**
 * Collects the development-mode warnings `dataset-controller.ts` logs when a
 * loaded example's bundle lacks one of its `defaultView` names.
 */
export function collectDefaultViewDriftWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('defaultView names missing')) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

export async function getCurrentDatasetName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { currentDatasetName?: string })
      | null;
    return controlBar?.currentDatasetName ?? null;
  });
}

export async function openImportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const ownDataset = page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]');
  // Importing a custom dataset leaves the menu open (nothing closes it), so only
  // click the trigger when the menu is closed — re-clicking would toggle it shut.
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
  }
  await expect(ownDataset).toBeVisible();
}

export async function getFirstLegendItemValue(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const item = legend?.shadowRoot?.querySelector(
      '.legend-item:not([data-value="Other"]):not([data-value="__NA__"])',
    );
    return item?.getAttribute('data-value') ?? null;
  });

  if (!value) {
    throw new Error('No legend item found');
  }

  return value;
}

export async function clickLegendItem(page: Page, value: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page
    .locator('protspace-legend')
    .getByRole('button', { name: new RegExp(`^${escapeRegex(value)}:`) })
    .click();
}

export async function isLegendItemHidden(page: Page, value: string): Promise<boolean> {
  return page.evaluate((targetValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const item = legend?.shadowRoot?.querySelector(
      `.legend-item[data-value="${CSS.escape(targetValue)}"]`,
    );
    return item?.classList.contains('hidden') ?? false;
  }, value);
}

export async function waitForPersistedExploreDataset(page: Page, timeout = 30_000): Promise<void> {
  const supportsOpfs = await supportsExplorePersistedDataset(page);
  if (!supportsOpfs) {
    throw new Error('OPFS is unavailable in this browser.');
  }

  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const hasReadyPersistedDataset = await page.evaluate(async () => {
      const storageWithDirectory = navigator.storage as StorageManager & {
        getDirectory?: () => Promise<FileSystemDirectoryHandle>;
      };

      if (typeof storageWithDirectory.getDirectory !== 'function') {
        return false;
      }

      const root = await storageWithDirectory.getDirectory();
      try {
        const dir = await root.getDirectoryHandle('protspace-last-import');
        const metadataHandle = await dir.getFileHandle('metadata.json');
        await dir.getFileHandle('dataset.bin');
        const metadata = JSON.parse(await (await metadataHandle.getFile()).text()) as {
          schemaVersion?: number;
          lastLoadStatus?: string;
        };

        // Schema v1 predates load-status tracking and represents a dataset that
        // completed under the previous persistence implementation. Current
        // schema entries are reload-safe only after finalization marks success.
        return metadata.schemaVersion === 1 || metadata.lastLoadStatus === 'success';
      } catch {
        return false;
      }
    });

    if (hasReadyPersistedDataset) {
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error('Timed out waiting for the persisted OPFS dataset load to finalize.');
}

export async function supportsExplorePersistedDataset(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const storageWithDirectory = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };

    // navigator.storage is undefined on about:blank (before any navigation),
    // so guard before reading getDirectory.
    if (typeof storageWithDirectory?.getDirectory !== 'function') {
      return false;
    }

    // WebKit exposes getDirectory but its OPFS operations can fail with a
    // transient UnknownError, so verify a real write/read/delete round-trip
    // works before relying on persistence.
    try {
      const root = await storageWithDirectory.getDirectory();
      const probe = '.protspace-opfs-probe';
      const handle = await root.getFileHandle(probe, { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array([1]));
      await writable.close();
      await root.removeEntry(probe);
      return true;
    } catch {
      return false;
    }
  });
}

interface ExploreViewStability {
  loadStarts: number;
  overlayShows: number;
  initialNavigationEntries: number;
  navigationEntries: number;
  samePlot: boolean;
  sameLoader: boolean;
  overlayPresent: boolean;
}

async function installViewStabilityProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as Window & {
      __viewStabilityProbe?: {
        loadStarts: number;
        overlayShows: number;
        navigationEntries: number;
        plotBefore: Element | null;
        loaderBefore: Element | null;
        observer?: MutationObserver;
        onLoadStart?: EventListener;
      };
    };

    win.__viewStabilityProbe?.observer?.disconnect();
    const previousLoadStart = win.__viewStabilityProbe?.onLoadStart;
    const loader = document.getElementById('myDataLoader');
    if (loader && previousLoadStart) {
      loader.removeEventListener('data-loading-start', previousLoadStart);
    }

    const probe = {
      loadStarts: 0,
      overlayShows: 0,
      navigationEntries: performance.getEntriesByType('navigation').length,
      plotBefore: document.getElementById('myPlot'),
      loaderBefore: document.getElementById('myDataLoader'),
    };

    const onLoadStart: EventListener = () => {
      probe.loadStarts += 1;
    };
    loader?.addEventListener('data-loading-start', onLoadStart);

    const observer = new MutationObserver(() => {
      if (document.getElementById('progressive-loading')) {
        probe.overlayShows += 1;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    win.__viewStabilityProbe = {
      ...probe,
      observer,
      onLoadStart,
    };
  });
}

async function readViewStabilityProbe(page: Page): Promise<ExploreViewStability> {
  return page.evaluate(() => {
    const win = window as Window & {
      __viewStabilityProbe?: {
        loadStarts: number;
        overlayShows: number;
        navigationEntries: number;
        plotBefore: Element | null;
        loaderBefore: Element | null;
        observer?: MutationObserver;
        onLoadStart?: EventListener;
      };
    };

    const probe = win.__viewStabilityProbe;
    const loader = document.getElementById('myDataLoader');
    probe?.observer?.disconnect();
    if (loader && probe?.onLoadStart) {
      loader.removeEventListener('data-loading-start', probe.onLoadStart);
    }

    return {
      loadStarts: probe?.loadStarts ?? 0,
      overlayShows: probe?.overlayShows ?? 0,
      initialNavigationEntries: probe?.navigationEntries ?? 0,
      navigationEntries: performance.getEntriesByType('navigation').length,
      samePlot: document.getElementById('myPlot') === (probe?.plotBefore ?? null),
      sameLoader: document.getElementById('myDataLoader') === (probe?.loaderBefore ?? null),
      overlayPresent: document.getElementById('progressive-loading') !== null,
    };
  });
}

export async function captureExploreViewStability(
  page: Page,
  action: () => Promise<void>,
): Promise<ExploreViewStability> {
  await installViewStabilityProbe(page);
  await action();
  return readViewStabilityProbe(page);
}
