import { expect, test, type Page } from '@playwright/test';
import {
  getSelectedProteinIds,
  openExplore,
  searchInput,
  selectionBarAction,
} from './helpers/explore';

const search = (page: Page) => page.locator('protspace-protein-search');
/** The report under the field; its one-sentence summary is in the search's live region. */
const report = (page: Page) => search(page).locator('.search-report');

/** The first `count` protein ids of the loaded dataset. */
function proteinIds(page: Page, count: number): Promise<string[]> {
  return page
    .locator('#myPlot')
    .evaluate(
      (plot, n) =>
        ((plot as Element & { data?: { protein_ids?: string[] } }).data?.protein_ids ?? []).slice(
          0,
          n,
        ),
      count,
    );
}

/** Pastes `text` into the search box, as a browser does on ⌘V / Ctrl+V. */
async function paste(page: Page, text: string): Promise<void> {
  await searchInput(page).focus();
  await searchInput(page).evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }, text);
}

type Transform = { k: number; x: number; y: number };
function readTransform(page: Page): Promise<Transform> {
  return page.locator('#myPlot').evaluate((plot) => {
    const { k, x, y } = (plot as unknown as Element & { _transform: Transform })._transform;
    return { k, x, y };
  });
}

test.describe('protein search feedback', () => {
  test('an unknown ID shows the message and keeps the text', async ({ page }) => {
    await openExplore(page);
    await searchInput(page).fill('NOT_A_PROTEIN_ZZZ');
    await searchInput(page).press('Enter');

    await expect(report(page)).toHaveText('No protein NOT_A_PROTEIN_ZZZ in this dataset');
    await expect(search(page).getByRole('status')).toHaveText(
      'No protein NOT_A_PROTEIN_ZZZ in this dataset',
    );
    await expect(searchInput(page)).toHaveValue('NOT_A_PROTEIN_ZZZ');
    expect(await getSelectedProteinIds(page)).toEqual([]);

    // One Escape closes the report and keeps the text; the next empties the box.
    await searchInput(page).press('Escape');
    await expect(report(page)).toHaveCount(0);
    await expect(searchInput(page)).toHaveValue('NOT_A_PROTEIN_ZZZ');
    await searchInput(page).press('Escape');
    await expect(searchInput(page)).toHaveValue('');
  });

  test('pasting a list reports found and missing, and Copy missing IDs copies them', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openExplore(page);
    const [a, b] = await proteinIds(page, 2);

    await paste(page, `${a}, ${b.toLowerCase()}; MISSING_ONE\nMISSING_TWO`);

    const shown = report(page);
    await expect(shown).toContainText('2 of 4 found');
    await expect(shown.getByRole('listitem')).toHaveText(['MISSING_ONE', 'MISSING_TWO']);
    await expect(search(page).getByRole('status')).toHaveText('2 of 4 found, 2 not found');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([a, b]);

    await shown.getByRole('button', { name: 'Copy missing IDs' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'MISSING_ONE\nMISSING_TWO',
    );
    // Copying keeps the report on screen and says so.
    await expect(shown).toBeVisible();
    await expect(shown.getByRole('button', { name: 'Copied' })).toBeVisible();
  });

  test('a single hit moves the protein to the plot centre ±2 px', async ({ page }) => {
    await openExplore(page);
    const [id] = await proteinIds(page, 1);

    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');

    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);
    await expect.poll(async () => (await readTransform(page)).k).toBeGreaterThanOrEqual(8);
    const plot = (await page.locator('#myPlot').boundingBox())!;
    const at = await page.locator('#myPlot').evaluate(
      (element, proteinId) =>
        (
          element as unknown as Element & {
            getProteinClientPosition(id: string): { x: number; y: number } | null;
          }
        ).getProteinClientPosition(proteinId),
      id,
    );
    expect(at).not.toBeNull();
    expect(Math.abs(at!.x - (plot.x + plot.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(at!.y - (plot.y + plot.height / 2))).toBeLessThanOrEqual(2);
  });

  test('a pasted list selects without zooming and the selection bar offers Zoom to them', async ({
    page,
  }) => {
    await openExplore(page);
    const ids = await proteinIds(page, 3);
    const before = await readTransform(page);

    await paste(page, ids.join('\n'));

    await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids);
    expect(await readTransform(page)).toEqual(before);
    // Everything was found: the selection bar carries the result, the search reports nothing.
    await expect(report(page)).toHaveCount(0);

    await selectionBarAction(page, 'Zoom to them').click();
    await expect.poll(() => readTransform(page)).not.toEqual(before);
  });
});
