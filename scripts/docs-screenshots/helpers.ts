import { Page } from '@playwright/test';
import * as path from 'path';

// Output directory for screenshots
export const IMAGES_DIR = path.join(__dirname, '../../docs/explore/images');

// Output directory for temporary videos (before GIF conversion)
export const TEMP_VIDEOS_DIR = path.join(__dirname, '../../temp-videos');

/**
 * Dismiss the product tour by setting the localStorage flag that marks it as
 * completed.  Must be called **after** `page.goto()` (so the origin is set)
 * but **before** data finishes loading (which triggers the tour).
 *
 * A simple approach: navigate first, inject the key, then reload so the page
 * starts fresh with the flag already in place.  Alternatively, call this
 * right after goto and before waitForDataLoad — the tour checks localStorage
 * synchronously before calling `driverObj.drive()`.
 */
export async function dismissProductTour(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
}

/**
 * Settle for two animation frames so Lit's update cycle and the next paint
 * have committed before we proceed. Cheaper and more deterministic than a
 * fixed `waitForTimeout` since it ties to the actual render loop.
 */
async function awaitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Wait for the scatterplot to finish loading data and for the first render
 * pass to populate the plot's internal layout state. Also waits for the
 * `#progressive-loading` overlay (loading-overlay.ts) to fully remove
 * itself — without this, screenshots can land during the 500 ms fade-out.
 */
export async function waitForDataLoad(page: Page, timeout = 30000): Promise<void> {
  await page.waitForSelector('#myPlot', { timeout });

  // Wait for the data property AND the post-render derived state used by
  // the animation tests (`_plotData`, `_scales`). When both are populated
  // the canvas has rendered at least once.
  await page.waitForFunction(
    () => {
      const plot = document.querySelector('#myPlot') as any;
      if (!plot) return false;
      if (!plot.data?.protein_ids?.length) return false;
      if (!Array.isArray(plot._plotData) || plot._plotData.length === 0) return false;
      if (!plot._scales) return false;
      return true;
    },
    { timeout, polling: 200 },
  );

  // The loading overlay fades out (opacity 0.5s) then removes itself ~500 ms
  // later. Wait for the element to be gone from the DOM.
  await page.waitForFunction(() => !document.getElementById('progressive-loading'), {
    timeout,
    polling: 100,
  });

  await awaitTwoFrames(page);
}

/**
 * Wait for the legend to populate with items and finish its first paint.
 */
export async function waitForLegend(page: Page, timeout = 15000): Promise<void> {
  await page.waitForSelector('#myLegend', { timeout });

  await page.waitForFunction(
    () => {
      const legend = document.querySelector('#myLegend');
      if (!legend || !legend.shadowRoot) return false;
      const items = legend.shadowRoot.querySelectorAll('.legend-item');
      return items.length > 0;
    },
    { timeout, polling: 200 },
  );

  await awaitTwoFrames(page);
}

/**
 * Wait for WebGL context to be ready in a canvas element.
 * This ensures WebGL is fully initialized before capturing screenshots.
 */
export async function waitForWebGLContext(
  page: Page,
  selector: string = 'canvas',
  timeout = 30000,
): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement;
      if (!canvas) return false;

      // Try to get WebGL2 or WebGL context
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;

      // Check if context is actually working (not lost)
      const isContextLost = gl.isContextLost ? gl.isContextLost() : false;
      if (isContextLost) return false;

      // Additional check: ensure canvas has non-zero dimensions
      return canvas.width > 0 && canvas.height > 0;
    },
    selector,
    { timeout, polling: 500 },
  );

  // Wait for a frame to ensure rendering has started
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

/**
 * Wait for the structure viewer to load a protein.
 * Note: Mol* loading can take a long time (CDN + AlphaFold fetch), so we're lenient.
 */
