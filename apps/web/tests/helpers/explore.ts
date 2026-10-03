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

/**
 * Wait until the loading overlay is gone, polling every 100 ms. A locator assertion would back
 * off to 500 ms polls after a few hundred milliseconds, adding up to half a second to every load
 * whose post-load work runs that long. An overlay that stays up fails the wait with that reason.
 */
async function waitForLoadingOverlayRemoved(page: Page, timeout: number): Promise<void> {
  try {
    await page.waitForFunction(() => !document.getElementById('progressive-loading'), undefined, {
      timeout,
      polling: 100,
    });
  } catch (error) {
    throw new Error(
      `The loading overlay (#progressive-loading) was still shown after ${timeout} ms`,
      {
        cause: error,
      },
    );
  }
}

interface ExploreDataLoadOptions {
  /** Applies to each stage of the wait. Defaults to 30 s. */
  timeout?: number;
  /** Wait for exactly this many proteins, so the wait cannot pass on the previous dataset. */
  proteinCount?: number;
  /**
   * Wait for any protein count other than this one, for a replacement dataset whose size the
   * test does not know. Pass the count read before the load was started.
   */
  changedFrom?: number;
}

/**
 * Wait until an Explore load has settled: the plot holds the expected data and the loading
 * overlay is gone.
 *
 * The app removes the overlay synchronously once a load's post-load work (view restore,
 * persistence bookkeeping) has finished, so its absence is the settle signal. An overlay that
 * stays up is a bug, and the wait fails instead of swallowing it. The protein-count gate comes
 * first because the overlay is also absent before a queued load has started. The closing
 * animation frame lets the scatterplot rebuild its point index, which it does in a
 * requestAnimationFrame after a data or projection update.
 */
export async function waitForExploreDataLoad(
  page: Page,
  { timeout = 30_000, proteinCount, changedFrom }: ExploreDataLoadOptions = {},
): Promise<void> {
  await page.waitForSelector('#myPlot', { timeout });
  await page.waitForFunction(
    ({ exact, previous }) => {
      const plot = document.querySelector('#myPlot') as
        | (Element & {
            data?: { protein_ids?: string[] };
          })
        | null;
      const count = plot?.data?.protein_ids?.length ?? 0;
      if (exact !== null) return count === exact;
      return count > 0 && count !== previous;
    },
    { exact: proteinCount ?? null, previous: changedFrom ?? null },
    { timeout, polling: 100 },
  );
  await waitForLoadingOverlayRemoved(page, timeout);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

/** {@link waitForExploreDataLoad} for a dataset of a known size. */
export async function waitForProteinCount(
  page: Page,
  proteinCount: number,
  timeout = 30_000,
): Promise<void> {
  await waitForExploreDataLoad(page, { timeout, proteinCount });
}

/** How many proteins the plot currently holds. */
export async function getProteinCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { protein_ids?: string[] } })
      | null;
    return plot?.data?.protein_ids?.length ?? 0;
  });
}

export async function waitForExploreInteractionReady(page: Page, timeout = 10_000): Promise<void> {
  await waitForLoadingOverlayRemoved(page, timeout);
  await dismissTourIfPresent(page);
  await expect(page.locator('.driver-overlay')).toBeHidden({ timeout });
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
