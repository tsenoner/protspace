import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET, EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { TOUR_STORAGE_KEY } from '../src/tour/storage-key';
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import { expectProductDemo, openExample } from './helpers/examples';
import {
  appBar,
  applyFirstCategoryFilter,
  chooseTool,
  clearSelection,
  clearStatusChip,
  closeFilterPanel,
  expectUrlParam,
  exportMenu,
  filterButton,
  filterPanel,
  getColorByOptions,
  getContoursMode,
  getCurrentDatasetName,
  getFirstLegendItemValue,
  getProteinCount,
  getSelectedProteinIds,
  getViewState,
  importMenu,
  isolateSelection,
  openExplore,
  openExportMenu,
  openFilter,
  openImportMenu,
  pasteIntoSearch,
  pickExample,
  plotArea,
  queryBuilder,
  resetIsolation,
  searchInput,
  searchProteins,
  selectAnnotation,
  selectionBar,
  selectProjection,
  setContours,
  sidebar,
  statusChip,
  toast,
  waitForExploreDataLoad,
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';
import { figureEditor, openFigureEditor } from './helpers/figure';
import {
  closeLegendSettings,
  doubleClickLegendRow,
  dragLegendRow,
  legendRowValues,
  toggleLegendSetting,
} from './helpers/legend';
import {
  clusterScreenPoints,
  duplicateStacks,
  emptyScreenPointNear,
  plotSettled,
  proteinScreenPosition,
} from './helpers/plot';
import { waitForStructureLoaded, watchStructureLoads } from './helpers/structure';
import { exploreStorageState, seedTourSeen } from './helpers/tour-storage-state';
import { clickProteinNearPlotCentre, stubStructureRequests } from './helpers/workbench';

/**
 * The contract of the layout-free helpers in helpers/explore.ts. A task that moves a control
 * changes helper internals and re-runs this spec, which must keep passing unchanged.
 */

async function plotProjections(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { projections?: Array<{ name: string }> } | null })
      | null;
    return plot?.data?.projections?.map((projection) => projection.name) ?? [];
  });
}

async function plotTool(page: Page): Promise<{ selectionMode: boolean; selectionTool?: string }> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { selectionMode?: boolean; selectionTool?: string })
      | null;
    return { selectionMode: plot?.selectionMode ?? false, selectionTool: plot?.selectionTool };
  });
}

