import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY } from '../src/explore/layout-defaults';
import {
  clickProteinNearPlotCentre,
  collapseSidebar,
  dragSidebarEdge,
  expandSidebar,
  exportMenu,
  importMenu,
  openExplore,
  openExportMenu,
  openImportMenu,
  rail,
  readLayout,
  seedLayout,
  sidebar,
  structurePanel,
  stubStructureRequests,
  waitForExploreDataLoad,
  watchPlotResizes,
} from './helpers/explore';

const workbench = (page: Page) => page.locator('.workbench');
const edge = (page: Page) => page.getByRole('separator', { name: 'Resize sidebar' });

function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Renders the plot has drawn, from the perf counters (`?perfCounters=1`). */
function renders(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __protspacePerfCounters: { render: number } }).__protspacePerfCounters
        .render,
  );
}

/** The render count once it has stopped moving, so a test's own renders start from rest. */
async function settledRenders(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await renders(page);
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [300] },
    )
    .toBe(true);
  return last;
}

/** Both resizes of a toggle, each with one render: collapse, then expand back. */
async function expectOneResizePerToggle(page: Page): Promise<void> {
  const plot = page.locator('#myPlot');
  const open = (await plot.boundingBox())!;
  const resizes = await watchPlotResizes(page);
  const before = await settledRenders(page);

  await collapseSidebar(page);
  expectNear((await plot.boundingBox())!.width - open.width, DEFAULT_LAYOUT.sidebarWidth);
  // Read the resize count once things are still: its observer reports a frame after the change.
  const collapsed = await settledRenders(page);
  expect(await resizes()).toBe(1);
  expect(collapsed - before).toBe(1);

  await expandSidebar(page);
  expect(await plot.boundingBox()).toEqual(open);
  const expanded = await settledRenders(page);
  expect(await resizes()).toBe(2);
  expect(expanded - collapsed).toBe(1);
}

type PlotProbe = HTMLElement & {
  _plotData: {
    length: number;
    xs: ArrayLike<number>;
    ys: ArrayLike<number>;
    proteinIds: string[];
    originalIndices: ArrayLike<number> | null;
  };
  _scales: { x(value: number): number };
  _transform: { k: number };
  dataToClient(x: number, y: number): { x: number; y: number } | null;
  getProteinClientPosition(id: string): { x: number; y: number } | null;
};

/** The protein drawn nearest the plot's centre, its offset from the centre, and px per data unit. */
function centreProtein(page: Page) {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as PlotProbe;
    const rect = plot.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    let best = { slot: -1, dx: 0, dy: 0, distance: Infinity };
    for (let slot = 0; slot < plot._plotData.length; slot++) {
      const at = plot.dataToClient(plot._plotData.xs[slot], plot._plotData.ys[slot]);
      if (!at) continue;
      const distance = Math.hypot(at.x - centreX, at.y - centreY);
      if (distance < best.distance)
        best = { slot, dx: at.x - centreX, dy: at.y - centreY, distance };
    }
    const index = plot._plotData.originalIndices?.[best.slot] ?? best.slot;
    return {
      id: plot._plotData.proteinIds[index],
      dx: best.dx,
      dy: best.dy,
      scale: (plot._scales.x(1) - plot._scales.x(0)) * plot._transform.k,
    };
  });
}

/** Where `id` is drawn now, relative to the plot's centre, and px per data unit. */
function offsetOf(page: Page, id: string) {
  return page.locator('#myPlot').evaluate((element, proteinId) => {
    const plot = element as PlotProbe;
    const rect = plot.getBoundingClientRect();
    const at = plot.getProteinClientPosition(proteinId)!;
    return {
      dx: at.x - (rect.left + rect.width / 2),
      dy: at.y - (rect.top + rect.height / 2),
      scale: (plot._scales.x(1) - plot._scales.x(0)) * plot._transform.k,
    };
  }, id);
}

