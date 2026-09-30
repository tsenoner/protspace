import { expect, test, type Page } from '@playwright/test';
import {
  INITIAL_PAUSE,
  getProteinScreenPosition,
  initVisualIndicators,
  logAction,
  printActionSummary,
  saveTestVideo,
  selectAnnotation,
  showActionLabel,
  showClickIndicator,
  trackedMouseClick,
  trackedMouseMove,
} from './helpers';
import { DEMO_ANNOTATION, loadEatExampleBundle, pickProvenanceDemoPair } from './eat-helpers';

/**
 * Animated captures for `docs/explore/eat.md`.
 *
 * Matches the conventions of `capture-animations.spec.ts`: an INITIAL_PAUSE at
 * the top of each test that `convert-to-gif.ts` trims away, visual click
 * indicators so the viewer can see where the pointer acted, and the video
 * saved under a name derived from the test title.
 */

const BEAT = 1200;

/**
 * Step the pointer off the protein it just clicked, into empty plot space, so
 * the hover tooltip closes: it opens beside the pointer, over the very
 * connectors the click drew. Tries spots `distance` px from `fromId`, starting
 * on the side away from `awayId` (the far end of the lines, so the pointer does
 * not park on them) and turning 30° at a time, and takes the first spot with no
 * marker within `clearance` px. Positions are read now, after the click opened
 * the structure viewer beside the plot.
 */
async function stepOffMarker(
  page: Page,
  fromId: string,
  awayId: string,
  distance = 40,
  clearance = 16,
): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(
    ({ fromId, awayId, distance, clearance }) => {
      const plot = document.querySelector('protspace-scatterplot') as
        | (Element & {
            data?: { protein_ids: string[] };
            getProteinClientPosition?(proteinId: string): { x: number; y: number } | null;
          })
        | null;
      const from = plot?.getProteinClientPosition?.(fromId);
      const away = plot?.getProteinClientPosition?.(awayId);
      if (!from || !away) return null;
      const markers = (plot?.data?.protein_ids ?? [])
        .map((id) => plot?.getProteinClientPosition?.(id) ?? null)
        .filter((marker): marker is { x: number; y: number } => marker !== null);

      const start = Math.atan2(from.y - away.y, from.x - away.x);
      for (let step = 0; step < 12; step++) {
        // 0°, +30°, −30°, +60°, −60°, … around the side away from the lines.
        const turn = Math.ceil(step / 2) * (step % 2 ? 1 : -1) * (Math.PI / 6);
        const x = from.x + distance * Math.cos(start + turn);
        const y = from.y + distance * Math.sin(start + turn);
        if (markers.every((marker) => Math.hypot(marker.x - x, marker.y - y) > clearance)) {
          return { x, y };
        }
      }
      return null;
    },
    { fromId, awayId, distance, clearance },
  );
  if (!spot) {
    throw new Error(`No empty spot ${distance} px from ${fromId} to park the pointer on`);
  }
  await trackedMouseMove(page, spot.x, spot.y, { steps: 10 });
  return spot;
}

test.beforeEach(async ({ page }) => {
  await loadEatExampleBundle(page);
  await selectAnnotation(page, DEMO_ANNOTATION);
  await initVisualIndicators(page);
});

test.afterEach(async ({ page }, testInfo) => {
  printActionSummary();
  await saveTestVideo(page, testInfo);
});

test('eat-connectors.gif - Tracing where a transferred value came from', async ({ page }) => {
  const { source, target, dependantCount } = await pickProvenanceDemoPair(page, DEMO_ANNOTATION);
  logAction(
    'mouse',
    'Provenance pair',
    `${target} borrowed from ${source} (${dependantCount} dependants)`,
  );

  const targetPos = await getProteinScreenPosition(page, target);
  const connectors = page.locator('protspace-scatterplot').locator('line.eat-provenance-connector');

  // Settle on the plot before the first action; this stretch is trimmed.
  await trackedMouseMove(page, targetPos.x, targetPos.y, { steps: 15 });
  await page.waitForTimeout(INITIAL_PAUSE);

  // One transferred protein: a single dashed line back to its source.
  await showActionLabel(page, 'Click a transferred protein', targetPos.x, targetPos.y);
  await showClickIndicator(page, targetPos.x, targetPos.y);
  await trackedMouseClick(page, targetPos.x, targetPos.y);
  await expect(connectors).toHaveCount(1);
  await stepOffMarker(page, target, source);
  await page.waitForTimeout(BEAT * 2);

  // Read now, not up front: the first click opens the structure viewer beside the
  // plot, and a stale position a pixel or two off can land on a neighbour.
  const sourcePos = await getProteinScreenPosition(page, source);

  // The source it borrowed from: lines fan out to everything that used it.
  await trackedMouseMove(page, sourcePos.x, sourcePos.y, { steps: 15 });
  await showActionLabel(page, 'Click its source', sourcePos.x, sourcePos.y);
  await showClickIndicator(page, sourcePos.x, sourcePos.y);
  await trackedMouseClick(page, sourcePos.x, sourcePos.y);
  // Assert the fan-out actually drew: a click that lands on empty canvas (or on
  // a protein that turns out to be transferred itself) leaves one line or none,
  // and without this the capture would ship a GIF showing the previous frame.
  await expect(connectors).toHaveCount(dependantCount);
  const parked = await stepOffMarker(page, source, target);
  await page.waitForTimeout(BEAT * 2);

  // Escape clears the connectors, and the control bar clears the selection with them.
  await showActionLabel(page, 'Esc to clear', parked.x, parked.y);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(BEAT);
});

test('eat-reliability.gif - Hiding predictions below a reliability threshold', async ({ page }) => {
  const eatGroup = page
    .locator('protspace-legend')
    .getByRole('region', { name: 'Embedding Annotation Transfer' });
  const thresholdPercent = eatGroup.getByRole('spinbutton', {
    name: 'EAT reliability filter percentage',
  });

  await eatGroup.waitFor({ state: 'visible' });
  const box = await eatGroup.boundingBox();
  if (!box) throw new Error('Could not get the EAT legend group bounding box');

  // Park the pointer beside the control being driven; this stretch is trimmed.
  await trackedMouseMove(page, box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(INITIAL_PAUSE);

  // Step the threshold up so the rings thin out in visible stages rather than
  // snapping straight to the final state.
  for (const percent of ['40', '70', '90']) {
    await showActionLabel(
      page,
      `Hide below ${percent}%`,
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    await thresholdPercent.fill(percent);
    await thresholdPercent.press('Enter');
    logAction('keyboard', 'Reliability threshold', `${percent}%`);
    await page.waitForTimeout(BEAT);
  }

  await page.waitForTimeout(BEAT);

  // Back to 0: every prediction returns and the filter condition is removed.
  await showActionLabel(page, 'Back to 0%', box.x + box.width / 2, box.y + box.height / 2);
  await thresholdPercent.fill('0');
  await thresholdPercent.press('Enter');
  logAction('keyboard', 'Reliability threshold', '0%');
  await page.waitForTimeout(BEAT * 2);
});