test.describe('explore helpers', () => {
  test("getViewState reads the plot's view", async ({ page }) => {
    await openExplore(page);
    const projections = await plotProjections(page);
    expect(projections.length).toBeGreaterThanOrEqual(2);

    await openExplore(
      page,
      `?annotation=ec&projection=${encodeURIComponent(projections[1])}&tooltip=pfam`,
    );
    await expect(plotArea(page).locator('#myPlot')).toBeVisible();
    const expected: ViewState = { annotation: 'ec', projection: projections[1], tooltip: ['pfam'] };
    await expect.poll(() => getViewState(page)).toEqual(expected);
  });

  test('selectProjection and selectAnnotation change the plot', async ({ page }) => {
    await openExplore(page);
    const before = await getViewState(page);
    const nextAnnotation = (await getColorByOptions(page)).find(
      (annotation) => annotation !== before.annotation,
    );
    expect(nextAnnotation).toBeTruthy();

    await selectAnnotation(page, nextAnnotation!);
    expect((await getViewState(page)).annotation).toBe(nextAnnotation);
    await expect
      .poll(() =>
        sidebar(page)
          .locator('#myLegend')
          .evaluate(
            (legend) => (legend as Element & { selectedAnnotation?: string }).selectedAnnotation,
          ),
      )
      .toBe(nextAnnotation);

    const projections = await plotProjections(page);
    const nextIndex = projections.findIndex((projection) => projection !== before.projection);
    await selectProjection(page, nextIndex);
    expect((await getViewState(page)).projection).toBe(projections[nextIndex]);
    await selectProjection(page, before.projection!);
    expect((await getViewState(page)).projection).toBe(before.projection);
  });

  test('selectProjection picks by name while search suggestions are open', async ({ page }) => {
    await openExplore(page);
    const projections = await plotProjections(page);
    const before = (await getViewState(page)).projection;
    const nextIndex = projections.findIndex((projection) => projection !== before);
    const firstId = await page.evaluate(
      () =>
        (document.querySelector('#myPlot') as Element & { data: { protein_ids: string[] } }).data
          .protein_ids[0],
    );
    await searchInput(page).fill(firstId.slice(0, 2));
    await expect(
      page.locator('protspace-protein-search').getByRole('option').first(),
    ).toBeVisible();

    await selectProjection(page, nextIndex);
    expect((await getViewState(page)).projection).toBe(projections[nextIndex]);
  });

  test("setContours changes the plot's contour mode and the URL", async ({ page }) => {
    await openExplore(page);
    expect(await getContoursMode(page)).toBe('off');

    await setContours(page, 'auto');
    expect(await getContoursMode(page)).toBe('auto');
    await expectUrlParam(page, 'density', 'auto');

    await setContours(page, 'on');
    await expectUrlParam(page, 'density', 'on');

    await setContours(page, 'off');
    expect(await getContoursMode(page)).toBe('off');
    await expectUrlParam(page, 'density', null);
  });

  test('openImportMenu shows the examples and pickExample loads one', async ({ page }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);

    await openImportMenu(page);
    await expect(importMenu(page).locator('[data-example-id]')).toHaveCount(
      EXAMPLE_DATASETS.length,
    );
    await pickExample(page, other.id);
    await waitForProteinCount(page, other.count);
    await expectUrlParam(page, 'dataset', other.id);
  });

  test('openExportMenu shows the export menu', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);
    const quickPng = exportMenu(page).getByRole('menuitem', { name: 'Quick PNG', exact: true });
    await expect(quickPng).toBeVisible();
    // An open menu stays open.
    await openExportMenu(page);
    await expect(quickPng).toBeVisible();
  });

  test('openFilter opens the Filter panel with its query builder', async ({ page }) => {
    await openExplore(page);
    await expect(filterButton(page)).toBeVisible();
    await openFilter(page);
    await expect(filterPanel(page)).toBeVisible();
    await expect(queryBuilder(page)).toBeVisible();
    // An open panel stays open.
    await openFilter(page);
    await expect(filterPanel(page)).toBeVisible();
  });

  test('chooseTool switches between move, box and lasso', async ({ page }) => {
    await openExplore(page);
    await chooseTool(page, 'Box select');
    expect(await plotTool(page)).toEqual({ selectionMode: true, selectionTool: 'rectangle' });
    await chooseTool(page, 'Lasso select');
    expect(await plotTool(page)).toEqual({ selectionMode: true, selectionTool: 'lasso' });
    await chooseTool(page, 'Move and zoom');
    expect((await plotTool(page)).selectionMode).toBe(false);
  });

  test('clearSelection, isolateSelection and resetIsolation act on the selection', async ({
    page,
  }) => {
    await openExplore(page);
    const ids = await page.evaluate(() =>
      (
        document.querySelector('#myPlot') as Element & { data: { protein_ids: string[] } }
      ).data.protein_ids.slice(0, 2),
    );
    // Two proteins: isolating one would leave too few points to select from.
    const selectBoth = async () => {
      for (const id of ids) {
        await searchInput(page).fill(id);
        await searchInput(page).press('Enter');
      }
      await expect
        .poll(async () => (await getSelectedProteinIds(page)).sort())
        .toEqual([...ids].sort());
    };

    await selectBoth();
    await isolateSelection(page);
    await expect(statusChip(page, 'isolation')).toBeVisible();
    await resetIsolation(page);
    await expect(statusChip(page, 'isolation')).toHaveCount(0);

    await selectBoth();
    await clearSelection(page);
    expect(await getSelectedProteinIds(page)).toEqual([]);
  });

  test('getCurrentDatasetName names the loaded dataset', async ({ page }) => {
    await openExplore(page);
    expect(await getCurrentDatasetName(page)).toBe(DEFAULT_EXAMPLE_DATASET.label);
    await expect(appBar(page)).toContainText(DEFAULT_EXAMPLE_DATASET.label.split(' · ')[0]);
  });
});

test.describe('tour storage helpers', () => {
  // Empty storage, as in a context a test opens itself: only seedTourSeen marks the tour seen.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('seedTourSeen keeps the tour from starting', async ({ page, baseURL }) => {
    await seedTourSeen(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);

    // The same entry the e2e contexts start with.
    const state = exploreStorageState(baseURL!);
    const seen =
      typeof state === 'object'
        ? state.origins[0].localStorage.find((entry) => entry.name === TOUR_STORAGE_KEY)?.value
        : undefined;
    expect(seen).toBeTruthy();
    expect(await page.evaluate((key) => localStorage.getItem(key), TOUR_STORAGE_KEY)).toBe(seen);

    // The tour would start 800 ms after the first load: a 2 s window in which it must not show.
    const shown = await page
      .locator('.driver-popover')
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(
        () => true,
        () => false,
      );
    expect(shown).toBe(false);
  });
});

