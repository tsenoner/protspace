import { expect, type Locator, type Page } from '@playwright/test';

// The legend helpers live in helpers/legend.ts; these three are re-exported for their old callers.
export { clickLegendItem, getFirstLegendItemValue, isLegendItemHidden } from './legend';

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

/**
 * Opens Explore at `/explore` plus `search`, waits for its dataset to load and
 * closes the product tour; given `count`, also waits until the plot holds that
 * many proteins.
 */
export async function openExplore(page: Page, search = '', count?: number): Promise<void> {
  await page.goto(`/explore${search}`);
  await waitForExploreDataLoad(page, { proteinCount: count });
  await dismissTourIfPresent(page);
}

/** The decoded value of the page URL's `key` query parameter, or null when it is absent. */
export async function getUrlParam(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => new URL(window.location.href).searchParams.get(name), key);
}

/**
 * Waits until the page URL's `key` query parameter decodes to `expected` (null:
 * absent), robust to `+`/`%20`/em-dash encoding.
 */
export async function expectUrlParam(
  page: Page,
  key: string,
  expected: string | null,
): Promise<void> {
  await expect.poll(() => getUrlParam(page, key)).toBe(expected);
}

/**
 * Holds the next request matching `glob` until the returned function is
 * called. The page may abort the held request meanwhile (a cancelled or
 * superseded download), so continuing it is allowed to fail.
 */
export async function holdNextRequest(page: Page, glob: string): Promise<() => void> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    glob,
    async (route) => {
      await gate;
      await route.fallback().catch(() => {});
    },
    { times: 1 },
  );
  return release;
}

// ─── Regions ───────────────────────────────────────────────────────────────────
// The workbench's regions, by the data-workbench hooks the shell renders. Specs reach controls
// through the helpers below, which find them by role, accessible name or tag (Playwright's CSS
// pierces shadow roots). When a control moves, a helper's internals change and no spec does.

export const appBar = (page: Page): Locator => page.locator('[data-workbench="app-bar"]');
export const viewBar = (page: Page): Locator => page.locator('[data-workbench="view-bar"]');
export const plotArea = (page: Page): Locator => page.locator('[data-workbench="plot"]');
export const sidebar = (page: Page): Locator => page.locator('[data-workbench="sidebar"]');

// ─── View state ────────────────────────────────────────────────────────────────

/** The view the plot shows: colour-by annotation, projection and tooltip annotations. */
export interface ViewState {
  annotation: string | null;
  projection: string | null;
  tooltip: string[];
}

/** The view, read from #myPlot whichever controls show it. */
export async function getViewState(page: Page): Promise<ViewState> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & {
          selectedAnnotation?: string;
          selectedProjectionIndex?: number;
          tooltipAnnotations?: string[];
          data?: { projections?: Array<{ name: string }> } | null;
        })
      | null;
    const index = plot?.selectedProjectionIndex ?? -1;
    return {
      annotation: plot?.selectedAnnotation ?? null,
      projection: plot?.data?.projections?.[index]?.name ?? null,
      tooltip: [...(plot?.tooltipAnnotations ?? [])],
    };
  });
}

/** A catalog entry's curated view, in the shape `getViewState` reads. */
export function curatedViewOf(entry: {
  defaultView: { projection: string; annotation: string; tooltip?: readonly string[] };
}): ViewState {
  return {
    annotation: entry.defaultView.annotation,
    projection: entry.defaultView.projection,
    tooltip: [...(entry.defaultView.tooltip ?? [])],
  };
}

/** The annotations Color by offers, in its order (tooltip-only and EAT-confidence columns left out). */
export async function getColorByOptions(page: Page): Promise<string[]> {
  return annotationSelect(page).evaluate(
    (select) => [...((select as Element & { annotations?: string[] }).annotations ?? [])],
    undefined,
    { timeout: 10_000 },
  );
}

/** The plot's contour mode. */
export async function getContoursMode(page: Page): Promise<'off' | 'auto' | 'on'> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { config?: { densityLayer?: 'off' | 'auto' | 'on' } })
      | null;
    return plot?.config?.densityLayer ?? 'off';
  });
}

