import { test, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Collects screen-space coordinates of points whose currently-selected
 * annotation value contains `substringMatch`, then trims outliers via MAD.
 * Reads annotation indices from `plot.data` (handles both Int32Array and
 * number[][] storage) since the on-plot points are bare lazy objects after
 * Phase 2.5.
 */
async function collectClusterScreenPoints(
  page: Page,
  substringMatch: string,
): Promise<Array<{ sx: number; sy: number }> | null> {
  return page.evaluate((needle: string) => {
    const plot = document.querySelector('#myPlot') as any;
    if (!plot?._plotData?.length || !plot._scales || !plot.data) return null;

    const plotData = plot._plotData;
    const scales = plot._scales;
    const transform = plot._transform || { x: 0, y: 0, k: 1 };
    const plotRect = plot.getBoundingClientRect();
    const annotation = plot.selectedAnnotation;

    const annotationDef = plot.data.annotations?.[annotation];
    const annotationRows = plot.data.annotation_data?.[annotation];
    if (!annotationDef || !annotationRows) return null;
    const annotationValues: Array<string | null> = annotationDef.values;

    const readValuesAt = (originalIndex: number): string[] => {
      let indices: number[];
      if (annotationRows instanceof Int32Array) {
        const i = annotationRows[originalIndex];
        indices = i < 0 ? [] : [i];
      } else {
        indices = annotationRows[originalIndex] ?? [];
      }
      const out: string[] = [];
      for (const i of indices) {
        const v = annotationValues[i];
        if (v != null) out.push(v);
      }
      return out;
    };

    const targetPoints: Array<{ sx: number; sy: number }> = [];
    for (const point of plotData) {
      const values = readValuesAt(point.originalIndex);
      if (values.some((v) => v?.includes(needle))) {
        const sx = plotRect.left + scales.x(point.x) * transform.k + transform.x;
        const sy = plotRect.top + scales.y(point.y) * transform.k + transform.y;
        targetPoints.push({ sx, sy });
      }
    }

    if (targetPoints.length === 0) return null;

    // MAD outlier trim: keep points within 2 × MAD of the median in both axes.
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const xs = targetPoints.map((p) => p.sx);
    const ys = targetPoints.map((p) => p.sy);
    const medX = median(xs);
    const medY = median(ys);
    const madX = median(xs.map((x) => Math.abs(x - medX))) * 1.4826;
    const madY = median(ys.map((y) => Math.abs(y - medY))) * 1.4826;
    const threshold = 2;

    const filtered = targetPoints.filter(
      (p) =>
        (madX === 0 || Math.abs(p.sx - medX) <= threshold * madX) &&
        (madY === 0 || Math.abs(p.sy - medY) <= threshold * madY),
    );
    return filtered.length > 0 ? filtered : targetPoints;
  }, substringMatch);
}
import {
  TEMP_VIDEOS_DIR,
  dismissProductTour,
  waitForDataLoad,
  waitForLegend,
  toggleLegendItem,
  doubleClickLegendItem,
  enableSelectionMode,
  initVisualIndicators,
  showActionLabel,
  showClickIndicator,
  showKeyboardIndicator,
  hideKeyboardIndicator,
  clickClearButton,
  getClearButtonCoords,
  clickIsolateButton,
  clickResetButton,
  trackedMouseMove,
  trackedMouseClick,
  trackedMouseDown,
  trackedMouseUp,
  trackedMouseWheel,
  trackedKeyboardDown,
  trackedKeyboardUp,
  logAction,
  printActionSummary,
} from './helpers';

// Shared constants for animation timing
// Initial pause after data loads to show the initial state before animation starts
// This time will be trimmed from the final GIF to remove loading screen
const INITIAL_PAUSE = 2000; // 2 seconds

// Ensure temp videos directory exists
test.beforeAll(async () => {
  if (!fs.existsSync(TEMP_VIDEOS_DIR)) {
    fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });
  }
});

