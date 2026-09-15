import { expect, test } from '@playwright/test';
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
import { DEMO_ANNOTATION, loadVenomEatBundle, pickProvenanceDemoPair } from './eat-helpers';

/**
 * Animated captures for `docs/explore/eat.md`.
 *
 * Matches the conventions of `capture-animations.spec.ts`: an INITIAL_PAUSE at
 * the top of each test that `convert-to-gif.ts` trims away, visual click
 * indicators so the viewer can see where the pointer acted, and the video
 * saved under a name derived from the test title.
 */

const BEAT = 1200;

test.beforeEach(async ({ page }) => {
  await loadVenomEatBundle(page);
  await selectAnnotation(page, DEMO_ANNOTATION);
  await initVisualIndicators(page);
});

test.afterEach(async ({ page }, testInfo) => {
  printActionSummary();
  await saveTestVideo(page, testInfo);
});

test('eat-connectors.gif - Tracing where a transferred value came from', async ({ page }) => {
  const { source, target, dependantCount } = await pickProvenanceDemoPair(page, DEMO_ANNOTATION);
  await logAction(
    page,
    'mouse',
    'Provenance pair',
    `${target} borrowed from ${source} (${dependantCount} dependants)`,
  );

  const targetPos = await getProteinScreenPosition(page, target);
  const sourcePos = await getProteinScreenPosition(page, source);
  const connectors = page.locator('protspace-scatterplot').locator('line.eat-provenance-connector');

  // Settle on the plot before the first action; this stretch is trimmed.
  await trackedMouseMove(page, targetPos.x, targetPos.y, { steps: 15 });
  await page.waitForTimeout(INITIAL_PAUSE);

  // One transferred protein: a single dashed line back to its source.
  await showActionLabel(page, 'Click a transferred protein', targetPos.x, targetPos.y);
  await showClickIndicator(page, targetPos.x, targetPos.y);
  await trackedMouseClick(page, targetPos.x, targetPos.y);
  await expect(connectors).toHaveCount(1);
  await page.waitForTimeout(BEAT * 2);

  // The source it borrowed from: lines fan out to everything that used it.
  await trackedMouseMove(page, sourcePos.x, sourcePos.y, { steps: 15 });
  await showActionLabel(page, 'Click its source', sourcePos.x, sourcePos.y);
  await showClickIndicator(page, sourcePos.x, sourcePos.y);
  await trackedMouseClick(page, sourcePos.x, sourcePos.y);
  // Assert the fan-out actually drew: a click that lands on empty canvas (or on
  // a protein that turns out to be transferred itself) leaves one line or none,
  // and without this the capture would ship a GIF showing the previous frame.
  await expect(connectors).toHaveCount(dependantCount);
  await page.waitForTimeout(BEAT * 2);

  // Escape clears the connectors without clearing the selection.
  await showActionLabel(page, 'Esc to clear', sourcePos.x, sourcePos.y);
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
    await logAction(page, 'keyboard', 'Reliability threshold', `${percent}%`);
    await page.waitForTimeout(BEAT);
  }

  await page.waitForTimeout(BEAT);

  // Back to 0: every prediction returns and the filter condition is removed.
  await showActionLabel(page, 'Back to 0%', box.x + box.width / 2, box.y + box.height / 2);
  await thresholdPercent.fill('0');
  await thresholdPercent.press('Enter');
  await logAction(page, 'keyboard', 'Reliability threshold', '0%');
  await page.waitForTimeout(BEAT * 2);
});
