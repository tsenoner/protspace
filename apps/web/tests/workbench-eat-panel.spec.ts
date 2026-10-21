import { expect, test } from '@playwright/test';
import { openExplore, selectAnnotation, statusChip } from './helpers/explore';
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
import { seedTourSeen } from './helpers/tour-storage-state';
import { readLayout, seedLayout, workbenchRoot } from './helpers/workbench';

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
  await expect(eatPanel(page).getByRole('heading', { name: /^EAT · / })).toBeVisible();
  await expect(item).toHaveAttribute('aria-pressed', 'true');

  // Close returns to the legend and hands focus to the rail item.
  await page.locator('#wb-eat-panel').getByRole('button', { name: 'Close EAT' }).click();
  await expect(page.locator('#myLegend')).toBeVisible();
  await expect(item).toBeFocused();
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
  await expect(eatPanel(page).getByRole('heading', { name: /^EAT · / })).toBeVisible();
});

test('moving the EAT threshold filters the plot and the legend says so', async ({ page }) => {
  await loadPhosphataseEat(page);
  await selectAnnotation(page, 'ec');
  await expect(legendEatNote(page)).toBeVisible();
  await expect(legendEatNote(page)).not.toContainText('Filtered');

  await openEatPanel(page);
  await eatThresholdBox(page).fill('50');
  await expect(statusChip(page, 'filter')).toContainText('Filtered');

  await page.locator('#wb-eat-panel').getByRole('button', { name: 'Close EAT' }).click();
  await expect(legendEatNote(page)).toContainText('Filtered ≥ 50\u202f%');
  await legendEatLink(page).click();
  await expect(eatPanel(page)).toBeVisible();
  await expect(eatThresholdBox(page)).toHaveValue('50');
});