// After each test, copy the video to our temp directory with a proper name
test.afterEach(async ({ page }, testInfo) => {
  // Print action summary before closing
  printActionSummary();

  // Get the video from the test
  const video = page.video();
  if (video) {
    // Create a sanitized filename from the test title
    const sanitizedName = testInfo.title
      .replace(/\.gif.*$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .toLowerCase();

    const destPath = path.join(TEMP_VIDEOS_DIR, `${sanitizedName}.webm`);

    // Close the page first to finalize the video recording
    await page.close();

    // Now saveAs() will work because the video is finalized
    await video.saveAs(destPath);
    console.log(`🎬 Video saved: ${destPath}`);
  }
});

test.describe('Zoom Animation', () => {
  const ZOOM_STEPS = 20;
  const ZOOM_DELTA = 50;
  const STEP_DELAY = 50;
  const PAUSE_DURATION = 1000;

  /**
   * Perform a smooth zoom animation with multiple wheel steps.
   */
  async function performZoomAnimation(
    page: any,
    deltaY: number,
    steps: number,
    stepDelay: number,
  ): Promise<void> {
    const direction = deltaY < 0 ? 'Zoom In' : 'Zoom Out';
    await logAction(
      page,
      'mouse',
      'Zoom Animation',
      `${direction} (${steps} steps, ${deltaY} delta)`,
    );
    for (let i = 0; i < steps; i++) {
      await trackedMouseWheel(page, 0, deltaY);
      await page.waitForTimeout(stepDelay);
    }
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await dismissProductTour(page);
    await waitForDataLoad(page);
    await waitForLegend(page);
  });

  test('zoom.gif - Zooming and panning animation', async ({ page }) => {
    const plot = page.locator('#myPlot');
    const box = await plot.boundingBox();
    if (!box) throw new Error('Could not get plot bounding box');

    // Find the centroid of the dense "three-finger toxin" cluster, ignoring outliers
    const targetPoints = await collectClusterScreenPoints(page, 'three-finger toxin');
    const clusterCenter =
      targetPoints && targetPoints.length > 0
        ? {
            x: targetPoints.reduce((s, p) => s + p.sx, 0) / targetPoints.length,
            y: targetPoints.reduce((s, p) => s + p.sy, 0) / targetPoints.length,
          }
        : null;

    // Use the cluster centroid, or fall back to upper-right quadrant
    const zoomX = clusterCenter ? clusterCenter.x : box.x + box.width * 0.85;
    const zoomY = clusterCenter ? clusterCenter.y : box.y + box.height * 0.15;

    // Initialize visual indicators and action logging
    await initVisualIndicators(page);

    // Move to zoom target and wait before starting zoom
    await trackedMouseMove(page, zoomX, zoomY, { steps: 15 });
    await page.waitForTimeout(INITIAL_PAUSE);

    // Show wheel indicator before zooming in
    await showClickIndicator(page, zoomX, zoomY);
    await page.waitForTimeout(200);
    // Zoom in smoothly
    await performZoomAnimation(page, -ZOOM_DELTA, ZOOM_STEPS, STEP_DELAY);
    await page.waitForTimeout(PAUSE_DURATION);

    // Show wheel indicator before zooming out
    await showClickIndicator(page, zoomX, zoomY);
    await page.waitForTimeout(200);
    // Zoom out smoothly
    await performZoomAnimation(page, ZOOM_DELTA, ZOOM_STEPS, STEP_DELAY);
    await page.waitForTimeout(PAUSE_DURATION);
  });
});

