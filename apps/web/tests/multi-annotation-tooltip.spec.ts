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
import { expectNoAxeViolations } from './helpers/a11y';
import { clickProteinNearPlotCentre, stubStructureRequests } from './helpers/workbench';

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

/** Color by's and the scatter plot's extra tooltip annotations. */
async function readTooltipAnnotations(page: Page) {
  return {
    picker: await annotationSelect(page).evaluate((select) => [
      ...((select as Element & { tooltipAnnotations?: string[] }).tooltipAnnotations ?? []),
    ]),
    plot: (await getViewState(page)).tooltip,
  };
}

test.describe('Multi-annotation hover tooltip', () => {
  // One load walks the whole toggle cycle: the dropdown's primary marker, then an
  // extra annotation toggled on (URL, Color by and plot) and back off again.
  test('the (i) toggle adds an extra tooltip annotation to the URL and the plot, and removes it', async ({
    page,
  }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);

    // The primary annotation is marked with a check and offers no (i) toggle.
    const primaryRow = await getRowForAnnotation(page, 'ec');
    await expect(primaryRow.locator('.selected-check svg')).toHaveCount(1);
    await expect(primaryRow.locator('.tooltip-toggle-btn')).toHaveCount(0);

    const annotations = await getColorByOptions(page);
    const otherAnnotation = annotations.find((name) => name !== 'ec');
    expect(otherAnnotation, 'the pinned demo has a second annotation').toBeTruthy();

    const otherToggle = (await getRowForAnnotation(page, otherAnnotation!)).locator(
      '.tooltip-toggle-btn',
    );
    await otherToggle.click();

    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));
    expect(await readTooltipAnnotations(page)).toEqual({
      picker: [otherAnnotation],
      plot: [otherAnnotation],
    });

    await otherToggle.click();

    await expect(page).not.toHaveURL(/tooltip=/);
    await expect.poll(() => readTooltipAnnotations(page)).toEqual({ picker: [], plot: [] });
  });

  test('the hover tooltip names annotations by their display name', async ({ page }) => {
    await stubStructureRequests(page);
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    // The pointer stays on the clicked protein, so its hover tooltip shows.
    await clickProteinNearPlotCentre(page);
    const header = page
      .locator('#myPlot protspace-protein-tooltip .tooltip-annotation-header span')
      .first();
    await expect(header).toHaveText('EC number');
  });

  test('the open picker has no accessibility violations', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await openAnnotationDropdown(page);
    await expect(annotationSelect(page).locator('.dropdown-item').first()).toBeVisible();

    await expectNoAxeViolations(page, {
      include: 'protspace-annotation-select',
      // Each listbox row keeps its eye toggle and ⓘ beside the option, inside a role="none"
      // wrapper (Task 4.16, ruling R5 Q5); this rule counts those buttons as listbox children.
      // Every other rule runs.
      disableRules: ['aria-required-children'],
      tags: null,
    });
  });
});
