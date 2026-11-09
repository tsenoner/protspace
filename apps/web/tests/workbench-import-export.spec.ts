import { expect, test } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import {
  appBar,
  datasetSwitcher,
  exportAction,
  exportDownload,
  exportFormats,
  exportKinds,
  exportMenu,
  exportPanel,
  expectUrlParam,
  figureEditorButton,
  getCurrentDatasetName,
  getSelectedProteinIds,
  importMenu,
  importTrigger,
  importUserFile,
  openExplore,
  openExportMenu,
  openImportMenu,
  pickExample,
  supportsExplorePersistedDataset,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
import { figureEditor, figureEditorContent } from './helpers/figure';
import { PHOSPHATASE_1587_FIXTURE, TOXPROT_5181_FIXTURE } from './helpers/fixtures';
import { clickProteinNearPlotCentre, stubStructureRequests } from './helpers/workbench';

/** The Import and Export panels under the dataset name (Task 2.5), and the Figure editor button. */

test.describe('Import and Export menus', () => {
  test('Import and Export open from the dataset name and work from the keyboard', async ({
    page,
  }) => {
    await openExplore(page);
    // No buttons of their own in the bar: the dataset name opens both.
    await expect(appBar(page).getByRole('button', { name: /^(Import|Export)$/ })).toHaveCount(0);
    // The tour's Import step finds the menu itself, in the light DOM.
    await expect(page.locator('[data-driver-id="import"]')).toHaveAttribute('id', 'myImportMenu');

    const dataset = importTrigger(page);
    await dataset.focus();
    await page.keyboard.press('Enter');
    const ownDataset = importMenu(page).locator('[data-driver-id="import-own-dataset"]');
    await expect(ownDataset).toBeFocused();
    await expect(dataset).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(ownDataset).toHaveCount(0);
    await expect(dataset).toBeFocused();

    // "Export…", the panel's next action, hands over to the Export panel under the same name.
    await page.keyboard.press('Enter');
    await expect(ownDataset).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(importMenu(page).getByRole('button', { name: 'Export…' })).toBeFocused();
    await page.keyboard.press('Enter');
    // Focus lands on the first choice, what to export.
    const image = exportKinds(page).getByRole('radio', { name: 'Image', exact: true });
    await expect(image).toBeFocused();
    await expect(ownDataset).toHaveCount(0);
    await expect(dataset).toHaveAttribute('aria-expanded', 'true');
    // The arrow keys pick what, Tab moves on to how.
    await page.keyboard.press('ArrowRight');
    await expect(
      exportKinds(page).getByRole('radio', { name: 'Protein IDs', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(exportDownload(page)).toBeFocused();
    await expect(exportDownload(page)).toHaveAccessibleName('Download .txt');
    await page.keyboard.press('Escape');
    await expect(exportPanel(page)).toBeHidden();
    await expect(dataset).toBeFocused();
  });

  test('Open a file… opens the file chooser', async ({ page }) => {
    await openExplore(page);
    await openImportMenu(page);

    const chooser = page.waitForEvent('filechooser');
    await importMenu(page).locator('[data-driver-id="import-own-dataset"]').click();
    expect((await chooser).isMultiple()).toBe(false);
    await expect(importMenu(page).locator('.import-menu')).toHaveCount(0);
  });

  test("an example's info bubble is fully visible and topmost", async ({ page }) => {
    await openExplore(page);
    await openImportMenu(page);
    const info = importMenu(page).locator(
      `.import-examples [data-example-info="${EXAMPLE_DATASETS[1].id}"]`,
    );
    await info.locator('.info-button').click();
    const bubble = info.locator('.popover');
    await expect(bubble).toBeVisible();

    const placement = await bubble.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // The deepest element at the bubble's centre, looking through every shadow root on the way.
      let hit: Element | null = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      return {
        onScreen:
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight,
        topmost: hit !== null && element.contains(hit),
      };
    });
    expect(placement).toEqual({ onScreen: true, topmost: true });
  });

  test('the dataset name opens the Import panel and an example switches the dataset', async ({
    page,
  }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);

    const switcher = datasetSwitcher(page);
    await expect(switcher).toHaveAttribute('aria-haspopup', 'dialog');
    await switcher.click();
    const panel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(panel).toBeVisible();
    await expect(switcher).toHaveAttribute('aria-expanded', 'true');
    const anchor = (await switcher.boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(Math.abs(box.x - anchor.x)).toBeLessThan(2);
    expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(switcher).toBeFocused();
    await expect(switcher).toHaveAttribute('aria-expanded', 'false');

    // A second press on the dataset name closes the panel, as on Import.
    await switcher.click();
    await expect(panel).toBeVisible();
    await switcher.click();
    await expect(panel).toBeHidden();
    await expect(switcher).toHaveAttribute('aria-expanded', 'false');

    await switcher.click();
    await importMenu(page).locator(`[data-example-id="${other.id}"]`).click();
    await waitForProteinCount(page, other.count);
    await expectUrlParam(page, 'dataset', other.id);
  });

  test('after a user import then an example, Last file reopens the import', async ({ page }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);
    test.skip(!(await supportsExplorePersistedDataset(page)), 'This browser has no usable OPFS.');

    await importUserFile(page, TOXPROT_5181_FIXTURE);
    await waitForProteinCount(page, 5181);
    await waitForPersistedExploreDataset(page);
    // A second import replaces the stored copy after its render announced it, so the panel must
    // read the store again when it opens (not offer "Reopen" for the first file).
    await importUserFile(page, PHOSPHATASE_1587_FIXTURE);
    await waitForProteinCount(page, 1587);
    const importedName = await getCurrentDatasetName(page);
    expect(importedName).not.toBeNull();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            try {
              const root = await navigator.storage.getDirectory();
              const dir = await root.getDirectoryHandle('protspace-last-import');
              const meta = await (await dir.getFileHandle('metadata.json')).getFile();
              const parsed = JSON.parse(await meta.text()) as {
                name?: string;
                lastLoadStatus?: string;
              };
              return parsed.lastLoadStatus === 'success' ? (parsed.name ?? null) : null;
            } catch {
              return null;
            }
          }),
        { timeout: 30_000 },
      )
      .toBe(importedName);

    // While the import is on screen, the panel offers no "Last file".
    await openImportMenu(page);
    await expect(importMenu(page).getByRole('button', { name: /^Reopen / })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The example has as many proteins as the second import (1587): wait on the URL, not the count.
    await pickExample(page, other.id);
    await expectUrlParam(page, 'dataset', other.id);
    await expect.poll(() => getCurrentDatasetName(page)).not.toBe(importedName);

    await datasetSwitcher(page).click();
    const reopen = importMenu(page).getByRole('button', { name: `Reopen ${importedName}` });
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect.poll(() => getCurrentDatasetName(page), { timeout: 30_000 }).toBe(importedName);
    await expectUrlParam(page, 'dataset', null);
  });

  test('a user import disables no example; a chosen example is then disabled', async ({ page }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);

    await importUserFile(page, TOXPROT_5181_FIXTURE);
    await waitForProteinCount(page, 5181);
    await openImportMenu(page);
    const examples = importMenu(page).locator('[data-example-id]');
    expect(await examples.count()).toBeGreaterThan(1);
    for (const item of await examples.all()) await expect(item).toBeEnabled();
    await page.keyboard.press('Escape');

    await pickExample(page, other.id);
    await expectUrlParam(page, 'dataset', other.id);
    await openImportMenu(page);
    await expect(importMenu(page).locator(`[data-example-id="${other.id}"]`)).toBeDisabled();
  });

  test('an image downloads as a PNG and shows Export ready.', async ({ page }) => {
    await openExplore(page);

    const download = page.waitForEvent('download');
    await exportAction(page, 'PNG');
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.png$/);
    await expect(exportPanel(page)).toBeHidden();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Export ready.' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(file.suggestedFilename());
  });

  test('Protein IDs downloads a .txt', async ({ page }) => {
    await openExplore(page);

    const download = page.waitForEvent('download');
    await exportAction(page, 'Protein IDs');
    expect((await download).suggestedFilename()).toBe('protein_ids.txt');
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'protein_ids.txt' }),
    ).toBeVisible();
  });

  test('the panel asks what, then how, and shows only that choice’s options', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);

    await expect(exportKinds(page).getByRole('radio')).toHaveText([
      'Image',
      'Protein IDs',
      'Table',
      'Data bundle',
    ]);
    // An image: PNG or PDF, and what the file leaves out.
    await expect(exportFormats(page).getByRole('radio')).toHaveText(['PNG', 'PDF']);
    await expect(exportMenu(page).getByText(/without contours/)).toBeVisible();
    await expect(exportDownload(page)).toHaveAccessibleName('Download PNG');
    // The figure editor is not in the panel: it has its own button.
    await expect(exportPanel(page).getByText('Figure editor…')).toHaveCount(0);

    // A bundle: whether it carries the legend settings, checked by default.
    await exportKinds(page).getByRole('radio', { name: 'Data bundle', exact: true }).click();
    await expect(exportFormats(page)).toHaveCount(0);
    await expect(
      exportMenu(page).getByRole('checkbox', { name: 'Include legend settings' }),
    ).toBeChecked();
    await expect(exportDownload(page)).toHaveAccessibleName('Download .parquetbundle');
  });

  test('the figure editor opens from its button in the app bar', async ({ page }) => {
    await openExplore(page);
    await expect(figureEditorButton(page)).toBeVisible();
    // Labelled on a desktop, not an icon alone: the label is the kit button's slotted text.
    await expect(appBar(page).locator('ps-button[data-driver-id="figure-editor"]')).toHaveText(
      'Figure editor',
    );
    await figureEditorButton(page).click();
    await expect(figureEditorContent(page)).toBeAttached();
    await expect(figureEditor(page)).toBeVisible();
    // Closing it returns focus to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(figureEditorContent(page)).toHaveCount(0);
    await expect(figureEditorButton(page)).toBeFocused();
  });

  test('Escape closes the figure editor and the selection stays', async ({ page }) => {
    await stubStructureRequests(page);
    await openExplore(page);
    const id = await clickProteinNearPlotCentre(page);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    await figureEditorButton(page).click();
    const editor = figureEditor(page);
    await expect(editor).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(figureEditorContent(page)).toHaveCount(0);
    // The editor took the press: the plot's selection fallback did not run.
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });
});
