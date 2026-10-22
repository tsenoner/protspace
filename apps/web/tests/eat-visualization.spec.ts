import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
  annotationSelect,
  clearSelection,
  colorByTrigger,
  dismissTourIfPresent,
  draftFilterCondition,
  exportAction,
  filterButton,
  isolateSelection,
  plotStatus,
  projectionTrigger,
  queryBuilder,
  resetIsolation,
  searchInput,
  selectAnnotation,
  selectProjection,
  viewBar,
  waitForProteinCount,
} from './helpers/explore';
import { eatPanel, eatThresholdBox, openEatPanel } from './helpers/eat';
import { STARTUP_URL_GLOB } from './helpers/fixtures';
import { getFirstLegendItemValue } from './helpers/legend';
import { proteinScreenPosition } from './helpers/plot';
import { seedTourSeen } from './helpers/tour-storage-state';

const EAT_FIXTURE = fileURLToPath(
  new URL('./fixtures/phosphatase_eat.parquetbundle', import.meta.url),
);
// Exact asset from issue #277 comment 4902936797. Bundle SHA-256:
// 06bacd7a1f862bdea4a9bf2e81037a4a7d772636704c74e3f2806958f3b9ba33.

test.beforeEach(async ({ page }) => {
  await seedTourSeen(page);
});

async function loadEatFixture(page: Page): Promise<void> {
  await page.route(STARTUP_URL_GLOB, (route) => route.abort());
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const loader = document.querySelector('protspace-data-loader') as
      | (Element & { loadFromFile?: (file: File) => Promise<void> })
      | null;
    return typeof loader?.loadFromFile === 'function';
  });

  await page.locator('protspace-data-loader input[type="file"]').setInputFiles(EAT_FIXTURE);
  await waitForProteinCount(page, 832);
}

/**
 * Per-protein reliability score for the `ec` annotation, read straight off the
 * loaded dataset: `null` on curated proteins (they carry no EAT transfer, so
 * they have no confidence) and the transfer's score on EAT-predicted ones.
 *
 * The column is resolved by runtime identity (role + base annotation), the same
 * way the app resolves it, so a renamed/suffixed confidence column still works.
 */
async function readEcEatConfidences(
  page: Page,
): Promise<{ id: string; confidence: number | null }[]> {
  return page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: {
            protein_ids: string[];
            annotations: Record<string, { runtime?: { role?: string; baseAnnotation?: string } }>;
            numeric_annotation_data?: Record<string, Float64Array>;
          };
        })
      | null;
    const data = plot?.data;
    const key = Object.entries(data?.annotations ?? {}).find(
      ([, annotation]) =>
        annotation.runtime?.role === 'eat-confidence' &&
        annotation.runtime?.baseAnnotation === 'ec',
    )?.[0];
    const values = key ? data?.numeric_annotation_data?.[key] : undefined;
    if (!data || !values) {
      throw new Error('The EAT confidence column for `ec` is not loaded');
    }
    return data.protein_ids.map((id, index) => ({
      id,
      confidence: Number.isFinite(values[index]) ? values[index] : null,
    }));
  });
}

/**
 * Protein ids the scatter plot currently renders. Query filters physically cull
 * `_plotData` (see scatter-plot.filter-render.test.ts), so this is the visible
 * point set, and `originalIndices` still addresses the full dataset.
 */
async function readRenderedProteinIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const plotData = (
      document.querySelector('protspace-scatterplot') as unknown as
        | (Element & {
            _plotData?: {
              length: number;
              proteinIds: string[];
              originalIndices: Int32Array | null;
            };
          })
        | null
    )?._plotData;
    if (!plotData) throw new Error('Scatter plot geometry is not ready');
    return Array.from(
      { length: plotData.length },
      (_, slot) => plotData.proteinIds[plotData.originalIndices?.[slot] ?? slot],
    );
  });
}