export async function waitForStructureViewer(page: Page, timeout = 20000): Promise<void> {
  // Wait for element to exist (not necessarily visible yet)
  await page.waitForSelector('#myStructureViewer', { state: 'attached', timeout });

  // Wait for structure viewer to become visible (display !== 'none')
  await page.waitForFunction(
    () => {
      const viewer = document.querySelector('#myStructureViewer') as HTMLElement;
      if (!viewer) return false;

      // Check if viewer is visible (not display:none)
      const computedStyle = window.getComputedStyle(viewer);
      return computedStyle.display !== 'none' && viewer.style.display !== 'none';
    },
    { timeout, polling: 500 },
  );

  // Try to wait for Mol* canvas, but don't fail if it doesn't appear
  // Mol* needs to load from CDN + fetch from AlphaFold which can be slow
  try {
    await page.waitForFunction(
      () => {
        const viewer = document.querySelector('#myStructureViewer') as HTMLElement;
        if (!viewer?.shadowRoot) return false;

        // Check for Mol* plugin container in shadow root
        const plugin = viewer.shadowRoot.querySelector('.msp-plugin');
        const viewerContent = viewer.shadowRoot.querySelector('.viewer-content');
        const nestedPlugin = viewerContent?.querySelector('.msp-plugin');

        return !!(plugin || nestedPlugin);
      },
      { timeout: 15000, polling: 1000 },
    );
    // If plugin found, wait a bit more for canvas rendering and structure loading
    await page.waitForTimeout(5000);

    // Wait for WebGL context to be ready in the Mol* canvas
    try {
      await page.waitForFunction(
        () => {
          const viewer = document.querySelector('#myStructureViewer') as HTMLElement;
          if (!viewer?.shadowRoot) return false;

          // Find canvas in shadow root
          const canvas = viewer.shadowRoot.querySelector('canvas');
          if (!canvas) return false;

          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          return !!gl && !(gl.isContextLost && gl.isContextLost());
        },
        { timeout: 10000, polling: 500 },
      );

      // Wait for a couple of frames to ensure rendering
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
      });
    } catch {
      console.log('Note: WebGL context check timed out, proceeding anyway');
    }
  } catch {
    // Mol* didn't appear in time
    console.log('Note: Mol* plugin did not load in time, capturing current state');
    await page.waitForTimeout(1000);
  }
}

/**
 * Capture a screenshot of a specific element with optional padding.
 */
export async function captureElement(
  page: Page,
  selector: string,
  filename: string,
  options: {
    padding?: number;
    fullPage?: boolean;
  } = {},
): Promise<string> {
  const { fullPage = false } = options;
  const outputPath = path.join(IMAGES_DIR, filename);

  if (fullPage) {
    await page.screenshot({
      path: outputPath,
      fullPage: true,
    });
  } else {
    const element = page.locator(selector);
    await element.screenshot({
      path: outputPath,
    });
  }

  console.log(`📸 Captured: ${filename}`);
  return outputPath;
}

/**
 * Capture a screenshot of a shadow DOM element.
 * Since Playwright can't directly screenshot shadow DOM elements,
 * we use evaluate to get bounding box and clip the screenshot.
 */
export async function captureShadowElement(
  page: Page,
  hostSelector: string,
  shadowSelector: string,
  filename: string,
  padding = 10,
): Promise<string> {
  const outputPath = path.join(IMAGES_DIR, filename);

  // Get the bounding box of the shadow DOM element
  const box = await page.evaluate(
    ({ hostSel, shadowSel }) => {
      const host = document.querySelector(hostSel);
      if (!host || !host.shadowRoot) return null;

      const element = host.shadowRoot.querySelector(shadowSel);
      if (!element) return null;

      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    },
    { hostSel: hostSelector, shadowSel: shadowSelector },
  );

  if (!box) {
    throw new Error(`Could not find shadow element: ${hostSelector} >> ${shadowSelector}`);
  }

  // Add padding
  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };

  await page.screenshot({
    path: outputPath,
    clip,
  });

  console.log(`📸 Captured shadow element: ${filename}`);
  return outputPath;
}

/**
 * Click on a protein point in the scatterplot.
 * Directly shows the structure viewer and loads a protein.
 */
