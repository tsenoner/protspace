import type { Page, TestInfo } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { TEMP_VIDEOS_DIR } from './paths';

// The load and tour helpers are the e2e suite's, shared with the captures (design decision 19).
export { dismissTourIfPresent, waitForExploreDataLoad } from '../../apps/web/tests/helpers/explore';

/**
 * Pause at the top of each animation so the GIF opens on a settled frame.
 * `convert-to-gif.ts` trims this span back off, so the two must stay in sync.
 */
export const INITIAL_PAUSE = 2000;

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
    undefined,
    { timeout, polling: 200 },
  );

  await awaitTwoFrames(page);
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

  logAction('mouse', 'Toggle Legend Item', `Toggle category ${index}`);
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

  logAction('mouse', 'Double Click Legend Item', `Isolate category ${index}`);
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

  logAction('mouse', 'Enable Selection Mode', 'Click select button');
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

  logAction('mouse', 'Click Clear Button', 'Clear all selections');
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

  logAction('mouse', 'Click Isolate Button', 'Isolate selected proteins');
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

  logAction('mouse', 'Click Reset Button', 'Reset to original dataset');
  await page.waitForTimeout(300);
}

/**
 * Get video path from test result for GIF conversion.
 *
 * The name is derived from the test title the same way `convert-to-gif.ts`
 * parses it back, so the two stay in step: everything from `.gif` onwards is
 * dropped, then anything unsafe for a filename is collapsed to `-`.
 */
function getVideoOutputPath(testName: string): string {
  const sanitized = testName
    .replace(/\.gif.*$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .toLowerCase();
  return path.join(TEMP_VIDEOS_DIR, `${sanitized}.webm`);
}

/**
 * Persist the recording Playwright made for the current test, if it passed.
 *
 * `docs:gifs` converts every video in TEMP_VIDEOS_DIR, so a failed test saves
 * nothing and removes any older recording under the same name. Playwright keeps
 * its own copy of the failed run's video under test-results.
 *
 * Closes the page first: `saveAs()` only resolves once the recording has been
 * finalized, which happens on close. Safe to call when video is disabled.
 */
export async function saveTestVideo(page: Page, testInfo: TestInfo): Promise<void> {
  const video = page.video();
  if (!video) return;

  const destPath = getVideoOutputPath(testInfo.title);

  await page.close();
  if (testInfo.status !== testInfo.expectedStatus) {
    fs.rmSync(destPath, { force: true });
    console.log(`🎬 Video not saved (test ${testInfo.status}): ${destPath}`);
    return;
  }
  fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });
  await video.saveAs(destPath);
  console.log(`🎬 Video saved: ${destPath}`);
}

/** Pick an annotation from the control bar's dropdown by its data key. */
export async function selectAnnotation(page: Page, annotation: string): Promise<void> {
  const controlBar = page.locator('protspace-control-bar');
  await controlBar.locator('protspace-annotation-select .dropdown-trigger').click();
  await controlBar.locator(`.dropdown-item[data-annotation="${annotation}"]`).click();
  await page.waitForFunction(
    (key) => {
      const plot = document.querySelector('protspace-scatterplot') as
        | (Element & { selectedAnnotation?: string })
        | null;
      return plot?.selectedAnnotation === key;
    },
    annotation,
    { polling: 100 },
  );
}

/**
 * Switch the control bar to the first projection whose name contains `match`,
 * then wait for the scatter-plot to adopt it. Returns the resolved name.
 *
 * Drives `applyProjectionSelection()` directly instead of clicking the
 * dropdown, unlike `selectAnnotation()`: the animation specs record video, so
 * an open menu would land in the GIF.
 */
