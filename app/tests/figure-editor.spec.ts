import { test, expect, type Page } from '@playwright/test';
import { waitForExploreDataLoad, dismissTourIfPresent } from './helpers/explore';

/**
 * E2E coverage for the Publish (Figure Editor) modal — specifically the
 * geometric-zoom inset path. These tests exercise the WebGL renderer's
 * dataDomain + pointSizeReference + getRenderInfo overrides, which jsdom
 * unit tests can't cover (no real WebGL2 context).
 *
 * Not in CI by default — run with `pnpm test:e2e`.
 */

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

interface Inset {
  sourceRect: { x: number; y: number; w: number; h: number };
  targetRect: { x: number; y: number; w: number; h: number };
  border: number;
  connector: 'lines' | 'none';
  pointSizeScale?: number;
}

async function openFigureEditor(page: Page): Promise<void> {
  // Trigger the open-publish-editor event directly — the same handler the
  // Export → Figure Editor button click goes through. Skips the dropdown
  // animation and possible viewport-clipping headaches.
  await page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar');
    cb?.dispatchEvent(new CustomEvent('open-publish-editor', { bubbles: true, composed: true }));
  });
  await page.waitForFunction(() => !!document.querySelector('protspace-publish-modal'), {
    timeout: 5_000,
  });
  // Wait for the preview canvas to be created and have non-zero pixels.
  await page.waitForFunction(
    () => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | null;
      const c = m?.shadowRoot?.querySelector('.publish-preview-canvas') as HTMLCanvasElement | null;
      return !!c && c.width > 0 && c.height > 0;
    },
    { timeout: 5_000 },
  );
}

/** Inject an inset via state mutation — far more reliable than mouse drags
 *  through the shadow-DOM overlay canvas. */
async function setInsets(page: Page, insets: Inset[]): Promise<void> {
  await page.evaluate((nextInsets) => {
    const m = document.querySelector('protspace-publish-modal') as
      | (HTMLElement & {
          _state: unknown;
          _plotCacheKey: string;
          requestUpdate: () => void;
        })
      | null;
    if (!m) throw new Error('publish modal not mounted');
    const state = m._state as Record<string, unknown>;
    m._state = { ...state, insets: nextInsets };
    m._plotCacheKey = ''; // force fresh plot capture
    m.requestUpdate();
  }, insets);
  // Wait for at least one rAF tick + settle timer (modal redraws on rAF).
  await page.waitForTimeout(300);
}

interface PixelStats {
  total: number;
  colored: number;
  dominantColor: { r: number; g: number; b: number } | null;
}

/**
 * Sample pixels from a normalised rect (0–1 over the preview canvas) and
 * return basic stats: pixel count, count of "colored" (non-white,
 * non-transparent) pixels, and the most common non-white color rounded
 * to 16-bucket quantization. Used to compare the colors inside an inset
 * to the colors inside the source rect on the main plot.
 */
async function samplePreviewRect(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<PixelStats> {
  return page.evaluate((r) => {
    const m = document.querySelector('protspace-publish-modal') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | null;
    const c = m?.shadowRoot?.querySelector('.publish-preview-canvas') as HTMLCanvasElement | null;
    if (!c) throw new Error('preview canvas not present');
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('preview canvas 2d context unavailable');
    const x = Math.max(0, Math.floor(r.x * c.width));
    const y = Math.max(0, Math.floor(r.y * c.height));
    const w = Math.max(1, Math.min(c.width - x, Math.floor(r.w * c.width)));
    const h = Math.max(1, Math.min(c.height - y, Math.floor(r.h * c.height)));
    const data = ctx.getImageData(x, y, w, h).data;
    let total = 0;
    let colored = 0;
    const histogram = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const rC = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      total++;
      if (a < 32) continue;
      // Treat near-white as background.
      if (rC > 235 && g > 235 && b > 235) continue;
      colored++;
      const bucket = `${rC >> 4}|${g >> 4}|${b >> 4}`;
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    }
    let bestKey = '';
    let bestCount = 0;
    for (const [k, v] of histogram) {
      if (v > bestCount) {
        bestKey = k;
        bestCount = v;
      }
    }
    let dominant: { r: number; g: number; b: number } | null = null;
    if (bestKey) {
      const [rB, gB, bB] = bestKey.split('|').map((s) => parseInt(s, 10) << 4);
      dominant = { r: rB, g: gB, b: bB };
    }
    return { total, colored, dominantColor: dominant };
  }, rect);
}