test('the rail keeps Legend, Structure and Collapse sidebar, named for assistive tech, when collapsed', async ({
  page,
}) => {
  await openExplore(page);
  const panels = rail(page);
  const legend = panels.getByRole('button', { name: 'Legend', exact: true });
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await expect(
    panels.getByRole('button', { name: 'Structure: click a protein to view it' }),
  ).toBeDisabled();
  await expect(panels.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await collapseSidebar(page);

  await expect(panels).toBeVisible();
  expectNear((await panels.boundingBox())!.width, 44);
  await expect(legend).toHaveAttribute('aria-pressed', 'false');
  await expect(
    panels.getByRole('button', { name: 'Structure: click a protein to view it' }),
  ).toBeVisible();
  await expect(panels.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(sidebar(page)).toHaveAttribute('inert', '');
  await expect(page.locator('#myLegend')).toBeHidden();
  await expect(edge(page)).toBeHidden();

  // Legend opens the sidebar again.
  await legend.click();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(page.locator('#myLegend')).toBeVisible();
});

test('collapsing widens #myPlot by the sidebar width with one render, and expanding narrows it with one', async ({
  page,
}) => {
  await openExplore(page, '?perfCounters=1');
  await expectOneResizePerToggle(page);
});

test('with reduced motion, collapse and expand still resize the plot once each', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExplore(page, '?perfCounters=1');
  await expectOneResizePerToggle(page);
});

test('dragging the edge previews over the plot and resizes it once on release, clamped to 240–480', async ({
  page,
}) => {
  await openExplore(page);
  const plot = page.locator('#myPlot');
  const start = (await plot.boundingBox())!;
  const resizes = await watchPlotResizes(page);
  const box = (await edge(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 10 });
  // Mid-drag the sidebar is wider, over the plot; the plot itself has not changed.
  await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBe(400);
  expect(await plot.boundingBox()).toEqual(start);
  expect(await resizes()).toBe(0);
  await page.mouse.up();

  await expect.poll(async () => (await plot.boundingBox())!.width).toBe(start.width - 100);
  // The resize observer reports a frame after the change.
  await expect.poll(resizes).toBe(1);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '400');
  expect((await readLayout(page))?.sidebarWidth).toBe(400);
  expect(await resizes()).toBe(1);

  await dragSidebarEdge(page, -300);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '480');
  await dragSidebarEdge(page, 400);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '240');
  expect((await readLayout(page))?.sidebarWidth).toBe(240);
});

test('the edge separator moves by keyboard and commits once', async ({ page }) => {
  await openExplore(page);
  const resizes = await watchPlotResizes(page);
  await edge(page).focus();

  // A held key repeats keydown; the width is written once, on keyup.
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowLeft');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '348');
  expect(await resizes()).toBe(0);
  await page.keyboard.up('ArrowLeft');
  await expect.poll(resizes).toBe(1);
  expect((await readLayout(page))?.sidebarWidth).toBe(348);

  // Each press commits once. Wait for each resize: two commits in one frame would show as one.
  await page.keyboard.press('End');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '480');
  await expect.poll(resizes).toBe(2);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '416');
  await expect.poll(resizes).toBe(3);
  await page.keyboard.press('Home');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '240');
  await expect.poll(resizes).toBe(4);

  // Enter collapses; focus moves to the control that brings the sidebar back.
  await page.keyboard.press('Enter');
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'collapsed');
  await expect(rail(page).getByRole('button', { name: 'Expand sidebar' })).toBeFocused();
});

test('width and collapsed state survive a reload, and layout never reaches the URL', async ({
  page,
}) => {
  await openExplore(page);
  await dragSidebarEdge(page, -60);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '360');
  await collapseSidebar(page);
  expect(await readLayout(page)).toMatchObject({ sidebarWidth: 360, sidebarOpen: false });

  await page.reload();
  await waitForExploreDataLoad(page);
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'collapsed');
  await expandSidebar(page);
  expectNear((await sidebar(page).boundingBox())!.width, 360);

  const url = new URL(page.url());
  const allowed = ['dataset', 'annotation', 'projection', 'tooltip', 'density'];
  expect([...url.searchParams.keys()].filter((key) => !allowed.includes(key))).toEqual([]);
  expect(url.href).not.toMatch(/sidebar|layout|legendFraction|floating/i);
});

test('a corrupt or oversized stored layout loads safely', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, '{"sidebarWidth": "wide", oops'),
    LAYOUT_STORAGE_KEY,
  );
  await openExplore(page);
  expectNear((await sidebar(page).boundingBox())!.width, DEFAULT_LAYOUT.sidebarWidth);
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  expect(errors).toEqual([]);

  // Init scripts run in order on every navigation: this one now wins.
  await seedLayout(page, { sidebarWidth: 480 });
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.reload();
  await waitForExploreDataLoad(page);
  expect((await page.locator('#myPlot').boundingBox())!.width).toBeGreaterThanOrEqual(480);
  expectNear((await sidebar(page).boundingBox())!.width, 476);
  // Clamping at render never rewrites what the user stored.
  expect((await readLayout(page))?.sidebarWidth).toBe(480);
  expect(errors).toEqual([]);
});