test.describe('Scatterplot Animation Captures', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await dismissProductTour(page);
    await waitForDataLoad(page);
    await waitForLegend(page);
  });

  test('select-single.gif - Clicking to select a protein', async ({ page }) => {
    const plot = page.locator('#myPlot');
    const box = await plot.boundingBox();
    if (!box) throw new Error('Could not get plot bounding box');

    // Initialize visual indicators for clicks and key presses
    await initVisualIndicators(page);

    // Wait to show initial state (will be trimmed from GIF)
    await page.waitForTimeout(INITIAL_PAUSE);

    // Determine modifier key based on platform (Meta for Mac, Control for Windows/Linux)
    const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Get screen coordinates of visible protein points
    const pointCoords = await page.evaluate((_plotBox) => {
      const plot = document.querySelector('#myPlot') as any;
      if (!plot?._plotData?.length || !plot._scales) return null;

      const plotData = plot._plotData;
      const scales = plot._scales;
      const transform = plot._transform || { x: 0, y: 0, k: 1 };

      // Get the plot element's bounding box
      const plotElement = plot.getBoundingClientRect();

      // Get points that are likely visible (near center of data range)
      const visiblePoints: Array<{ screenX: number; screenY: number; id: string }> = [];

      // Sample 5 points from different parts of the plot
      const sampleIndices = [
        Math.floor(plotData.length * 0.15),
        Math.floor(plotData.length * 0.31),
        Math.floor(plotData.length * 0.5),
        Math.floor(plotData.length * 0.75),
        Math.floor(plotData.length * 0.85),
      ];

      for (const idx of sampleIndices) {
        if (idx < plotData.length) {
          const point = plotData[idx];
          if (point && scales) {
            // Calculate screen coordinates (scales return coordinates relative to plot)
            const plotX = scales.x(point.x);
            const plotY = scales.y(point.y);

            // Apply transform
            const transformedX = plotX * transform.k + transform.x;
            const transformedY = plotY * transform.k + transform.y;

            // Convert to absolute screen coordinates
            const screenX = plotElement.left + transformedX;
            const screenY = plotElement.top + transformedY;

            // Check if within plot bounds (with some margin)
            if (
              transformedX >= -50 &&
              transformedX <= plotElement.width + 50 &&
              transformedY >= -50 &&
              transformedY <= plotElement.height + 50
            ) {
              visiblePoints.push({
                screenX,
                screenY,
                id: point.id,
              });
            }
          }
        }
      }

      return visiblePoints.length > 0 ? visiblePoints : null;
    });

    if (!pointCoords || pointCoords.length < 5) {
      // Fallback: click on center area
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await logAction(
        page,
        'mouse',
        'Click (Fallback)',
        `Click center at (${Math.round(centerX)}, ${Math.round(centerY)})`,
      );
      await trackedMouseClick(page, centerX, centerY);
      await page.waitForTimeout(1500);
      return;
    }

    const modLabel = modifierKey === 'Meta' ? '⌘+Click' : 'Ctrl+Click';

    // Click sequence: 5 points with specific pattern
    // 1. Click first point
    const point1 = pointCoords[0];
    await trackedMouseMove(page, point1.screenX, point1.screenY, { steps: 15 });
    await page.waitForTimeout(400);
    await showActionLabel(page, 'Click', point1.screenX, point1.screenY);
    await showClickIndicator(page, point1.screenX, point1.screenY);
    await trackedMouseClick(page, point1.screenX, point1.screenY);
    await page.waitForTimeout(1500);

    // 2. Click second point
    const point2 = pointCoords[1];
    await trackedMouseMove(page, point2.screenX, point2.screenY, { steps: 15 });
    await page.waitForTimeout(400);
    await showActionLabel(page, 'Click', point2.screenX, point2.screenY);
    await showClickIndicator(page, point2.screenX, point2.screenY);
    await trackedMouseClick(page, point2.screenX, point2.screenY);
    await page.waitForTimeout(1500);

    // 3. Click second point again (to deselect it)
    await showActionLabel(page, 'Click', point2.screenX, point2.screenY);
    await showClickIndicator(page, point2.screenX, point2.screenY);
    await trackedMouseClick(page, point2.screenX, point2.screenY);
    await page.waitForTimeout(1500);

    // 4. Click third point
    const point3 = pointCoords[2];
    await trackedMouseMove(page, point3.screenX, point3.screenY, { steps: 15 });
    await page.waitForTimeout(400);
    await showActionLabel(page, 'Click', point3.screenX, point3.screenY);
    await showClickIndicator(page, point3.screenX, point3.screenY);
    await trackedMouseClick(page, point3.screenX, point3.screenY);
    await page.waitForTimeout(1500);

    // 5. Hold Command/Ctrl and click fourth point
    const point4 = pointCoords[3];
    await trackedKeyboardDown(page, modifierKey);
    await showKeyboardIndicator(page, modifierKey);
    await page.waitForTimeout(300); // Show indicator before moving
    await trackedMouseMove(page, point4.screenX, point4.screenY, { steps: 15 });
    await page.waitForTimeout(400);
    await showActionLabel(page, modLabel, point4.screenX, point4.screenY);
    await showClickIndicator(page, point4.screenX, point4.screenY, { modifier: modifierKey });
    await trackedMouseClick(page, point4.screenX, point4.screenY);
    await page.waitForTimeout(800); // Keep indicator visible after click
    await trackedKeyboardUp(page, modifierKey);

    // 6. Hold Command/Ctrl and click fifth point
    const point5 = pointCoords[4];
    await trackedKeyboardDown(page, modifierKey);
    await showKeyboardIndicator(page, modifierKey);
    await page.waitForTimeout(300); // Show indicator before moving
    await trackedMouseMove(page, point5.screenX, point5.screenY, { steps: 15 });
    await page.waitForTimeout(400);
    await showActionLabel(page, modLabel, point5.screenX, point5.screenY);
    await showClickIndicator(page, point5.screenX, point5.screenY, { modifier: modifierKey });
    await trackedMouseClick(page, point5.screenX, point5.screenY);
    await page.waitForTimeout(800); // Keep indicator visible after click
    await trackedKeyboardUp(page, modifierKey);
    await hideKeyboardIndicator(page);
    await page.waitForTimeout(1000);

    // 7. Click the clear button to clear all selections
    const clearButtonCoords = await getClearButtonCoords(page);
    if (clearButtonCoords) {
      await trackedMouseMove(page, clearButtonCoords.x, clearButtonCoords.y, { steps: 15 });
      await page.waitForTimeout(400);
      await showActionLabel(page, 'Click', clearButtonCoords.x, clearButtonCoords.y);
      await showClickIndicator(page, clearButtonCoords.x, clearButtonCoords.y);
      await trackedMouseClick(page, clearButtonCoords.x, clearButtonCoords.y);
      await page.waitForTimeout(1500);
    } else {
      // Fallback: use the helper function
      await logAction(page, 'mouse', 'Click Clear Button', 'Clear all selections');
      await clickClearButton(page);
      await page.waitForTimeout(1500);
    }

    // Final pause to show the result
    await page.waitForTimeout(500);
  });

  test('select-box.gif - Box selection animation', async ({ page }) => {
    // Initialize visual indicators and action logging
    await initVisualIndicators(page);

    // Wait to show initial state (will be trimmed from GIF)
    await page.waitForTimeout(INITIAL_PAUSE);

    // Enable selection mode first - get button coordinates for visual indicator
    const selectButtonCoords = await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar');
      if (!controlBar || !controlBar.shadowRoot) return null;
      const selectButton = controlBar.shadowRoot.querySelector(
        '[data-select-button], .select-button, button[title*="Select"]',
      ) as HTMLElement;
      if (!selectButton) return null;
      const rect = selectButton.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (selectButtonCoords) {
      await trackedMouseMove(page, selectButtonCoords.x, selectButtonCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showClickIndicator(page, selectButtonCoords.x, selectButtonCoords.y);
    }
    await enableSelectionMode(page);
    await page.waitForTimeout(500);

    const plot = page.locator('#myPlot');
    const box = await plot.boundingBox();
    if (!box) throw new Error('Could not get plot bounding box');

    // Find the bounding box of the dense "phospholipase A2" cluster, ignoring outliers
    const targetPoints = await collectClusterScreenPoints(page, 'phospholipase A2');
    let clusterBBox: { x1: number; y1: number; x2: number; y2: number } | null = null;
    if (targetPoints && targetPoints.length > 0) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of targetPoints) {
        if (p.sx < minX) minX = p.sx;
        if (p.sy < minY) minY = p.sy;
        if (p.sx > maxX) maxX = p.sx;
        if (p.sy > maxY) maxY = p.sy;
      }
      const pad = 20;
      clusterBBox = { x1: minX - pad, y1: minY - pad, x2: maxX + pad, y2: maxY + pad };
    }

    // Use cluster bbox or fall back to center region
    const startX = clusterBBox ? clusterBBox.x1 : box.x + box.width * 0.3;
    const startY = clusterBBox ? clusterBBox.y1 : box.y + box.height * 0.3;
    const endX = clusterBBox ? clusterBBox.x2 : box.x + box.width * 0.7;
    const endY = clusterBBox ? clusterBBox.y2 : box.y + box.height * 0.7;

    await logAction(
      page,
      'mouse',
      'Box Selection',
      `Drag from (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(endX)}, ${Math.round(endY)})`,
    );
    await trackedMouseMove(page, startX, startY, { steps: 15 });
    await page.waitForTimeout(300);
    await showClickIndicator(page, startX, startY);
    await trackedMouseDown(page);
    await trackedMouseMove(page, endX, endY, { steps: 30 });
    await page.waitForTimeout(200);
    await trackedMouseUp(page);

    // Show the selection result
    await page.waitForTimeout(1000);

    // Click the isolate button - get coordinates for visual indicator
    const isolateButtonCoords = await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar');
      if (!controlBar || !controlBar.shadowRoot) return null;
      const isolateButton = controlBar.shadowRoot.querySelector(
        '.right-controls-split, button[title*="Isolate selected proteins"]',
      ) as HTMLElement;
      if (!isolateButton) return null;
      const rect = isolateButton.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (isolateButtonCoords) {
      await trackedMouseMove(page, isolateButtonCoords.x, isolateButtonCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showClickIndicator(page, isolateButtonCoords.x, isolateButtonCoords.y);
    }
    await clickIsolateButton(page);
    await page.waitForTimeout(1000);

    // Click the reset button - get coordinates for visual indicator
    const resetButtonCoords = await page.evaluate(() => {
      const controlBar = document.querySelector('#myControlBar');
      if (!controlBar || !controlBar.shadowRoot) return null;
      const resetButton = controlBar.shadowRoot.querySelector(
        'button[title*="Reset to original dataset"]',
      ) as HTMLElement;
      if (!resetButton) return null;
      const rect = resetButton.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    if (resetButtonCoords) {
      await trackedMouseMove(page, resetButtonCoords.x, resetButtonCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showClickIndicator(page, resetButtonCoords.x, resetButtonCoords.y);
    }
    await clickResetButton(page);
    await page.waitForTimeout(1000);
  });

  test('duplicate-badges.gif - Cross-projection duplicate badge and spiderfy', async ({ page }) => {
    await initVisualIndicators(page);

    // Pre-enable the duplicate-counts setting so badges render without
    // animating the cog → checkbox path (keeps the GIF focused on the badge).
    await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as
        | (HTMLElement & { config?: Record<string, unknown> })
        | null;
      if (!plot) return;
      plot.config = { ...(plot.config ?? {}), enableDuplicateStackUI: true };
    });

    // Wait for the scatter-plot to (re)compute its duplicate stacks. The
    // overlay update is debounced behind the config change + a quadtree
    // rebuild, so poll the private cache until at least one multi-point
    // stack appears.
    await page.waitForFunction(
      () => {
        const plot = document.querySelector('#myPlot') as
          | (HTMLElement & {
              _duplicateStackByKey?: Map<string, { points: unknown[] }>;
            })
          | null;
        const map = plot?._duplicateStackByKey;
        if (!map || map.size === 0) return false;
        for (const stack of map.values()) {
          if (stack.points.length > 1) return true;
        }
        return false;
      },
      { timeout: 10_000 },
    );

    await page.waitForTimeout(INITIAL_PAUSE);

    type StackInfo = {
      key: string;
      count: number;
      x: number;
      y: number;
    };

    // Snapshot the duplicate-stack candidates so the heuristic can pick one.
    const collectStacks = async (): Promise<StackInfo[]> =>
      page.evaluate(() => {
        const plot = document.querySelector('#myPlot') as
          | (HTMLElement & {
              _duplicateStackByKey?: Map<
                string,
                { key: string; x: number; y: number; points: unknown[] }
              >;
            })
          | null;
        const map = plot?._duplicateStackByKey;
        if (!map) return [];
        const out: StackInfo[] = [];
        for (const stack of map.values()) {
          if (stack.points.length > 1) {
            out.push({
              key: stack.key,
              count: stack.points.length,
              x: stack.x,
              y: stack.y,
            });
          }
        }
        return out;
      });

    // Pick the most visually compelling stack: largest badge first, then
    // closest to the median (x, y) of all candidates. Using the median
    // rather than the mean keeps the anchor near the cluster mass even if
    // a single duplicate group lives far out on the projection's edge.
    const pickAnchorStack = (candidates: StackInfo[]): StackInfo | null => {
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      const sortedX = candidates.map((c) => c.x).sort((a, b) => a - b);
      const sortedY = candidates.map((c) => c.y).sort((a, b) => a - b);
      const midX = sortedX[Math.floor(sortedX.length / 2)];
      const midY = sortedY[Math.floor(sortedY.length / 2)];

      return [...candidates].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const da = (a.x - midX) ** 2 + (a.y - midY) ** 2;
        const db = (b.x - midX) ** 2 + (b.y - midY) ** 2;
        return da - db;
      })[0];
    };

    const initialStacks = await collectStacks();
    const anchor = pickAnchorStack(initialStacks);

    if (!anchor) {
      console.warn(
        `⚠ No duplicate-stack anchor selected (candidates=${initialStacks.length}); ` +
          'skipping spiderfy scenario.',
      );
      await page.waitForTimeout(500);
      return;
    }

    // Convert the stack's data-space coords → screen pixels using the plot's
    // current scales + zoom transform, exactly like select-single.gif does.
    const stackToScreen = async (stackKey: string) =>
      page.evaluate((key: string) => {
        const plot = document.querySelector('#myPlot') as
          | (HTMLElement & {
              _duplicateStackByKey?: Map<string, { x: number; y: number; points: unknown[] }>;
              _scales?: { x: (v: number) => number; y: (v: number) => number };
              _transform?: { x: number; y: number; k: number };
            })
          | null;
        const stack = plot?._duplicateStackByKey?.get(key);
        if (!stack || !plot?._scales) return null;
        const transform = plot._transform ?? { x: 0, y: 0, k: 1 };
        const rect = plot.getBoundingClientRect();
        return {
          screenX: rect.left + plot._scales.x(stack.x) * transform.k + transform.x,
          screenY: rect.top + plot._scales.y(stack.y) * transform.k + transform.y,
          count: stack.points.length,
        };
      }, stackKey);

    // Smooth, mouse-anchored zoom helper. D3 zoom keys off cursor position,
    // so the mouse must already be over the anchor before calling this.
    const ZOOM_DELTA = 50;
    const ZOOM_STEPS_IN = 14;
    const zoomBy = async (deltaY: number, steps: number) => {
      for (let i = 0; i < steps; i++) {
        await trackedMouseWheel(page, 0, deltaY);
        await page.waitForTimeout(50);
      }
    };

    // Re-wait for the anchor stack to be materialized in the current viewport.
    // After a zoom/pan, _duplicateStackByKey rebuilds — poll until our
    // anchor.key reappears with its multi-point membership.
    const waitForAnchorVisible = async () =>
      page.waitForFunction(
        (key: string) => {
          const plot = document.querySelector('#myPlot') as
            | (HTMLElement & {
                _duplicateStackByKey?: Map<string, { points: unknown[] }>;
              })
            | null;
          const stack = plot?._duplicateStackByKey?.get(key);
          return !!stack && stack.points.length > 1;
        },
        anchor.key,
        { timeout: 8_000 },
      );

    // After clicking the underlying point, the spider should expand. Poll the
    // private _expandedDuplicateStackKey to confirm the click landed and the
    // spider actually opened — without this, a missed click would silently
    // produce a blank GIF instead of failing the test.
    const waitForSpiderOpen = async () =>
      page.waitForFunction(
        (key: string) => {
          const plot = document.querySelector('#myPlot') as
            | (HTMLElement & { _expandedDuplicateStackKey?: string | null })
            | null;
          return plot?._expandedDuplicateStackKey === key;
        },
        anchor.key,
        { timeout: 2_000 },
      );

    // Glide mouse → zoom in (anchored on cursor) → recompute screen coords →
    // click point to expand → wait until spider is open → click badge to
    // collapse → zoom back out.
    const before = await stackToScreen(anchor.key);
    if (!before) throw new Error(`Stack ${anchor.key} missing before zoom`);

    await trackedMouseMove(page, before.screenX, before.screenY, { steps: 20 });
    await page.waitForTimeout(550);

    await zoomBy(-ZOOM_DELTA, ZOOM_STEPS_IN);
    await waitForAnchorVisible();
    await page.waitForTimeout(450);

    // After zooming, the anchor's screen position has drifted; re-fetch.
    const target = await stackToScreen(anchor.key);
    if (!target) throw new Error(`Stack ${anchor.key} dropped during zoom-in`);

    await trackedMouseMove(page, target.screenX, target.screenY, { steps: 8 });
    await page.waitForTimeout(250);
    await showClickIndicator(page, target.screenX, target.screenY);
    await trackedMouseClick(page, target.screenX, target.screenY);

    // Verify the spider actually opened — fails loudly if the click missed.
    await waitForSpiderOpen();
    await page.waitForTimeout(1100); // hold spider open so it reads as a fan

    // Pick the spider node visually farthest from the badge (+10, -10 from
    // the spider center). Reads live SVG rects from the scatter-plot's shadow
    // DOM, so it's robust to any node count or layout change.
    const spiderNode = await page.evaluate(
      ({ offsetX, offsetY }) => {
        const plot = document.querySelector('#myPlot');
        const root = (plot as Element | null)?.shadowRoot;
        const circles = root?.querySelectorAll('.dup-spiderfy-node-circle');
        if (!circles || circles.length === 0) return null;
        const rects = Array.from(circles).map((c) => (c as Element).getBoundingClientRect());
        // Spider center ≈ centroid of node rects.
        const cx = rects.reduce((s, r) => s + (r.left + r.width / 2), 0) / rects.length;
        const cy = rects.reduce((s, r) => s + (r.top + r.height / 2), 0) / rects.length;
        const badgeCx = cx + offsetX;
        const badgeCy = cy + offsetY;
        let bestIdx = 0;
        let bestDist = -Infinity;
        rects.forEach((r, i) => {
          const nx = r.left + r.width / 2;
          const ny = r.top + r.height / 2;
          const d = (nx - badgeCx) ** 2 + (ny - badgeCy) ** 2;
          if (d > bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        });
        const r = rects[bestIdx];
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      { offsetX: 10, offsetY: -10 },
    );

    if (!spiderNode) {
      throw new Error('Spider opened but no .dup-spiderfy-node-circle rendered');
    }

    // Click a spider node to showcase per-point selection. The node's own
    // pointerdown/pointerup handlers stopPropagation and call _handleClick,
    // so the spider stays open — only the selection state changes.
    await trackedMouseMove(page, spiderNode.x, spiderNode.y, { steps: 10 });
    await page.waitForTimeout(300);
    await showClickIndicator(page, spiderNode.x, spiderNode.y);
    await trackedMouseClick(page, spiderNode.x, spiderNode.y);
    await page.waitForTimeout(1500); // hold to show the selected state

    // Click the badge to collapse. The badge is drawn at screen offset
    // (+10, -10) from the stack's transformed center (see
    // _renderDuplicateBadgesCanvas in scatter-plot.ts). _handleCanvasClick
    // first nulls _expandedDuplicateStackKey, then runs a quadtree hit-test;
    // clicking the badge lands outside the underlying point's hit radius,
    // so the collapse sticks instead of re-toggling.
    const badgeX = target.screenX + 10;
    const badgeY = target.screenY - 10;
    await trackedMouseMove(page, badgeX, badgeY, { steps: 6 });
    await page.waitForTimeout(250);
    await showClickIndicator(page, badgeX, badgeY);
    await trackedMouseClick(page, badgeX, badgeY);

    // End on the collapsed, zoomed-in frame — no zoom-out.
    await page.waitForTimeout(900);
  });
});