async function sampleEncodedExportMarkers(
  page: Page,
  pointSize = 240,
  backgroundColor = '#ffffff',
): Promise<{
  predicted: number[];
  predictedRing: number[][];
  predictedRingSamples: number;
  densePredicted: number[];
  densePredictedNearestNeighbor: number;
  observed: number[];
  predictedNearestNeighbor: number;
  observedNearestNeighbor: number;
  corner: number[];
}> {
  return page.evaluate(
    async ({ pointSize, backgroundColor }) => {
      const plot = document.querySelector('protspace-scatterplot') as unknown as
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
            _webglRenderer?: { pointScale(): number };
            _mergedConfig?: { width: number; height: number };
          })
        | null;
      const plotData = plot?._plotData;
      const predictedCells = plot?.data?.annotation_predicted?.ec;
      const extent = plot?.getDataExtent?.({ padded: true });
      // Portrait, like the phosphatase projection: one scale for both axes fits the data to its own
      // shape, so a landscape frame would leave its markers crowded in a narrow column.
      const width = 600;
      const height = 800;
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
      const live = plot._mergedConfig!;
      const exportRadius =
        (Math.sqrt(pointSize) / 3) *
        plot._webglRenderer!.pointScale() *
        Math.sqrt((width * height) / (live.width * live.height));
      const ringOffset = Math.max(1, Math.round(0.75 * exportRadius));
      // Sixteen directions: at large point sizes neighbours cover much of the ring, and only
      // samples clear of them count (below).
      const predictedRingOffsets = Array.from({ length: 16 }, (_, i) => [
        Math.round(ringOffset * Math.cos((i * Math.PI) / 8)),
        Math.round(ringOffset * Math.sin((i * Math.PI) / 8)),
      ]);
      // Only ring samples clear of every other marker: one inside a neighbour's marker reads that
      // marker's colour, and would pass for the ring when the ring is lost.
      const clear = ([dx, dy]: number[]) =>
        positions.every(
          (other) =>
            other.slot === predictedPoint.slot ||
            Math.hypot(other.x - predictedPoint.x - dx, other.y - predictedPoint.y - dy) >
              exportRadius + 1,
        );
      const ringOffsets = predictedRingOffsets.filter(clear);
      const result = {
        predicted: sample(predictedPoint),
        predictedRing: ringOffsets.map(([dx, dy]) =>
          sample({ x: predictedPoint.x + dx, y: predictedPoint.y + dy }),
        ),
        predictedRingSamples: ringOffsets.length,
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
  await selectAnnotation(page, 'ec');

  const plot = page.locator('protspace-scatterplot');
  await openEatPanel(page);
  const panel = eatPanel(page);
  const eatToggle = panel.getByRole('switch', { name: 'Show predictions' });
  const threshold = panel.getByRole('slider', {
    name: 'EAT reliability filter lower bound',
  });
  const thresholdPercent = eatThresholdBox(page);
  // The overview's key: curated, predicted and no-value proteins in view.
  const counts = panel.locator('.eat-counts');
  // The plot's filter channel, which the Filter button's badge reflects.
  const plotFiltersActive = () =>
    page.evaluate(
      () =>
        (document.querySelector('#myPlot') as (Element & { filtersActive?: boolean }) | null)
          ?.filtersActive ?? false,
    );
  const predictedVisibleCount = () =>
    page.evaluate(() => {
      const renderer = (
        document.querySelector('protspace-scatterplot') as unknown as
          | (Element & {
              _webglRenderer?: {
                stageArrays?: { predicted: Float32Array };
                currentPointCount?: number;
              };
            })
          | null
      )?._webglRenderer;
      const count = renderer?.currentPointCount ?? 0;
      const predicted = renderer?.stageArrays?.predicted;
      return predicted
        ? Array.from(predicted.subarray(0, count)).filter((value) => value === 1).length
        : -1;
    });

  await expect(eatToggle).toBeChecked();
  await expect(eatToggle).toBeEnabled();
  // Default position 0: every prediction visible, filter box clean.
  await expect(threshold).toHaveValue('0');
  await expect(thresholdPercent).toHaveValue('0');
  await expect.poll(plotFiltersActive).toBe(false);
  await expect(filterButton(page)).toHaveAccessibleName('Filter');
  await expect.poll(predictedVisibleCount).toBe(213);
  // Raising the threshold (hiding, the filter-active button, exact survivor counts)
  // is checked by "keeps curated points visible while the reliability filter…".

  // The header's info explains what a prediction and its reliability are.
  const eatSection = page.locator('#wb-eat-panel');
  await eatSection.getByRole('button', { name: 'Information about EAT' }).click();
  const eatInfo = eatSection.locator('protspace-info-popover .popover');
  await expect(eatInfo).toContainText('nearest curated protein');
  await expect(eatInfo).toContainText('not a probability');
  await page.keyboard.press('Escape');

  // Showing predictions off: the counts say they are off, shown as N/A, and the threshold turns off.
  await eatToggle.click();
  await expect(eatToggle).not.toBeChecked();
  await expect(counts).toContainText('213 predicted (off, shown as N/A)');
  await expect(threshold).toBeDisabled();
  await eatToggle.click();
  await expect(counts).toHaveText('535 curated 213 predicted 84 with no value');

  const colorBy = annotationSelect(page);
  await colorByTrigger(page).click();
  const ecRow = colorBy.locator('.dropdown-item[data-annotation="ec"]');
  await expect(ecRow.locator('.eat-badge')).toHaveText('EAT');
  const ordinaryRow = colorBy
    .locator('.dropdown-item:not(:has(.eat-badge))')
    .filter({ hasNot: colorBy.locator('.annotation-section-header') })
    .first();
  await ordinaryRow.click();
  await expect(panel).toContainText('has no predicted values.');
  await expect(threshold).toHaveCount(0);
  await colorByTrigger(page).click();
  await colorBy.locator('.dropdown-item[data-annotation="ec"]').click();
  await expect(threshold).toBeVisible();

  // 832 proteins: 535 curated with an EC number, 213 predicted, 84 with neither.
  await expect(counts).toHaveText('535 curated 213 predicted 84 with no value');

  const noAnnotationExample = await page.evaluate(() => {
    const plotElement = document.querySelector('protspace-scatterplot') as unknown as
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

  await searchInput(page).fill('A0JMF6');
  await searchInput(page).press('Enter');
  await isolateSelection(page);
  // The panel counts what the filter keeps, not the isolation (EAT plan, Decision 9).
  await expect(counts).toHaveText('535 curated 213 predicted 84 with no value');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scatterplot = document.querySelector('protspace-scatterplot') as unknown as
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
  // The search zoomed in on A0JMF6; isolating fits the view again over a transition. Read the
  // position once it has settled.
  await expect
    .poll(() =>
      page.locator('#myPlot').evaluate((element) => {
        const { k, x, y } = (
          element as unknown as Element & { _transform: { k: number; x: number; y: number } }
        )._transform;
        return [k, x, y];
      }),
    )
    .toEqual([1, 0, 0]);
  // The aborted demo's error toast and the others stack up over the plot's centre, where the
  // isolated protein sits; close them so the hover reaches the plot.
  const dismiss = page
    .locator('[data-sonner-toast]:not([data-removed="true"])')
    .getByRole('button', {
      name: 'Dismiss notification',
    });
  while ((await dismiss.count()) > 0) await dismiss.first().click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  const isolatedPosition = await proteinScreenPosition(page, 'A0JMF6');
  await page.mouse.move(isolatedPosition.x, isolatedPosition.y);
  const isolatedTooltip = plot.locator('protspace-protein-tooltip');
  await expect(isolatedTooltip).toContainText('A0JMF6');
  await expect(isolatedTooltip).not.toContainText('Predicted (transferred)');
  await resetIsolation(page);
  await expect(counts).toHaveText('535 curated 213 predicted 84 with no value');

  await expect.poll(predictedVisibleCount).toBe(213);

  await eatToggle.click();
  await expect(threshold).toBeDisabled();
  await expect(thresholdPercent).toBeDisabled();
  await expect(counts).toContainText('(off, shown as N/A)');
  await eatToggle.click();
  await expect(threshold).toBeEnabled();

  const exactMultiValueTransfer = await page.evaluate(() => {
    const plotElement = document.querySelector('protspace-scatterplot') as unknown as
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

  const o88488Position = await proteinScreenPosition(page, 'O88488');
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
    const responsivePosition = await proteinScreenPosition(page, 'O88488');
    // Whole pixels: Chrome truncates the mouse event's coordinates, and at this size O88488 sits
    // 1.5 px from P0C5E4, so a truncated fractional probe can land nearer the neighbour.
    await page.mouse.move(Math.round(responsivePosition.x), Math.round(responsivePosition.y));
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
    const plotElement = document.querySelector('protspace-scatterplot') as unknown as
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

  const targetPosition = await proteinScreenPosition(page, transfer.target);
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
          modifierKeys: { ctrl: false, meta: false, shift: false, alt: false },
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
          modifierKeys: { ctrl: false, meta: false, shift: false, alt: false },
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
  const haloRadius = () =>
    plot.evaluate((el) => {
      const p = el as unknown as { _drawnPointRadiusCss(): number };
      return Math.max(4, p._drawnPointRadiusCss() + 2);
    });
  const endpointBeforeZoom = await endpoint.boundingBox();
  const haloBeforeZoom = await haloRadius();
  const plotBounds = await plot.boundingBox();
  expect(endpointBeforeZoom).not.toBeNull();
  expect(plotBounds).not.toBeNull();
  await page.mouse.move(
    plotBounds!.x + plotBounds!.width / 2,
    plotBounds!.y + plotBounds!.height / 2,
  );
  await page.mouse.wheel(0, -500);
  await expect.poll(haloRadius).toBeGreaterThan(haloBeforeZoom);
  await expect
    .poll(async () => {
      const grownBy = 2 * ((await haloRadius()) - haloBeforeZoom);
      return ((await endpoint.boundingBox())?.width ?? 0) - endpointBeforeZoom!.width - grownBy;
    })
    .toBeCloseTo(0, 0);
  await expect(plot.locator('line.eat-provenance-connector')).toHaveCount(4);
  const firstConnectorX = await plot
    .locator('line.eat-provenance-connector')
    .first()
    .getAttribute('x1');

  await selectProjection(page, 1);
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
  // The point clicks above also selected a protein, as a real click does. Clear it so the
  // export markers below are sampled without the selection dimming the other points.
  await clearSelection(page);

  // At 601 px the Projection and Color by pickers still sit side by side on screen, and the EAT
  // reliability controls stay in the EAT panel, not in the view bar.
  // The view bar settles on its stage in the frame after the resize, so the layout is polled.
  await page.setViewportSize({ width: 601, height: 844 });
  await expect(async () => {
    const projectionBox = await projectionTrigger(page).boundingBox();
    const colorByBox = await colorByTrigger(page).boundingBox();
    expect(projectionBox).not.toBeNull();
    expect(colorByBox).not.toBeNull();
    expect(projectionBox!.x + projectionBox!.width).toBeLessThanOrEqual(colorByBox!.x);
    expect(projectionBox!.x).toBeGreaterThanOrEqual(0);
    expect(colorByBox!.x + colorByBox!.width).toBeLessThanOrEqual(601);
    expect(await viewBar(page).evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true);
  }).toPass({ timeout: 5_000 });
  await expect(
    viewBar(page).getByRole('slider', { name: 'EAT reliability filter lower bound' }),
  ).toHaveCount(0);

  // The panel's reliability controls fit inside it, and the panel inside the screen, at every
  // width (below 951 px the panel is the EAT tab, kept open from the layout).
  for (const width of [320, 390, 601, 800]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(panel).toBeVisible();
    const layout = await panel.evaluate((element) => {
      const root = element.shadowRoot!;
      const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
      const host = element.getBoundingClientRect();
      const section = root.querySelector<HTMLElement>('.eat-reliability')!;
      const range = root.querySelector<HTMLElement>('#eat-reliability-threshold')!;
      return {
        viewportWidth: window.innerWidth,
        host: [host.left, host.right],
        section: [box('.eat-reliability').left, box('.eat-reliability').right],
        range: [box('#eat-reliability-threshold').left, box('#eat-reliability-threshold').right],
        bounds: [box('.eat-bounds').left, box('.eat-bounds').right],
        sectionFits: section.scrollWidth <= section.clientWidth,
        rangeFits: range.scrollWidth <= range.clientWidth,
      };
    });
    expect(layout.host[0]).toBeGreaterThanOrEqual(0);
    expect(layout.host[1]).toBeLessThanOrEqual(layout.viewportWidth);
    for (const [left, right] of [layout.section, layout.range, layout.bounds]) {
      expect(left).toBeGreaterThanOrEqual(layout.host[0]);
      expect(right).toBeLessThanOrEqual(layout.host[1]);
    }
    expect(layout.sectionFits).toBe(true);
    expect(layout.rangeFits).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  const markerProfiles: Awaited<ReturnType<typeof sampleEncodedExportMarkers>>[] = [];
  for (const pointSize of [48, 240, 512]) {
    markerProfiles.push(await sampleEncodedExportMarkers(page, pointSize));
  }
  const exportMarkers = markerProfiles[1];
  const distanceFromWhite = ([red, green, blue]: number[]) =>
    Math.abs(255 - red) + Math.abs(255 - green) + Math.abs(255 - blue);
  // Measured at a 1280x720 window: predicted nearest neighbour 8.36 px, observed 10.93 px, export
  // radius 5.36 px, ring offset 4 px. The ring sample that faces the predicted point's nearest
  // neighbour lands 4.36 px from that neighbour's centre, 1 px inside its marker, so the stricter
  // `> exportRadius + ringOffset` does not hold for this data; the sampler drops such samples and
  // keeps the ones clear of every other marker. The predicted centre (the hollow check) is 3 px
  // clear of every neighbour's marker and the observed centre 5.6 px.
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
  expect(exportMarkers.predictedRingSamples).toBeGreaterThanOrEqual(3);
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
    expect(profile.predictedRingSamples).toBeGreaterThanOrEqual(3);
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

  const downloadPromise = page.waitForEvent('download');
  await exportAction(page, 'Quick PNG');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(fs.statSync(downloadPath!).size).toBeGreaterThan(10_000);
});

test('with a dirty draft, moving the threshold in the EAT panel updates the draft’s reliability row and keeps the other edit', async ({
  page,
}) => {
  await loadEatFixture(page);
  await selectAnnotation(page, 'ec');
  const value = await getFirstLegendItemValue(page);
  type Draft = Array<{ kind?: string; annotation?: string; min?: number | null }>;
  const draft = () =>
    queryBuilder(page).evaluate((builder) => (builder as unknown as { query: Draft }).query);

  // A dirty draft: the seeded row picks EC number and one value, unapplied.
  await draftFilterCondition(page, 0, 'ec', [value]);
  const cancel = queryBuilder(page).getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeEnabled();

  // To the EAT panel, move the threshold, back to the Filter panel.
  await openEatPanel(page);
  await eatThresholdBox(page).fill('50');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector('#myPlot') as (Element & { filtersActive?: boolean }) | null)
            ?.filtersActive ?? false,
      ),
    )
    .toBe(true);
  await filterButton(page).click();

  const rows = await draft();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ annotation: 'ec' });
  expect(rows[1]).toMatchObject({ kind: 'numeric', min: 0.5 });
  await expect(cancel).toBeEnabled();
});

