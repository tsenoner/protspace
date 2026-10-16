import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  chooseTool,
  dismissTourIfPresent,
  exportMenu,
  getSelectedProteinIds,
  openExplore,
  searchInput,
  selectAnnotation,
  selectionBar,
  selectionBarAction,
  viewBar,
  waitForProteinCount,
} from './helpers/explore';
import { figureEditorContent, figurePreviewCanvas } from './helpers/figure';
import { STARTUP_URL_GLOB } from './helpers/fixtures';
import { seedTourSeen } from './helpers/tour-storage-state';
import { stubStructureRequests } from './helpers/workbench';

const EAT_FIXTURE = fileURLToPath(
  new URL('./fixtures/phosphatase_eat.parquetbundle', import.meta.url),
);

const toolButton = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Plot tools' }).getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }) => {
  // A selection opens the structure viewer: answer its requests offline.
  await stubStructureRequests(page);
});

/** The EAT fixture, loaded through the data loader's file input as eat-visualization.spec.ts does. */
async function loadEatFixture(page: Page): Promise<void> {
  await seedTourSeen(page);
  await page.route(STARTUP_URL_GLOB, (route) => route.abort());
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const loader = document.querySelector('protspace-data-loader') as
      | (Element & { loadFromFile?: unknown })
      | null;
    return typeof loader?.loadFromFile === 'function';
  });
  await page.locator('protspace-data-loader input[type="file"]').setInputFiles(EAT_FIXTURE);
  await waitForProteinCount(page, 832);
}

/** Clicks the first protein with an EAT transfer, as a point click reports it, and returns its id. */
function clickEatTransfer(page: Page): Promise<string> {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as unknown as {
      data: {
        protein_ids: string[];
        annotation_predicted?: Record<string, Array<unknown | null>>;
      };
    };
    const cells = plot.data.annotation_predicted?.ec ?? [];
    const index = cells.findIndex((cell) => cell !== null);
    if (index < 0) throw new Error('No EAT transfer was decoded');
    const proteinId = plot.data.protein_ids[index];
    element.dispatchEvent(
      new CustomEvent('protein-click', {
        detail: {
          proteinId,
          point: { originalIndex: index },
          modifierKeys: { ctrl: false, meta: false, shift: false, alt: false },
        },
        bubbles: true,
        composed: true,
      }),
    );
    return proteinId;
  });
}

/** Selects the dataset's first protein through the search box and returns its id. */
async function selectFirstBySearch(page: Page): Promise<string> {
  const id = await page
    .locator('#myPlot')
    .evaluate(
      (plot) => (plot as unknown as { data: { protein_ids: string[] } }).data.protein_ids[0],
    );
  await searchInput(page).fill(id);
  await searchInput(page).press('Enter');
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);
  return id;
}

/** Two frames: a wrong clear shows at once in the search box and reaches the plot after the paint. */
const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

test.describe('the Escape order', () => {
  test('an EAT click: Escape 1 hides the connectors and keeps the selection, 2 clears the selection, 3 returns to Move', async ({
    page,
  }) => {
    await loadEatFixture(page);
    await selectAnnotation(page, 'ec');
    await chooseTool(page, 'Box select');
    const connectors = page.locator('#myPlot line.eat-provenance-connector');

    const target = await clickEatTransfer(page);
    await expect(connectors.first()).toBeAttached();
    expect(await getSelectedProteinIds(page)).toEqual([target]);

    await page.keyboard.press('Escape');
    await expect(connectors).toHaveCount(0);
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([target]);
    await expect(toolButton(page, 'Box select')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
    await expect(toolButton(page, 'Box select')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(toolButton(page, 'Move and zoom')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape with focus in the selection bar clears the selection and returns focus to the tool', async ({
    page,
  }) => {
    await openExplore(page);
    await selectFirstBySearch(page);
    await selectionBarAction(page, 'Zoom to them').focus();

    await page.keyboard.press('Escape');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
    await expect(selectionBar(page)).toBeHidden();
    await expect(toolButton(page, 'Move and zoom')).toBeFocused();
  });

  test('with the projection details pinned, Escape closes only them', async ({ page }) => {
    await openExplore(page);
    const id = await selectFirstBySearch(page);
    // Give the details something to show whatever the fixture's projection metadata holds.
    await page.locator('#myProjectionMetadata').evaluate((details: Element) => {
      (details as Element & { projection: unknown }).projection = {
        name: 'Fixture projection',
        metadata: { n_neighbors: 15, min_dist: 0.1, metric: 'cosine' },
      };
    });
    const trigger = viewBar(page).getByRole('button', { name: 'View projection metadata' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([id]);

    // The details are closed: the next press reaches the selection.
    await page.keyboard.press('Escape');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
  });

  test('Escape in the search box with a typed query empties the box and keeps the selection', async ({
    page,
  }) => {
    await openExplore(page);
    const id = await selectFirstBySearch(page);

    await searchInput(page).fill('zz-no-such-protein');
    await searchInput(page).press('Escape');
    await expect(searchInput(page)).toHaveValue('');
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });

  test('in the figure editor, Escape never clears the plot’s selection', async ({ page }) => {
    await openExplore(page);
    const id = await selectFirstBySearch(page);
    await searchInput(page).blur();
    // The same handler the Export menu's Figure editor item reaches.
    await exportMenu(page).evaluate((menu) =>
      menu.dispatchEvent(new CustomEvent('open-publish-editor', { bubbles: true, composed: true })),
    );
    const editor = figureEditorContent(page);
    await expect(editor).toBeAttached();
    // Draw a circle with the Circle tool, then select it from its row in the sidebar.
    await editor.getByRole('button', { name: 'Circle', exact: true }).click();
    await expect
      .poll(() => figurePreviewCanvas(page).evaluate((c: HTMLCanvasElement) => c.width > 0))
      .toBe(true);
    const canvas = (await figurePreviewCanvas(page).boundingBox())!;
    const cx = canvas.x + canvas.width * 0.4;
    const cy = canvas.y + canvas.height * 0.4;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + canvas.width * 0.15, cy + canvas.height * 0.15, { steps: 5 });
    await page.mouse.up();
    const overlayRow = editor.locator('[data-publish-item="overlay-0"]');
    await overlayRow.click({ position: { x: 4, y: 4 } });
    await expect(overlayRow).toHaveClass(/\bselected\b/);

    await page.keyboard.press('Escape');
    await expect(overlayRow).not.toHaveClass(/\bselected\b/);
    await expect(editor).toBeAttached();
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([id]);

    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });
});
