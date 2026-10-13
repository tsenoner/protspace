import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  appBar,
  holdNextRequest,
  importMenu,
  importUserFile,
  openExplore,
  pickExample,
  sidebar,
  waitForProteinCount,
} from './helpers/explore';
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import { STARTUP_URL_GLOB, TOXPROT_5181_V3_FIXTURE } from './helpers/fixtures';
import {
  clickProteinNearPlotCentre,
  dropFileOnWorkbench,
  emptyState,
  structurePanel,
  stubStructureRequests,
} from './helpers/workbench';

/** The loading overlay, the empty plot and drops anywhere on the workbench (Task 4.12). */

const BUNDLE = {
  name: path.basename(TOXPROT_5181_V3_FIXTURE),
  mimeType: 'application/octet-stream',
  buffer: fs.readFileSync(TOXPROT_5181_V3_FIXTURE),
};
const BUNDLE_COUNT = 5181;

test.describe('loading overlay', () => {
  test('importing a local bundle says it is read in the browser and never mentions an upload', async ({
    page,
  }) => {
    await openExplore(page);
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { overlayTexts: string[] }).overlayTexts = seen;
      new MutationObserver(() => {
        const overlay = document.getElementById('progressive-loading');
        if (overlay) seen.push(overlay.textContent ?? '');
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    await importUserFile(page, TOXPROT_5181_V3_FIXTURE);
    await waitForProteinCount(page, BUNDLE_COUNT);

    const texts = await page.evaluate(
      () => (window as unknown as { overlayTexts: string[] }).overlayTexts,
    );
    expect(texts.some((text) => text.includes('Reading your file in the browser'))).toBe(true);
    expect(texts.some((text) => text.includes(`Reading ${BUNDLE.name}…`))).toBe(true);
    expect(texts.filter((text) => /upload/i.test(text))).toEqual([]);
  });

  test('the overlay blocks Tab from reaching the app bar', async ({ page }) => {
    const release = await holdNextRequest(page, STARTUP_URL_GLOB);
    await page.goto('/explore');
    await expect(page.locator('#progressive-loading')).toBeVisible();
    await expect(page.locator('.workbench')).toHaveAttribute('inert', '');

    for (let press = 0; press < 6; press++) await page.keyboard.press('Tab');
    const inWorkbench = await page.evaluate(
      () => document.activeElement?.closest('.workbench') != null,
    );
    expect(inWorkbench).toBe(false);

    release();
    await expect(page.locator('#progressive-loading')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.workbench')).not.toHaveAttribute('inert', '');
    await expect(appBar(page)).toBeVisible();
  });

  test('Ctrl+Z during a load changes nothing', async ({ page }) => {
    await serveExampleFixtures(page);
    await openExplore(page);
    // A recorded selection step that an undo during the load would take back.
    const picked = await clickProteinNearPlotCentre(page);
    const selected = () =>
      page
        .locator('#myPlot')
        .evaluate((plot) => [
          ...(plot as unknown as { selectedProteinIds: string[] }).selectedProteinIds,
        ]);
    await expect.poll(selected).toEqual([picked]);

    const other = e2eExample('other');
    const release = await holdNextRequest(page, other.glob);
    await pickExample(page, other.id);
    await expect(page.locator('#progressive-loading')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    expect(await selected()).toEqual([picked]);

    release();
    await waitForProteinCount(page, other.count);
  });
});

test.describe('empty state', () => {
  test.beforeEach(async ({ page }) => {
    // The startup demo never arrives: startup ends with nothing on screen.
    await page.route(STARTUP_URL_GLOB, (route) => route.abort());
    await page.goto('/explore');
  });

  test('with the demo download aborted, the empty state shows and Open a file… opens the file chooser', async ({
    page,
  }) => {
    const empty = emptyState(page);
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Drop a file or pick an example');
    await expect(empty).toContainText('FASTA files (.fasta, .fa, .fna) are sent to the server');

    const chooser = page.waitForEvent('filechooser');
    await empty.getByRole('button', { name: 'Open a file…' }).click();
    expect((await chooser).isMultiple()).toBe(false);
  });

  test('Pick an example opens the Import panel at the button', async ({ page }) => {
    const pick = emptyState(page).getByRole('button', { name: 'Pick an example' });
    await pick.click();
    const panel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(panel).toBeVisible();
    const anchor = (await pick.boundingBox())!;
    const box = (await panel.boundingBox())!;
    // Under the button, or above it when the window leaves too little room below (it flips at 720).
    const below = box.y >= anchor.y + anchor.height;
    const above = box.y + box.height <= anchor.y;
    expect(below || above).toBe(true);
    expect(box.x).toBeLessThan(anchor.x + anchor.width);
    expect(box.x + box.width).toBeGreaterThan(anchor.x);
    await expect(importMenu(page).locator('[data-example-id]').first()).toBeVisible();
  });

  test('a drop on the empty plot loads the file and the empty state goes', async ({ page }) => {
    await expect(emptyState(page)).toBeVisible();
    await dropFileOnWorkbench(page, page.locator('#myPlot'), BUNDLE);
    await waitForProteinCount(page, BUNDLE_COUNT);
    await expect(emptyState(page)).toBeHidden();
  });
});

test.describe('drop target', () => {
  test('a file dragged over the sidebar shows the drop area and a drop loads it', async ({
    page,
  }) => {
    await openExplore(page);
    await dropFileOnWorkbench(page, sidebar(page), BUNDLE);
    await waitForProteinCount(page, BUNDLE_COUNT);
  });

  test('dragging a legend row does not show the drop area', async ({ page }) => {
    await openExplore(page);
    const textDrag = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'a legend row');
      return transfer;
    });
    const legend = page.locator('#myLegend');
    await legend.dispatchEvent('dragenter', { dataTransfer: textDrag });
    await legend.dispatchEvent('dragover', { dataTransfer: textDrag });

    expect(await page.locator('.workbench').getAttribute('data-dragging')).toBeNull();
    await expect(page.locator('.wb-drop-area')).toBeHidden();
    await legend.dispatchEvent('dragleave', { dataTransfer: textDrag });
    await textDrag.dispose();
  });

  test('a drop over the docked structure loads the file', async ({ page }) => {
    await stubStructureRequests(page);
    await openExplore(page);
    await clickProteinNearPlotCentre(page);
    await expect(page.locator('.workbench')).toHaveAttribute('data-structure', 'docked');

    await dropFileOnWorkbench(page, structurePanel(page), BUNDLE);
    await waitForProteinCount(page, BUNDLE_COUNT);
  });
});