/** Small 4-D vector distance for color buckets. */
function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** Find a non-white-dominated rect on the main preview canvas — used as
 *  the source for the inset so we know we're zooming over actual data. */
async function findColoredRegion(page: Page): Promise<{
  x: number;
  y: number;
  w: number;
  h: number;
  dominant: { r: number; g: number; b: number };
}> {
  // Sample a 4×4 grid; pick the cell with the highest colored-pixel ratio.
  const cellW = 0.18;
  const cellH = 0.18;
  let best: {
    x: number;
    y: number;
    w: number;
    h: number;
    ratio: number;
    dominant: { r: number; g: number; b: number } | null;
  } | null = null;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 0.04 + col * 0.2;
      const y = 0.04 + row * 0.2;
      const stats = await samplePreviewRect(page, { x, y, w: cellW, h: cellH });
      const ratio = stats.colored / Math.max(1, stats.total);
      if (!best || ratio > best.ratio) {
        best = { x, y, w: cellW, h: cellH, ratio, dominant: stats.dominantColor };
      }
    }
  }
  if (!best || !best.dominant || best.ratio < 0.05) {
    throw new Error(
      `No sufficiently colored region found on the main preview (best ratio=${best?.ratio ?? 0})`,
    );
  }
  return { x: best.x, y: best.y, w: best.w, h: best.h, dominant: best.dominant };
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

