import { expect, type Locator, type Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';
import { around } from './clip';
import { PLA2, THREE_FINGER } from './demo';
import { EXAMPLE_MANIFEST } from '../../../apps/web/src/explore/example-manifest';
import {
  chooseTool,
  clickLegendItem,
  plotArea,
  selectProjection,
  selectionBar,
  selectionBarAction,
  statusChip,
  toolButton,
  viewBar,
} from '../../../apps/web/tests/helpers/explore';
import {
  closeLegendSettings,
  legendRowValues,
  legendValueContaining,
  toggleLegendSetting,
} from '../../../apps/web/tests/helpers/legend';
import { plotTooltip, type Point } from '../../../apps/web/tests/helpers/mobile';
import { clickProteinNearPlotCentre } from '../../../apps/web/tests/helpers/workbench';
import {
  clusterScreenPoints,
  duplicateStacks,
  emptyScreenPointNear,
} from '../../../apps/web/tests/helpers/plot';

/**
 * Where the zoom GIF zooms: empty plot next to the centre of the demo's three-finger toxins, so
 * the wheel anchors on the cluster and the pointer opens no protein tooltip over it.
 */
async function zoomTarget(page: Page): Promise<{ x: number; y: number }> {
  const points = await clusterScreenPoints(page, 'three-finger toxin');
  if (points.length === 0) throw new Error('No three-finger toxin points on the demo plot');
  const centre = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  return emptyScreenPointNear(page, centre);
}

/** Wheel steps of a smooth zoom, 50 ms apart; negative `delta` zooms in. */
async function wheel(page: Page, cap: CaptureApi, delta: number): Promise<void> {
  for (let step = 0; step < 20; step++) {
    await page.mouse.wheel(0, delta);
    await cap.hold(50);
  }
}

// ─── Selection, duplicates and the plot's own chrome (Task 7.11) ───────────────

/** A plotted point of `value`'s cluster nearest the cluster's median, in client pixels. */
async function clusterMiddle(page: Page, value: string): Promise<Point> {
  const points = await clusterScreenPoints(page, value, 400);
  if (points.length === 0) throw new Error(`No plotted protein of "${value}"`);
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const mid = Math.floor(points.length / 2);
  const target = { x: xs[mid], y: ys[mid] };
  const distance = (p: Point) => Math.hypot(p.x - target.x, p.y - target.y);
  return points.reduce((best, p) => (distance(p) < distance(best) ? p : best));
}

/**
 * A drag that boxes `value`'s cluster with a 20 px margin, kept clear of the tool strip (left
 * 72 px) and the status corner and selection bar (bottom 56 px).
 */
async function clusterBox(page: Page, value: string): Promise<{ from: Point; to: Point }> {
  const points = await clusterScreenPoints(page, value, 400);
  if (points.length === 0) throw new Error(`No plotted protein of "${value}"`);
  const plot = await plotArea(page).boundingBox();
  if (!plot) throw new Error('The plot area is not shown');
  const pad = 20;
  const clampX = (x: number) => Math.min(Math.max(x, plot.x + 72), plot.x + plot.width - 8);
  const clampY = (y: number) => Math.min(Math.max(y, plot.y + 8), plot.y + plot.height - 56);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    from: { x: clampX(Math.min(...xs) - pad), y: clampY(Math.min(...ys) - pad) },
    to: { x: clampX(Math.max(...xs) + pad), y: clampY(Math.max(...ys) + pad) },
  };
}

/** The selection bar's count reads `text` (its visible count span is aria-hidden). */
async function expectSelected(page: Page, text: string): Promise<void> {
  await expect(selectionBar(page)).toContainText(text);
}

/** The modifier that adds a protein to the selection: the app accepts ⌘ or Ctrl on a click. */
const ADD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';
/**
 * One neutral caption: the page runs Desktop Chrome's Windows user agent, so the app's own keycaps
 * read Ctrl, while a GIF made on a Mac would otherwise say ⌘.
 */
const ADD_LABEL = 'Ctrl/⌘ + click';

async function selectSingleSteps(page: Page, cap: CaptureApi): Promise<void> {
  const third = (await legendRowValues(page)).find(
    (v) =>
      v !== 'Other' &&
      v !== '__NA__' &&
      !v.toLowerCase().includes(PLA2.toLowerCase()) &&
      !v.toLowerCase().includes(THREE_FINGER.toLowerCase()),
  );
  if (!third) throw new Error('The legend has no third family to select from');
  const first = await clusterMiddle(page, PLA2);
  const second = await clusterMiddle(page, THREE_FINGER);
  const last = await clusterMiddle(page, third);

  await cap.hold(500);
  await cap.moveTo(first, { steps: 15 });
  await cap.hold(300);
  await cap.click(first, { label: 'Click' });
  await expectSelected(page, '1 protein selected');
  await cap.hold(1200);

  for (const [point, count] of [
    [second, '2 proteins selected'],
    [last, '3 proteins selected'],
  ] as const) {
    await cap.moveTo(point, { steps: 15 });
    await cap.hold(300);
    await page.keyboard.down(ADD_KEY);
    await cap.click(point, { label: ADD_LABEL });
    await page.keyboard.up(ADD_KEY);
    await expectSelected(page, count);
    await cap.hold(1200);
  }

  await cap.press('Escape', { label: 'Esc' });
  await expect(selectionBar(page)).toBeHidden();
  await cap.hold(1000);
}

