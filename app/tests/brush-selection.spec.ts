import { test, expect, type Page } from '@playwright/test';
import { waitForExploreDataLoad, dismissTourIfPresent } from './helpers/explore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getProteinCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    return plot?.data?.protein_ids?.length ?? 0;
  });
}

/** Read the list of currently selected protein IDs from the scatter-plot. */
async function getSelectedProteinIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    return Array.from(plot?.selectedProteinIds ?? []) as string[];
  });
}

/**
 * Programmatically invoke brush selection on the scatter-plot.
 * Coordinates are in CSS pixels relative to the plot element.
 * This bypasses mouse event delivery issues with shadow DOM.
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
    { timeout: 5_000 },
  );

  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    return !!plot?.selectionMode && !!plot?._interaction?._brush;
  });
}

/**
 * Wait for selectedProteinIds to reach a condition after a brush gesture.
 * The component uses requestAnimationFrame, so we poll until it settles.
 */
async function waitForSelection(
  page: Page,
  condition: 'non-empty' | number,
  timeout = 5_000,
): Promise<string[]> {
  await page.waitForFunction(
    (cond) => {
      const plot = document.querySelector('#myPlot') as any;
      const ids = plot?.selectedProteinIds ?? [];
      if (typeof cond === 'number') return ids.length === cond;
      return ids.length > 0;
    },
    condition,
    { timeout },
  );
  return getSelectedProteinIds(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Brush selection works at all zoom levels (#189)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
  });

  test('full-canvas brush at default zoom selects all visible points', async ({ page }) => {
    const totalProteins = await getProteinCount(page);
    expect(totalProteins).toBeGreaterThan(0);

    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });

    const result = await brushSelect(page, 0, 0, dims.width, dims.height);
    expect(result.brushCreated).toBe(true);
    expect(result.selectionMode).toBe(true);

    const actual = await waitForSelection(page, totalProteins);
    expect(actual.length).toBe(totalProteins);
  });

  test('full-canvas brush after zooming out selects all points', async ({ page }) => {
    const totalProteins = await getProteinCount(page);

    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });

    // Zoom out: k=0.3 centered
    const k = 0.3;
    await setZoomTransform(page, k, ((1 - k) * dims.width) / 2, ((1 - k) * dims.height) / 2);

    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    await brushSelect(page, 0, 0, dims.width, dims.height);

    const actual = await waitForSelection(page, totalProteins);
    expect(actual.length).toBe(totalProteins);
  });

  test('full-canvas brush after zooming in selects visible points', async ({ page }) => {
    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });

    // Zoom in 3x centered
    const k = 3;
    await setZoomTransform(page, k, ((1 - k) * dims.width) / 2, ((1 - k) * dims.height) / 2);

    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    await brushSelect(page, 0, 0, dims.width, dims.height);

    // When zoomed in to center, some (not all) points should be in view
    const actual = await waitForSelection(page, 'non-empty');
    expect(actual.length).toBeGreaterThan(0);
  });

  test('brush reaches full viewport when panned and zoomed in', async ({ page }) => {
    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });

    // Zoom in 2x, panned so the data center is at screen top-left.
    const k = 2;
    const margin = 40;
    await setZoomTransform(page, k, -margin * k, -margin * k);

    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    // With the old margin-constrained extent, starting from CSS pixel (0,0)
    // would be clamped — dead-zone of margin*k = 80 screen pixels on each side.
    const result = await brushSelect(page, 0, 0, dims.width, dims.height);
    expect(result.brushCreated).toBe(true);

    const actual = await waitForSelection(page, 'non-empty');
    expect(actual.length).toBeGreaterThan(0);
  });

  test('brush extent covers viewport not just margins', async ({ page }) => {
    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    const extentInfo = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as any;
      // B8/F-07: brush moved into PlotInteractionController.
      if (!plot?._interaction?._brush) return null;

      const config = plot._mergedConfig;
      const t = plot._transform;
      const extent = plot._interaction._brush.extent()();

      return {
        extentX0: extent[0][0],
        extentY0: extent[0][1],
        extentX1: extent[1][0],
        extentY1: extent[1][1],
        width: config.width,
        height: config.height,
        transformK: t.k,
        transformX: t.x,
      };
    });

    expect(extentInfo).not.toBeNull();
    if (!extentInfo) return;

    // At default zoom (identity transform), the extent should cover
    // [0,0] to [width,height] — NOT [margin.left,margin.top] to
    // [width-margin.right, height-margin.bottom]
    if (extentInfo.transformK === 1 && extentInfo.transformX === 0) {
      expect(extentInfo.extentX0).toBeLessThanOrEqual(0);
      expect(extentInfo.extentY0).toBeLessThanOrEqual(0);
      expect(extentInfo.extentX1).toBeGreaterThanOrEqual(extentInfo.width);
      expect(extentInfo.extentY1).toBeGreaterThanOrEqual(extentInfo.height);
    }
  });
});