export async function selectProjection(page: Page, match: string): Promise<string> {
  const projection = await page.evaluate((needle) => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { projections?: Array<{ name: string }> } })
      | null;
    const controlBar = document.querySelector('#myControlBar') as
      | (Element & { applyProjectionSelection(name: string): void })
      | null;
    if (!plot || !controlBar) {
      throw new Error('selectProjection needs #myPlot and #myControlBar');
    }

    const target = plot.data?.projections?.find((p) => p.name.includes(needle));
    if (!target) {
      throw new Error(`No projection matching "${needle}"`);
    }

    controlBar.applyProjectionSelection(target.name);
    return target.name;
  }, match);

  // Gate on the name we asked for, not on the plot agreeing with the control
  // bar: both are set synchronously by `applyProjectionSelection`, so a
  // control-bar-vs-plot comparison passes even when the switch never happened.
  await page.waitForFunction(
    (name) => {
      const plot = document.querySelector('#myPlot') as
        | (Element & {
            data?: { projections?: Array<{ name: string }> };
            selectedProjectionIndex?: number;
          })
        | null;
      if (!plot || plot.selectedProjectionIndex === undefined) return false;
      return plot.data?.projections?.[plot.selectedProjectionIndex]?.name === name;
    },
    projection,
    { timeout: 5_000, polling: 100 },
  );

  return projection;
}

/**
 * Screen coordinates of a protein's marker, in page space, from the scatter
 * plot's own projection — so it accounts for zoom, filtering and isolation.
 */
export async function getProteinScreenPosition(
  page: Page,
  proteinId: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getProteinClientPosition(proteinId: string): { x: number; y: number } | null;
        })
      | null;
    const position = plot?.getProteinClientPosition(id);
    if (!position) {
      throw new Error(`Protein ${id} is not plotted, or the scatter plot has no geometry yet`);
    }
    return position;
  }, proteinId);
}

/**
 * Action tracking interface for logging all user interactions.
 */
interface ActionLog {
  type: 'mouse' | 'keyboard';
  action: string;
  details: string;
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
export function logAction(type: 'mouse' | 'keyboard', action: string, details: string): void {
  actionLogs.push({ type, action, details });

  // Log to console only
  const icon = type === 'mouse' ? '🖱️' : '⌨️';
  console.log(`${icon} ${action}: ${details}`);
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
  logAction(
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
  logAction('mouse', action, `${button} button at (${Math.round(x)}, ${Math.round(y)})`);
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
  logAction('mouse', 'Mouse Down', `${button} button pressed`);
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
  logAction('mouse', 'Mouse Up', `${button} button released`);
  await page.mouse.up(options);
}

/**
 * Wrapper for mouse.wheel that logs the action.
 */
export async function trackedMouseWheel(page: Page, deltaX: number, deltaY: number): Promise<void> {
  const direction = deltaY < 0 ? 'Zoom In' : deltaY > 0 ? 'Zoom Out' : 'Scroll';
  logAction('mouse', 'Mouse Wheel', `${direction} (deltaX: ${deltaX}, deltaY: ${deltaY})`);
  await page.mouse.wheel(deltaX, deltaY);
}

/**
 * Wrapper for keyboard.down that logs the action.
 */
export async function trackedKeyboardDown(page: Page, key: string): Promise<void> {
  const keyName = key === 'Meta' ? '⌘ (Cmd)' : key === 'Control' ? 'Ctrl' : key;
  logAction('keyboard', 'Key Down', keyName);
  await page.keyboard.down(key);
}

/**
 * Wrapper for keyboard.up that logs the action.
 */
export async function trackedKeyboardUp(page: Page, key: string): Promise<void> {
  const keyName = key === 'Meta' ? '⌘ (Cmd)' : key === 'Control' ? 'Ctrl' : key;
  logAction('keyboard', 'Key Up', keyName);
  await page.keyboard.up(key);
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
  logAction('keyboard', 'Modifier Key', `Hold ${key === 'Meta' ? '⌘ (Cmd)' : 'Ctrl'}`);
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
  logAction('mouse', 'Action Label', label);
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
  logAction('keyboard', 'Modifier Key', 'Released');
}
