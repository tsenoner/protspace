/**
 * Captures for docs/explore/eat.md, on the Snake three-finger toxins example, which opens coloured
 * by toxin_class with every transfer shown and the reliability range at 0–100 %. The product demo
 * has no transferred annotations. Needs `pnpm examples:fetch` (a release asset).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  filterPanel,
  plotArea,
  selectionBar,
  statusChip,
} from '../../../apps/web/tests/helpers/explore';
import { eatPanel, eatThresholdBox } from '../../../apps/web/tests/helpers/eat';
import { panelTab } from '../../../apps/web/tests/helpers/mobile';
import {
  emptyScreenPointNear,
  plotSettled,
  proteinScreenPosition,
  provenancePair,
} from '../../../apps/web/tests/helpers/plot';
import { rail } from '../../../apps/web/tests/helpers/workbench';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

const DATASET = 'three-finger-toxins';
const ANNOTATION = 'toxin_class';
/** The label the checking GIF opens: most of its members are predicted. */
const CHECKED_LABEL = 'Ancestral / non-conventional';
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

const connectors = (page: Page): Locator =>
  page.locator('#myPlot').locator('line.eat-provenance-connector');
/** The EAT panel's whole section: its header row and the panel under it. */
const eatSection = (page: Page): Locator => page.locator('#wb-eat-panel');
const handle = (page: Page, end: 'Lowest' | 'Highest'): Locator =>
  eatPanel(page).getByRole('slider', { name: `${end} reliability in range`, exact: true });
const outcome = (page: Page, name: 'Hide' | 'Fade'): Locator =>
  eatPanel(page).getByRole('radio', { name, exact: true });
const selectedProtein = (page: Page): Locator =>
  eatPanel(page).getByRole('region', { name: 'Selected protein' });

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

/** Zooms in on the biggest group of predictions, so the rings the range changes are large. */
async function zoomOnPredictions(page: Page, cap: CaptureApi): Promise<void> {
  // Clearance 0: only the spot matters here.
  const { source } = await provenancePair(page, ANNOTATION, { clearancePx: 0 });
  await zoomAround(page, cap, await proteinScreenPosition(page, source), ZOOM_STEPS / 2);
}

/** Types `percent` into the range's low box, as a user does, and waits for the plot. */
async function setLowEnd(page: Page, percent: number): Promise<void> {
  await eatThresholdBox(page).fill(String(percent));
  await eatThresholdBox(page).press('Enter');
  await expect(eatPanel(page).getByText(/^\s*\d+ of 659 predictions in range/)).not.toHaveText(
    /659 of 659/,
  );
  await plotSettled(page);
}

/** Where a range handle's thumb sits for `percent`: the input's track runs inside its thumb. */
async function thumbAt(slider: Locator, percent: number): Promise<{ x: number; y: number }> {
  const box = await slider.boundingBox();
  if (!box) throw new Error('The reliability handle has no box');
  // The thumb is 0.85rem wide; its centre travels between half a thumb from each end.
  const half = 7;
  return {
    x: box.x + half + ((box.width - 2 * half) * percent) / 100,
    y: box.y + box.height / 2,
  };
}

/** The panel's readout, "407 of 659 predictions in range". */
const readout = (page: Page): Locator => eatPanel(page).locator('.eat-readout');