/** The first `count` protein ids of the loaded dataset. */
function firstProteinIds(page: Page, count: number): Promise<string[]> {
  return page
    .locator('#myPlot')
    .evaluate(
      (plot, n) =>
        ((plot as Element & { data?: { protein_ids?: string[] } }).data?.protein_ids ?? []).slice(
          0,
          n,
        ),
      count,
    );
}

/** A protein drawn on top at its own position, clear of the plot's edges: a hover there shows it. */
function unoccludedProtein(page: Page): Promise<string> {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as HTMLElement & {
      data: { protein_ids: string[] };
      getProteinClientPosition(id: string): { x: number; y: number } | null;
      pickInteractivePointAt(x: number, y: number): { id: string } | null;
    };
    const rect = plot.getBoundingClientRect();
    const margin = 80;
    for (const id of plot.data.protein_ids.slice(0, 500)) {
      const at = plot.getProteinClientPosition(id);
      if (!at) continue;
      if (at.x < rect.left + margin || at.x > rect.right - margin) continue;
      if (at.y < rect.top + margin || at.y > rect.bottom - margin) continue;
      if (plot.pickInteractivePointAt(at.x - rect.left, at.y - rect.top)?.id === id) return id;
    }
    throw new Error('No unoccluded protein among the first 500');
  });
}

const plotTooltip = (page: Page) => page.locator('#myPlot protspace-protein-tooltip');

