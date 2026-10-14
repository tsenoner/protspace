/**
 * Phone, tablet and landscape helpers for the `mobile` project (design decision 17): geometry
 * checks, raw touch input through CDP, plot targets and the phone layout's controls. Controls are
 * found by role, accessible name or tag; Playwright's locators pierce shadow roots, so no helper
 * reaches into one by hand.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  viewBar,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './explore';
import { stubStructureRequests } from './workbench';

// ─── Geometry ──────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** The element's box in viewport pixels; throws when it is not rendered. */
export async function box(locator: Locator): Promise<Box> {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error(`${locator} has no layout box`);
  return bounds;
}

/** Asserts that the element lies inside the viewport (within `slack` px) and returns its box. */
export async function expectWithinViewport(page: Page, locator: Locator, slack = 1): Promise<Box> {
  const viewport = page.viewportSize()!;
  const bounds = await box(locator);
  expect(bounds.x, `${locator}: left edge`).toBeGreaterThanOrEqual(-slack);
  expect(bounds.y, `${locator}: top edge`).toBeGreaterThanOrEqual(-slack);
  expect(bounds.x + bounds.width, `${locator}: right edge`).toBeLessThanOrEqual(
    viewport.width + slack,
  );
  expect(bounds.y + bounds.height, `${locator}: bottom edge`).toBeLessThanOrEqual(
    viewport.height + slack,
  );
  return bounds;
}

// ─── Touch ─────────────────────────────────────────────────────────────────────

/**
 * One finger down at `point`, an optional rest (a long press), then a vertical move of `dy` in
 * ten steps, one frame apart, and up.
 */
export async function touchDrag(page: Page, point: Point, dy: number, restMs = 0): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (y: number) => [{ x: point.x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(point.y) });
  if (restMs) await page.waitForTimeout(restMs);
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(point.y + (dy * step) / 10),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * Opens /explore on the emulated device with the structure requests answered offline, waits for
 * the startup dataset and closes the product tour.
 */
export async function openExplorePhone(page: Page): Promise<void> {
  await stubStructureRequests(page);
  await page.goto('/explore');
  await waitForExploreDataLoad(page);
  await dismissTourIfPresent(page);
  await waitForExploreInteractionReady(page);
}

// ─── Phone controls ────────────────────────────────────────────────────────────

/** The view bar's More button; its name reads "More view options" (", N active" with its dot). */
export const moreButton = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^More view options/ });

/** The More bottom sheet: the dialog named "More" (its box, its heading and its Close). */
export const moreSheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'More', exact: true });

/**
 * The More sheet's `ps-dialog` host, the scope for its rows: they are slotted light-DOM children,
 * which a locator scoped to the dialog element does not reach.
 */
export const moreSheetContent = (page: Page): Locator =>
  page.locator('ps-dialog').filter({ has: moreSheet(page) });

/**
 * The shown Legend or Filter tab of the panel under the plot. Each panel's header holds a copy of
 * the tabs; only the shown panel's copy is visible.
 */
export const panelTab = (page: Page, name: 'Legend' | 'Filter'): Locator =>
  page.getByRole('tab', { name, exact: true }).filter({ visible: true });

/** The phone panel's fold chevron, "Fold panel" or "Unfold panel", in the shown panel's header. */
export const panelFold = (page: Page): Locator =>
  page.getByRole('button', { name: /^(Fold|Unfold) panel$/ }).filter({ visible: true });
