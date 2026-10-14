/**
 * Phone, tablet and landscape helpers for the `mobile` project (design decision 17): geometry
 * checks, raw touch input through CDP, plot targets and the phone layout's controls. Controls are
 * found by role, accessible name or tag; Playwright's locators pierce shadow roots, so no helper
 * reaches into one by hand.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  appBar,
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
  try {
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
  } finally {
    await cdp.detach().catch(() => {});
  }
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

/** A segment of the More sheet's Theme row, by its text. */
export const themeSegment = (page: Page, label: 'System' | 'Light' | 'Dark'): Locator =>
  moreSheetContent(page).getByRole('radio', { name: label, exact: true });

/**
 * The shown Legend or Filter tab of the panel under the plot. Each panel's header holds a copy of
 * the tabs; only the shown panel's copy is visible.
 */
export const panelTab = (page: Page, name: 'Legend' | 'Filter'): Locator =>
  page.getByRole('tab', { name, exact: true }).filter({ visible: true });

/** The phone panel's fold chevron, "Fold panel" or "Unfold panel", in the shown panel's header. */
export const panelFold = (page: Page): Locator =>
  page.getByRole('button', { name: /^(Fold|Unfold) panel$/ }).filter({ visible: true });

// ─── More touch ────────────────────────────────────────────────────────────────

/** `steps + 1` points from `from`, moving by (dx, dy) in equal steps. */
export function line(from: Point, dx: number, dy: number, steps = 10): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + (dx * i) / steps,
    y: from.y + (dy * i) / steps,
  }));
}

/**
 * Raw touch points through CDP, one track per finger, all tracks the same length: touchStart at
 * each track's first point, a touchMove per later point, then touchEnd. A pinch is two tracks.
 */
export async function touchGesture(page: Page, tracks: Point[][]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (step: number) =>
    tracks.map((track, id) => ({ x: track[step].x, y: track[step].y, id }));
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let step = 1; step < tracks[0].length; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** A one-finger tap: touch events, the compat mouse events and a click, as a phone sends them. */
export async function tap(page: Page, point: Point): Promise<void> {
  await page.touchscreen.tap(point.x, point.y);
}

/** Whether two boxes share any area. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// ─── Plot ──────────────────────────────────────────────────────────────────────

type PlotElement = HTMLElement & {
  data: { protein_ids: string[] };
  getProteinClientPosition(proteinId: string): Point | null;
};

/** The plot's protein tooltip (hover or pinned); it exists only while shown. */
export const plotTooltip = (page: Page): Locator =>
  page.locator('#myPlot protspace-protein-tooltip');

/** The structure section: the phone's bottom sheet, the tablet's right half, desktop's dock. */
export const structureSheet = (page: Page): Locator => page.locator('[data-workbench="structure"]');

/** The structure sheet's chevron: "Show the structure" folded, "Hide the structure" expanded. */
export const sheetToggle = (page: Page): Locator =>
  structureSheet(page).getByRole('button', { name: /^(Show|Hide) the structure$/ });

/**
 * The plotted protein nearest the spot at fractions (fx, fy) of the plot's box, in viewport
 * pixels with its id. It stays clear of the tool strip (left 64 px), the top 60 px, the status
 * corner (bottom 50 px) and the window's edge, and above `maxY` so a sheet below cannot cover it.
 */
export async function proteinNear(
  page: Page,
  fx: number,
  fy: number,
  maxY = Infinity,
): Promise<Point & { id: string }> {
  const found = await page.locator('#myPlot').evaluate(
    (element: PlotElement, { fx, fy, maxY }) => {
      const rect = element.getBoundingClientRect();
      const target = { x: rect.left + rect.width * fx, y: rect.top + rect.height * fy };
      const bottom = Math.min(rect.bottom - 50, maxY, window.innerHeight - 8);
      let best: { x: number; y: number; id: string } | null = null;
      let bestDistance = Infinity;
      for (const id of element.data.protein_ids) {
        const p = element.getProteinClientPosition(id);
        if (!p || p.x < rect.left + 64 || p.x > rect.right - 16) continue;
        if (p.y < Math.max(rect.top, 0) + 60 || p.y > bottom) continue;
        const distance = Math.hypot(p.x - target.x, p.y - target.y);
        if (distance < bestDistance) [best, bestDistance] = [{ ...p, id }, distance];
      }
      return best;
    },
    { fx, fy, maxY },
  );
  if (!found) throw new Error(`No protein near (${fx}, ${fy}) of the plot`);
  return found;
}

/**
 * The plotted protein farthest right, in the upper half of the screen (clear of a structure
 * sheet) and below the plot's top 60 px.
 */
export async function proteinNearRightEdge(page: Page): Promise<Point & { id: string }> {
  const found = await page.locator('#myPlot').evaluate((element: PlotElement) => {
    const rect = element.getBoundingClientRect();
    const bottom = Math.min(rect.bottom - 50, window.innerHeight / 2 - 30);
    let best: { x: number; y: number; id: string } | null = null;
    for (const id of element.data.protein_ids) {
      const p = element.getProteinClientPosition(id);
      if (!p || p.y < Math.max(rect.top, 0) + 60 || p.y > bottom || p.x > rect.right - 4) continue;
      if (!best || p.x > best.x) best = { ...p, id };
    }
    return best;
  });
  if (!found) throw new Error('No protein near the plot’s right edge');
  return found;
}

/**
 * A spot on the visible plot with no protein within 40 px, clear of the tool strip, the status
 * corner, the selection bar, a shown tooltip and a shown structure sheet.
 */
export async function emptyPlotSpot(page: Page): Promise<Point> {
  const avoid: Box[] = [];
  for (const overlay of [plotTooltip(page), structureSheet(page)]) {
    if (await overlay.isVisible().catch(() => false)) avoid.push(await box(overlay));
  }
  const spot = await page.locator('#myPlot').evaluate((element: PlotElement, avoid) => {
    const rect = element.getBoundingClientRect();
    const boxes = [...avoid];
    // Light-DOM siblings of the plot inside the plot area.
    for (const id of ['myPlotTools', 'myPlotStatus', 'mySelectionBar']) {
      const r = document.getElementById(id)?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0)
        boxes.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    const covered = (x: number, y: number) =>
      boxes.some(
        (b) => x >= b.x - 8 && x <= b.x + b.width + 8 && y >= b.y - 8 && y <= b.y + b.height + 8,
      );
    const points = element.data.protein_ids
      .map((id) => element.getProteinClientPosition(id))
      .filter((p): p is { x: number; y: number } => p !== null);
    const top = Math.max(rect.top, 0) + 20;
    const bottom = Math.min(rect.bottom, window.innerHeight) - 20;
    for (let y = top; y < bottom; y += 10) {
      for (let x = rect.left + 20; x < rect.right - 20; x += 10) {
        if (covered(x, y)) continue;
        if (points.every((p) => Math.hypot(p.x - x, p.y - y) > 40)) return { x, y };
      }
    }
    return null;
  }, avoid);
  if (!spot) throw new Error('No empty spot on the plot');
  return spot;
}

// ─── Touch targets ─────────────────────────────────────────────────────────────

/**
 * The visible buttons, links and tabs inside `root` (through shadow roots) smaller than `min`
 * px either way, as "name: W×H". Empty when every target is finger-sized.
 */
export async function touchTargetsBelow(page: Page, root: Locator, min = 40): Promise<string[]> {
  return root.locator('button, [role="button"], a[href], [role="tab"]').evaluateAll(
    (elements, limit) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
          return [];
        }
        if (rect.width >= limit - 0.5 && rect.height >= limit - 0.5) return [];
        const name = (element.getAttribute('aria-label') ?? element.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
        return [`${name || element.tagName.toLowerCase()}: ${size}`];
      }),
    min,
  );
}

