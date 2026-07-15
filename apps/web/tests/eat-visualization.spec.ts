import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { dismissTourIfPresent } from './helpers/explore';

const EAT_FIXTURE = fileURLToPath(
  new URL('./fixtures/phosphatase_eat.parquetbundle', import.meta.url),
);
// Exact asset from issue #277 comment 4902936797. Bundle SHA-256:
// 06bacd7a1f862bdea4a9bf2e81037a4a7d772636704c74e3f2806958f3b9ba33.

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

async function sampleEncodedExportMarkers(page: Page): Promise<{
  predicted: number[];
  observed: number[];
  predictedNearestNeighbor: number;
  observedNearestNeighbor: number;
}> {
  return page.evaluate(async () => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (HTMLElement & {
          _plotData?: {
            length: number;
            xs: Float32Array;
            ys: Float32Array;
            originalIndices: Int32Array | null;
          };
          data?: {
            annotation_predicted?: Record<string, Array<unknown | null>>;
          };
          captureAtResolution?: (
            width: number,
            height: number,
            options: { resetView: boolean },
          ) => HTMLCanvasElement;
          getDataExtent?: (options: { padded: boolean }) => {
            xMin: number;
            xMax: number;
            yMin: number;
            yMax: number;
          } | null;
          getRenderInfo?: (
            width: number,
            height: number,
          ) => {
            marginLeft: number;
            marginRight: number;
            marginTop: number;
            marginBottom: number;
          } | null;
        })
      | null;
    const plotData = plot?._plotData;
    const predictedCells = plot?.data?.annotation_predicted?.ec;
    const extent = plot?.getDataExtent?.({ padded: true });
    const width = 800;
    const height = 600;
    const margins = plot?.getRenderInfo?.(width, height);
    if (!plotData || !predictedCells || !extent || !margins || !plot?.captureAtResolution) {
      throw new Error('Export geometry is not ready');
    }

    const positions = Array.from({ length: plotData.length }, (_, slot) => ({
      slot,
      x:
        margins.marginLeft +
        ((plotData.xs[slot] - extent.xMin) / (extent.xMax - extent.xMin)) *
          (width - margins.marginLeft - margins.marginRight),
      y:
        margins.marginTop +
        ((extent.yMax - plotData.ys[slot]) / (extent.yMax - extent.yMin)) *
          (height - margins.marginTop - margins.marginBottom),
    }));
    const withIsolation = positions.map((position) => ({
      ...position,
      nearestNeighbor: Math.min(
        ...positions
          .filter((other) => other.slot !== position.slot)
          .map((other) => Math.hypot(other.x - position.x, other.y - position.y)),
      ),
    }));
    const mostIsolated = (isPredicted: boolean) =>
      withIsolation
        .filter(({ slot }) => {
          const proteinIndex = plotData.originalIndices?.[slot] ?? slot;
          return (predictedCells[proteinIndex] !== null) === isPredicted;
        })
        .sort((a, b) => b.nearestNeighbor - a.nearestNeighbor)[0];
    const predictedPoint = mostIsolated(true);
    const observedPoint = mostIsolated(false);
    if (!predictedPoint || !observedPoint) throw new Error('No export marker pair was available');

    // Exercise the same off-screen renderer used by PNG export, encode it as PNG, and decode the
    // resulting bitmap before sampling. This catches regressions where only the live shader is wired.
    const exportCanvas = plot.captureAtResolution(width, height, { resetView: true });
    const png = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
        'image/png',
      );
    });
    const bitmap = await createImageBitmap(png);
    const decoded = document.createElement('canvas');
    decoded.width = bitmap.width;
    decoded.height = bitmap.height;
    const context = decoded.getContext('2d');
    if (!context) throw new Error('PNG decoding context is unavailable');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const sample = ({ x, y }: { x: number; y: number }): number[] => {
      const rgba = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return Array.from(rgba);
    };
    return {
      predicted: sample(predictedPoint),
      observed: sample(observedPoint),
      predictedNearestNeighbor: predictedPoint.nearestNeighbor,
      observedNearestNeighbor: observedPoint.nearestNeighbor,
    };
  });
}

