import { test, expect, type Page } from '@playwright/test';
import { openExplore } from './helpers/explore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * How the plot's current selection relates to the proteins it holds. Comparing
 * IDs rather than counts means a selection of placeholder values cannot pass.
 */
async function readSelection(page: Page) {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { protein_ids?: string[] }; selectedProteinIds?: string[] })
      | null;
    const proteinIds = new Set(plot?.data?.protein_ids ?? []);
    const selected = plot?.selectedProteinIds ?? [];
    return {
      selected: selected.length,
      distinct: new Set(selected).size,
      unknown: selected.filter((id) => !proteinIds.has(id)).length,
    };
  });
}

/** Wait until the plot's selection is exactly every protein it holds. */
async function expectEveryProteinSelected(page: Page): Promise<void> {
  const total = await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { protein_ids?: string[] } })
      | null;
    return new Set(plot?.data?.protein_ids ?? []).size;
  });
  expect(total).toBeGreaterThan(0);
  await expect
    .poll(() => readSelection(page), { timeout: 5_000, intervals: [100] })
    .toEqual({ selected: total, distinct: total, unknown: 0 });
}

async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { selectedProteinIds?: string[] })
      | null;
    if (plot) plot.selectedProteinIds = [];
  });
  await expect
    .poll(() => readSelection(page), { timeout: 5_000, intervals: [100] })
    .toEqual({ selected: 0, distinct: 0, unknown: 0 });
}

/** The plot element's size in CSS pixels. */
async function getPlotSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as HTMLElement;
    return { width: plot.clientWidth, height: plot.clientHeight };
  });
}

/**
 * Programmatically invoke brush selection on the scatter-plot.
 * Coordinates are in CSS pixels relative to the plot element.
 * This bypasses mouse event delivery issues with shadow DOM.
 *
 * d3's `brush.move` does not clamp the selection to the brush extent, so a
 * selection made this way cannot detect an extent regression; the extent test
 * below reads the extent itself.
 */
async function brushSelect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<{ brushCreated: boolean; selectionMode: boolean }> {
  return page.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const plot = document.querySelector('#myPlot') as any;
      if (!plot) return { brushCreated: false, selectionMode: false };

      const selectionMode = !!plot.selectionMode;
      // B8/F-07: brush + brushGroup moved into PlotInteractionController.
      const brushGroup = plot._interaction?._brushGroup;
      const brush = plot._interaction?._brush;
      const brushCreated = !!brush;

      if (!brush || !brushGroup) {
        return { brushCreated, selectionMode };
      }

      // CSS pixels → SVG viewBox coords → local (untransformed) coords.
      const svg = plot.shadowRoot?.querySelector('svg');
      if (!svg) return { brushCreated, selectionMode };

      const svgRect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;

      const scaleX = viewBox.width / svgRect.width;
      const scaleY = viewBox.height / svgRect.height;

      const t = plot._transform;
      const svgX0 = x0 * scaleX;
      const svgY0 = y0 * scaleY;
      const svgX1 = x1 * scaleX;
      const svgY1 = y1 * scaleY;

      // SVG coords → local (untransformed) coords via inverse zoom transform.
      const localX0 = (svgX0 - t.x) / t.k;
      const localY0 = (svgY0 - t.y) / t.k;
      const localX1 = (svgX1 - t.x) / t.k;
      const localY1 = (svgY1 - t.y) / t.k;

      // Programmatically set the brush selection and trigger the end event
      brushGroup.call(brush.move, [
        [Math.min(localX0, localX1), Math.min(localY0, localY1)],
        [Math.max(localX0, localX1), Math.max(localY0, localY1)],
      ]);

      return { brushCreated, selectionMode };
    },
    { x0, y0, x1, y1 },
  );
}

/**
 * Apply a d3-zoom transform to the scatter-plot.
 */
async function setZoomTransform(page: Page, k: number, tx: number, ty: number): Promise<void> {
  await page.evaluate(
    ({ k, tx, ty }) => {
      const plot = document.querySelector('#myPlot') as any;
      // B8/F-07: zoom behavior + svg selection moved into PlotInteractionController.
      const ix = plot?._interaction;
      if (!ix?._svgSelection || !ix._zoom) return;

      const ZoomTransform = plot._transform.constructor;
      const transform = new ZoomTransform(k, tx, ty);
      ix._svgSelection.call(ix._zoom.transform, transform);
    },
    { k, tx, ty },
  );
  await page.waitForFunction(
    (expectedK) => {
      const plot = document.querySelector('#myPlot') as any;
      return plot?._transform?.k === expectedK;
    },
    k,
    { timeout: 5_000 },
  );
}

/**
 * Enable selection mode and wait for the brush to be created.
 */