/** The proteins the plot has selected. */
export async function getSelectedProteinIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { selectedProteinIds?: string[] })
      | null;
    return [...(plot?.selectedProteinIds ?? [])];
  });
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

/** The dataset the app bar names: an example's label or a file's name; null before a load. */
export async function getCurrentDatasetName(page: Page): Promise<string | null> {
  const name = await appBar(page)
    .locator('[data-workbench="dataset"]')
    .getAttribute('data-dataset-name');
  return name || null;
}

// ─── Controls ──────────────────────────────────────────────────────────────────

/** The Projection picker's trigger; its accessible name starts with "Projection". */
export const projectionTrigger = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^Projection/ });

/**
 * The Color by picker's trigger: the annotation select's first popup button. The select keeps its
 * trigger first when it moves to the view bar (Task 2.8).
 */
export const colorByTrigger = (page: Page): Locator =>
  annotationSelect(page).locator('button[aria-haspopup]').first();

/** The Import menu's trigger, in the app bar. */
export const importTrigger = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: 'Import', exact: true });

/** The element that holds the Import panel. */
export const importMenu = (page: Page): Locator => page.locator('#myImportMenu');

/** The element that holds the Export panel. */
export const exportMenu = (page: Page): Locator => page.locator('#myExportMenu');

/** The view bar's Filter button; its name reads "Filter" or "Filter, N conditions applied". */
export const filterButton = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^Filter/ });

/** The Filter dialog (`ps-dialog` headed "Filter"). */
export const filterDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Filter', exact: true });

export const queryBuilder = (page: Page): Locator => page.locator('protspace-query-builder');

/** The query builder's Apply button. */
export const filterApplyButton = (page: Page): Locator =>
  queryBuilder(page).getByRole('button', { name: 'Apply', exact: true });

/** The query builder's Reset button: it removes the filter. */
export const filterResetButton = (page: Page): Locator =>
  queryBuilder(page).getByRole('button', { name: 'Reset', exact: true });

export const annotationSelect = (page: Page): Locator =>
  page.locator('protspace-annotation-select');

export const searchInput = (page: Page): Locator =>
  page.locator('protspace-protein-search #protein-search-input');

/** The selection bar at the bottom of the plot; it shows while proteins are selected. */
export const selectionBar = (page: Page): Locator =>
  page.getByRole('toolbar', { name: 'Selection', exact: true });

/** One of the selection bar's actions. */
export const selectionBarAction = (
  page: Page,
  name: 'Show only these' | 'Zoom to them' | 'Copy IDs' | 'Clear',
): Locator => selectionBar(page).getByRole('button', { name, exact: true });

type StatusChipKind = 'filter' | 'isolation' | 'hidden';

const STATUS_CLEAR_NAMES: Readonly<Record<StatusChipKind, string>> = {
  filter: 'Remove filter',
  isolation: 'Show all proteins',
  hidden: 'Show hidden categories',
};

/** The plot's bottom-left corner: the protein count and a chip per narrowing. */
export const plotStatus = (page: Page): Locator => page.locator('#myPlotStatus');

/** The status corner's chip for one narrowing (filtered, isolated, categories hidden). */
export const statusChip = (page: Page, kind: StatusChipKind): Locator =>
  plotStatus(page).locator(`.status-chip[data-kind="${kind}"]`);

/** Presses a chip's ✕ by its name and waits until the chip is gone. */
export async function clearStatusChip(page: Page, kind: StatusChipKind): Promise<void> {
  await statusChip(page, kind)
    .getByRole('button', { name: STATUS_CLEAR_NAMES[kind], exact: true })
    .click();
  await expect(statusChip(page, kind)).toHaveCount(0);
}

// ─── Actions ───────────────────────────────────────────────────────────────────

/**
 * Opens the Import menu unless it is open. Importing a custom dataset leaves the menu open
 * (nothing closes it), so only click the trigger when the menu is closed: re-clicking toggles it.
 */
export async function openImportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const ownDataset = importMenu(page).locator('[data-driver-id="import-own-dataset"]');
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await importTrigger(page).click();
  }
  await expect(ownDataset).toBeVisible();
}

