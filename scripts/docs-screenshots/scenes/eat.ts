/**
 * Captures for docs/explore/eat.md, on the Snake three-finger toxins example, which opens coloured
 * by toxin_class with every transfer shown and the reliability filter at 0. The product demo has
 * no transferred annotations. Needs `pnpm examples:fetch` (a release asset).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { plotArea, selectionBar } from '../../../apps/web/tests/helpers/explore';
import { legend } from '../../../apps/web/tests/helpers/legend';
import {
  emptyScreenPointNear,
  plotSettled,
  proteinScreenPosition,
  provenancePair,
} from '../../../apps/web/tests/helpers/plot';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

const DATASET = 'three-finger-toxins';
const ANNOTATION = 'toxin_class';
/**
 * How far both clicked proteins stand from every other one. The workbench's 1280×720 plot packs
 * the islands too tight for the helper's 4 px; a click picks the nearest protein, and the scene's
 * connector counts fail the capture if it picks a neighbour.
 */
const CLEARANCE_PX = 2;
/** Wheel steps of the connectors GIF's zoom, before its recording starts. */
const ZOOM_STEPS = 12;

type Pair = Awaited<ReturnType<typeof provenancePair>>;
/** The connectors GIF's pair per page: picked in setup, before the zoom, and clicked in steps. */
const pairs = new WeakMap<Page, Pair>();

const eatSection = (page: Page): Locator =>
  legend(page).getByRole('region', { name: 'Embedding Annotation Transfer' });
const reliabilityPercent = (page: Page): Locator =>
  eatSection(page).getByRole('spinbutton', { name: 'EAT reliability filter percentage' });
const connectors = (page: Page): Locator =>
  page.locator('#myPlot').locator('line.eat-provenance-connector');

/** A spot to rest the pointer between clicks: the plot's right margin, clear of the points. */
async function restingSpot(page: Page): Promise<{ x: number; y: number }> {
  const box = await plotArea(page).boundingBox();
  if (!box) throw new Error('The plot area has no box');
  return emptyScreenPointNear(page, { x: box.x + box.width - 48, y: box.y + box.height / 2 });
}

/**
 * Wheels the plot in by `steps` around the empty spot nearest `at`, then rests the pointer in the
 * margin. Each wheel event is one zoom step: Playwright dispatches them one at a time.
 */
async function zoomAround(
  page: Page,
  cap: CaptureApi,
  at: { x: number; y: number },
  steps: number,
): Promise<void> {
  await cap.moveTo(await emptyScreenPointNear(page, at), { steps: 15 });
  for (let step = 0; step < steps; step++) await page.mouse.wheel(0, -50);
  await plotSettled(page);
  await cap.moveTo(await restingSpot(page), { steps: 15 });
}

export const EAT_CAPTURES: CaptureEntry[] = [
  {
    name: 'eat-legend-section',
    kind: 'png',
    viewport: 'desktop',
    dataset: DATASET,
    docs: ['explore/eat.md'],
    steps: async (page) => {
      // The counts row renders a frame after the section itself.
      await expect(
        eatSection(page).getByRole('region', { name: 'Transferred annotation counts' }),
      ).toBeVisible();
    },
    target: (page) => eatSection(page),
  },
  {
    name: 'eat-connectors',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    timeoutMs: 120_000,
    docs: ['explore/eat.md'],
    setup: async (page, cap) => {
      const pair = await provenancePair(page, ANNOTATION, { clearancePx: CLEARANCE_PX });
      pairs.set(page, pair);
      // Zoom in around the pair, so the lines are long enough to read in the docs column.
      const sourceAt = await proteinScreenPosition(page, pair.source);
      const targetAt = await proteinScreenPosition(page, pair.target);
      const between = { x: (sourceAt.x + targetAt.x) / 2, y: (sourceAt.y + targetAt.y) / 2 };
      await zoomAround(page, cap, between, ZOOM_STEPS);
    },
    steps: async (page, cap) => {
      const pair = pairs.get(page);
      if (!pair) throw new Error('eat-connectors: setup picks the pair');
      const { source, target, dependantCount } = pair;
      const rest = await restingSpot(page);

      // One transferred protein: a single dashed line back to its source.
      const targetAt = await proteinScreenPosition(page, target);
      await cap.moveTo(targetAt, { steps: 15 });
      await cap.click(targetAt, { label: 'Click a transferred protein' });
      await expect(connectors(page)).toHaveCount(1);
      await cap.moveTo(rest, { steps: 12 });
      await cap.hold(1600);

      // Read now: the plot did not move, but a stale read is the one thing that can land a
      // click on a neighbour.
      const sourceAt = await proteinScreenPosition(page, source);
      await cap.moveTo(sourceAt, { steps: 15 });
      await cap.click(sourceAt, { label: 'Click its source' });
      await expect(connectors(page)).toHaveCount(dependantCount);
      await cap.moveTo(rest, { steps: 12 });
      await cap.hold(1600);

      // Escape steps back one layer at a time: the lines first, then the selection.
      await cap.press('Escape', { label: 'Esc clears the lines' });
      await expect(connectors(page)).toHaveCount(0);
      await cap.hold(1200);
      await cap.press('Escape', { label: 'Esc again clears the selection' });
      await expect(selectionBar(page)).toBeHidden();
      await cap.hold(1200);
    },
  },
  {
    name: 'eat-reliability',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    docs: ['explore/eat.md'],
    setup: async (page, cap) => {
      // Zoom in on the biggest group of transferred proteins, so the rings the filter removes
      // are large enough to see in the docs column. Clearance 0: only the spot matters here.
      const { source } = await provenancePair(page, ANNOTATION, { clearancePx: 0 });
      await zoomAround(page, cap, await proteinScreenPosition(page, source), ZOOM_STEPS / 2);
      // Rest in the gap left of the % box, so the cursor never covers the number it changes.
      const box = await reliabilityPercent(page).boundingBox();
      if (!box) throw new Error('The reliability percentage has no box');
      await cap.moveTo({ x: box.x - 40, y: box.y + box.height / 2 }, { steps: 15 });
    },
    steps: async (page, cap) => {
      const percent = reliabilityPercent(page);
      // Up in stages, so the rings thin out visibly rather than snapping to the end state.
      for (const value of ['40', '70', '90']) {
        await cap.label(`Hide below ${value}%`);
        await percent.fill(value);
        await cap.press('Enter');
        await plotSettled(page);
        await cap.hold(1000);
      }
      await cap.hold(600);
      // Back to 0: every prediction returns and the filter condition is removed.
      await cap.label('Back to 0%');
      await percent.fill('0');
      await cap.press('Enter');
      await plotSettled(page);
      await cap.hold(1600);
    },
  },
];
