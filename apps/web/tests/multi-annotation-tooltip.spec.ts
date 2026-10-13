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
  // Dropdown items show the friendly display label (e.g. "EC number") but carry
  // the raw annotation key on data-annotation; match by key so this stays
  // label-agnostic.
  return page.locator(
    `protspace-control-bar protspace-annotation-select .dropdown-item[data-annotation="${annotation}"]`,
  );
}

/** The control bar's and the scatter plot's extra tooltip annotations. */
async function readTooltipAnnotations(page: Page) {
  return page.evaluate(() => {
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
}

test.describe('Multi-annotation hover tooltip', () => {
  // One load walks the whole toggle cycle: the dropdown's primary marker, then an
  // extra annotation toggled on (URL, control bar and plot) and back off again.
  test('the (i) toggle adds an extra tooltip annotation to the URL and the plot, and removes it', async ({
    page,
  }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);

    // The primary annotation is marked with a dot and offers no (i) toggle.
    const primaryRow = await getRowForAnnotation(page, 'ec');
    await expect(primaryRow.locator('.primary-dot')).toHaveCount(1);
    await expect(primaryRow.locator('.tooltip-toggle-btn')).toHaveCount(0);

    const annotations = await page.evaluate(() => {
      const cb = document.querySelector('protspace-control-bar') as
        | (Element & { annotations?: string[] })
        | null;
      return cb?.annotations ?? [];
    });
    const otherAnnotation = annotations.find((name) => name !== 'ec');
    expect(otherAnnotation, 'the pinned demo has a second annotation').toBeTruthy();

    const otherToggle = (await getRowForAnnotation(page, otherAnnotation!)).locator(
      '.tooltip-toggle-btn',
    );
    await otherToggle.click();

    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));
    expect(await readTooltipAnnotations(page)).toEqual({
      controlBar: [otherAnnotation],
      plot: [otherAnnotation],
    });

    await otherToggle.click();

    await expect(page).not.toHaveURL(/tooltip=/);
    await expect.poll(() => readTooltipAnnotations(page)).toEqual({ controlBar: [], plot: [] });
  });
});
