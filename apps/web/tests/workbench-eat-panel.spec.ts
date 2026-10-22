import { expect, test } from '@playwright/test';
import {
  clearStatusChip,
  filterButton,
  filterPanel,
  getSelectedProteinIds,
  openExplore,
  queryBuilder,
  selectAnnotation,
  selectionBar,
  statusChip,
  waitForExploreInteractionReady,
} from './helpers/explore';
import {
  eatPanel,
  eatRailItem,
  eatThresholdBox,
  legendEatLink,
  legendEatNote,
  loadPhosphataseEat,
  openEatPanel,
} from './helpers/eat';
import { panelTab } from './helpers/mobile';
import { proteinScreenPosition, provenancePair, weakPrediction } from './helpers/plot';
import { seedTourSeen } from './helpers/tour-storage-state';
import { rail, readLayout, seedLayout, workbenchRoot } from './helpers/workbench';

/**
 * The EAT panel (Phase 9): a sidebar section like Filter, opened from the rail's EAT item on
 * desktop and from the panel tabs on a phone, enabled only when Color by carries EAT predictions.
 */

test.beforeEach(async ({ page }) => {
  await seedTourSeen(page);
});

test('the EAT rail item is disabled with its reason on a dataset without EAT', async ({ page }) => {
  // A stored EAT panel from an earlier EAT dataset: this dataset shows the legend in its place.
  await seedLayout(page, { panel: 'eat' });
  await openExplore(page);

  const item = eatRailItem(page);
  await expect(item).toBeDisabled();
  await expect(item).toHaveAccessibleName('This dataset has no transferred annotations (EAT).');
  // Off, it stays focusable, so a keyboard user reaches the reason.
  await item.focus();
  await expect(item).toBeFocused();
  await expect(workbenchRoot(page)).toHaveAttribute('data-panel', 'legend');
  await expect(page.locator('#myLegend')).toBeVisible();
  await expect(eatPanel(page)).toBeHidden();
  // The stored panel stays, so the next EAT dataset reopens it.
  expect((await readLayout(page))?.panel).toBe('eat');
});

test('the EAT rail item opens the panel in place of the legend', async ({ page }) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');

  const item = eatRailItem(page);
  await expect(item).toBeEnabled();
  await expect(item).toHaveAccessibleName('EAT — transferred annotations');
  await openEatPanel(page);

  await expect(page.locator('#myLegend')).toBeHidden();
  // One header row: the heading names the annotation, beside it ⓘ, Reset (off at defaults), Close.
  const section = page.locator('#wb-eat-panel');
  await expect(section.getByRole('heading', { level: 2 })).toHaveCount(1);
  await expect(section.getByRole('heading', { name: 'EAT · EC number' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Information about EAT' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Reset' })).toBeDisabled();
  await expect(item).toHaveAttribute('aria-pressed', 'true');

  // Close returns to the legend and hands focus to the rail item.
  await page.locator('#wb-eat-panel').getByRole('button', { name: 'Close EAT' }).click();
  await expect(page.locator('#myLegend')).toBeVisible();
  await expect(item).toBeFocused();
});

test('switching Color by to an annotation without EAT keeps the panel on its empty state', async ({
  page,
}) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await openEatPanel(page);
  await eatThresholdBox(page).fill('50');
  await expect(statusChip(page, 'filter')).toContainText('Filtered');

  await selectAnnotation(page, 'annotation_score');
  await expect(eatPanel(page)).toContainText('has no predicted values.');
  // The item says why it is off, and stays pressed and usable while its panel shows.
  const item = eatRailItem(page);
  await expect(item).toHaveAccessibleName(
    /has no EAT predictions\. Color by an annotation marked EAT\./,
  );
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  // Nothing on this annotation to reset: the panel shows its defaults.
  await expect(page.locator('#wb-eat-panel').getByRole('button', { name: 'Reset' })).toBeDisabled();

  // Close lands on Legend, since the EAT item turns off with the panel closed.
  await page.locator('#wb-eat-panel').getByRole('button', { name: 'Close EAT' }).click();
  await expect(item).toBeDisabled();
  await expect(rail(page).getByRole('button', { name: 'Legend' })).toBeFocused();
});

test('on a phone the EAT tab is the third tab', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');

  const tabs = page.getByRole('tablist', { name: 'Sidebar panels' }).filter({ visible: true });
  await expect(tabs.getByRole('tab')).toHaveText(['Legend', 'Filter', 'EAT']);
  await panelTab(page, 'EAT').click();
  await expect(eatPanel(page)).toBeVisible();
  await expect(page.locator('#myLegend')).toBeHidden();
  await expect(panelTab(page, 'EAT')).toHaveAttribute('aria-selected', 'true');
  // The tab names the panel; the heading stays for screen readers.
  await expect(
    page.locator('#wb-eat-panel').getByRole('heading', { level: 2 }),
  ).toHaveAccessibleName('EAT · EC number');

  // Changed settings: the tab says so, as its dot shows.
  await eatThresholdBox(page).fill('50');
  await expect(page.getByRole('tab', { name: 'EAT, settings changed' })).toBeVisible();
});