async function enableSelectionMode(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    if (plot) plot.selectionMode = true;
  });
  await page.waitForFunction(
    () => {
      const plot = document.querySelector('#myPlot') as any;
      return !!plot?.selectionMode && !!plot?._interaction?._brush;
    },
    undefined,
    { timeout: 5_000 },
  );

  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    return !!plot?.selectionMode && !!plot?._interaction?._brush;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Brush selection works at all zoom levels (#189)', () => {
  test.beforeEach(async ({ page }) => {
    await openExplore(page);
  });

  test('full-canvas brush selects every protein at default zoom and zoomed out', async ({
    page,
  }) => {
    const active = await enableSelectionMode(page);
    expect(active).toBe(true);
    const dims = await getPlotSize(page);

    const result = await brushSelect(page, 0, 0, dims.width, dims.height);
    expect(result.brushCreated).toBe(true);
    expect(result.selectionMode).toBe(true);
    await expectEveryProteinSelected(page);

    await clearSelection(page);
    // Zoom out: k=0.3 centered
    const k = 0.3;
    await setZoomTransform(page, k, ((1 - k) * dims.width) / 2, ((1 - k) * dims.height) / 2);
    await brushSelect(page, 0, 0, dims.width, dims.height);
    await expectEveryProteinSelected(page);
  });

  // The #189 guard: the brush extent must be the whole viewport, in local
  // coordinates, at every zoom level. The old extent stopped at the plot
  // margins, leaving a dead zone of margin*k screen pixels at each edge.
  test('brush extent covers the viewport at every zoom level', async ({ page }) => {
    // Selection mode first, so every zoom below goes through the extent resync
    // in applyZoom rather than the initial brush setup.
    const active = await enableSelectionMode(page);
    expect(active).toBe(true);
    const dims = await getPlotSize(page);

    const transforms: Array<{ name: string; k: number; x: number; y: number }> = [
      { name: 'identity', k: 1, x: 0, y: 0 },
      { name: 'zoomed out', k: 0.3, x: (0.7 * dims.width) / 2, y: (0.7 * dims.height) / 2 },
      { name: 'zoomed in', k: 3, x: -dims.width, y: -dims.height },
      // Zoomed in 2x and panned so the data centre sits at the top-left.
      { name: 'zoomed in and panned', k: 2, x: -80, y: -80 },
    ];

    for (const { name, k, x, y } of transforms) {
      await setZoomTransform(page, k, x, y);
      const state = await page.evaluate(() => {
        const plot = document.querySelector('#myPlot') as any;
        const t = plot._transform;
        return {
          transform: { k: t.k, x: t.x, y: t.y },
          extent: plot._interaction._brush.extent()() as [[number, number], [number, number]],
          width: plot._mergedConfig.width as number,
          height: plot._mergedConfig.height as number,
        };
      });

      expect(state.transform, name).toEqual({ k, x, y });
      const [[x0, y0], [x1, y1]] = state.extent;
      expect(x0, `${name}: left`).toBeCloseTo(-x / k, 6);
      expect(y0, `${name}: top`).toBeCloseTo(-y / k, 6);
      expect(x1, `${name}: right`).toBeCloseTo((state.width - x) / k, 6);
      expect(y1, `${name}: bottom`).toBeCloseTo((state.height - y) / k, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Lasso selection tests (#208)
// ---------------------------------------------------------------------------

/**
 * Draw a lasso with the real mouse, through the plot's own pointer handlers.
 * Vertices are in CSS pixels relative to the plot element.
 */
async function drawLasso(page: Page, vertices: Array<[number, number]>): Promise<void> {
  const box = await page.locator('#myPlot').boundingBox();
  if (!box) throw new Error('#myPlot has no bounding box');
  const [[startX, startY], ...rest] = vertices;
  await page.mouse.move(box.x + startX, box.y + startY);
  await page.mouse.down();
  for (const [x, y] of rest) {
    await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  }
  await page.mouse.up();
}

/** Switch the selection tool on the scatter-plot component. */
async function setSelectionTool(page: Page, tool: 'rectangle' | 'lasso'): Promise<string> {
  await page.evaluate((t) => {
    const plot = document.querySelector('#myPlot') as any;
    if (plot) plot.selectionTool = t;
  }, tool);
  await page.waitForFunction(
    (expected) => {
      const plot = document.querySelector('#myPlot') as any;
      return plot?.selectionTool === expected;
    },
    tool,
    { timeout: 5_000 },
  );
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    return plot?.selectionTool ?? '';
  });
}

test.describe('Lasso selection (#208)', () => {
  test.beforeEach(async ({ page }) => {
    await openExplore(page);
  });

  test('lasso at default zoom selects all points with enclosing polygon', async ({ page }) => {
    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    const tool = await setSelectionTool(page, 'lasso');
    expect(tool).toBe('lasso');

    const dims = await getPlotSize(page);

    // A polygon just inside the plot's edges encloses every point.
    await drawLasso(page, [
      [2, 2],
      [dims.width - 2, 2],
      [dims.width - 2, dims.height - 2],
      [2, dims.height - 2],
    ]);

    await expectEveryProteinSelected(page);
  });

  test('switch between rectangle and lasso tools', async ({ page }) => {
    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    // Default is rectangle
    let tool = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as any;
      return plot?.selectionTool ?? '';
    });
    expect(tool).toBe('rectangle');

    // Switch to lasso
    tool = await setSelectionTool(page, 'lasso');
    expect(tool).toBe('lasso');

    // Switch back to rectangle
    tool = await setSelectionTool(page, 'rectangle');
    expect(tool).toBe('rectangle');

    // Rectangle brush still works after switching back
    const dims = await getPlotSize(page);
    const result = await brushSelect(page, 0, 0, dims.width, dims.height);
    expect(result.brushCreated).toBe(true);

    await expectEveryProteinSelected(page);
  });
});
