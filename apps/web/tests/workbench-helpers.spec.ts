import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET, EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import {
  appBar,
  chooseTool,
  clearSelection,
  expectUrlParam,
  exportMenu,
  filterButton,
  filterPanel,
  getColorByOptions,
  getContoursMode,
  getCurrentDatasetName,
  getSelectedProteinIds,
  getViewState,
  importMenu,
  isolateSelection,
  openExplore,
  openExportMenu,
  openFilter,
  openImportMenu,
  pickExample,
  plotArea,
  queryBuilder,
  resetIsolation,
  searchInput,
  selectAnnotation,
  selectProjection,
  setContours,
  sidebar,
  statusChip,
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';

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