test('renders and explores EAT transfers from the real phosphatase bundle', async ({ page }) => {
  await loadEatFixture(page);
  await selectEcAnnotation(page);

  const controlBar = page.locator('protspace-control-bar');
  const plot = page.locator('protspace-scatterplot');
  const eatGroup = controlBar.getByRole('group', { name: 'Embedding Annotation Transfer' });
  const eatToggle = controlBar.getByRole('checkbox', { name: 'EAT' });
  const threshold = controlBar.getByRole('slider', {
    name: 'Minimum EAT reliability index',
  });
  const thresholdPercent = controlBar.getByRole('spinbutton', {
    name: 'Minimum EAT reliability percentage',
  });

  await expect(eatGroup).toBeVisible();
  await expect(eatToggle).toBeChecked();
  await expect(eatToggle).toBeEnabled();
  await expect(threshold).toHaveValue('0.5');
  await expect(thresholdPercent).toHaveValue('50');
  await threshold.press('Home');
  await expect(threshold).toHaveValue('0');
  await expect(thresholdPercent).toHaveValue('0');
  await thresholdPercent.fill('50');
  await expect(threshold).toHaveValue('0.5');

  const annotationSelect = controlBar.locator('protspace-annotation-select');
  await annotationSelect.locator('.dropdown-trigger').click();
  const ecRow = annotationSelect.locator('.dropdown-item[data-annotation="ec"]');
  await expect(ecRow.locator('.eat-badge')).toHaveText('EAT');
  const ordinaryRow = annotationSelect
    .locator('.dropdown-item:not(:has(.eat-badge))')
    .filter({ hasNot: annotationSelect.locator('.annotation-section-header') })
    .first();
  await ordinaryRow.click();
  await expect(eatGroup).toBeHidden();
  await annotationSelect.locator('.dropdown-trigger').click();
  await annotationSelect.locator('.dropdown-item[data-annotation="ec"]').click();
  await expect(eatGroup).toBeVisible();

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
  await expect(thresholdPercent).toBeDisabled();
  await expect(legendSummary).toBeHidden();
  await eatToggle.check();
  await expect(threshold).toBeEnabled();

  const exactMultiValueTransfer = await page.evaluate(() => {
    const plotElement = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: {
            protein_ids: string[];
            annotation_predicted?: Record<
              string,
              Array<{ source: string; values?: readonly string[] } | null>
            >;
          };
        })
      | null;
    const proteinIndex = plotElement?.data?.protein_ids.indexOf('O88488') ?? -1;
    return plotElement?.data?.annotation_predicted?.ec?.[proteinIndex] ?? null;
  });
  expect(exactMultiValueTransfer).toMatchObject({
    source: 'P0C5E4',
    values: [
      '3.1.3.36 (phosphoinositide 5-phosphatase)',
      '3.1.3.67 (phosphatidylinositol-3,4,5-trisphosphate 3-phosphatase)',
      '3.1.3.86 (phosphatidylinositol-3,4,5-trisphosphate 5-phosphatase)',
      '3.1.3.95 (phosphatidylinositol-3,5-bisphosphate 3-phosphatase)',
    ],
  });

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
    const plotElement = element as Element & { data?: { protein_ids: string[] } };
    element.dispatchEvent(
      new CustomEvent('protein-click', {
        detail: {
          proteinId,
          point: { originalIndex: plotElement.data?.protein_ids.indexOf(proteinId) },
        },
        bubbles: true,
        composed: true,
      }),
    );
  }, transfer.target);
  await expect(plot.getByRole('status')).toContainText('Showing 1 of 1 provenance connection');
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(1);

  await plot.evaluate((element, proteinId) => {
    const plotElement = element as Element & { data?: { protein_ids: string[] } };
    element.dispatchEvent(
      new CustomEvent('protein-click', {
        detail: {
          proteinId,
          point: { originalIndex: plotElement.data?.protein_ids.indexOf(proteinId) },
        },
        bubbles: true,
        composed: true,
      }),
    );
  }, transfer.source);
  await expect(plot.getByRole('status')).toContainText('Showing 4 of 4 provenance connections');
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(4);
  const endpoint = plot.locator('circle.eat-provenance-endpoint').first();
  const endpointBeforeZoom = await endpoint.boundingBox();
  const plotBounds = await plot.boundingBox();
  expect(endpointBeforeZoom).not.toBeNull();
  expect(plotBounds).not.toBeNull();
  await page.mouse.move(
    plotBounds!.x + plotBounds!.width / 2,
    plotBounds!.y + plotBounds!.height / 2,
  );
  await page.mouse.wheel(0, -500);
  await expect
    .poll(async () => (await endpoint.boundingBox())?.width ?? 0)
    .toBeGreaterThan(endpointBeforeZoom!.width + 0.5);
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
      viewportWidth: window.innerWidth,
      controlLeft: element.getBoundingClientRect().left,
      controlRight: element.getBoundingClientRect().right,
      projectionBottom: projection.bottom,
      projectionLeft: projection.left,
      projectionRight: projection.right,
      eatTop: eat.top,
      eatBottom: eat.bottom,
      eatLeft: eat.left,
      eatRight: eat.right,
      annotationTop: annotation.top,
      annotationLeft: annotation.left,
      annotationRight: annotation.right,
    };
  });
  expect(mobileRows.controlLeft).toBeGreaterThanOrEqual(0);
  expect(mobileRows.controlRight).toBeLessThanOrEqual(mobileRows.viewportWidth);
  expect(mobileRows.projectionLeft).toBeGreaterThanOrEqual(0);
  expect(mobileRows.projectionRight).toBeLessThanOrEqual(mobileRows.viewportWidth);
  expect(mobileRows.eatLeft).toBeGreaterThanOrEqual(0);
  expect(mobileRows.eatRight).toBeLessThanOrEqual(mobileRows.viewportWidth);
  expect(mobileRows.annotationLeft).toBeGreaterThanOrEqual(0);
  expect(mobileRows.annotationRight).toBeLessThanOrEqual(mobileRows.viewportWidth);
  expect(mobileRows.projectionBottom).toBeLessThanOrEqual(mobileRows.annotationTop);
  expect(mobileRows.annotationTop).toBeLessThanOrEqual(mobileRows.eatTop);
  await page.setViewportSize({ width: 1280, height: 720 });

  const exportMarkers = await sampleEncodedExportMarkers(page);
  const distanceFromWhite = ([red, green, blue]: number[]) =>
    Math.abs(255 - red) + Math.abs(255 - green) + Math.abs(255 - blue);
  expect(exportMarkers.predictedNearestNeighbor).toBeGreaterThan(8);
  expect(exportMarkers.observedNearestNeighbor).toBeGreaterThan(8);
  expect(exportMarkers.predicted[3]).toBe(255);
  expect(exportMarkers.observed[3]).toBe(255);
  expect(distanceFromWhite(exportMarkers.predicted)).toBeLessThan(20);
  expect(distanceFromWhite(exportMarkers.observed)).toBeGreaterThan(60);

  await controlBar.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await controlBar.getByRole('button', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(fs.statSync(downloadPath!).size).toBeGreaterThan(10_000);
});