test('a zoomed-in view keeps its centre protein across collapse and expand', async ({ page }) => {
  await openExplore(page);
  const box = (await page.locator('#myPlot').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -240);
  await expect
    .poll(() => page.locator('#myPlot').evaluate((plot) => (plot as PlotProbe)._transform.k))
    .toBeGreaterThan(2);
  const start = await centreProtein(page);

  await collapseSidebar(page);
  const collapsed = await offsetOf(page, start.id);
  // The data at the centre stays at the centre; offsets from it scale with the fit.
  const ratio = collapsed.scale / start.scale;
  expectNear(collapsed.dx, start.dx * ratio, 2);
  expectNear(collapsed.dy, start.dy * ratio, 2);

  await expandSidebar(page);
  const back = await offsetOf(page, start.id);
  expectNear(back.dx, start.dx, 2);
  expectNear(back.dy, start.dy, 2);
});

test('the legend settings dialog is fully visible after collapse and expand', async ({ page }) => {
  await openExplore(page);
  await collapseSidebar(page);
  await expandSidebar(page);

  await page.locator('protspace-legend').getByRole('button', { name: 'Legend settings' }).click();
  const overlay = page.locator('protspace-legend .modal-overlay');
  await expect(overlay).toBeVisible();
  // position: fixed; inset: 0 covers the viewport only while no ancestor keeps a transform.
  const viewport = page.viewportSize()!;
  expect(await overlay.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  // Nothing of the shell paints over it: not the rail, not the structure footer under the legend.
  for (const [x, y] of [
    [viewport.width - 22, viewport.height / 2],
    [viewport.width - 200, viewport.height - 22],
  ]) {
    const legendOnTop = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px, py) === document.querySelector('protspace-legend'),
      [x, y],
    );
    expect(legendOnTop, `${x},${y}`).toBe(true);
  }
  await page.keyboard.press('Escape');
});

test('a protein clicked while collapsed waits behind the Structure dot; Structure opens the sidebar and loads it', async ({
  page,
}) => {
  await stubStructureRequests(page);
  await openExplore(page);
  await collapseSidebar(page);

  const id = await clickProteinNearPlotCentre(page);

  const structure = rail(page).getByRole('button', { name: `Structure: ${id}` });
  await expect(structure).toBeEnabled();
  await expect(rail(page).locator('[data-workbench="structure-dot"]')).toBeVisible();
  // Hidden structures load nothing.
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);

  await structure.click();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', id);
  await expect(page.locator('#myStructureViewer')).toBeVisible();
});

/**
 * Whether `locator`'s element is the topmost thing painted at its centre and across its box (a 3×3
 * grid 8 px inside its edges), looking through every shadow root on the way down.
 */
function isTopmost(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const xs = [box.left + 8, box.left + box.width / 2, box.right - 8];
    const ys = [box.top + 8, box.top + box.height / 2, box.bottom - 8];
    return xs.every((x) =>
      ys.every((y) => {
        let hit: Element | null = document.elementFromPoint(x, y);
        while (hit?.shadowRoot) {
          const inner = hit.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        return hit !== null && element.contains(hit);
      }),
    );
  });
}

test('with the sidebar open, a legend dialog and the Import and Export panels sit over the shell', async ({
  page,
}) => {
  await stubStructureRequests(page);
  await openExplore(page);
  // A docked structure: the section (z-index 3) sits under the legend, beside the edge and the rail.
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
  await expect(structurePanel(page)).toHaveCSS('z-index', '3');
  await expect(edge(page)).toBeVisible();

  await page.locator('protspace-legend').getByRole('button', { name: 'Legend settings' }).click();
  const overlay = page.locator('protspace-legend .modal-overlay');
  await expect(overlay).toBeVisible();
  const viewport = page.viewportSize()!;
  expect(await overlay.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  const dialog = overlay.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  expect(await isTopmost(dialog)).toBe(true);
  // The overlay covers the rail, the edge and the docked structure too.
  const shellPoints = await Promise.all(
    [rail(page), edge(page), structurePanel(page)].map(async (part) => {
      const box = (await part.boundingBox())!;
      return [box.x + box.width / 2, box.y + box.height / 2] as const;
    }),
  );
  for (const [x, y] of shellPoints) {
    const legendOnTop = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px, py) === document.querySelector('protspace-legend'),
      [x, y],
    );
    expect(legendOnTop, `${x},${y}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  for (const [open, menu] of [
    [openImportMenu, importMenu],
    [openExportMenu, exportMenu],
  ] as const) {
    await open(page);
    const panel = menu(page).locator('.panel');
    const box = (await panel.boundingBox())!;
    // The panel reaches over the sidebar column, and nothing of the shell paints over it.
    const sidebarBox = (await sidebar(page).boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(sidebarBox.x);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await isTopmost(panel)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});