/**
 * Characterization guard for the reliability filter's NET user-visible outcome:
 * raising the threshold hides low-confidence EAT predictions while CURATED
 * points — which carry no confidence score at all — stay on the plot.
 *
 * Deliberately outcome-only: it asserts which proteins the scatter plot renders
 * and never how the filter is expressed (no operator, no query shape, no
 * condition internals). The mechanism has already changed once under this guard:
 * curated points used to be re-included by the NOT index-complement, and the
 * condition is now stated positively as `EAT_confidence >= x` carrying an
 * explicit "no value" presence chip. The test passed unchanged across that
 * rewrite, which is the point — if it ever fails, curated annotations really did
 * start disappearing from the plot, which is the regression it exists to catch.
 */
test('keeps curated points visible while the reliability filter hides low-confidence EAT predictions', async ({
  page,
}) => {
  await loadEatFixture(page);
  await selectAnnotation(page, 'ec');

  await openEatPanel(page);
  const thresholdPercent = eatThresholdBox(page);

  const confidences = await readEcEatConfidences(page);
  const curated = confidences.filter(({ confidence }) => confidence === null).map(({ id }) => id);
  const predicted = confidences.filter(
    (entry): entry is { id: string; confidence: number } => entry.confidence !== null,
  );
  // Fixture facts (phosphatase bundle, `ec`): 832 proteins = 619 curated + 213 EAT transfers.
  expect(curated).toHaveLength(619);
  expect(predicted).toHaveLength(213);

  /**
   * Visibility snapshot at a given threshold. `curatedHidden` lists ids rather
   * than counting them so a regression names the vanished proteins, and
   * `predictedExpectedVisible` re-derives the expected survivor count from the
   * data so the hard-coded numbers below stay self-explaining.
   */
  const visibility = async (threshold: number) => {
    const rendered = new Set(await readRenderedProteinIds(page));
    return {
      renderedTotal: rendered.size,
      curatedHidden: curated.filter((id) => !rendered.has(id)),
      predictedVisible: predicted.filter(({ id }) => rendered.has(id)).length,
      predictedExpectedVisible: predicted.filter(({ confidence }) => confidence >= threshold)
        .length,
    };
  };

  // Threshold 0: nothing is filtered, the whole dataset is on screen.
  await expect
    .poll(() => visibility(0), { timeout: 15_000 })
    .toEqual({
      renderedTotal: 832,
      curatedHidden: [],
      predictedVisible: 213,
      predictedExpectedVisible: 213,
    });

  // 60%: 94 of the 213 transfers fall below the threshold and are hidden; all
  // 619 curated points stay, so 619 + 119 = 738 points remain rendered.
  await thresholdPercent.fill('60');
  // The threshold drives the shared filter, so the Filter button counts it.
  await expect(filterButton(page)).toHaveAccessibleName('Filter, 1 condition applied');
  await expect
    .poll(() => visibility(0.6), { timeout: 15_000 })
    .toEqual({
      renderedTotal: 738,
      curatedHidden: [],
      predictedVisible: 119,
      predictedExpectedVisible: 119,
    });
  await expect(plotStatus(page).locator('.status-count')).toHaveText('738 proteins');

  // 100% in the low box: it stops one step short of the high end (100 %), so the range is
  // 99–100 % and only the 5 transfers at 99 % or more survive — still no curated point is
  // dropped, which is the whole point of the filter.
  await thresholdPercent.fill('100');
  await expect(thresholdPercent).toHaveValue('99');
  await expect
    .poll(() => visibility(0.99), { timeout: 15_000 })
    .toEqual({
      renderedTotal: 624,
      curatedHidden: [],
      predictedVisible: 5,
      predictedExpectedVisible: 5,
    });

  // Back to 0: the condition is removed and every prediction returns, so the
  // filter hid rather than dropped them.
  await thresholdPercent.fill('0');
  await expect(filterButton(page)).toHaveAccessibleName('Filter');
  await expect
    .poll(() => visibility(0), { timeout: 15_000 })
    .toEqual({
      renderedTotal: 832,
      curatedHidden: [],
      predictedVisible: 213,
      predictedExpectedVisible: 213,
    });
});