/** Chooses an example from the Import menu by its catalog id. */
export async function pickExample(page: Page, id: string): Promise<void> {
  await openImportMenu(page);
  await importMenu(page).locator(`[data-example-id="${id}"]`).click();
}

/** Opens the Export menu unless it is open; resolves once its formats show. */
export async function openExportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const png = exportMenu(page).getByRole('button', { name: 'PNG', exact: true });
  if (!(await png.isVisible().catch(() => false))) {
    await exportMenu(page).getByRole('button', { name: 'Export', exact: true }).click();
  }
  await expect(png).toBeVisible();
}

/** Opens the Filter dialog, from the view bar or from More, unless it is open already. */
export async function openFilter(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const dialog = filterDialog(page);
  if (await dialog.isVisible().catch(() => false)) return;
  if (await filterButton(page).isVisible()) {
    await filterButton(page).click();
  } else {
    await moreButton(page).click();
    await page.locator('#wb-more-menu').getByRole('menuitem', { name: 'Filter…' }).click();
  }
  await expect(dialog).toBeVisible();
}

/**
 * Imports `file` (a path, or a payload built in the test) through the data
 * loader's file input, the input the Import menu's "Load your dataset" opens.
 */
export async function importUserFile(
  page: Page,
  file: Parameters<Locator['setInputFiles']>[0],
): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.locator('protspace-data-loader').locator('input[type="file"]').setInputFiles(file);
}

type ViewHost = Element & { selectedAnnotation?: string; selectedProjectionIndex?: number };

/** Wait until every element in `selectors` reports `value` for `key`. */
async function waitForViewState(
  page: Page,
  key: 'selectedAnnotation' | 'selectedProjectionIndex',
  value: string | number,
  selectors: string[],
): Promise<void> {
  try {
    await page.waitForFunction(
      ({ key, value, selectors }) =>
        selectors.every(
          (selector) => (document.querySelector(selector) as ViewHost | null)?.[key] === value,
        ),
      { key, value, selectors },
      { timeout: 10_000 },
    );
  } catch (error) {
    const actual = await page
      .evaluate(
        ({ key, selectors }) =>
          selectors
            .map((s) => `${s} ${String((document.querySelector(s) as ViewHost | null)?.[key])}`)
            .join(', '),
        { key, selectors },
      )
      .catch(() => 'unreadable');
    throw new Error(`${key} never became ${JSON.stringify(value)} (still ${actual})`, {
      cause: error,
    });
  }
}

/**
 * Click a picker's menu item and wait until the pick is applied. A picker applies a pick after the
 * next paint and then dispatches `event` (composed). Re-picking the checked item dispatches
 * nothing, so that click is not waited on.
 */
async function pickFromMenu(
  page: Page,
  item: Locator,
  event: 'annotation-change' | 'projection-change',
): Promise<void> {
  // Projection marks its radio item; Color by marks the row's indicator.
  const checked = await item.evaluate(
    (el) =>
      el.getAttribute('aria-checked') === 'true' ||
      el.querySelector('[data-active="true"]') !== null,
  );
  if (checked) {
    await item.click();
    return;
  }
  const applied = await page.evaluateHandle((type) => {
    const state = { done: false };
    document.addEventListener(
      type,
      () => {
        state.done = true;
      },
      { once: true },
    );
    return state;
  }, event);
  await item.click();
  await page.waitForFunction((state) => state.done, applied, { timeout: 10_000 });
  await applied.dispose();
}

/**
 * Picks `annotation` from Color by. Its rows show the display label and carry the raw key on
 * `data-annotation`; the annotation select keeps those rows when it moves (Task 2.8).
 */
export async function selectAnnotation(page: Page, annotation: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  const item = annotationSelect(page)
    .locator(`.dropdown-item[data-annotation="${annotation}"]`)
    .first();
  // The trigger toggles, so only click it when the menu is closed.
  if (!(await item.isVisible())) await colorByTrigger(page).click();
  await expect(item, `annotation menu item "${annotation}" not shown`).toBeVisible({
    timeout: 5_000,
  });
  await pickFromMenu(page, item, 'annotation-change');
  await waitForViewState(page, 'selectedAnnotation', annotation, ['#myPlot', 'protspace-legend']);
}