// ─── Page fit ──────────────────────────────────────────────────────────────────

/** Asserts that nothing pushes the document wider than the window. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(clientWidth);
}

/** Asserts that the page does not scroll: it is one fixed screen. */
export async function expectNoPageScroll(page: Page): Promise<void> {
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(scrollHeight, 'the page does not scroll').toBeLessThanOrEqual(clientHeight + 1);
}

/** The panel under the plot on phones and tablets: the sidebar, holding the legend or Filter. */
export const bottomPanel = (page: Page): Locator => page.locator('[data-workbench="sidebar"]');

/** The phone app bar's search button; it opens search over the bar. */
export const searchToggle = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: 'Search proteins', exact: true });

/**
 * Applies a one-condition filter keeping the first ten proteins, as the Filter panel's Apply
 * reports it (the filter controller hears the builder's query-changed and query-apply), without
 * driving the builder's pickers on a small screen. Resolves once the status corner shows the chip.
 */
export async function applyFilterKeepingTen(page: Page): Promise<void> {
  await page.locator('#myQueryBuilder').evaluate((builder) => {
    const plot = document.querySelector('#myPlot') as Element & { selectedAnnotation: string };
    const query = [
      {
        id: 'e2e-filter',
        kind: 'categorical',
        annotation: plot.selectedAnnotation,
        values: ['e2e'],
      },
    ];
    builder.dispatchEvent(new CustomEvent('query-changed', { detail: { query } }));
    builder.dispatchEvent(
      new CustomEvent('query-apply', {
        detail: { matchedIndices: new Set(Array.from({ length: 10 }, (_, i) => i)) },
      }),
    );
  });
  await expect(page.locator('#myPlotStatus .status-chip[data-kind="filter"]')).toBeVisible();
}