test('the phone EAT tab shows the histogram and opens a drill-down by tap', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await panelTab(page, 'EAT').click();

  await expect(eatPanel(page)).toHaveAttribute('compact', '');
  const histogram = eatPanel(page).getByRole('group', { name: 'Predictions by reliability' });
  await expect(histogram).toBeVisible();
  expect((await histogram.boundingBox())!.height).toBe(56);
  // Drawing folds into Display options.
  await expect(eatPanel(page).getByText('Display options', { exact: true })).toBeVisible();
  await expect(
    eatPanel(page).getByRole('switch', {
      name: 'Draw a line to the source when I click a protein',
    }),
  ).toBeHidden();

  const bar = histogram.getByRole('button', { name: /: [1-9][\d,]* predictions?$/ }).last();
  await bar.click();
  const list = eatPanel(page).getByRole('region', { name: /^\d+ least reliable in / });
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: 'Export IDs of these predictions' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('moving the EAT threshold filters the plot and the legend says so', async ({ page }) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await expect(legendEatNote(page)).toBeVisible();
  await expect(legendEatNote(page)).not.toContainText('Filtered');

  await openEatPanel(page);
  await eatThresholdBox(page).fill('50');
  await expect(statusChip(page, 'filter')).toContainText('Filtered');
  await expect(eatRailItem(page)).toHaveAccessibleName(
    'EAT — transferred annotations, settings changed',
  );

  await page.locator('#wb-eat-panel').getByRole('button', { name: 'Close EAT' }).click();
  await expect(legendEatNote(page)).toContainText('outside 50–100\u202f% hidden');
  await legendEatLink(page).click();
  await expect(eatPanel(page)).toBeVisible();
  // The link hid with the legend: focus moves to the EAT heading.
  await expect(page.locator('#wb-eat-title')).toBeFocused();
  await expect(eatThresholdBox(page)).toHaveValue('50');

  // The header's Reset takes the filter back off, and turns off without dropping focus.
  const reset = page.locator('#wb-eat-panel').getByRole('button', { name: 'Reset' });
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(statusChip(page, 'filter')).toBeHidden();
  await expect(eatThresholdBox(page)).toHaveValue('0');
  await expect(reset).toBeDisabled();
  await expect(reset).toBeFocused();
  await expect(eatRailItem(page)).toHaveAccessibleName('EAT — transferred annotations');
});

test('the Filter panel shows the reliability as a locked row that opens the EAT panel', async ({
  page,
}) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await openEatPanel(page);
  await eatThresholdBox(page).fill('50');
  await expect(statusChip(page, 'filter')).toContainText('Filtered');

  await filterButton(page).click();
  await expect(filterPanel(page)).toBeVisible();
  const row = queryBuilder(page).getByRole('group', {
    name: 'Condition 1: EC number reliability at least 50\u202f%, set in the EAT panel',
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText('EC number — reliability ≥ 50\u202f%');
  await expect(row.getByRole('button', { name: /Choose annotation|EC number/ })).toHaveCount(0);

  await row.getByRole('button', { name: 'Edit in EAT', exact: true }).click();
  await expect(eatPanel(page)).toBeVisible();
  await expect(page.locator('#wb-eat-title')).toBeFocused();
  await expect(eatThresholdBox(page)).toHaveValue('50');

  // The row's ✕ resets the reliability at once: the filter goes, the panel is back at 0.
  await filterButton(page).click();
  await row.getByRole('button', { name: 'Reset EAT reliability' }).click();
  await expect(statusChip(page, 'filter')).toBeHidden();
  await expect(row).toBeHidden();
  await openEatPanel(page);
  await expect(eatThresholdBox(page)).toHaveValue('0');
});

test('a histogram bar lists its weakest predictions and a row selects the protein', async ({
  page,
}) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await openEatPanel(page);

  const histogram = eatPanel(page).getByRole('group', { name: 'Predictions by reliability' });
  // The bars are one tab stop.
  await expect(histogram.locator('button[tabindex="0"]')).toHaveCount(1);
  const bar = histogram.getByRole('button', { name: /: [1-9][\d,]* predictions?$/ }).first();
  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
  const list = eatPanel(page).getByRole('region', { name: /^\d+ least reliable in / });
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: /^Select all [\d,]+ in range$/ })).toBeVisible();

  const row = list.getByRole('listitem').first().getByRole('button');
  const proteinId = (await row.getAttribute('aria-label'))!.split(',')[0];
  await row.click();
  await expect(selectionBar(page)).toContainText('1 selected');
  expect(await getSelectedProteinIds(page)).toEqual([proteinId]);
  // A pick from the panel keeps the structure to its header row, and the row in view.
  await expect(workbenchRoot(page)).toHaveAttribute('data-structure-collapsed', '');
  await expect(row).toBeInViewport({ ratio: 1 });
  // The rail's Structure reads shown only once the viewer is: a header row is not pressed, and
  // Structure expands it.
  const structureItem = rail(page).getByRole('button', { name: /^Structure: / });
  await expect(structureItem).toHaveAttribute('aria-pressed', 'false');
  await structureItem.click();
  await expect(workbenchRoot(page)).not.toHaveAttribute('data-structure-collapsed');
  await expect(structureItem).toHaveAttribute('aria-pressed', 'true');

  // Escape inside the panel closes the list before it reaches the selection.
  await bar.focus();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  expect(await getSelectedProteinIds(page)).toEqual([proteinId]);
});