export async function clickProteinPoint(page: Page): Promise<void> {
  const plot = page.locator('#myPlot');
  const box = await plot.boundingBox();

  if (!box) throw new Error('Could not get scatterplot bounding box');

  // Dispatch a protein-click event AND directly load the protein to ensure visibility
  const proteinId = await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as any;
    const structureViewer = document.querySelector('#myStructureViewer') as any;

    if (!plot?.data?.protein_ids?.length || !structureViewer) return null;

    // Get the first protein ID
    const id = plot.data.protein_ids[0];

    // Programmatically select it on the plot
    plot.selectedProteinIds = [id];

    // Directly call loadProtein on the structure viewer
    structureViewer.loadProtein(id);

    // Force display to be visible
    structureViewer.style.display = 'flex';

    return id;
  });

  if (proteinId) {
    await logAction(page, 'mouse', 'Click Protein Point', `Load protein: ${proteinId}`);
  }

  // Give the structure viewer time to load
  await page.waitForTimeout(1000);
}

/**
 * Perform a box selection on the scatterplot.
 */
export async function boxSelect(
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): Promise<void> {
  const plot = page.locator('#myPlot');
  const box = await plot.boundingBox();

  if (!box) throw new Error('Could not get scatterplot bounding box');

  // Calculate absolute positions
  const absStartX = box.x + startX;
  const absStartY = box.y + startY;
  const absEndX = box.x + endX;
  const absEndY = box.y + endY;

  // Perform drag selection
  await page.mouse.move(absStartX, absStartY);
  await page.mouse.down();
  await page.mouse.move(absEndX, absEndY, { steps: 20 });
  await page.mouse.up();
}

/**
 * Zoom the scatterplot using mouse wheel.
 */
export async function zoomScatterplot(page: Page, deltaY: number, steps = 5): Promise<void> {
  const plot = page.locator('#myPlot');
  const box = await plot.boundingBox();

  if (!box) throw new Error('Could not get scatterplot bounding box');

  // Move to center of plot
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.mouse.move(centerX, centerY);

  // Zoom in steps for smoother animation
  const stepDelta = deltaY / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, stepDelta);
    await page.waitForTimeout(100);
  }
}

/**
 * Pan the scatterplot by dragging.
 */
export async function panScatterplot(page: Page, deltaX: number, deltaY: number): Promise<void> {
  const plot = page.locator('#myPlot');
  const box = await plot.boundingBox();

  if (!box) throw new Error('Could not get scatterplot bounding box');

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(centerX + deltaX, centerY + deltaY, { steps: 20 });
  await page.mouse.up({ button: 'middle' });
}

/**
 * Toggle a legend item visibility.
 */
export async function toggleLegendItem(page: Page, index = 0): Promise<void> {
  // The @click handler lives on the inner `.legend-item-main` button, not the
  // wrapper `.legend-item` div — clicking the wrapper would be a no-op.
  await page.evaluate((idx) => {
    const legend = document.querySelector('#myLegend');
    if (!legend || !legend.shadowRoot) return;

    const items = legend.shadowRoot.querySelectorAll('.legend-item');
    const button = items[idx]?.querySelector('.legend-item-main') as HTMLElement | null;
    button?.click();
  }, index);

  await logAction(page, 'mouse', 'Toggle Legend Item', `Toggle category ${index}`);
  await page.waitForTimeout(500);
}

/**
 * Double-click a legend item to isolate it (show only that category).
 */
export async function doubleClickLegendItem(page: Page, index = 0): Promise<void> {
  // Same caveat as toggleLegendItem: the @dblclick handler is on the inner
  // `.legend-item-main` button. Dispatching on the wrapper does not bubble
  // down to children, so we must dispatch on the button itself.
  await page.evaluate((idx) => {
    const legend = document.querySelector('#myLegend');
    if (!legend || !legend.shadowRoot) return;

    const items = legend.shadowRoot.querySelectorAll('.legend-item');
    const button = items[idx]?.querySelector('.legend-item-main') as HTMLElement | null;
    if (!button) return;

    const event = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    button.dispatchEvent(event);
  }, index);

  await logAction(page, 'mouse', 'Double Click Legend Item', `Isolate category ${index}`);
  await page.waitForTimeout(500);
}

/**
 * Open the export menu in the control bar.
 */
