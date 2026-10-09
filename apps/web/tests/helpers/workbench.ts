/**
 * Helpers for the workbench's sidebar column: the structure section, the rail, collapse and the
 * edge, the stored layout, and the plot's resize count that layout changes must keep at one.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  type LayoutState,
} from '../../src/explore/layout-defaults';

/** The structure section of the sidebar: the docked viewer, or its empty footer. */
export function structurePanel(page: Page): Locator {
  return page.locator('[data-workbench="structure"]');
}

/** Drags the divider between the legend and the structure by `dy` pixels and releases it. */
export async function dragDivider(page: Page, dy: number): Promise<void> {
  const box = await page
    .getByRole('separator', { name: 'Resize legend and structure' })
    .boundingBox();
  if (!box) throw new Error('The legend/structure divider is not shown');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Mol*'s global, with a viewer that loads nothing and draws nothing. */
const MOLSTAR_STUB = `window.molstar = { Viewer: { create: async () => ({
  plugin: { representation: { structure: { themes: { colorThemeRegistry: { add() {} } } } } },
  loadStructureFromUrl: async () => {},
  dispose() {},
}) } };`;

const ANY_ORIGIN = { 'access-control-allow-origin': '*' };

/**
 * Answers the structure viewer's requests (AlphaFold's prediction, model file and TED domains,
 * and the Mol* bundle) offline, so a structure "loads" every time and Mol* mounts a viewer that
 * draws nothing. Specs assert where the viewer is and what it holds, never its 3D picture.
 */
export async function stubStructureRequests(page: Page): Promise<void> {
  await page.route('https://www.alphafold.ebi.ac.uk/api/prediction/**', (route) =>
    route.fulfill({
      headers: ANY_ORIGIN,
      json: [{ cifUrl: 'https://alphafold.ebi.ac.uk/files/stub-model.cif', modelVersion: 4 }],
    }),
  );
  await page.route('https://alphafold.ebi.ac.uk/files/**', (route) =>
    route.fulfill({ headers: ANY_ORIGIN, contentType: 'text/plain', body: 'data_stub\n' }),
  );
  await page.route('https://alphafold.ebi.ac.uk/api/domains/**', (route) =>
    route.fulfill({ headers: ANY_ORIGIN, json: { annotations: [] } }),
  );
  await page.route('https://cdn.jsdelivr.net/npm/molstar@*/build/viewer/molstar.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: MOLSTAR_STUB }),
  );
  await page.route('https://cdn.jsdelivr.net/npm/molstar@*/build/viewer/molstar.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
}

/**
 * Clicks the protein nearest the middle of the plot, clear of the tool strip and the status
 * corner, and returns its id.
 */
export async function clickProteinNearPlotCentre(page: Page): Promise<string> {
  const target = await page.locator('#myPlot').evaluate((element) => {
    const plot = element as HTMLElement & {
      _plotData: { length: number; xs: ArrayLike<number>; ys: ArrayLike<number> };
      dataToClient(x: number, y: number): { x: number; y: number } | null;
      pickInteractivePointAt(x: number, y: number): { id: string } | null;
    };
    const rect = plot.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    let best: { id: string; x: number; y: number; distance: number } | null = null;
    for (let slot = 0; slot < plot._plotData.length; slot++) {
      const at = plot.dataToClient(plot._plotData.xs[slot], plot._plotData.ys[slot]);
      if (!at) continue;
      const distance = Math.hypot(at.x - centreX, at.y - centreY);
      if (best && distance >= best.distance) continue;
      // What a click there picks: the topmost interactive protein, not always this slot's.
      const hit = plot.pickInteractivePointAt(at.x - rect.left, at.y - rect.top);
      if (hit) best = { id: hit.id, x: at.x, y: at.y, distance };
    }
    if (!best) throw new Error('No protein to click on the plot');
    return best;
  });
  await page.mouse.click(target.x, target.y);
  return target.id;
}

/**
 * Starts counting changes of `#myPlot`'s size; the returned function reads the count. A layout
 * change that moves only panels must leave it at 0 (design decision 4).
 */
export async function watchPlotResizes(page: Page): Promise<() => Promise<number>> {
  const counter = await page.locator('#myPlot').evaluateHandle((plot) => {
    const size = () => `${plot.clientWidth}x${plot.clientHeight}`;
    const state = { count: 0, last: size() };
    new ResizeObserver(() => {
      const next = size();
      if (next === state.last) return;
      state.last = next;
      state.count++;
    }).observe(plot);
    return state;
  });
  return () => counter.evaluate((state) => state.count);
}

/** The icon rail at the sidebar's right edge. */
export function rail(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Panels' });
}

/** Collapses the sidebar from the rail and waits until its slide has ended. */
export async function collapseSidebar(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'collapsed');
}

/** Expands the sidebar from the rail and waits until it is open and the plot has narrowed. */
export async function expandSidebar(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'open');
}

/** Drags the sidebar's left edge by `dx` pixels (negative widens the sidebar) and releases it. */
export async function dragSidebarEdge(page: Page, dx: number): Promise<void> {
  const box = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox();
  if (!box) throw new Error('The sidebar edge is not shown');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

/** Stores `patch` over the default layout before every navigation of `page`. */
export async function seedLayout(page: Page, patch: Partial<LayoutState>): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: LAYOUT_STORAGE_KEY,
    value: JSON.stringify({ ...DEFAULT_LAYOUT, ...patch }),
  });
}

/** The layout protspace:layout:v1 holds, or null when nothing readable is stored. */
export async function readLayout(page: Page): Promise<LayoutState | null> {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as LayoutState);
    } catch {
      return null;
    }
  }, LAYOUT_STORAGE_KEY);
}
