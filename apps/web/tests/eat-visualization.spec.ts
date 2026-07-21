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
      // At 0.75 * radius (sqrt(pointSize)/4 vs. the sqrt(pointSize)/3 sprite radius, see
      // stage-point.ts POINT_SIZE_DIVISOR) this offset lands well inside the ring band for both
      // the pre-Task-3 ringWidth clamp(aa*1.75, 0.22, 0.42) and the thicker
      // clamp(aa*1.75, 0.30, 0.55) — the wider ring only grows margin, it never shrinks it.
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
  const legend = page.locator('protspace-legend');
  const eatGroup = legend.getByRole('region', { name: 'Embedding Annotation Transfer' });
  const eatToggle = eatGroup.getByRole('checkbox', { name: 'Show EAT predictions' });
  const threshold = eatGroup.getByRole('slider', {
    name: 'EAT reliability filter threshold',
  });
  const thresholdPercent = eatGroup.getByRole('spinbutton', {
    name: 'EAT reliability filter percentage',
  });
  const filterButton = controlBar.locator('.filter-container .dropdown-trigger');
  const predictedVisibleCount = () =>
    page.evaluate(() => {
      const renderer = (
        document.querySelector('protspace-scatterplot') as
          | (Element & {
              _webglRenderer?: { predicted?: Float32Array; currentPointCount?: number };
            })
          | null
      )?._webglRenderer;
      const count = renderer?.currentPointCount ?? 0;
      return renderer?.predicted
        ? Array.from(renderer.predicted.subarray(0, count)).filter((value) => value === 1).length
        : -1;
    });

  await expect(eatGroup).toBeVisible();
  await expect(eatToggle).toBeChecked();
  await expect(eatToggle).toBeEnabled();
  // Default position 0: every prediction visible, filter box clean.
  await expect(threshold).toHaveValue('0');
  await expect(thresholdPercent).toHaveValue('0');
  await expect(filterButton).not.toHaveClass(/filter-active/);
  await expect.poll(predictedVisibleCount).toBe(213);

  // Raising the threshold drives the shared NOT(EAT_confidence < x) filter, which
  // HIDES sub-threshold predictions (fewer visible points) rather than dimming them.
  await thresholdPercent.fill('99');
  await expect(threshold).toHaveValue('0.99');
  await expect(filterButton).toHaveClass(/filter-active/);
  await expect.poll(predictedVisibleCount).toBeLessThan(213);

  // Dragging back to 0 removes the condition and restores every prediction.
  await threshold.press('Home');
  await expect(threshold).toHaveValue('0');
  await expect(thresholdPercent).toHaveValue('0');
  await expect(filterButton).not.toHaveClass(/filter-active/);
  await expect.poll(predictedVisibleCount).toBe(213);

  // The info popover explains predictions are filtered out while curated stays.
  await eatGroup.getByRole('button', { name: 'Information about EAT reliability filter' }).click();
  await expect(eatGroup.getByRole('dialog')).toContainText(
    'Predictions below this reliability are hidden',
  );
  await expect(eatGroup.getByRole('dialog')).toContainText('EC number — EAT confidence');

  const legendSummary = eatGroup.getByRole('region', {
    name: 'Transferred annotation counts',
  });
  await eatToggle.uncheck();
  await expect(eatGroup).toBeVisible();
  await expect(legendSummary).toBeHidden();
  await expect(threshold).toBeDisabled();
  await eatToggle.check();
  await expect(legendSummary).toBeVisible();

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

  await expect(legendSummary).toContainText(/Observed\s*535/);
  await expect(legendSummary).toContainText(/Predicted by EAT\s*213/);

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
  // All endpoints are on-screen, so the terse status chip stays silent (Task 1: #1).
  await expect(plot.locator('.connector-status')).not.toBeVisible();
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
  // Still all on-screen after the second pair is added — chip remains silent.
  await expect(plot.locator('.connector-status')).not.toBeVisible();
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

  // Both endpoints stay on-screen here too, so there is no × chip to click; dismiss
  // via the existing "click empty plot space" path instead (Task 1: #1). Use the
  // bottom-right corner: the top-left ~50x40px band is occupied by the
  // projection-metadata / tips info triggers (2rem info button at top:0.5rem;
  // left:0.5rem, z-index 10, so (8,8) lands on that button, not the canvas), the
  // bottom overlays (`.plot-indicator`) are `pointer-events: none` so they never
  // intercept clicks, and the extreme corner sits well outside the zoomed-in
  // 832-point cluster.
  const clearClickBounds = await plot.boundingBox();
  expect(clearClickBounds).not.toBeNull();
  await plot.click({
    position: { x: clearClickBounds!.width - 12, y: clearClickBounds!.height - 12 },
  });
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(0);

  await page.setViewportSize({ width: 601, height: 844 });
  const compactControlBar = await controlBar.evaluate((element) => {
    const root = element.shadowRoot!;
    const [projectionElement, annotationElement] = root.querySelectorAll<HTMLElement>(
      '.left-controls > .control-group',
    );
    const projection = projectionElement.getBoundingClientRect();
    const annotation = annotationElement.getBoundingClientRect();
    return {
      projectionRight: projection.right,
      projectionClientWidth: projectionElement.clientWidth,
      projectionScrollWidth: projectionElement.scrollWidth,
      annotationLeft: annotation.left,
      annotationClientWidth: annotationElement.clientWidth,
      annotationScrollWidth: annotationElement.scrollWidth,
      eatControlCount: root.querySelectorAll('.eat-controls').length,
    };
  });
  expect(compactControlBar.projectionRight).toBeLessThanOrEqual(compactControlBar.annotationLeft);
  expect(compactControlBar.projectionScrollWidth).toBeLessThanOrEqual(
    compactControlBar.projectionClientWidth,
  );
  expect(compactControlBar.annotationScrollWidth).toBeLessThanOrEqual(
    compactControlBar.annotationClientWidth,
  );
  expect(compactControlBar.eatControlCount).toBe(0);

  for (const width of [320, 390, 601, 800]) {
    await page.setViewportSize({ width, height: 844 });
    const legendControlLayout = await eatGroup.evaluate((element) => {
      const group = element as HTMLElement;
      const host = (group.getRootNode() as ShadowRoot).host.getBoundingClientRect();
      const groupBounds = group.getBoundingClientRect();
      const thresholdElement = group.querySelector<HTMLElement>('.eat-threshold')!;
      const thresholdBounds = thresholdElement.getBoundingClientRect();
      const percentBounds = group
        .querySelector<HTMLElement>('.eat-threshold-percent')!
        .getBoundingClientRect();
      const helpBounds = group
        .querySelector<HTMLElement>('.eat-threshold-info')!
        .getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        hostLeft: host.left,
        hostRight: host.right,
        groupLeft: groupBounds.left,
        groupRight: groupBounds.right,
        helpLeft: helpBounds.left,
        helpRight: helpBounds.right,
        thresholdLeft: thresholdBounds.left,
        thresholdRight: thresholdBounds.right,
        thresholdClientWidth: thresholdElement.clientWidth,
        thresholdScrollWidth: thresholdElement.scrollWidth,
        percentLeft: percentBounds.left,
        percentRight: percentBounds.right,
      };
    });
    expect(legendControlLayout.groupLeft).toBeGreaterThanOrEqual(legendControlLayout.hostLeft);
    expect(legendControlLayout.groupRight).toBeLessThanOrEqual(legendControlLayout.hostRight);
    expect(legendControlLayout.groupLeft).toBeGreaterThanOrEqual(0);
    expect(legendControlLayout.groupRight).toBeLessThanOrEqual(legendControlLayout.viewportWidth);
    expect(legendControlLayout.helpLeft).toBeGreaterThanOrEqual(legendControlLayout.groupLeft);
    expect(legendControlLayout.helpRight).toBeLessThanOrEqual(legendControlLayout.groupRight);
    expect(legendControlLayout.thresholdLeft).toBeGreaterThanOrEqual(legendControlLayout.groupLeft);
    expect(legendControlLayout.thresholdRight).toBeLessThanOrEqual(legendControlLayout.groupRight);
    expect(legendControlLayout.thresholdScrollWidth).toBeLessThanOrEqual(
      legendControlLayout.thresholdClientWidth,
    );
    expect(legendControlLayout.percentLeft).toBeGreaterThanOrEqual(legendControlLayout.groupLeft);
    expect(legendControlLayout.percentRight).toBeLessThanOrEqual(legendControlLayout.groupRight);
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
  // Predicted interiors are hollow (Task 3: #3+#4) — `captureAtResolution` fills the export
  // canvas with an opaque `backgroundColor` first and then composites the WebGL layer over it
  // ("source-over"), so a fully transparent hole still resolves to an opaque background-colored
  // pixel here. The center only reads as truly transparent when the export itself has no opaque
  // background fill (see the `'transparent'` backgroundColor case below).
  expect(exportMarkers.predicted[3]).toBe(255);
  expect(exportMarkers.observed[3]).toBe(255);
  expect(distanceFromWhite(exportMarkers.predicted)).toBeLessThan(20);
  expect(Math.max(...exportMarkers.predictedRing.map(distanceFromWhite))).toBeGreaterThan(60);
  expect(distanceFromWhite(exportMarkers.observed)).toBeGreaterThan(60);
  expect(exportMarkers.densePredictedNearestNeighbor).toBeLessThan(0.5);
  // Hollow interiors intentionally drop the opaque-knockout protection against overlapping
  // markers: a densely overlapping predicted point's "hole" can now reveal whatever was painted
  // underneath it in the same WebGL pass instead of always matching the plot background, so the
  // color is no longer pinned to white here. The exported alpha stays opaque regardless (same
  // background-fill compositing as above), which is still worth asserting.
  expect(exportMarkers.densePredicted[3]).toBe(255);
  // The colored ring must render at every point size. The hollow CENTER's color is intentionally
  // NOT asserted per-size here: at a small point size (48px) the hole is sub-pixel, so the sampled
  // "center" can land on the ring and is not reliably the show-through color across platforms (it
  // read ~92 on Linux CI vs near-white on macOS). The center's show-through is proven at the default
  // size instead — near-white over the white bg (above), the dark bg (below), and alpha 0 over a
  // transparent bg (below).
  for (const profile of markerProfiles) {
    expect(Math.max(...profile.predictedRing.map(distanceFromWhite))).toBeGreaterThan(60);
  }
  const darkExport = await sampleEncodedExportMarkers(page, 240, '#102030');
  expect(
    Math.abs(darkExport.predicted[0] - 16) +
      Math.abs(darkExport.predicted[1] - 32) +
      Math.abs(darkExport.predicted[2] - 48),
  ).toBeLessThan(20);
  const transparentExport = await sampleEncodedExportMarkers(page, 240, 'transparent');
  // With backgroundColor: 'transparent', `captureAtResolution` skips the opaque-fill compositing
  // step entirely and returns the raw WebGL canvas, which is cleared to (0,0,0,0). An isolated
  // hollow predicted point's center is therefore genuinely transparent here — unlike the opaque
  // exports above, there is no background fill underneath it to composite onto.
  expect(transparentExport.predicted[3]).toBe(0);
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