/**
 * The Table (TSV) export holds exactly the proteins the Protein IDs export holds — here after
 * the reliability filter — with the projection's coordinates, the curated column and its EAT
 * companions. Driven through the real Export menu, as a user would.
 */
test('exports the visible proteins as a table, the same set as the ID export', async ({ page }) => {
  await loadEatFixture(page);
  await selectAnnotation(page, 'ec');

  await openEatPanel(page);
  await eatThresholdBox(page).fill('60');
  // 619 curated + the 119 transfers at or above 0.6 (see the reliability filter test).
  await expect.poll(async () => (await readRenderedProteinIds(page)).length).toBe(738);

  const download = async (item: 'Protein IDs (.txt)' | 'Table (.tsv)') => {
    const downloadPromise = page.waitForEvent('download');
    await exportAction(page, item);
    const file = await downloadPromise;
    return { name: file.suggestedFilename(), text: fs.readFileSync((await file.path())!, 'utf8') };
  };

  const ids = (await download('Protein IDs (.txt)')).text.split('\n');
  const table = await download('Table (.tsv)');
  expect(table.name).toMatch(/\.tsv$/);

  const [header, ...rows] = table.text
    .trimEnd()
    .split('\n')
    .map((line) => line.split('\t'));
  expect(header[0]).toBe('protein_id');
  expect(header[1]).toMatch(/_x$/);
  expect(header[2]).toMatch(/_y$/);
  const column = (name: string) => {
    expect(header).toContain(name);
    return header.indexOf(name);
  };
  const [ec, value, confidence, source] = [
    'ec',
    'ec__pred_value',
    'ec__pred_confidence',
    'ec__pred_source',
  ].map(column);
  // The synthetic confidence views are filter-only: no column but the stored companions.
  for (const name of header.filter((candidate) => /confidence/i.test(candidate))) {
    expect(name).toMatch(/__pred_confidence$/);
  }

  expect(rows.map((row) => row[0])).toEqual(ids);
  expect(rows).toHaveLength(738);
  // A missing cell is empty, never the loader's internal N/A token.
  expect(rows.flat()).not.toContain('__NA__');
  expect(rows.some((row) => row.includes(''))).toBe(true);

  const predicted = rows.filter((row) => row[value] !== '');
  expect(predicted).toHaveLength(119);
  for (const row of predicted) {
    expect(row[ec]).toBe('');
    expect(Number(row[confidence])).toBeGreaterThanOrEqual(0.6);
    expect(row[source]).not.toBe('');
  }
  expect(rows.filter((row) => row[ec] !== '').length).toBeGreaterThan(0);
});
