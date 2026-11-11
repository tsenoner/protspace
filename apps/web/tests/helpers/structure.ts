/**
 * Waiting for a structure to load, by the viewer's own signal: `#myStructureViewer` dispatches a
 * bubbling `structure-load` event with `status: 'loaded'` once Mol* has shown the protein (or, in
 * the e2e suite, once `stubStructureRequests`' viewer has taken it). Replaces fixed sleeps.
 */
import type { Page } from '@playwright/test';

/** What each `structure-load` event said, in order; kept on the window by `watchStructureLoads`. */
type StructureLoadLog = Array<{ proteinId: string; status: string }>;
type LoadWatchingWindow = Window & { __structureLoads?: StructureLoadLog };

/**
 * Starts recording the viewer's `structure-load` events in the page. Call it before the click that
 * loads a structure; calling it again keeps the one recorder. A navigation drops it.
 */
export async function watchStructureLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as LoadWatchingWindow;
    if (win.__structureLoads) return;
    const log: StructureLoadLog = [];
    win.__structureLoads = log;
    document.addEventListener('structure-load', (event) => {
      const detail = (event as CustomEvent<{ proteinId: string; status: string }>).detail;
      log.push({ proteinId: detail.proteinId, status: detail.status });
    });
  });
}

/**
 * Waits until the viewer reports `proteinId` loaded, then for two frames so its canvas has drawn.
 * Throws when `watchStructureLoads` was not called on this page.
 */
export async function waitForStructureLoaded(
  page: Page,
  proteinId: string,
  timeout = 30_000,
): Promise<void> {
  const watching = await page.evaluate(() =>
    Array.isArray((window as LoadWatchingWindow).__structureLoads),
  );
  if (!watching) {
    throw new Error('Call watchStructureLoads(page) before the click that loads the structure');
  }
  await page.waitForFunction(
    (id) =>
      ((window as LoadWatchingWindow).__structureLoads ?? []).some(
        (load) => load.proteinId === id && load.status === 'loaded',
      ),
    proteinId,
    { timeout, polling: 100 },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