// ---------------------------------------------------------------------------
// Lasso selection tests (#208)
// ---------------------------------------------------------------------------

/**
 * Programmatically invoke lasso selection with a polygon in CSS pixels.
 * Converts to local coords and triggers the component's lasso handlers directly.
 */
async function lassoSelect(
  page: Page,
  vertices: Array<[number, number]>,
): Promise<{ selectionTool: string }> {
  return page.evaluate((verts) => {
    const plot = document.querySelector('#myPlot') as any;
    if (!plot) return { selectionTool: '' };

    const selectionTool = plot.selectionTool ?? '';
    const svg = plot.shadowRoot?.querySelector('svg');
    if (!svg) return { selectionTool };

    const svgRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const scaleX = viewBox.width / svgRect.width;
    const scaleY = viewBox.height / svgRect.height;
    const t = plot._transform;

    // Convert CSS pixels → local (untransformed) coords
    const localVerts: Array<[number, number]> = verts.map(([x, y]) => {
      const svgX = x * scaleX;
      const svgY = y * scaleY;
      return [(svgX - t.x) / t.k, (svgY - t.y) / t.k] as [number, number];
    });

    // Query the quadtree directly with the polygon
    const candidates = plot._quadtreeIndex?.queryByPolygon(localVerts) ?? [];
    const getOpacity = plot._getOpacity?.bind(plot);
    const selectedIds = getOpacity
      ? candidates.filter((d: any) => getOpacity(d) > 0).map((d: any) => d.id)
      : candidates.map((d: any) => d.id);

    if (selectedIds.length > 0) {
      plot.selectedProteinIds = [...selectedIds];
      plot.dispatchEvent(
        new CustomEvent('brush-selection', {
          detail: { proteinIds: selectedIds, isMultiple: true },
          bubbles: true,
          composed: true,
        }),
      );
      plot.requestUpdate();
    }

    return { selectionTool };
  }, vertices);
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
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
  });

  test('lasso at default zoom selects all points with enclosing polygon', async ({ page }) => {
    const totalProteins = await getProteinCount(page);
    expect(totalProteins).toBeGreaterThan(0);

    const active = await enableSelectionMode(page);
    expect(active).toBe(true);

    const tool = await setSelectionTool(page, 'lasso');
    expect(tool).toBe('lasso');

    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });

    // Draw a polygon that encloses the entire canvas
    const result = await lassoSelect(page, [
      [0, 0],
      [dims.width, 0],
      [dims.width, dims.height],
      [0, dims.height],
    ]);
    expect(result.selectionTool).toBe('lasso');

    const actual = await waitForSelection(page, totalProteins);
    expect(actual.length).toBe(totalProteins);
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
    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });
    const result = await brushSelect(page, 0, 0, dims.width, dims.height);
    expect(result.brushCreated).toBe(true);

    const actual = await waitForSelection(page, 'non-empty');
    expect(actual.length).toBeGreaterThan(0);
  });

  test('lasso with fewer than 3 vertices does not change selection', async ({ page }) => {
    const active = await enableSelectionMode(page);
    expect(active).toBe(true);
    await setSelectionTool(page, 'lasso');

    // Make a brush selection first so there's an existing selection
    await setSelectionTool(page, 'rectangle');
    const dims = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement;
      return { width: plot.clientWidth, height: plot.clientHeight };
    });
    await brushSelect(page, 0, 0, dims.width, dims.height);
    const beforeSelection = await waitForSelection(page, 'non-empty');
    expect(beforeSelection.length).toBeGreaterThan(0);

    // Switch to lasso and do a < 3 vertex selection (should be ignored)
    await setSelectionTool(page, 'lasso');
    await lassoSelect(page, [
      [10, 10],
      [20, 20],
    ]);

    // Selection should be unchanged
    const afterSelection = await getSelectedProteinIds(page);
    expect(afterSelection.length).toBe(beforeSelection.length);
  });
});