test('the selected-protein card goes to the source and draws its lines', async ({ page }) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await openEatPanel(page);
  await waitForExploreInteractionReady(page);
  const { source, target } = await provenancePair(page, 'ec');
  const connectors = page.locator('#myPlot').locator('line.eat-provenance-connector');

  const at = await proteinScreenPosition(page, target);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([target]);
  const card = eatPanel(page).getByRole('region', { name: 'Selected protein' });
  await expect(card).toContainText(`copied from ${source}`);
  await expect(connectors).toHaveCount(1);
  // Escape clears the click's line and keeps the selection, so the next line is Go to source's.
  await page.keyboard.press('Escape');
  await expect(connectors).toHaveCount(0);
  expect(await getSelectedProteinIds(page)).toEqual([target]);
  const transform = () =>
    page.locator('#myPlot').evaluate((plot) => {
      const t = (plot as unknown as { _transform: { k: number; x: number; y: number } })._transform;
      return { k: t.k, x: t.x, y: t.y };
    });
  const before = await transform();

  await card.getByRole('button', { name: 'Go to source' }).click();
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([source]);
  // Go to source draws the pair and fits both; the card now shows the source.
  await expect(connectors).toHaveCount(1);
  await expect.poll(transform).not.toEqual(before);
  await expect(card.locator('.eat-card-title')).toContainText(source);
  await expect(card).toContainText('Curated');

  await card
    .getByRole('button', { name: new RegExp(`^${source} is the source of [\\d,]+ predictions?$`) })
    .click();
  await expect.poll(() => connectors.count()).toBeGreaterThan(1);
  expect(await getSelectedProteinIds(page)).toEqual([source]);
});

test('with source lines off, a click only selects; Go to source still draws', async ({ page }) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await openEatPanel(page);
  await waitForExploreInteractionReady(page);
  const { source, target } = await provenancePair(page, 'ec');
  const connectors = page.locator('#myPlot').locator('line.eat-provenance-connector');

  // The drawing settings sit in the closed Display options.
  await eatPanel(page).getByText('Display options', { exact: true }).click();
  const trace = eatPanel(page).getByRole('switch', {
    name: 'Draw a line to the source when I click a protein',
  });
  await expect(trace).toBeChecked();
  await trace.click();
  await expect(trace).not.toBeChecked();
  await expect(
    eatPanel(page).getByRole('combobox', { name: 'Most lines from one source' }),
  ).toHaveValue('20');

  const at = await proteinScreenPosition(page, target);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([target]);
  await expect(connectors).toHaveCount(0);

  const card = eatPanel(page).getByRole('region', { name: 'Selected protein' });
  await card.getByRole('button', { name: 'Go to source' }).click();
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([source]);
  await expect(connectors).toHaveCount(1);
});

test('Fade fades weak predictions without filtering', async ({ page }) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await openEatPanel(page);
  await waitForExploreInteractionReady(page);
  await eatThresholdBox(page).fill('50');
  await expect(statusChip(page, 'filter')).toContainText('Filtered');

  await eatPanel(page).getByRole('radio', { name: 'Fade' }).click();
  await expect(statusChip(page, 'filter')).toBeHidden();
  await expect(statusChip(page, 'eat-dim')).toContainText('EAT: outside 50–100\u202f% faded');
  await expect(legendEatNote(page)).toContainText('outside 50–100\u202f% faded');

  // A below-threshold ring is still on the plot and hoverable.
  const weak = await weakPrediction(page, 'ec', 0.5);
  const at = await proteinScreenPosition(page, weak);
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('#myPlot').locator('protspace-protein-tooltip')).toContainText(weak);

  // Hide puts the filter back; the fade chip's ✕ resets the panel to Hide at 0.
  await eatPanel(page).getByRole('radio', { name: 'Hide' }).click();
  await expect(statusChip(page, 'filter')).toContainText('Filtered');
  await expect(statusChip(page, 'eat-dim')).toBeHidden();
  await eatPanel(page).getByRole('radio', { name: 'Fade' }).click();
  await clearStatusChip(page, 'eat-dim');
  await expect(eatThresholdBox(page)).toHaveValue('0');
  await expect(eatPanel(page).getByRole('radio', { name: 'Hide' })).toBeChecked();
});
