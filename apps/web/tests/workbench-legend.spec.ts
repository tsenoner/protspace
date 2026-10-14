import { expect, test } from '@playwright/test';
import { SIDEBAR_WIDTH } from '../src/explore/layout-defaults';
import {
  dismissTourIfPresent,
  getFirstLegendItemValue,
  importUserFile,
  openExplore,
  openImportMenu,
  selectAnnotation,
  sidebar,
  waitForExploreDataLoad,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
import { TOXPROT_5181_FIXTURE } from './helpers/fixtures';
import {
  addFromOther,
  closeLegendSettings,
  escapeRegex,
  isLegendItemHidden,
  legend,
  legendRow,
  legendRowAction,
  legendOtherDialog,
  legendRowValues,
  legendSettingsDialog,
  legendSortButton,
  legendSortLabel,
  openLegendOther,
  openLegendSettings,
  pickLegendPalette,
  readLegendSettings,
  setLegendSetting,
  setLegendSort,
} from './helpers/legend';
import { seedLayout, structurePanel } from './helpers/workbench';

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

test.describe('workbench legend', () => {
  test('legend rows are 28 px with their actions hidden until hover', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);
    const row = legend(page).locator(`.legend-item[data-value="${value}"]`);

    expect((await row.boundingBox())?.height).toBeCloseTo(28, 0);
    const actions = row.locator('.legend-item-actions');
    await expect(actions).toHaveCSS('opacity', '0');
    await legendRow(page, value).hover();
    await expect(actions).toHaveCSS('opacity', '1');
  });

  test('the eye hides a category and the row stays, dimmed', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    // The demo's stored settings may already hide some rows: compare against them.
    const hiddenBefore = await legendRowValues(page, { visible: false });
    await legendRowAction(page, value, 'Hide');

    await expect.poll(() => isLegendItemHidden(page, value)).toBe(true);
    expect(await legendRowValues(page)).toContain(value);
    expect((await legendRowValues(page, { visible: false })).sort()).toEqual(
      [...hiddenBefore, value].sort(),
    );
    await expect(legendRow(page, value)).toHaveAccessibleName(/, hidden$/);
    await expect(
      legend(page).locator(`.legend-item[data-value="${value}"] .legend-swatch`),
    ).toHaveCSS('opacity', '0.35');
  });

  test('Show only this from the ⋯ menu isolates the category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    await legendRowAction(page, value, 'Show only this');

    await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([value]);
  });

  test("a long name ends in an ellipsis and its full name is in the row's accessible name", async ({
    page,
  }) => {
    await seedLayout(page, { sidebarWidth: SIDEBAR_WIDTH.min });
    await openExplore(page);
    await selectAnnotation(page, 'protein_families');
    const rows = legend(page).locator('.legend-item');
    await expect(rows.first()).toBeVisible();

    const truncated = await rows.evaluateAll((items) =>
      items
        .map((item) => {
          const text = item.querySelector('.legend-text') as HTMLElement;
          const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
          return {
            value: item.getAttribute('data-value') ?? '',
            label: text.textContent?.trim() ?? '',
            truncated: text.scrollWidth > text.clientWidth,
            oneLine: text.getBoundingClientRect().height <= lineHeight * 1.5,
          };
        })
        .filter((each) => each.truncated),
    );

    expect(truncated.length).toBeGreaterThan(0);
    const [longest] = truncated;
    expect(longest.oneLine).toBe(true);
    await expect(legendRow(page, longest.value)).toHaveAccessibleName(
      new RegExp(`^${escapeRegex(longest.label)}: `),
    );
  });

  test('the header shows the display name and the active sort; picking By name reorders the list and stores it', async ({
    page,
  }) => {
    await openExplore(page);
    // 'order' is a plain Taxonomy annotation with no stored order in the demo bundle.
    await selectAnnotation(page, 'order');
    await expect(legend(page).locator('.legend-title')).toHaveText('Order');
    await expect(legendSortButton(page)).toHaveAccessibleName('Sort: By count, largest first');

    await setLegendSort(page, 'By name');
    const named = (await legendRowValues(page)).filter(
      (value) => value !== 'Other' && value !== '__NA__',
    );
    expect(named.length).toBeGreaterThan(1);
    expect(named).toEqual([...named].sort(byName));
    // Stored at once under the same key. (A reload of the demo would clear it: a default load
    // resets stored settings in dataset-controller.ts. Task 3.13 checks the reload on a user import.)
    const stored = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => /^protspace:legend:[^:]+:order$/.test(key))
        .map(
          (key) =>
            (JSON.parse(localStorage.getItem(key) ?? 'null') as { sortMode?: string })?.sortMode,
        ),
    );
    expect(stored).toEqual(['alpha-asc']);
  });
});