async function selectBoxSteps(page: Page, cap: CaptureApi): Promise<void> {
  const boxTool = toolButton(page, 'Box select');
  await cap.hold(500);
  await cap.moveTo(boxTool, { steps: 15 });
  await cap.click(boxTool, { label: 'Box select' });
  await expect(boxTool).toHaveAttribute('aria-pressed', 'true');
  await cap.hold(500);

  const area = await clusterBox(page, PLA2);
  await cap.moveTo(area.from, { steps: 15 });
  await cap.hold(300);
  await cap.drag(area.from, area.to, { steps: 30 });
  await expect(selectionBar(page)).toBeVisible();
  await cap.hold(1500);

  const showOnly = selectionBarAction(page, 'Show only these');
  await cap.moveTo(showOnly, { steps: 15 });
  await cap.click(showOnly, { label: 'Show only these' });
  await expect(statusChip(page, 'isolation')).toBeVisible();
  await cap.hold(1500);

  const showAll = statusChip(page, 'isolation').getByRole('button', {
    name: 'Show all proteins',
    exact: true,
  });
  await cap.moveTo(showAll, { steps: 15 });
  await cap.click(showAll, { label: 'Show all proteins' });
  await expect(statusChip(page, 'isolation')).toHaveCount(0);
  await cap.hold(1000);
}

/** PCA stacks identical projections densely enough to badge; the badges are a legend setting. */
async function duplicateBadgesSetup(page: Page, cap: CaptureApi): Promise<void> {
  const pca = EXAMPLE_MANIFEST.examples.demo.projections.find((name) => name.includes('PCA'));
  if (!pca) throw new Error('The demo has no PCA projection');
  await selectProjection(page, pca);
  await toggleLegendSetting(page, 'Show duplicate counts and spread overlaps');
  await closeLegendSettings(page);
  await expect.poll(async () => (await duplicateStacks(page)).length).toBeGreaterThan(0);
  // Escape leaves focus, and so its tooltip, on the Legend settings button: a click on empty plot
  // beside the stack takes both away before the trim.
  await cap.click((await duplicateAnchor(page)).zoomAt);
}

/** How far from its stack the zoom may anchor: the zoom pushes the stack away by this times its factor. */
const ZOOM_OFFSET_PX = 24;

/**
 * The largest stack nearest the median of all stacks, so it sits inside the cluster mass, among
 * those with empty plot within ZOOM_OFFSET_PX: the zoom anchors there, since a pointer resting on
 * the stack's own point would keep its tooltip over the stack for the whole zoom.
 */
async function duplicateAnchor(
  page: Page,
): Promise<{ key: string; x: number; y: number; count: number; zoomAt: Point }> {
  const stacks = await duplicateStacks(page);
  const xs = stacks.map((s) => s.x).sort((a, b) => a - b);
  const ys = stacks.map((s) => s.y).sort((a, b) => a - b);
  const mid = { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
  const ranked = [...stacks].sort(
    (a, b) =>
      b.count - a.count ||
      Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y),
  );
  for (const stack of ranked) {
    const zoomAt = await emptyScreenPointNear(page, stack, ZOOM_OFFSET_PX).catch(() => null);
    if (zoomAt) return { ...stack, zoomAt };
  }
  throw new Error(`No duplicate stack has empty plot within ${ZOOM_OFFSET_PX}px`);
}