export async function openExportMenu(page: Page): Promise<void> {
  // Click the export button in the control bar
  await page.evaluate(() => {
    const controlBar = document.querySelector('#myControlBar');
    if (!controlBar || !controlBar.shadowRoot) return;

    const exportButton = controlBar.shadowRoot.querySelector(
      '[data-export-button], .export-button, button[title*="Export"]',
    );
    if (exportButton) {
      (exportButton as HTMLElement).click();
    }
  });

  await page.waitForTimeout(500);
}

/**
 * Enable selection mode in the control bar.
 */
export async function enableSelectionMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlBar = document.querySelector('#myControlBar');
    if (!controlBar || !controlBar.shadowRoot) return;

    const selectButton = controlBar.shadowRoot.querySelector(
      '[data-select-button], .select-button, button[title*="Select"]',
    );
    if (selectButton) {
      (selectButton as HTMLElement).click();
    }
  });

  await logAction(page, 'mouse', 'Enable Selection Mode', 'Click select button');
  await page.waitForTimeout(300);
}

/**
 * Get the screen coordinates of the clear button in the control bar.
 */
export async function getClearButtonCoords(page: Page): Promise<{ x: number; y: number } | null> {
  return await page.evaluate(() => {
    const controlBar = document.querySelector('#myControlBar');
    if (!controlBar || !controlBar.shadowRoot) return null;

    const clearButton = controlBar.shadowRoot.querySelector(
      '.right-controls-clear, button[title*="Clear"]',
    ) as HTMLElement;
    if (!clearButton) return null;

    const rect = clearButton.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
}

/**
 * Click the clear button in the control bar to clear all selections.
 */
export async function clickClearButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlBar = document.querySelector('#myControlBar');
    if (!controlBar || !controlBar.shadowRoot) return;

    const clearButton = controlBar.shadowRoot.querySelector(
      '.right-controls-clear, button[title*="Clear"]',
    );
    if (clearButton) {
      (clearButton as HTMLElement).click();
    }
  });

  await logAction(page, 'mouse', 'Click Clear Button', 'Clear all selections');
  await page.waitForTimeout(300);
}

/**
 * Click the isolate button in the control bar to isolate selected proteins.
 */
export async function clickIsolateButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlBar = document.querySelector('#myControlBar');
    if (!controlBar || !controlBar.shadowRoot) return;

    const isolateButton = controlBar.shadowRoot.querySelector(
      '.right-controls-split, button[title*="Isolate selected proteins"]',
    );
    if (isolateButton) {
      (isolateButton as HTMLElement).click();
    }
  });

  await logAction(page, 'mouse', 'Click Isolate Button', 'Isolate selected proteins');
  await page.waitForTimeout(300);
}

/**
 * Click the reset button in the control bar to reset isolation.
 */
export async function clickResetButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlBar = document.querySelector('#myControlBar');
    if (!controlBar || !controlBar.shadowRoot) return;

    const resetButton = controlBar.shadowRoot.querySelector(
      'button[title*="Reset to original dataset"]',
    );
    if (resetButton) {
      (resetButton as HTMLElement).click();
    }
  });

  await logAction(page, 'mouse', 'Click Reset Button', 'Reset to original dataset');
  await page.waitForTimeout(300);
}

/**
 * Get video path from test result for GIF conversion.
 */
export function getVideoOutputPath(testName: string): string {
  return path.join(TEMP_VIDEOS_DIR, `${testName}.webm`);
}

/**
 * Action tracking interface for logging all user interactions.
 */
export interface ActionLog {
  type: 'mouse' | 'keyboard';
  action: string;
  details: string;
  timestamp: number;
}

// Global action log storage
const actionLogs: ActionLog[] = [];

/**
 * Initialize visual indicator overlay system for showing clicks and key presses.
 * This creates a fixed overlay div that will display click indicators and keyboard status.
 */