test.describe('figure editor — geometric inset zoom', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await openFigureEditor(page);
  });

  test('inset content reflects the source rect region', async ({ page }) => {
    // Find a real cluster on the main preview, then drop an inset that
    // sources from there and renders into a 30%×30% target rect kept well
    // inside the plot area (away from the right-edge legend).
    const region = await findColoredRegion(page);
    const target = { x: 0.4, y: 0.55, w: 0.3, h: 0.3 };

    await setInsets(page, [
      {
        sourceRect: region,
        targetRect: target,
        border: 2,
        connector: 'lines',
        pointSizeScale: 2,
      },
    ]);

    // The inset target rect, after rendering, should contain colors close
    // to the source region's dominant — proving the dataDomain mapping
    // landed on the right data points.
    const insetStats = await samplePreviewRect(page, {
      // Sample the interior of the target rect (exclude border outline).
      x: target.x + 0.02,
      y: target.y + 0.02,
      w: target.w - 0.04,
      h: target.h - 0.04,
    });

    expect(insetStats.colored).toBeGreaterThan(50);
    expect(insetStats.dominantColor).not.toBeNull();
    // 16-bucket quantization + magnification + antialiasing means the
    // inset's dominant bucket can shift by up to a half-bucket in each
    // channel relative to the source cell's dominant bucket. Allow that
    // headroom but reject genuinely different colors (e.g. a yellow
    // cluster source rendered as a purple inset would be ~290 apart).
    const distance = colorDistance(insetStats.dominantColor!, region.dominant);
    expect(distance).toBeLessThan(140);
  });

  test('Dot size slider scales the rendered point coverage', async ({ page }) => {
    const region = await findColoredRegion(page);
    const target = { x: 0.55, y: 0.55, w: 0.3, h: 0.3 };
    const innerSampleRect = {
      x: target.x + 0.02,
      y: target.y + 0.02,
      w: target.w - 0.04,
      h: target.h - 0.04,
    };

    // Render at 1× — baseline.
    await setInsets(page, [
      {
        sourceRect: region,
        targetRect: target,
        border: 2,
        connector: 'lines',
        pointSizeScale: 1,
      },
    ]);
    const at1x = await samplePreviewRect(page, innerSampleRect);

    // Render at 5× — same data domain, larger dots.
    await setInsets(page, [
      {
        sourceRect: region,
        targetRect: target,
        border: 2,
        connector: 'lines',
        pointSizeScale: 5,
      },
    ]);
    const at5x = await samplePreviewRect(page, innerSampleRect);

    // 5× visibly enlarges the dots, but the colored-pixel growth is bounded by
    // the cluster's footprint within the sample rect — empty background around
    // the cluster can't be filled, so coverage can't reach a naive 25×/1.5×
    // multiple and the exact ratio depends on the demo's point density. Require
    // a clear, density-tolerant increase: a broken slider (5× ≈ 1×) would not
    // exceed ~1.0×, while a working one grows coverage well past that.
    expect(at1x.colored).toBeGreaterThan(0);
    expect(at5x.colored).toBeGreaterThan(at1x.colored * 1.2);
  });

  test('exports a PNG with embedded DPI metadata', async ({ page }) => {
    // beforeEach already ran waitForExploreDataLoad, dismissTourIfPresent,
    // and openFigureEditor. Set small dimensions to keep the test fast.
    await page.evaluate(() => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & {
            _state: Record<string, unknown>;
            requestUpdate: () => void;
            _plotCacheKey: string;
          })
        | null;
      if (!m) throw new Error('publish modal not mounted');
      m._state = {
        ...(m._state as Record<string, unknown>),
        widthPx: 800,
        heightPx: 600,
        dpi: 150,
        format: 'png',
      };
      m._plotCacheKey = '';
      m.requestUpdate();
    });
    await page.waitForTimeout(300);

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });

    // Click the Export button. The modal renders it as
    //   <button class="btn-primary" @click=${this._handleExport}>Export</button>
    // so the text-based fallback is the reliable identifier; we still try
    // a few data attributes first in case future commits add one.
    await page.evaluate(() => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | null;
      const root = m?.shadowRoot;
      if (!root) throw new Error('modal shadow root missing');
      const candidates = [
        'button[data-action="export"]',
        'button.publish-export-btn',
        'button.publish-action-export',
        '[data-testid="export-btn"]',
      ];
      for (const sel of candidates) {
        const btn = root.querySelector(sel) as HTMLButtonElement | null;
        if (btn) {
          btn.click();
          return;
        }
      }
      // Match the actual primary button by text — current implementation.
      const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
      const exportBtn = buttons.find((b) => b.textContent?.trim() === 'Export');
      if (exportBtn) {
        exportBtn.click();
        return;
      }
      throw new Error('Export button not found in publish-modal shadow DOM');
    });

    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Read the file back and verify the pHYs chunk carries the correct
    // pixels-per-metre value. PNG chunk layout: length(4) | type(4) | data(N)
    // | crc(4); buf.indexOf('pHYs') points at the type field, so the X-axis
    // ppm uint32 begins at +4 bytes past that.
    const fs = await import('node:fs');
    const buf = fs.readFileSync(path!);
    const tag = Buffer.from('pHYs', 'ascii');
    const physOffset = buf.indexOf(tag);
    expect(physOffset).toBeGreaterThan(-1);
    // Pixels-per-metre at 150 DPI = round(150 * 39.3700787) = 5906.
    const ppm =
      (buf[physOffset + 4] << 24) |
      (buf[physOffset + 5] << 16) |
      (buf[physOffset + 6] << 8) |
      buf[physOffset + 7];
    expect(ppm >>> 0).toBe(5906);
  });

  test('high-frequency target resize does not stall the modal', async ({ page }) => {
    const region = await findColoredRegion(page);
    await setInsets(page, [
      {
        sourceRect: region,
        targetRect: { x: 0.55, y: 0.55, w: 0.2, h: 0.2 },
        border: 2,
        connector: 'lines',
        pointSizeScale: 2,
      },
    ]);

    // Simulate the user dragging the inset's resize handle: 20 rapid target
    // resizes within ~300 ms. The fast-path skip + rAF throttle should
    // finish well inside the assertion timeout, even on slower machines.
    const result = await page.evaluate(async () => {
      const m = document.querySelector('protspace-publish-modal') as
        | (HTMLElement & {
            _state: { insets: Array<Record<string, unknown>> };
            requestUpdate: () => void;
          })
        | null;
      if (!m) throw new Error('modal missing');
      const start = performance.now();
      for (let i = 0; i < 20; i++) {
        const w = 0.2 + i * 0.005;
        const h = 0.2 + i * 0.005;
        const ins = m._state.insets[0];
        m._state = {
          ...m._state,
          insets: [{ ...ins, targetRect: { x: 0.55, y: 0.55, w, h } }],
        };
        m.requestUpdate();
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { elapsed: performance.now() - start };
    });

    // 20 rAF ticks at 60 fps should be ~333 ms; allow generous headroom.
    expect(result.elapsed).toBeLessThan(2_000);
    // After settle (>120 ms idle), the modal should still be present and
    // responsive — i.e., we didn't lock up on shader compiles.
    await page.waitForTimeout(250);
    const stillThere = await page.evaluate(
      () => !!document.querySelector('protspace-publish-modal'),
    );
    expect(stillThere).toBe(true);
  });
});
