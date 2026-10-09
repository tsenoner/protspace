import { expect, test, type Page } from '@playwright/test';
import {
  annotationSelect,
  colorByTrigger,
  dismissTourIfPresent,
  getColorByOptions,
  getViewState,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';

async function openAnnotationDropdown(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  await colorByTrigger(page).click();
}

async function getRowForAnnotation(page: Page, annotation: string) {
  // Dropdown items show the friendly display label (e.g. "EC number") but carry
  // the raw annotation key on data-annotation; match by key so this stays
  // label-agnostic.
  return annotationSelect(page).locator(`.dropdown-item[data-annotation="${annotation}"]`);
}

test.describe('Multi-annotation hover tooltip', () => {
  test('marks the primary annotation with a dot and hides its (i) toggle', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);

    const primaryRow = await getRowForAnnotation(page, 'ec');
    await expect(primaryRow.locator('.primary-dot')).toHaveCount(1);
    await expect(primaryRow.locator('.tooltip-toggle-btn')).toHaveCount(0);
  });

  test('toggling the (i) icon adds the annotation to the URL tooltip param', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);

    const annotations = await getColorByOptions(page);
    const otherAnnotation = annotations.find((name) => name !== 'ec');
    if (!otherAnnotation) {
      test.skip(true, 'demo dataset has only a single annotation');
      return;
    }

    const otherRow = await getRowForAnnotation(page, otherAnnotation);
    await otherRow.locator('.tooltip-toggle-btn').click();

    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));

    // The picker lists the extra, and the plot draws it into the tooltip.
    const tooltipState = {
      picker: await annotationSelect(page).evaluate((select) => [
        ...((select as Element & { tooltipAnnotations?: string[] }).tooltipAnnotations ?? []),
      ]),
      plot: (await getViewState(page)).tooltip,
    };

    expect(tooltipState.picker).toEqual([otherAnnotation]);
    expect(tooltipState.plot).toEqual([otherAnnotation]);
  });

  test('toggling an extra back off removes the tooltip URL param', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);
    const available = await getColorByOptions(page);
    const otherAnnotation = available.find((name) => name !== 'ec');
    if (!otherAnnotation) {
      test.skip(true, 'demo dataset has only a single annotation');
      return;
    }

    const row = await getRowForAnnotation(page, otherAnnotation);
    await row.locator('.tooltip-toggle-btn').click();
    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));
    await row.locator('.tooltip-toggle-btn').click();

    await expect(page).not.toHaveURL(/tooltip=/);
  });
});