export async function initVisualIndicators(page: Page): Promise<void> {
  // Clear action logs
  actionLogs.length = 0;

  await page.evaluate(() => {
    // Remove existing overlay if present
    const existing = document.getElementById('playwright-visual-indicators');
    if (existing) existing.remove();

    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'playwright-visual-indicators';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create keyboard indicator
    const keyboardIndicator = document.createElement('div');
    keyboardIndicator.id = 'playwright-keyboard-indicator';
    keyboardIndicator.style.cssText = `
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255, 107, 107, 0.95);
      color: white;
      padding: 18px 36px;
      border-radius: 12px;
      font-size: 32px;
      font-weight: 700;
      display: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      letter-spacing: 2px;
      z-index: 1000001;
      border: 4px solid rgba(255, 255, 255, 0.4);
      animation: keyboardPulse 0.3s ease-out;
    `;
    overlay.appendChild(keyboardIndicator);

    // Add pulse animation for keyboard indicator
    if (!document.getElementById('playwright-keyboard-animation')) {
      const style = document.createElement('style');
      style.id = 'playwright-keyboard-animation';
      style.textContent = `
        @keyframes keyboardPulse {
          0% {
            transform: translateX(-50%) scale(0.9);
            opacity: 0;
          }
          100% {
            transform: translateX(-50%) scale(1);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
  });
}

/**
 * Log an action to console (for debugging).
 * Visual indicators are shown separately via showClickIndicator and showKeyboardIndicator.
 */
export async function logAction(
  page: Page,
  type: 'mouse' | 'keyboard',
  action: string,
  details: string,
): Promise<void> {
  const logEntry: ActionLog = {
    type,
    action,
    details,
    timestamp: Date.now(),
  };
  actionLogs.push(logEntry);

  // Log to console only
  const icon = type === 'mouse' ? '🖱️' : '⌨️';
  console.log(`${icon} ${action}: ${details}`);
}

/**
 * Get all logged actions.
 */
export function getActionLogs(): ActionLog[] {
  return [...actionLogs];
}

/**
 * Print action summary to console.
 */
export function printActionSummary(): void {
  console.log('\n📊 Action Summary:');
  console.log('='.repeat(60));
  actionLogs.forEach((log, index) => {
    const icon = log.type === 'mouse' ? '🖱️' : '⌨️';
    console.log(
      `${(index + 1).toString().padStart(3, ' ')}. ${icon} ${log.action.padEnd(20)} - ${log.details}`,
    );
  });
  console.log('='.repeat(60));
  console.log(`Total actions: ${actionLogs.length}`);
  console.log(`Mouse actions: ${actionLogs.filter((l) => l.type === 'mouse').length}`);
  console.log(`Keyboard actions: ${actionLogs.filter((l) => l.type === 'keyboard').length}`);
}

/**
 * Show a click indicator at the specified coordinates.
 * Creates a ripple effect that fades out after a short duration.
 */
export async function showClickIndicator(
  page: Page,
  x: number,
  y: number,
  options: { modifier?: string } = {},
): Promise<void> {
  await page.evaluate(
    ({ clickX, clickY, modifier }) => {
      const overlay = document.getElementById('playwright-visual-indicators');
      if (!overlay) return;

      // Create click indicator (ripple effect)
      const clickIndicator = document.createElement('div');
      clickIndicator.style.cssText = `
        position: fixed;
        left: ${clickX}px;
        top: ${clickY}px;
        width: 0;
        height: 0;
        border-radius: 50%;
        border: 3px solid ${modifier ? '#ff6b6b' : '#4dabf7'};
        background: ${modifier ? 'rgba(255, 107, 107, 0.2)' : 'rgba(77, 171, 247, 0.2)'};
        transform: translate(-50%, -50%);
        pointer-events: none;
        animation: clickRipple 0.6s ease-out forwards;
        z-index: 1000000;
      `;

      // Add animation keyframes if not already present
      if (!document.getElementById('playwright-click-animation')) {
        const style = document.createElement('style');
        style.id = 'playwright-click-animation';
        style.textContent = `
          @keyframes clickRipple {
            0% {
              width: 0;
              height: 0;
              opacity: 1;
            }
            50% {
              width: 40px;
              height: 40px;
              opacity: 0.8;
            }
            100% {
              width: 60px;
              height: 60px;
              opacity: 0;
            }
          }
        `;
        document.head.appendChild(style);
      }

      overlay.appendChild(clickIndicator);

      // Remove after animation completes
      setTimeout(() => {
        clickIndicator.remove();
      }, 600);
    },
    { clickX: x, clickY: y, modifier: options.modifier },
  );
}

/**
 * Wrapper for mouse.move that logs the action.
 */
export async function trackedMouseMove(
  page: Page,
  x: number,
  y: number,
  options?: { steps?: number },
): Promise<void> {
  await logAction(
    page,
    'mouse',
    'Mouse Move',
    `Move to (${Math.round(x)}, ${Math.round(y)})${options?.steps ? ` with ${options.steps} steps` : ''}`,
  );
  await page.mouse.move(x, y, options);
}

/**
 * Wrapper for mouse.click that logs the action.
 */
export async function trackedMouseClick(
  page: Page,
  x: number,
  y: number,
  options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number },
): Promise<void> {
  const button = options?.button || 'left';
  const count = options?.clickCount || 1;
  const action = count === 2 ? 'Double Click' : 'Click';
  await logAction(
    page,
    'mouse',
    action,
    `${button} button at (${Math.round(x)}, ${Math.round(y)})`,
  );
  await page.mouse.click(x, y, options);
}

/**
 * Wrapper for mouse.down that logs the action.
 */
export async function trackedMouseDown(
  page: Page,
  options?: { button?: 'left' | 'right' | 'middle' },
): Promise<void> {
  const button = options?.button || 'left';
  await logAction(page, 'mouse', 'Mouse Down', `${button} button pressed`);
  await page.mouse.down(options);
}

/**
 * Wrapper for mouse.up that logs the action.
 */
export async function trackedMouseUp(
  page: Page,
  options?: { button?: 'left' | 'right' | 'middle' },
): Promise<void> {
  const button = options?.button || 'left';
  await logAction(page, 'mouse', 'Mouse Up', `${button} button released`);
  await page.mouse.up(options);
}

/**
 * Wrapper for mouse.wheel that logs the action.
 */
export async function trackedMouseWheel(page: Page, deltaX: number, deltaY: number): Promise<void> {
  const direction = deltaY < 0 ? 'Zoom In' : deltaY > 0 ? 'Zoom Out' : 'Scroll';
  await logAction(
    page,
    'mouse',
    'Mouse Wheel',
    `${direction} (deltaX: ${deltaX}, deltaY: ${deltaY})`,
  );
  await page.mouse.wheel(deltaX, deltaY);
}

/**
 * Wrapper for keyboard.down that logs the action.
 */
export async function trackedKeyboardDown(page: Page, key: string): Promise<void> {
  const keyName = key === 'Meta' ? '⌘ (Cmd)' : key === 'Control' ? 'Ctrl' : key;
  await logAction(page, 'keyboard', 'Key Down', keyName);
  await page.keyboard.down(key);
}

/**
 * Wrapper for keyboard.up that logs the action.
 */
export async function trackedKeyboardUp(page: Page, key: string): Promise<void> {
  const keyName = key === 'Meta' ? '⌘ (Cmd)' : key === 'Control' ? 'Ctrl' : key;
  await logAction(page, 'keyboard', 'Key Up', keyName);
  await page.keyboard.up(key);
}

/**
 * Wrapper for keyboard.press that logs the action.
 */
export async function trackedKeyboardPress(
  page: Page,
  key: string,
  options?: { delay?: number },
): Promise<void> {
  const keyName = key === 'Escape' ? 'Esc' : key;
  await logAction(page, 'keyboard', 'Key Press', keyName);
  await page.keyboard.press(key, options);
}

/**
 * Show keyboard indicator for modifier key (Cmd/Ctrl).
 */
export async function showKeyboardIndicator(page: Page, key: string): Promise<void> {
  await page.evaluate(() => {
    const indicator = document.getElementById('playwright-keyboard-indicator');
    if (!indicator) return;

    indicator.textContent = 'Hold ⌘/Ctrl';
    indicator.style.display = 'block';
  });
  await logAction(page, 'keyboard', 'Modifier Key', `Hold ${key === 'Meta' ? '⌘ (Cmd)' : 'Ctrl'}`);
}

/**
 * Show a transient action label (e.g. "Click", "Double-Click") next to a
 * click point. The label sits centered above (x, y) and flips below when
 * (x, y) is near the top of the viewport. Auto-hides after `durationMs`.
 * Reuses a single DOM node so back-to-back calls replace each other
 * instead of stacking.
 */
export async function showActionLabel(
  page: Page,
  label: string,
  x: number,
  y: number,
  durationMs = 700,
): Promise<void> {
  await page.evaluate(
    ({ text, dur, posX, posY }) => {
      const overlay = document.getElementById('playwright-visual-indicators');
      if (!overlay) return;

      let badge = document.getElementById('playwright-action-label') as HTMLDivElement | null;
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'playwright-action-label';
        overlay.appendChild(badge);
      }

      const margin = 18;
      const flipBelow = posY < 80;
      const anchorY = flipBelow ? posY + margin : posY - margin;
      const transform = flipBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';

      badge.style.cssText = `
        position: fixed;
        left: ${posX}px;
        top: ${anchorY}px;
        transform: ${transform};
        background: rgba(77, 171, 247, 0.95);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 18px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.5px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        border: 2px solid rgba(255, 255, 255, 0.5);
        z-index: 1000001;
        pointer-events: none;
        white-space: nowrap;
      `;
      badge.textContent = text;
      badge.style.display = 'block';

      const prev = (badge as unknown as { _hideTimer?: number })._hideTimer;
      if (prev) window.clearTimeout(prev);
      (badge as unknown as { _hideTimer?: number })._hideTimer = window.setTimeout(() => {
        if (badge) badge.style.display = 'none';
      }, dur);
    },
    { text: label, dur: durationMs, posX: x, posY: y },
  );
  await logAction(page, 'mouse', 'Action Label', label);
}

/**
 * Hide keyboard indicator.
 */
export async function hideKeyboardIndicator(page: Page): Promise<void> {
  await page.evaluate(() => {
    const indicator = document.getElementById('playwright-keyboard-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  });
  await logAction(page, 'keyboard', 'Modifier Key', 'Released');
}

/**
 * Rotate the structure viewer by simulating mouse drag.
 * This simulates left-click and drag to rotate the 3D structure.
 */
export async function rotateStructureViewer(
  page: Page,
  deltaX: number,
  deltaY: number,
  steps = 20,
): Promise<void> {
  const viewer = page.locator('#myStructureViewer');
  const box = await viewer.boundingBox();

  if (!box) throw new Error('Could not get structure viewer bounding box');

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await logAction(
    page,
    'mouse',
    'Rotate Structure',
    `Drag rotation (Δx: ${deltaX}, Δy: ${deltaY}, ${steps} steps)`,
  );

  // Move to center and start drag
  await trackedMouseMove(page, centerX, centerY);
  await trackedMouseDown(page);

  // Drag in steps for smooth rotation
  const stepX = deltaX / steps;
  const stepY = deltaY / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(centerX + stepX * (i + 1), centerY + stepY * (i + 1), { steps: 1 });
    await page.waitForTimeout(20);
  }

  await trackedMouseUp(page);
  // Wait for rendering to catch up
  await page.waitForTimeout(100);
}

/**
 * Zoom the structure viewer by simulating mouse wheel.
 */
export async function zoomStructureViewer(page: Page, deltaY: number, steps = 5): Promise<void> {
  const viewer = page.locator('#myStructureViewer');
  const box = await viewer.boundingBox();

  if (!box) throw new Error('Could not get structure viewer bounding box');

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  const direction = deltaY < 0 ? 'Zoom In' : 'Zoom Out';
  await logAction(
    page,
    'mouse',
    'Zoom Structure',
    `${direction} (deltaY: ${deltaY}, ${steps} steps)`,
  );

  // Move to center
  await trackedMouseMove(page, centerX, centerY);

  // Zoom in steps for smoother animation
  const stepDelta = deltaY / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, stepDelta);
    await page.waitForTimeout(50);
  }

  // Wait for rendering to catch up
  await page.waitForTimeout(100);
}