/** Pick a projection by its position in the Projection menu (the plot's order), or by its label. */
export async function selectProjection(page: Page, projection: number | string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await projectionTrigger(page).click();
  const items = page.locator('protspace-projection-select').getByRole('menuitemradio');
  const item =
    typeof projection === 'number'
      ? items.nth(projection)
      : page
          .locator('protspace-projection-select')
          .getByRole('menuitemradio', { name: projection, exact: true });
  await pickFromMenu(page, item, 'projection-change');
  if (typeof projection === 'number') {
    await waitForViewState(page, 'selectedProjectionIndex', projection, ['#myPlot']);
  }
}

/** How each contour mode reads in the Contours menu. */
const CONTOUR_MENU_LABELS = { off: 'Off', auto: 'Auto', on: 'Always' } as const;

/** The view bar's More button; its name reads "More view options" (", N active" with its dot). */
function moreButton(page: Page): Locator {
  return viewBar(page).getByRole('button', { name: /^More view options/ });
}

/**
 * Sets the contour mode through the view bar's Contours menu, or through More while Contours sits
 * there, and waits until the plot shows it.
 */
export async function setContours(page: Page, mode: 'off' | 'auto' | 'on'): Promise<void> {
  await waitForExploreInteractionReady(page);
  const contours = viewBar(page).getByRole('button', { name: /^Contours/ });
  if (await contours.isVisible()) {
    await contours.click();
    await page
      .locator('protspace-contours-menu')
      .getByRole('menuitemradio', { name: new RegExp(`^${CONTOUR_MENU_LABELS[mode]}`) })
      .click();
  } else {
    await moreButton(page).click();
    await page
      .locator('#wb-more-menu')
      .getByRole('menuitemradio', { name: CONTOUR_MENU_LABELS[mode], exact: true })
      .click();
  }
  await expect.poll(() => getContoursMode(page)).toBe(mode);
}

const TOOL_STATES = {
  'Move and zoom': { selectionMode: false },
  'Box select': { selectionMode: true, selectionTool: 'rectangle' },
  'Lasso select': { selectionMode: true, selectionTool: 'lasso' },
} as const;

/** Picks a tool on the plot's tool strip and waits until the plot uses it. */
export async function chooseTool(
  page: Page,
  tool: 'Move and zoom' | 'Box select' | 'Lasso select',
): Promise<void> {
  await waitForExploreInteractionReady(page);
  const readTool = () =>
    page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as
        | (Element & { selectionMode?: boolean; selectionTool?: string })
        | null;
      return {
        selectionMode: plot?.selectionMode ?? false,
        selectionTool: plot?.selectionTool ?? 'rectangle',
      };
    });
  const wanted = TOOL_STATES[tool];
  await page
    .getByRole('toolbar', { name: 'Plot tools' })
    .getByRole('button', { name: tool, exact: true })
    .click();
  await expect
    .poll(async () => {
      const state = await readTool();
      return wanted.selectionMode ? state : { selectionMode: state.selectionMode };
    })
    .toEqual(wanted);
}

async function isIsolated(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { isIsolationMode?: () => boolean })
      | null;
    return plot?.isIsolationMode?.() ?? false;
  });
}

/** Clears the selection with the bar's Clear and waits until the plot holds none; a no-op with none. */
export async function clearSelection(page: Page): Promise<void> {
  if ((await getSelectedProteinIds(page)).length === 0) return;
  await selectionBarAction(page, 'Clear').click();
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
}

/** Isolates the selected proteins with Show only these and waits until the plot is isolated. */
export async function isolateSelection(page: Page): Promise<void> {
  await selectionBarAction(page, 'Show only these').click();
  await expect.poll(() => isIsolated(page)).toBe(true);
}

/** Leaves isolation with the isolation chip's ✕ and waits until the plot shows the full dataset. */
export async function resetIsolation(page: Page): Promise<void> {
  await clearStatusChip(page, 'isolation');
  await expect.poll(() => isIsolated(page)).toBe(false);
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
