import { expect, test, type Page } from '@playwright/test';
import { dismissTourIfPresent, waitForExploreDataLoad } from './helpers/explore';

/**
 * The density layer, checked where it actually shows: on the pixels.
 *
 * Two invariants, both machine-independent and both fine on SwiftShader:
 *   1. turning the layer on adds coverage over the points that were already
 *      drawn, so the alpha at a busy pixel rises;
 *   2. hidden categories contribute nothing to it, so hiding all but one
 *      category collapses the painted area. That is the colour policy in one
 *      assertion: the accumulate pass weights each point by `a_color.a`, not by
 *      a constant, and hidden points stay in the GPU arrays at alpha 0.
 *
 * Not "hide everything and expect a blank canvas": `computeVisibilityModel` has
 * an all-hidden hatch (`visibility-model.ts`, hiddenMode 'none') that shows every
 * point in neutral grey when every value of the annotation is hidden, so that
 * state proves nothing about the layer.
 *
 * `on`, never `auto`: the demo dataset is ~7.8K points, far below the count at
 * which the cross-fade turns itself on, so `auto` would measure an empty layer
 * and pass for the wrong reason.
 */

interface PlotInternals extends Element {
  config?: Record<string, unknown>;
  data?: { protein_ids?: string[] };
  hiddenAnnotationValues?: string[];
  selectedAnnotation?: string;
  getCurrentData?: () => {
    annotations?: Record<string, { values?: (string | null)[] }>;
  };
}

/** The layer needs the float render targets; without them there is nothing to test. */
async function gammaPipelineUnavailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const win = window as Window & { __densityDegraded__?: string[] };
    return (win.__densityDegraded__ ?? []).includes('gamma-pipeline-unavailable');
  });
}

async function watchForDegraded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as Window & { __densityDegraded__?: string[] };
    win.__densityDegraded__ = [];
    document.addEventListener(
      'renderer-degraded',
      (event: Event) => {
        const reason = (event as CustomEvent<{ context?: { reason?: string } }>).detail?.context
          ?.reason;
        if (reason) win.__densityDegraded__?.push(reason);
      },
      true,
    );
  });
}

/**
 * Mean alpha over a small block at the canvas centre. The WebGL canvas is created
 * with `preserveDrawingBuffer: true`, so it can be drawn into a 2D canvas and read
 * back after the frame. A block, not a pixel: a single texel can sit between two
 * sparse points and report 0 in both states.
 */
async function centreAlpha(page: Page, half = 24): Promise<number> {
  return page.evaluate((h) => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0);
    const x = Math.max(0, Math.round(canvas.width / 2) - h);
    const y = Math.max(0, Math.round(canvas.height / 2) - h);
    const { data } = ctx.getImageData(x, y, h * 2, h * 2);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i];
    return sum / (data.length / 4);
  }, half);
}

/** How many pixels the frame painted at all: points plus whatever the layer added. */
async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted;
  });
}

/** Two frames: one for the property to land, one for the render it schedules. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

async function setDensity(page: Page, mode: 'off' | 'auto' | 'on'): Promise<void> {
  await page.evaluate((value) => {
    const plot = document.querySelector('#myPlot') as PlotInternals | null;
    if (plot) plot.config = { ...(plot.config ?? {}), densityLayer: value };
  }, mode);
  await settle(page);
}

/** The frame as bytes, so two styles can be compared without a reference image. */
async function frameSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot');
    const canvas = plot?.shadowRoot?.querySelector('canvas[data-key]') as HTMLCanvasElement | null;
    if (!canvas) return '';
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    return copy.toDataURL();
  });
}

test.describe('density layer pixels', () => {
  test('composites above the points and respects hidden categories', async ({ page }) => {
    await watchForDegraded(page);
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    test.skip(
      await gammaPipelineUnavailable(page),
      'renderer reported gamma-pipeline-unavailable: no float render targets here',
    );

    const withoutLayer = await centreAlpha(page);
    expect(withoutLayer, 'canvas pixels not readable').toBeGreaterThanOrEqual(0);

    await setDensity(page, 'on');
    const withLayer = await centreAlpha(page);
    expect(withLayer, 'turning the density layer on added no coverage').toBeGreaterThan(
      withoutLayer,
    );

    const paintedWithAll = await paintedPixels(page);
    expect(paintedWithAll, 'nothing was painted with the layer on').toBeGreaterThan(0);

    // Hide every category but one. The legend writes exactly this property, one
    // click at a time; writing it in one go is the same code path and does not
    // depend on how many categories the demo happens to ship.
    const survivor = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as PlotInternals | null;
      const annotation = plot?.selectedAnnotation ?? '';
      const values = plot?.getCurrentData?.()?.annotations?.[annotation]?.values ?? [];
      const unique = Array.from(new Set(values.filter((v): v is string => typeof v === 'string')));
      if (plot) plot.hiddenAnnotationValues = unique.slice(1);
      return unique[0] ?? null;
    });
    expect(survivor, 'no categorical values to hide').toBeTruthy();
    await settle(page);

    // The remaining category still draws, so this is not the trivial blank frame.
    // If the accumulate pass weighted every staged point by 1.0 instead of by its
    // colour alpha, the layer would keep smearing over all 7.8K and the painted
    // area would barely move.
    await expect
      .poll(() => paintedPixels(page), {
        message: 'hidden categories still contribute to the density layer',
        timeout: 15_000,
      })
      .toBeLessThan(paintedWithAll / 2);
    expect(await paintedPixels(page), 'the surviving category vanished too').toBeGreaterThan(0);
  });

  // The contour style through the URL, end to end: ?density=contour-on has to
  // reach the shader, not just the select. Quantised bands paint a different
  // picture from the smooth ramp, so a frame identical to ?density=on means the
  // style never left the URL parser.
  test('?density=contour-on paints a different layer from ?density=on', async ({ page }) => {
    await watchForDegraded(page);
    await page.goto('/explore?density=on');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    test.skip(
      await gammaPipelineUnavailable(page),
      'renderer reported gamma-pipeline-unavailable: no float render targets here',
    );

    const heatmapAlpha = await centreAlpha(page);
    const heatmapFrame = await frameSignature(page);
    expect(heatmapAlpha, 'canvas pixels not readable').toBeGreaterThan(0);

    await page.goto('/explore?density=contour-on');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await settle(page);

    expect(
      await page.locator('protspace-control-bar').evaluate((bar) => {
        const select = bar.shadowRoot?.querySelector('#density-layer-select');
        return (select as HTMLSelectElement | null)?.value ?? '';
      }),
    ).toBe('contour-on');

    const contourAlpha = await centreAlpha(page);
    expect(contourAlpha, 'the contour layer added no coverage').toBeGreaterThan(0);
    expect(await frameSignature(page), 'contour renders the same pixels as the heatmap').not.toBe(
      heatmapFrame,
    );
  });
});