test.describe('Legend Animation Captures', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await dismissProductTour(page);
    await waitForDataLoad(page);
    await waitForLegend(page);
  });

  test('legend-toggle.gif - Toggling category visibility', async ({ page }) => {
    // Initialize visual indicators and action logging
    await initVisualIndicators(page);

    // Wait to show initial state (will be trimmed from GIF)
    await page.waitForTimeout(INITIAL_PAUSE);

    // Helper: find legend item index by substring match or CSS class
    const findLegendItemIndex = async (match: string, options?: { byClass?: string }) => {
      return await page.evaluate(
        ({ targetMatch, byClass }) => {
          const legend = document.querySelector('#myLegend');
          if (!legend || !legend.shadowRoot) return -1;
          const items = legend.shadowRoot.querySelectorAll('.legend-item');
          for (let i = 0; i < items.length; i++) {
            if (byClass && items[i].classList.contains(byClass)) return i;
            const text = items[i].querySelector('.legend-text')?.textContent?.trim() || '';
            if (targetMatch && text.includes(targetMatch)) return i;
          }
          return -1;
        },
        { targetMatch: match, byClass: options?.byClass },
      );
    };

    // Helper function to get coordinates of a legend item by index
    const getLegendItemCoords = async (index: number) => {
      return await page.evaluate((idx) => {
        const legend = document.querySelector('#myLegend');
        if (!legend || !legend.shadowRoot) return null;
        const items = legend.shadowRoot.querySelectorAll('.legend-item');
        if (items[idx]) {
          const rect = (items[idx] as HTMLElement).getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
      }, index);
    };

    // Find target legend items by name (substring match) or CSS class
    const naIdx = await findLegendItemIndex('N/A');
    const otherIdx = await findLegendItemIndex('', { byClass: 'legend-item-other' });
    const threefingerIdx = await findLegendItemIndex('three-finger toxin');

    if (naIdx < 0 || otherIdx < 0 || threefingerIdx < 0) {
      throw new Error(
        `Could not find legend items: N/A=${naIdx}, Other=${otherIdx}, three-finger toxin=${threefingerIdx}`,
      );
    }

    // 1. Click N/A to hide it
    const naCoords = await getLegendItemCoords(naIdx);
    if (naCoords) {
      await trackedMouseMove(page, naCoords.x, naCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showActionLabel(page, 'Click', naCoords.x, naCoords.y);
      await showClickIndicator(page, naCoords.x, naCoords.y);
    }
    await toggleLegendItem(page, naIdx);
    await page.waitForTimeout(800);

    // 2. Click Other to hide it
    const otherCoords = await getLegendItemCoords(otherIdx);
    if (otherCoords) {
      await trackedMouseMove(page, otherCoords.x, otherCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showActionLabel(page, 'Click', otherCoords.x, otherCoords.y);
      await showClickIndicator(page, otherCoords.x, otherCoords.y);
    }
    await toggleLegendItem(page, otherIdx);
    await page.waitForTimeout(800);

    // 3. Double-click Three-finger toxin to isolate it
    const threefingerCoords = await getLegendItemCoords(threefingerIdx);
    if (threefingerCoords) {
      await trackedMouseMove(page, threefingerCoords.x, threefingerCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      // Stretch the label so it's visible across both ripples of the dbl-click.
      await showActionLabel(page, 'Double-Click', threefingerCoords.x, threefingerCoords.y, 1100);
      await showClickIndicator(page, threefingerCoords.x, threefingerCoords.y);
      await page.waitForTimeout(100);
      await showClickIndicator(page, threefingerCoords.x, threefingerCoords.y);
    }
    await doubleClickLegendItem(page, threefingerIdx);
    await page.waitForTimeout(1000);

    // 4. Click Three-finger toxin again to restore all
    const threefingerCoordsAfter = await getLegendItemCoords(threefingerIdx);
    if (threefingerCoordsAfter) {
      await trackedMouseMove(page, threefingerCoordsAfter.x, threefingerCoordsAfter.y, {
        steps: 15,
      });
      await page.waitForTimeout(300);
      await showActionLabel(page, 'Click', threefingerCoordsAfter.x, threefingerCoordsAfter.y);
      await showClickIndicator(page, threefingerCoordsAfter.x, threefingerCoordsAfter.y);
    }
    await toggleLegendItem(page, threefingerIdx);
    await page.waitForTimeout(1000);
  });

  test('legend-reorder.gif - Dragging to reorder labels', async ({ page }) => {
    // Initialize visual indicators and action logging
    await initVisualIndicators(page);

    // Wait to show initial state (will be trimmed from GIF)
    await page.waitForTimeout(INITIAL_PAUSE);

    // Helper: find legend item index by its text label
    const findLegendItemIndex = async (label: string) => {
      return await page.evaluate((targetLabel) => {
        const legend = document.querySelector('#myLegend');
        if (!legend || !legend.shadowRoot) return -1;
        const items = legend.shadowRoot.querySelectorAll('.legend-item');
        for (let i = 0; i < items.length; i++) {
          const text = items[i].querySelector('.legend-text')?.textContent?.trim();
          if (text === targetLabel) return i;
        }
        return -1;
      }, label);
    };

    const getDragHandleCoords = async (index: number) => {
      return await page.evaluate((idx) => {
        const legend = document.querySelector('#myLegend');
        if (!legend || !legend.shadowRoot) return null;
        const items = legend.shadowRoot.querySelectorAll('.legend-item');
        if (!items[idx]) return null;
        const handle = items[idx].querySelector('.drag-handle') as HTMLElement;
        if (!handle) return null;
        const rect = handle.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, index);
    };

    const getLegendItemCoords = async (index: number) => {
      return await page.evaluate((idx) => {
        const legend = document.querySelector('#myLegend');
        if (!legend || !legend.shadowRoot) return null;
        const items = legend.shadowRoot.querySelectorAll('.legend-item');
        if (items[idx]) {
          const rect = (items[idx] as HTMLElement).getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
      }, index);
    };

    // Find the N/A item and the first item for target position
    const naIdx = await findLegendItemIndex('N/A');
    if (naIdx < 0) throw new Error('Could not find N/A legend item');

    const firstItemCoords = await getLegendItemCoords(0);
    const naHandleCoords = await getDragHandleCoords(naIdx);

    if (!firstItemCoords || !naHandleCoords) {
      throw new Error('Could not get legend item / drag handle coordinates');
    }

    // Target: above the first item (drag N/A to position 0)
    const targetX = naHandleCoords.x;
    const targetY = firstItemCoords.y - 10;

    // Move to the drag handle of the N/A item
    await trackedMouseMove(page, naHandleCoords.x, naHandleCoords.y, { steps: 15 });
    await page.waitForTimeout(300);

    // Show click indicator on the drag handle
    await showClickIndicator(page, naHandleCoords.x, naHandleCoords.y);
    await page.waitForTimeout(200);

    await logAction(page, 'mouse', 'Drag Legend Item', 'Drag N/A to first position');

    // Use plain mouse events so Sortable.js (handle: '.drag-handle') detects the drag
    await page.mouse.move(naHandleCoords.x, naHandleCoords.y);
    await trackedMouseDown(page);

    // Small delay for Sortable.js to detect drag start
    await page.waitForTimeout(200);

    // Smooth move to the target position
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      const currentX = naHandleCoords.x + (targetX - naHandleCoords.x) * (i / steps);
      const currentY = naHandleCoords.y + (targetY - naHandleCoords.y) * (i / steps);
      await page.mouse.move(currentX, currentY);
      await page.waitForTimeout(15);
    }

    await page.waitForTimeout(300);

    // Drop
    await trackedMouseUp(page);

    // Show final result
    await page.waitForTimeout(2000);
  });

  test('legend-others.gif - Expanding and collapsing Others group', async ({ page }) => {
    // Initialize visual indicators and action logging
    await initVisualIndicators(page);

    // Step 1: Move 2 categories into "Other" while keeping N/A as a separate
    // top-level entry, matching the default appearance in the other docs GIFs.
    //
    // Naively reducing `maxVisibleValues` by 2 falls back on size-desc sort,
    // which pushes the lowest-count items into Other — and N/A typically has
    // a low count, so it'd be the first to go. Instead, route through the
    // legend's own merge action for two specific non-N/A categories: that
    // path uses `pendingMergeValue` and leaves N/A's slot untouched.
    //
    // Happens before INITIAL_PAUSE so it's trimmed from the GIF.
    await page.evaluate(async () => {
      const legend = document.querySelector('#myLegend') as any;
      if (!legend?._legendItems) return;

      const targets: string[] = legend._legendItems
        .filter((i: any) => i.value !== '__NA__' && i.value !== 'Other')
        .slice()
        .sort((a: any, b: any) => a.count - b.count)
        .slice(0, 2)
        .map((i: any) => i.value);

      for (const value of targets) {
        legend._handleMergeToOther(value);
        await legend.updateComplete;
      }
    });
    // Wait for legend to re-render after merging items into Other
    await waitForLegend(page);
    await page.waitForTimeout(500);

    // Wait to show initial state (will be trimmed from GIF)
    await page.waitForTimeout(INITIAL_PAUSE);

    // Helper: find the "Other" legend item's (view) button coords
    const getViewButtonCoords = async () => {
      return await page.evaluate(() => {
        const legend = document.querySelector('#myLegend');
        if (!legend || !legend.shadowRoot) return null;
        // Find the Other item by its CSS class
        const otherItem = legend.shadowRoot.querySelector('.legend-item-other');
        if (!otherItem) return null;
        const viewButton = otherItem.querySelector('.view-button') as HTMLElement;
        if (!viewButton) return null;
        const rect = viewButton.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    };

    // Step 2: Click "(view)" button on the Other category
    const viewButtonCoords = await getViewButtonCoords();
    if (viewButtonCoords) {
      await trackedMouseMove(page, viewButtonCoords.x, viewButtonCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showClickIndicator(page, viewButtonCoords.x, viewButtonCoords.y);
    }
    await logAction(page, 'mouse', 'Click View Button', 'Open Others dialog');
    await page.evaluate(() => {
      const legend = document.querySelector('#myLegend');
      if (!legend || !legend.shadowRoot) return;
      const otherItem = legend.shadowRoot.querySelector('.legend-item-other');
      if (!otherItem) return;
      const viewButton = otherItem.querySelector('.view-button') as HTMLElement;
      if (viewButton) viewButton.click();
    });

    // Wait for modal to appear
    await page.waitForTimeout(800);

    // Step 3: Scroll "CRISP family" into view within the dialog, then extract it
    await page.evaluate(() => {
      const legend = document.querySelector('#myLegend');
      if (!legend || !legend.shadowRoot) return;
      const modal = legend.shadowRoot.querySelector('.modal-content');
      if (!modal) return;
      // Find the CRISP family item and scroll it into view
      const otherItems = modal.querySelectorAll('.other-item');
      for (const item of otherItems) {
        const name = item.querySelector('.other-item-name')?.textContent?.trim() || '';
        if (name.toLowerCase().includes('crisp')) {
          (item as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    });
    await page.waitForTimeout(600);

    // Pause to let the user see the dialog contents before extracting
    await page.waitForTimeout(1500);

    // Now get the (now visible) extract button coordinates
    const extractButtonCoords = await page.evaluate(() => {
      const legend = document.querySelector('#myLegend');
      if (!legend || !legend.shadowRoot) return null;
      const modal = legend.shadowRoot.querySelector('.modal-content');
      if (!modal) return null;
      const otherItems = modal.querySelectorAll('.other-item');
      for (const item of otherItems) {
        const name = item.querySelector('.other-item-name')?.textContent?.trim() || '';
        if (name.toLowerCase().includes('crisp')) {
          const extractBtn = item.querySelector('.extract-button') as HTMLElement;
          if (extractBtn) {
            const rect = extractBtn.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, name };
          }
        }
      }
      // Fallback: first extract button
      const firstBtn = modal.querySelector('.extract-button') as HTMLElement;
      if (!firstBtn) return null;
      const rect = firstBtn.getBoundingClientRect();
      const otherItem = firstBtn.closest('.other-item');
      const fallbackName =
        otherItem?.querySelector('.other-item-name')?.textContent?.trim() || 'first item';
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        name: fallbackName,
      };
    });

    const extractName = (extractButtonCoords as any)?.name || 'CRISP family';
    if (extractButtonCoords) {
      await trackedMouseMove(page, extractButtonCoords.x, extractButtonCoords.y, { steps: 15 });
      await page.waitForTimeout(300);
      await showClickIndicator(page, extractButtonCoords.x, extractButtonCoords.y);
    }
    await logAction(page, 'mouse', 'Click Extract Button', `Extract ${extractName}`);
    await page.evaluate(() => {
      const legend = document.querySelector('#myLegend');
      if (!legend || !legend.shadowRoot) return;
      const modal = legend.shadowRoot.querySelector('.modal-content');
      if (!modal) return;
      const otherItems = modal.querySelectorAll('.other-item');
      for (const item of otherItems) {
        const name = item.querySelector('.other-item-name')?.textContent?.trim() || '';
        if (name.toLowerCase().includes('crisp')) {
          const extractBtn = item.querySelector('.extract-button') as HTMLElement;
          if (extractBtn) {
            extractBtn.click();
            return;
          }
        }
      }
      // Fallback: click first extract button
      const firstBtn = modal.querySelector('.extract-button') as HTMLElement;
      if (firstBtn) firstBtn.click();
    });

    // Wait for extraction to complete and modal to close
    await page.waitForTimeout(1500);

    // Show final result
    await page.waitForTimeout(1000);
  });
});