/** Whether `point` lies inside `box`. */
const inside = (
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

test.describe('capture helpers', () => {
  test('plotSettled resolves after a zoom, and needs ?perfCounters=1', async ({ page }) => {
    await openExplore(page, '?perfCounters=1');
    const counters = () => page.evaluate(() => JSON.stringify(window.__protspacePerfCounters));
    await plotSettled(page);
    const idle = await counters();
    const box = (await plotArea(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await plotSettled(page);
    const settled = await counters();
    expect(settled).not.toBe(idle);
    // Settled means the zoom has finished drawing: half a second later nothing has changed.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(await counters()).toBe(settled);

    await openExplore(page);
    await expect(plotSettled(page)).rejects.toThrow('load the page with ?perfCounters=1');
  });

  test('proteinScreenPosition lands on a plotted protein', async ({ page }) => {
    await openExplore(page);
    const id = await unoccludedProtein(page);

    const at = await proteinScreenPosition(page, id);
    await page.mouse.move(at.x, at.y);
    await expect(plotTooltip(page)).toContainText(id);

    await expect(proteinScreenPosition(page, 'NOT_A_PROTEIN_ZZZ')).rejects.toThrow(
      'NOT_A_PROTEIN_ZZZ is not plotted',
    );
  });

  test('clusterScreenPoints finds the points of one category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    const points = await clusterScreenPoints(page, value, 10);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(10);
    const box = (await page.locator('#myPlot').boundingBox())!;
    for (const point of points) expect(inside(point, box)).toBe(true);

    // A hover on one of them names the category (a neighbour may be drawn over some).
    const named: boolean[] = [];
    for (const point of points.slice(0, 5)) {
      await page.mouse.move(point.x, point.y);
      named.push(
        await plotTooltip(page)
          .filter({ hasText: value })
          .waitFor({ timeout: 1_500 })
          .then(
            () => true,
            () => false,
          ),
      );
    }
    expect(named).toContain(true);
    expect(await clusterScreenPoints(page, 'NO_SUCH_CATEGORY_ZZZ')).toEqual([]);
  });

  test('emptyScreenPointNear finds a point that opens no tooltip', async ({ page }) => {
    await openExplore(page);
    const [near] = await clusterScreenPoints(page, await getFirstLegendItemValue(page), 1);
    const at = await emptyScreenPointNear(page, near);
    await page.mouse.move(at.x, at.y);
    // A hover resolves in a frame; give one a chance to open before checking none did.
    await page.mouse.move(at.x + 1, at.y);
    await expect(plotTooltip(page)).toBeHidden();
    // ...and a protein point is not empty: the helper moved away from one.
    const id = await unoccludedProtein(page);
    const onProtein = await proteinScreenPosition(page, id);
    expect(await emptyScreenPointNear(page, onProtein)).not.toEqual(onProtein);
  });

  test('duplicateStacks returns the stacks on the plot', async ({ page }) => {
    await openExplore(page);
    expect(await duplicateStacks(page)).toEqual([]);
    await toggleLegendSetting(page, 'Show duplicate counts and spread overlaps');
    await closeLegendSettings(page);

    // Exact duplicates show in some projections and not others: take the first that has them.
    let stacked = false;
    for (const projection of await plotProjections(page)) {
      await selectProjection(page, projection);
      stacked = await expect
        .poll(async () => (await duplicateStacks(page)).length, { timeout: 5_000 })
        .toBeGreaterThan(0)
        .then(
          () => true,
          () => false,
        );
      if (stacked) break;
    }
    expect(stacked, 'a projection of the startup fixture has duplicate stacks').toBe(true);
    const box = (await page.locator('#myPlot').boundingBox())!;
    for (const stack of await duplicateStacks(page)) {
      expect(stack.count).toBeGreaterThan(1);
      expect(inside(stack, box)).toBe(true);
    }
  });

  test('waitForStructureLoaded resolves once the clicked protein has loaded', async ({ page }) => {
    await stubStructureRequests(page);
    await openExplore(page);
    await expect(waitForStructureLoaded(page, 'ANY')).rejects.toThrow('watchStructureLoads');

    await watchStructureLoads(page);
    await watchStructureLoads(page);
    const id = await clickProteinNearPlotCentre(page);
    await waitForStructureLoaded(page, id);
    await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', id);
    await expect(waitForStructureLoaded(page, 'NOT_A_PROTEIN_ZZZ', 1_000)).rejects.toThrow();
  });

  test('openFigureEditor opens the figure editor', async ({ page }) => {
    await openExplore(page);
    const dialog = await openFigureEditor(page);
    expect(String(dialog)).toBe(String(figureEditor(page)));
    await expect(dialog).toBeVisible();
    // It resolves with the preview drawn: no wait here, the canvas already has a size.
    const size = await page
      .locator('protspace-publish-modal .publish-preview-canvas')
      .evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
    expect(Math.min(...size)).toBeGreaterThan(0);
  });

  test('searchProteins selects the given ids', async ({ page }) => {
    await openExplore(page);
    const ids = await firstProteinIds(page, 2);

    await searchProteins(page, ids);
    await expect(selectionBar(page)).toContainText('2 proteins selected');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids);

    await clearSelection(page);
    await searchProteins(page, ids.slice(0, 1));
    await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids.slice(0, 1));

    // With the bar already showing, the helper still waits for this search to land.
    await searchProteins(page, ids.slice(1));
    expect(await getSelectedProteinIds(page)).toEqual(ids);
  });

  test('pasteIntoSearch reports found and missing ids', async ({ page }) => {
    await openExplore(page);
    const [id] = await firstProteinIds(page, 1);

    await pasteIntoSearch(page, `${id}\nNOT_A_PROTEIN_ZZZ`);
    await expect(page.locator('protspace-protein-search .search-report')).toContainText(
      '1 of 2 found',
    );
  });

  test('toast finds a notification by its text', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await closeFilterPanel(page);
    await clearStatusChip(page, 'filter');

    await expect(toast(page, 'Filter removed')).toBeVisible();
    await expect(toast(page, /^Filter rem/)).toBeVisible();
    await expect(toast(page, 'NO_SUCH_NOTIFICATION')).toHaveCount(0);
  });

  test('doubleClickLegendRow shows only that category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    // A capture paces the gap with its own timer.
    const pauses: number[] = [];
    await doubleClickLegendRow(page, value, async (ms) => {
      pauses.push(ms);
      await page.waitForTimeout(ms);
    });
    expect(pauses).toEqual([120]);
    await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([value]);
  });

  test('dragLegendRow moves a row above another', async ({ page }) => {
    await openExplore(page);
    const rows = (await legendRowValues(page)).filter(
      (value) => value !== 'Other' && value !== '__NA__',
    );
    const [first, second] = rows;

    await dragLegendRow(page, second, first);
    await expect
      .poll(async () => {
        const order = await legendRowValues(page);
        return order.indexOf(second) < order.indexOf(first);
      })
      .toBe(true);
  });

  test('openExample opens an example by its link', async ({ page }) => {
    await serveExampleFixtures(page);
    const example = e2eExample('other');

    await openExample(page, example.id, { proteinCount: example.count });
    expect(await getProteinCount(page)).toBe(example.count);
    expect(new URL(page.url()).searchParams.get('dataset')).toBe(example.id);
  });

  test('expectProductDemo refuses the e2e startup fixture', async ({ page }) => {
    await openExplore(page);
    await expect(expectProductDemo(page)).rejects.toThrow('E2E startup fixture');
  });
});
