import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { dismissTourIfPresent } from './helpers/explore';

const EAT_FIXTURE = fileURLToPath(
  new URL('./fixtures/phosphatase_eat.parquetbundle', import.meta.url),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('driver.overviewTour', 'true');
  });
});

async function loadEatFixture(page: Page): Promise<void> {
  await page.route('**/data.parquetbundle', (route) => route.abort());
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const loader = document.querySelector('protspace-data-loader') as
      | (Element & { loadFromFile?: (file: File) => Promise<void> })
      | null;
    return typeof loader?.loadFromFile === 'function';
  });

  await page.locator('protspace-data-loader input[type="file"]').setInputFiles(EAT_FIXTURE);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: { protein_ids?: string[] };
        })
      | null;
    return plot?.data?.protein_ids?.length === 832;
  });
}

async function selectEcAnnotation(page: Page): Promise<void> {
  const controlBar = page.locator('protspace-control-bar');
  await controlBar.locator('protspace-annotation-select .dropdown-trigger').click();
  await controlBar.locator('.dropdown-item[data-annotation="ec"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const plot = document.querySelector('protspace-scatterplot') as
          | (Element & { selectedAnnotation?: string })
          | null;
        return plot?.selectedAnnotation;
      }),
    )
    .toBe('ec');
}

async function getProteinScreenPosition(
  page: Page,
  proteinId: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (HTMLElement & {
          _plotData?: {
            length: number;
            xs: Float32Array;
            ys: Float32Array;
            originalIndices: Int32Array | null;
            proteinIds: string[];
          };
          _scales?: { x(value: number): number; y(value: number): number };
          _transform?: { x: number; y: number; k: number };
        })
      | null;
    const canvas = plot?.shadowRoot?.querySelector('canvas');
    const data = plot?._plotData;
    const scales = plot?._scales;
    const transform = plot?._transform;
    if (!plot || !canvas || !data || !scales || !transform) {
      throw new Error('Scatter plot geometry is not ready');
    }

    const proteinIndex = data.proteinIds.indexOf(id);
    const slot = data.originalIndices
      ? Array.from(data.originalIndices).findIndex((value) => value === proteinIndex)
      : proteinIndex;
    if (proteinIndex < 0 || slot < 0) {
      throw new Error(`Protein ${id} is not in the rendered view`);
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + scales.x(data.xs[slot]) * transform.k + transform.x,
      y: rect.top + scales.y(data.ys[slot]) * transform.k + transform.y,
    };
  }, proteinId);
}

test('renders and explores EAT transfers from the real phosphatase bundle', async ({ page }) => {
  await loadEatFixture(page);
  await selectEcAnnotation(page);

  const controlBar = page.locator('protspace-control-bar');
  const plot = page.locator('protspace-scatterplot');
  const eatToggle = controlBar.getByRole('checkbox', { name: 'EAT' });
  const threshold = controlBar.getByRole('slider', {
    name: 'Minimum EAT reliability index',
  });

  await expect(eatToggle).toBeChecked();
  await expect(eatToggle).toBeEnabled();
  await expect(threshold).toHaveValue('0.5');
  await threshold.press('Home');
  await expect(threshold).toHaveValue('0');

  const legendSummary = page
    .locator('protspace-legend')
    .getByRole('region', { name: 'Transferred annotation counts' });
  await expect(legendSummary).toContainText(/Observed\s*535/);
  await expect(legendSummary).toContainText(/Predicted by EAT\s*213/);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const renderer = (
          document.querySelector('protspace-scatterplot') as
            | (Element & {
                _webglRenderer?: {
                  predicted?: Float32Array;
                  currentPointCount?: number;
                };
              })
            | null
        )?._webglRenderer;
        const count = renderer?.currentPointCount ?? 0;
        return renderer?.predicted
          ? Array.from(renderer.predicted.subarray(0, count)).filter((value) => value === 1).length
          : -1;
      }),
    )
    .toBe(213);

  await eatToggle.uncheck();
  await expect(threshold).toBeDisabled();
  await expect(legendSummary).toBeHidden();
  await eatToggle.check();
  await expect(threshold).toBeEnabled();

  const transfer = await page.evaluate(() => {
    const plotElement = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: {
            protein_ids: string[];
            annotation_predicted?: Record<
              string,
              Array<{ source: string; confidence: number } | null>
            >;
          };
        })
      | null;
    const cells = plotElement?.data?.annotation_predicted?.ec ?? [];
    const index = cells.findIndex((cell) => cell !== null);
    const cell = cells[index];
    if (!plotElement?.data || !cell || index < 0) {
      throw new Error('No EAT transfer was decoded');
    }
    return {
      target: plotElement.data.protein_ids[index],
      source: cell.source,
      confidence: cell.confidence,
    };
  });

  const targetPosition = await getProteinScreenPosition(page, transfer.target);
  await page.mouse.move(targetPosition.x, targetPosition.y);
  const tooltip = plot.locator('protspace-protein-tooltip');
  await expect(tooltip).toContainText('Predicted (transferred)');
  await expect(tooltip).toContainText('Reliability index');
  await expect(tooltip).toContainText(`source ${transfer.source}`);

  await plot.evaluate((element, proteinId) => {
    element.dispatchEvent(
      new CustomEvent('protein-click', {
        detail: { proteinId },
        bubbles: true,
        composed: true,
      }),
    );
  }, transfer.target);
  await expect(plot.getByRole('status')).toContainText('Showing 1 of 1 provenance connection');
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(1);

  await plot.evaluate((element, proteinId) => {
    element.dispatchEvent(
      new CustomEvent('protein-click', {
        detail: { proteinId },
        bubbles: true,
        composed: true,
      }),
    );
  }, transfer.source);
  await expect(plot.getByRole('status')).toContainText('Showing 4 of 4 provenance connections');
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(4);
  const firstConnectorX = await plot
    .locator('line.eat-provenance-connector')
    .first()
    .getAttribute('x1');

  await controlBar.getByRole('button', { name: 'Projection:' }).click();
  await controlBar.locator('.projection-container .dropdown-item').nth(1).click();
  await expect
    .poll(() => plot.locator('line.eat-provenance-connector').first().getAttribute('x1'))
    .not.toBe(firstConnectorX);
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(4);

  await plot.getByRole('button', { name: 'Close provenance connections' }).click();
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileRows = await controlBar.evaluate((element) => {
    const root = element.shadowRoot!;
    const projection = root
      .querySelector('.left-controls > .control-group')!
      .getBoundingClientRect();
    const eat = root.querySelector('.eat-controls')!.getBoundingClientRect();
    const annotation = root
      .querySelectorAll('.left-controls > .control-group')[1]
      .getBoundingClientRect();
    return {
      projectionBottom: projection.bottom,
      eatTop: eat.top,
      eatBottom: eat.bottom,
      annotationTop: annotation.top,
    };
  });
  expect(mobileRows.projectionBottom).toBeLessThanOrEqual(mobileRows.eatTop);
  expect(mobileRows.eatBottom).toBeLessThanOrEqual(mobileRows.annotationTop);
  await page.setViewportSize({ width: 1280, height: 720 });

  await controlBar.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await controlBar.getByRole('button', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(fs.statSync(downloadPath!).size).toBeGreaterThan(10_000);
});