export const EAT_CAPTURES: CaptureEntry[] = [
  {
    // The whole panel, every section on screen: a tall window and the structure hidden.
    name: 'eat-panel',
    kind: 'png',
    viewport: { width: 1280, height: 1130 },
    themes: ['light', 'dark'],
    dataset: DATASET,
    layout: { panel: 'eat', structureHidden: true },
    docs: ['explore/eat.md'],
    steps: async (page) => {
      await expect(eatPanel(page).locator('.eat-label-row').first()).toBeVisible();
      await expect(readout(page)).toHaveText('659 of 659 predictions in range');
    },
    target: (page) => eatSection(page),
  },
  {
    name: 'eat-filter-row',
    kind: 'png',
    viewport: 'desktop',
    dataset: DATASET,
    layout: { panel: 'eat' },
    docs: ['explore/eat.md', 'explore/filter.md'],
    steps: async (page) => {
      await setLowEnd(page, 50);
      await expect(statusChip(page, 'filter')).toBeVisible();
      await rail(page).locator('#wb-rail-filter').getByRole('button').click();
      await expect(filterPanel(page).getByRole('button', { name: /Edit in EAT/ })).toBeVisible();
    },
    target: (page) => filterPanel(page).locator('.condition-row.is-locked'),
  },
  {
    name: 'eat-phone',
    kind: 'png',
    viewport: 'phone',
    dataset: DATASET,
    layout: { panel: 'eat' },
    docs: ['explore/eat.md'],
    steps: async (page) => {
      await expect(panelTab(page, 'EAT')).toHaveAttribute('aria-selected', 'true');
      await expect(eatPanel(page).locator('.eat-histogram')).toBeVisible();
    },
  },
  {
    name: 'eat-range-hide',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    layout: { panel: 'eat' },
    timeoutMs: 120_000,
    docs: ['explore/eat.md'],
    setup: async (page, cap) => {
      await zoomOnPredictions(page, cap);
    },
    steps: async (page, cap) => {
      const low = handle(page, 'Lowest');
      const high = handle(page, 'Highest');
      await cap.hold(600);
      // The low end up: the weakest rings leave the map, the chart's left bars go pale.
      await cap.label('Drag the low end to 50 %');
      await cap.drag(await thumbAt(low, 0), await thumbAt(low, 50), { steps: 40 });
      await expect(readout(page)).toHaveText('407 of 659 predictions in range');
      await plotSettled(page);
      await cap.moveTo(await restingSpot(page), { steps: 15 });
      await cap.hold(1800);
      // The high end down: a band, both ends included.
      await cap.label('Drag the high end to 80 %');
      await cap.drag(await thumbAt(high, 100), await thumbAt(high, 80), { steps: 30 });
      await expect(readout(page)).not.toHaveText('407 of 659 predictions in range');
      await plotSettled(page);
      await cap.moveTo(await restingSpot(page), { steps: 15 });
      await cap.hold(1800);
      // Reset: 0–100 % again, every prediction back.
      await cap.click(page.locator('.wb-eat-reset'), { label: 'Reset' });
      await expect(readout(page)).toHaveText('659 of 659 predictions in range');
      await plotSettled(page);
      await cap.moveTo(await restingSpot(page), { steps: 15 });
      await cap.hold(1600);
    },
  },
  {
    name: 'eat-range-fade',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    layout: { panel: 'eat' },
    timeoutMs: 120_000,
    docs: ['explore/eat.md'],
    setup: async (page, cap) => {
      await setLowEnd(page, 50);
      await zoomOnPredictions(page, cap);
    },
    steps: async (page, cap) => {
      await cap.hold(1200);
      await cap.click(outcome(page, 'Fade'), { label: 'Fade' });
      await expect(outcome(page, 'Fade')).toBeChecked();
      await expect(statusChip(page, 'filter')).toHaveCount(0);
      await expect(statusChip(page, 'eat-dim')).toBeVisible();
      await plotSettled(page);
      await cap.moveTo(await restingSpot(page), { steps: 15 });
      await cap.hold(2000);
      await cap.click(outcome(page, 'Hide'), { label: 'Hide' });
      await expect(outcome(page, 'Hide')).toBeChecked();
      await plotSettled(page);
      await cap.moveTo(await restingSpot(page), { steps: 15 });
      await cap.hold(1600);
    },
  },
  {
    name: 'eat-check',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    layout: { panel: 'eat' },
    timeoutMs: 120_000,
    docs: ['explore/eat.md'],
    steps: async (page, cap) => {
      await cap.hold(600);
      // A label: its five least reliable predictions open under its row.
      const row = eatPanel(page).locator(`.eat-label-row[data-label="${CHECKED_LABEL}"]`);
      await cap.click(row, { label: 'Click a label' });
      const list = eatPanel(page).getByRole('region', { name: '5 least reliable predictions' });
      await expect(list).toBeVisible();
      await cap.hold(1400);
      // One of them: the map zooms to it, and the strip says where its label came from.
      await cap.click(list.locator('.eat-drill-row').nth(1), { label: 'Pick one' });
      await expect(selectedProtein(page)).toBeVisible();
      await plotSettled(page);
      await cap.hold(2200);
      // Its source: selected, with the line between the two.
      await cap.click(selectedProtein(page).getByRole('button', { name: 'Go to source' }), {
        label: 'Go to source',
      });
      await expect(connectors(page)).toHaveCount(1);
      await plotSettled(page);
      await cap.moveTo(await restingSpot(page), { steps: 15 });
      await cap.hold(2400);
    },
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
];