async function duplicateBadgesSteps(page: Page, cap: CaptureApi): Promise<void> {
  const anchor = await duplicateAnchor(page);

  await cap.hold(300);
  await cap.moveTo(anchor.zoomAt, { steps: 20 });
  await cap.hold(300);
  // The zoom keys off the pointer, which now rests beside the stack.
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -50);
    await cap.hold(50);
  }
  // Stacks are rebuilt on every zoom; read the anchor's new position once it is back.
  const findAnchor = async () => (await duplicateStacks(page)).find((s) => s.key === anchor.key);
  await expect.poll(async () => (await findAnchor()) !== undefined).toBe(true);
  const target = await findAnchor();
  if (!target) throw new Error(`Stack ${anchor.key} dropped during the zoom`);
  await cap.hold(300);

  await cap.moveTo(target, { steps: 8 });
  await cap.click(target, { label: 'Click' });
  const nodes = page.locator('#myPlot .dup-spiderfy-node-circle');
  await expect(nodes.first()).toBeVisible();
  await cap.hold(600);

  // The spider node farthest from the badge, which sits at (+10, −10) px from the stack.
  const badge = { x: target.x + 10, y: target.y - 10 };
  let farthest: Point | null = null;
  let farthestDistance = -1;
  for (let i = 0; i < (await nodes.count()); i++) {
    const box = await nodes.nth(i).boundingBox();
    if (!box) continue;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const distance = Math.hypot(centre.x - badge.x, centre.y - badge.y);
    if (distance > farthestDistance) [farthest, farthestDistance] = [centre, distance];
  }
  if (!farthest) throw new Error('The spider opened with no node on screen');
  await cap.moveTo(farthest, { steps: 10 });
  await cap.click(farthest, { label: 'Click' });
  await expectSelected(page, '1 protein selected');
  await cap.hold(1200);

  // The badge collapses the spider; the click lands outside the stacked point's hit radius.
  await cap.moveTo(badge, { steps: 6 });
  await cap.click(badge, { label: 'Click' });
  await expect(nodes).toHaveCount(0);
  await cap.hold(600);
}

/** The tool strip with Box select on, the selection bar, and a "1 category hidden" chip. */
async function plotChromeSteps(page: Page, cap: CaptureApi): Promise<void> {
  await chooseTool(page, 'Box select');
  const area = await clusterBox(page, PLA2);
  await cap.drag(area.from, area.to, { steps: 10 });
  await expect(selectionBar(page)).toBeVisible();
  await clickLegendItem(page, await legendValueContaining(page, THREE_FINGER));
  await expect(statusChip(page, 'hidden')).toBeVisible();
}

const projectionCard = (page: Page): Locator =>
  page.locator('#myProjectionMetadata #projection-metadata-content');

/**
 * A click pins a protein's tooltip with "View structure" while the docked structure is folded
 * away with the sidebar; hovering the projection details button then opens its card. A pinned
 * tooltip survives the pointer leaving the plot (only a press outside ends it).
 */
async function tooltipCardSteps(page: Page, cap: CaptureApi): Promise<void> {
  await clickProteinNearPlotCentre(page);
  await expect(plotTooltip(page).getByRole('button', { name: 'View structure' })).toBeVisible();
  const trigger = viewBar(page).getByRole('button', {
    name: 'View projection metadata',
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await cap.moveTo(trigger, { steps: 1 });
  await expect(projectionCard(page)).toBeVisible();
}

/** The scatterplot page's captures (docs/explore/scatterplot.md). */
export const SCATTERPLOT_CAPTURES: CaptureEntry[] = [
  {
    // Zoom in on a cluster with the wheel, drag to pan, and zoom back out.
    name: 'zoom',
    kind: 'gif',
    viewport: 'desktop',
    // The pointer starts on the target, before the trim: it never flies in from the corner.
    setup: async (page, cap) => {
      await cap.moveTo(await zoomTarget(page));
    },
    steps: async (page, cap) => {
      const target = await zoomTarget(page);
      await cap.hold(800);
      await cap.label('Scroll to zoom');
      await wheel(page, cap, -50);
      await cap.hold(1000);
      await cap.label('Drag to pan');
      // Right and down, towards the plot centre: the cluster sits on the plot's left.
      const panned = { x: target.x + 160, y: target.y + 90 };
      await cap.drag(target, panned, { steps: 30 });
      await cap.hold(1000);
      await wheel(page, cap, 50);
      await cap.hold(1000);
    },
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'select-single',
    kind: 'gif',
    viewport: 'desktop',
    steps: selectSingleSteps,
    timeoutMs: 120_000,
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'select-box',
    kind: 'gif',
    viewport: 'desktop',
    steps: selectBoxSteps,
    timeoutMs: 120_000,
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'duplicate-badges',
    kind: 'gif',
    viewport: 'desktop',
    gif: { fps: 20, width: 800 },
    setup: duplicateBadgesSetup,
    steps: duplicateBadgesSteps,
    timeoutMs: 120_000,
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'plot-tools-selection-bar',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: plotChromeSteps,
    target: (page) => plotArea(page),
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'tooltip-projection-card',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    layout: { sidebarOpen: false },
    steps: tooltipCardSteps,
    target: (page) =>
      around(
        [
          plotTooltip(page),
          projectionCard(page),
          viewBar(page).getByRole('button', { name: 'View projection metadata', exact: true }),
        ],
        16,
      ),
    keepPointer: true,
    docs: ['explore/scatterplot.md'],
  },
];
