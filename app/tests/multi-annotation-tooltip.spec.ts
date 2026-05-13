import { expect, test, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';

async function openAnnotationDropdown(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const trigger = page.locator(
    'protspace-control-bar protspace-annotation-select .dropdown-trigger',
  );
  await trigger.click();
}

async function getRowForAnnotation(page: Page, annotation: string) {
  return page
    .locator('protspace-control-bar protspace-annotation-select .dropdown-item')
    .filter({
      has: page.locator('.dropdown-item-label', { hasText: new RegExp(`^${annotation}$`) }),
    });
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

    const annotations = await page.evaluate(() => {
      const cb = document.querySelector('protspace-control-bar') as
        | (Element & { annotations?: string[] })
        | null;
      return cb?.annotations ?? [];
    });
    const otherAnnotation = annotations.find((name) => name !== 'ec');
    if (!otherAnnotation) {
      test.skip(true, 'demo dataset has only a single annotation');
      return;
    }

    const otherRow = await getRowForAnnotation(page, otherAnnotation);
    await otherRow.locator('.tooltip-toggle-btn').click();

    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));

    const tooltipState = await page.evaluate(() => {
      const cb = document.querySelector('protspace-control-bar') as
        | (Element & { tooltipAnnotations?: string[] })
        | null;
      const plot = document.querySelector('protspace-scatterplot') as
        | (Element & { tooltipAnnotations?: string[] })
        | null;
      return {
        controlBar: cb?.tooltipAnnotations ?? null,
        plot: plot?.tooltipAnnotations ?? null,
      };
    });

    expect(tooltipState.controlBar).toEqual([otherAnnotation]);
    expect(tooltipState.plot).toEqual([otherAnnotation]);
  });

  test('toggling an extra back off removes the tooltip URL param', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);
    const available = await page.evaluate(() => {
      const cb = document.querySelector('protspace-control-bar') as
        | (Element & { annotations?: string[] })
        | null;
      return cb?.annotations ?? [];
    });
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
