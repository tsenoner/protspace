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

async function sampleEncodedExportMarkers(
  page: Page,
  pointSize = 240,
  backgroundColor = '#ffffff',
): Promise<{
  predicted: number[];
  predictedRing: number[][];
  densePredicted: number[];
  densePredictedNearestNeighbor: number;
  observed: number[];
  predictedNearestNeighbor: number;
  observedNearestNeighbor: number;
  corner: number[];
}> {
  return page.evaluate(
    async ({ pointSize, backgroundColor }) => {
      const plot = document.querySelector('protspace-scatterplot') as
        | (HTMLElement & {
            _plotData?: {
              length: number;
              xs: Float32Array;
              ys: Float32Array;
              originalIndices: Int32Array | null;
              proteinIds: string[];
            };
            data?: {
              annotation_predicted?: Record<string, Array<unknown | null>>;
            };
            captureAtResolution?: (
              width: number,
              height: number,
              options: { resetView: boolean; backgroundColor: string },
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
            config?: Record<string, unknown>;
            updateComplete?: Promise<unknown>;
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

      const originalConfig = plot.config ?? {};
      plot.config = { ...originalConfig, pointSize };
      await plot.updateComplete;

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
      const denseProteinIndex = plotData.proteinIds.indexOf('P60483');
      const densePredictedPoint = withIsolation.find(
        ({ slot }) => (plotData.originalIndices?.[slot] ?? slot) === denseProteinIndex,
      );
      if (!predictedPoint || !observedPoint || !densePredictedPoint) {
        throw new Error('No isolated and dense export marker samples were available');
      }

      // Exercise the same off-screen renderer used by PNG export, encode it as PNG, and decode the
      // resulting bitmap before sampling. This catches regressions where only the live shader is wired.
      const exportCanvas = plot.captureAtResolution(width, height, {
        resetView: true,
        backgroundColor,
      });
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
      const ringOffset = Math.max(1, Math.round(Math.sqrt(pointSize) / 4));
      const diagonalOffset = Math.max(1, Math.round(ringOffset / Math.SQRT2));
      const predictedRingOffsets = [
        [-ringOffset, 0],
        [ringOffset, 0],
        [0, -ringOffset],
        [0, ringOffset],
        [-diagonalOffset, -diagonalOffset],
        [diagonalOffset, -diagonalOffset],
        [-diagonalOffset, diagonalOffset],
        [diagonalOffset, diagonalOffset],
      ];
      const result = {
        predicted: sample(predictedPoint),
        predictedRing: predictedRingOffsets.map(([dx, dy]) =>
          sample({ x: predictedPoint.x + dx, y: predictedPoint.y + dy }),
        ),
        densePredicted: sample(densePredictedPoint),
        densePredictedNearestNeighbor: densePredictedPoint.nearestNeighbor,
        observed: sample(observedPoint),
        predictedNearestNeighbor: predictedPoint.nearestNeighbor,
        observedNearestNeighbor: observedPoint.nearestNeighbor,
        corner: sample({ x: 0, y: 0 }),
      };
      plot.config = originalConfig;
      await plot.updateComplete;
      return result;
    },
    { pointSize, backgroundColor },
  );
}

test('renders and explores EAT transfers from the real phosphatase bundle', async ({ page }) => {
  await loadEatFixture(page);
  await selectEcAnnotation(page);

  const controlBar = page.locator('protspace-control-bar');
  const plot = page.locator('protspace-scatterplot');
  const eatGroup = controlBar.getByRole('group', { name: 'Embedding Annotation Transfer' });
  const eatToggle = controlBar.getByRole('checkbox', { name: 'EAT' });
  const threshold = controlBar.getByRole('slider', {
    name: 'EAT reliability emphasis threshold',
  });
  const thresholdPercent = controlBar.getByRole('spinbutton', {
    name: 'EAT reliability emphasis percentage',
  });

  await expect(eatGroup).toBeVisible();
  await expect(eatToggle).toBeChecked();
  await expect(eatToggle).toBeEnabled();
  await expect(threshold).toHaveValue('0.5');
  await expect(thresholdPercent).toHaveValue('50');
  await eatGroup
    .getByRole('button', { name: 'Information about EAT reliability emphasis' })
    .click();
  await expect(eatGroup.getByRole('dialog')).toContainText(
    'Predictions below this reliability remain visible but are dimmed',
  );
  await expect(eatGroup.getByRole('dialog')).toContainText('EC number — EAT confidence');
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
  await expect(legendSummary).toContainText(/No annotation\s*84/);
  await legendSummary.getByRole('button', { name: 'Information about No annotation' }).click();
  await expect(legendSummary.getByRole('dialog')).toContainText(
    'No observed EC number value and no EAT prediction',
  );

  const noAnnotationExample = await page.evaluate(() => {
    const plotElement = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: {
            protein_ids: string[];
            annotations: Record<string, { values: string[] }>;
            annotation_data: Record<string, Int32Array>;
            annotation_predicted?: Record<string, Array<unknown | null>>;
          };
        })
      | null;
    const index = plotElement?.data?.protein_ids.indexOf('A0JMF6') ?? -1;
    const valueIndex = index >= 0 ? plotElement?.data?.annotation_data.ec[index] : undefined;
    return {
      id: plotElement?.data?.protein_ids[index],
      observedValue:
        valueIndex === undefined ? undefined : plotElement?.data?.annotations.ec.values[valueIndex],
      prediction: index >= 0 ? plotElement?.data?.annotation_predicted?.ec[index] : undefined,
    };
  });
  expect(noAnnotationExample).toEqual({
    id: 'A0JMF6',
    observedValue: '__NA__',
    prediction: null,
  });

  const proteinSearch = controlBar.locator('protspace-protein-search');
  await proteinSearch.locator('#protein-search-input').fill('A0JMF6');
  await proteinSearch.locator('#protein-search-input').press('Enter');
  await controlBar.getByRole('button', { name: 'Isolate' }).click();
  await expect(legendSummary).toContainText(/Observed\s*0/);
  await expect(legendSummary).toContainText(/Predicted by EAT\s*0/);
  await expect(legendSummary).toContainText(/No annotation\s*1/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scatterplot = document.querySelector('protspace-scatterplot') as
          | (Element & {
              _plotData?: {
                length: number;
                proteinIds: string[];
                originalIndices: Int32Array | null;
              };
            })
          | null;
        const plotData = scatterplot?._plotData;
        return {
          length: plotData?.length,
          ids: plotData
            ? Array.from(
                { length: plotData.length },
                (_, slot) => plotData.proteinIds[plotData.originalIndices?.[slot] ?? slot],
              )
            : undefined,
        };
      }),
    )
    .toEqual({ length: 1, ids: ['A0JMF6'] });
  const isolatedPosition = await getProteinScreenPosition(page, 'A0JMF6');
  await page.mouse.move(isolatedPosition.x, isolatedPosition.y);
  const isolatedTooltip = plot.locator('protspace-protein-tooltip');
  await expect(isolatedTooltip).toContainText('A0JMF6');
  await expect(isolatedTooltip).not.toContainText('Predicted (transferred)');
  await controlBar.getByRole('button', { name: 'Reset' }).click();
  await expect(legendSummary).toContainText(/Observed\s*535/);
  await expect(legendSummary).toContainText(/Predicted by EAT\s*213/);
  await expect(legendSummary).toContainText(/No annotation\s*84/);

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

  const o88488Position = await getProteinScreenPosition(page, 'O88488');
  await page.mouse.move(o88488Position.x, o88488Position.y);
  const tooltip = plot.locator('protspace-protein-tooltip');
  const transferredLabels = tooltip.locator('.eat-transferred-label');
  await expect(transferredLabels).toHaveCount(4);
  await expect(transferredLabels.nth(3)).toContainText(
    '3.1.3.95 (phosphatidylinositol-3,5-bisphosphate 3-phosphatase)',
  );
  const transferLabelGeometry = await transferredLabels.evaluateAll((labels) =>
    labels.map((label) => ({
      clientWidth: label.clientWidth,
      scrollWidth: label.scrollWidth,
      clientHeight: label.clientHeight,
      scrollHeight: label.scrollHeight,
    })),
  );
  expect(
    transferLabelGeometry.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1),
  ).toBe(true);
  expect(transferLabelGeometry.some(({ clientHeight }) => clientHeight > 18)).toBe(true);

  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await plot.scrollIntoViewIfNeeded();
    const responsivePosition = await getProteinScreenPosition(page, 'O88488');
    await page.mouse.move(responsivePosition.x, responsivePosition.y);
    await expect(transferredLabels).toHaveCount(4);
    const tooltipBounds = await tooltip.boundingBox();
    expect(tooltipBounds).not.toBeNull();
    expect(tooltipBounds!.x).toBeGreaterThanOrEqual(15);
    expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(width - 15);
    await expect(transferredLabels.nth(3)).toContainText(
      '3.1.3.95 (phosphatidylinositol-3,5-bisphosphate 3-phosphatase)',
    );
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await plot.evaluate(async (element) => {
    await (element as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
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
    .toBeCloseTo(endpointBeforeZoom!.width, 0);
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

  await page.setViewportSize({ width: 601, height: 844 });
  const tabletRows = await controlBar.evaluate((element) => {
    const root = element.shadowRoot!;
    const [projectionElement, annotationElement] = root.querySelectorAll<HTMLElement>(
      '.left-controls > .control-group',
    );
    const eatElement = root.querySelector<HTMLElement>('.eat-controls')!;
    const projection = projectionElement.getBoundingClientRect();
    const annotation = annotationElement.getBoundingClientRect();
    const eat = eatElement.getBoundingClientRect();
    return {
      projectionRight: projection.right,
      projectionBottom: projection.bottom,
      projectionClientWidth: projectionElement.clientWidth,
      projectionScrollWidth: projectionElement.scrollWidth,
      annotationLeft: annotation.left,
      annotationBottom: annotation.bottom,
      annotationClientWidth: annotationElement.clientWidth,
      annotationScrollWidth: annotationElement.scrollWidth,
      eatTop: eat.top,
    };
  });
  expect(tabletRows.projectionRight).toBeLessThanOrEqual(tabletRows.annotationLeft);
  expect(tabletRows.projectionScrollWidth).toBeLessThanOrEqual(tabletRows.projectionClientWidth);
  expect(tabletRows.annotationScrollWidth).toBeLessThanOrEqual(tabletRows.annotationClientWidth);
  expect(tabletRows.eatTop).toBeGreaterThanOrEqual(
    Math.max(tabletRows.projectionBottom, tabletRows.annotationBottom),
  );

  for (const mobileWidth of [320, 390]) {
    await page.setViewportSize({ width: mobileWidth, height: 844 });
    const mobileRows = await controlBar.evaluate((element) => {
      const root = element.shadowRoot!;
      const projection = root
        .querySelector('.left-controls > .control-group')!
        .getBoundingClientRect();
      const eat = root.querySelector('.eat-controls')!.getBoundingClientRect();
      const eatThresholdElement = root.querySelector<HTMLElement>('.eat-threshold')!;
      const eatThreshold = eatThresholdElement.getBoundingClientRect();
      const eatPercent = root.querySelector('.eat-threshold-percent')!.getBoundingClientRect();
      const eatHelp = root.querySelector('.eat-threshold-info')!.getBoundingClientRect();
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
        eatHelpLeft: eatHelp.left,
        eatHelpRight: eatHelp.right,
        eatThresholdLeft: eatThreshold.left,
        eatThresholdRight: eatThreshold.right,
        eatThresholdClientWidth: eatThresholdElement.clientWidth,
        eatThresholdScrollWidth: eatThresholdElement.scrollWidth,
        eatPercentLeft: eatPercent.left,
        eatPercentRight: eatPercent.right,
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
    expect(mobileRows.eatHelpLeft).toBeGreaterThanOrEqual(mobileRows.eatLeft);
    expect(mobileRows.eatHelpRight).toBeLessThanOrEqual(mobileRows.eatRight);
    expect(mobileRows.eatThresholdLeft).toBeGreaterThanOrEqual(mobileRows.eatLeft);
    expect(mobileRows.eatThresholdRight).toBeLessThanOrEqual(mobileRows.eatRight);
    expect(mobileRows.eatThresholdScrollWidth).toBeLessThanOrEqual(
      mobileRows.eatThresholdClientWidth,
    );
    expect(mobileRows.eatPercentLeft).toBeGreaterThanOrEqual(mobileRows.eatLeft);
    expect(mobileRows.eatPercentRight).toBeLessThanOrEqual(mobileRows.eatRight);
    expect(mobileRows.annotationLeft).toBeGreaterThanOrEqual(0);
    expect(mobileRows.annotationRight).toBeLessThanOrEqual(mobileRows.viewportWidth);
    expect(mobileRows.projectionBottom).toBeLessThanOrEqual(mobileRows.annotationTop);
    expect(mobileRows.annotationTop).toBeLessThanOrEqual(mobileRows.eatTop);
  }

  for (const width of [320, 390, 601, 800]) {
    await page.setViewportSize({ width, height: 844 });
    const noAnnotationHelp = legendSummary.getByRole('button', {
      name: 'Information about No annotation',
    });
    await page.mouse.move(1, 1);
    await page.keyboard.press('Escape');
    await noAnnotationHelp.evaluate((button) => (button as HTMLButtonElement).click());
    const helpDialog = legendSummary.getByRole('dialog');
    await expect(helpDialog).toBeVisible();
    const helpBounds = await helpDialog.boundingBox();
    expect(helpBounds).not.toBeNull();
    expect(helpBounds!.x).toBeGreaterThanOrEqual(8);
    expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(width - 8);
    await noAnnotationHelp.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(helpDialog).toBeHidden();
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  const markerProfiles: Awaited<ReturnType<typeof sampleEncodedExportMarkers>>[] = [];
  for (const pointSize of [48, 240, 512]) {
    markerProfiles.push(await sampleEncodedExportMarkers(page, pointSize));
  }
  const exportMarkers = markerProfiles[1];
  const distanceFromWhite = ([red, green, blue]: number[]) =>
    Math.abs(255 - red) + Math.abs(255 - green) + Math.abs(255 - blue);
  expect(exportMarkers.predictedNearestNeighbor).toBeGreaterThan(8);
  expect(exportMarkers.observedNearestNeighbor).toBeGreaterThan(8);
  expect(exportMarkers.predicted[3]).toBe(255);
  expect(exportMarkers.observed[3]).toBe(255);
  expect(distanceFromWhite(exportMarkers.predicted)).toBeLessThan(20);
  expect(Math.max(...exportMarkers.predictedRing.map(distanceFromWhite))).toBeGreaterThan(60);
  expect(distanceFromWhite(exportMarkers.observed)).toBeGreaterThan(60);
  expect(exportMarkers.densePredictedNearestNeighbor).toBeLessThan(0.5);
  expect(distanceFromWhite(exportMarkers.densePredicted)).toBeLessThan(20);
  for (const profile of markerProfiles) {
    expect(distanceFromWhite(profile.predicted)).toBeLessThan(20);
    expect(Math.max(...profile.predictedRing.map(distanceFromWhite))).toBeGreaterThan(60);
  }
  const darkExport = await sampleEncodedExportMarkers(page, 240, '#102030');
  expect(
    Math.abs(darkExport.predicted[0] - 16) +
      Math.abs(darkExport.predicted[1] - 32) +
      Math.abs(darkExport.predicted[2] - 48),
  ).toBeLessThan(20);
  const transparentExport = await sampleEncodedExportMarkers(page, 240, 'transparent');
  expect(distanceFromWhite(transparentExport.predicted)).toBeLessThan(20);
  expect(transparentExport.corner[3]).toBe(0);

  await controlBar.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await controlBar.getByRole('button', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(fs.statSync(downloadPath!).size).toBeGreaterThan(10_000);
});