test('View opens Other; a search and Add to legend bring a category back', async ({ page }) => {
  await openExplore(page);
  // 'order' has 18 values, so the default 10 rows leave eight under Other.
  await selectAnnotation(page, 'order');
  const other = await openLegendOther(page);
  const search = other.getByRole('searchbox', { name: 'Search Other categories' });
  await expect(search).toBeFocused();

  const names = await other.locator('.other-item-name').allTextContents();
  expect(names.length).toBeGreaterThan(1);
  const target = names.at(-1)!.trim();
  await search.fill(target.slice(0, 4));
  await expect(
    other.getByRole('button', { name: `Add to legend: ${target}`, exact: true }),
  ).toBeVisible();

  await addFromOther(page, target);

  // Still open: an add keeps the popover open on the next row.
  await expect(legendOtherDialog(page)).toBeVisible();
  expect(await legendRowValues(page)).toContain(target);
});

test('settings and the sort apply live and survive a reload under the same protspace:legend: key', async ({
  page,
}) => {
  // A user import without bundle settings: a reload restores it from OPFS and keeps local
  // settings (the demo would clear them on every load).
  await openExplore(page);
  await openImportMenu(page);
  await importUserFile(page, TOXPROT_5181_FIXTURE);
  await waitForProteinCount(page, 5181);
  await waitForPersistedExploreDataset(page);
  await selectAnnotation(page, 'phylum');

  await openLegendSettings(page);
  await pickLegendPalette(page, 'Okabe-Ito');
  await setLegendSetting(page, 'Max legend items', '5');
  // Applied while the popover is still open: there is no Save.
  await expect(legendSettingsDialog(page)).toBeVisible();
  expect(
    (await legendRowValues(page)).filter((value) => value !== 'Other').length,
  ).toBeLessThanOrEqual(5);
  await closeLegendSettings(page);
  // The sort is stored in the same record (a demo reload would clear it: the user import keeps it).
  await setLegendSort(page, 'By name');

  const records = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => /^protspace:legend:[^:]+:phylum$/.test(key))
          .map((key) => [key, JSON.parse(localStorage.getItem(key) ?? 'null')]),
      ),
    );
  const before = await records();
  const keys = Object.keys(before);
  expect(keys).toHaveLength(1);
  expect(Object.keys(before[keys[0]])).toEqual([
    'maxVisibleValues',
    'shapeSize',
    'sortMode',
    'hiddenValues',
    'categories',
    'enableDuplicateStackUI',
    'selectedPaletteId',
  ]);
  expect(before[keys[0]]).toMatchObject({ maxVisibleValues: 5, selectedPaletteId: 'okabeIto' });

  await page.reload();
  await waitForExploreDataLoad(page, { proteinCount: 5181 });
  await dismissTourIfPresent(page);
  await selectAnnotation(page, 'phylum');

  expect(Object.keys(await records())).toEqual(keys);
  expect(await legendSortLabel(page)).toBe('By name, A to Z');
  expect(await readLegendSettings(page)).toMatchObject({ palette: 'Okabe-Ito', maxItems: '5' });
  await closeLegendSettings(page);
});

test('the legend fills the sidebar column flush, with no card border', async ({ page }) => {
  await openExplore(page);
  const host = legend(page);

  const chrome = await host.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
    };
  });
  expect(chrome).toEqual({ border: ['0px', '0px', '0px', '0px'], radius: '0px', shadow: 'none' });

  // The sidebar's 1 px left border is its edge; the legend spans the rest of the column.
  const column = (await sidebar(page).boundingBox())!;
  const box = (await host.boundingBox())!;
  expect(Math.abs(box.x - (column.x + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.x + box.width - (column.x + column.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - column.y)).toBeLessThanOrEqual(1);
  // The legend runs down to the structure bar under it.
  const bar = (await structurePanel(page).boundingBox())!;
  expect(Math.abs(box.y + box.height - bar.y)).toBeLessThanOrEqual(1);
});

test('the tablet legend scrolls its list inside its row', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await openExplore(page);
  await selectAnnotation(page, 'protein_families');
  await setLegendSetting(page, 'Max legend items', '60');
  await closeLegendSettings(page);

  const list = legend(page).locator('.legend-items');
  await expect.poll(() => list.locator('.legend-item').count()).toBeGreaterThan(30);
  const box = (await legend(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(800);
  expect(await list.evaluate((l) => l.scrollHeight > l.clientHeight)).toBe(true);
});
