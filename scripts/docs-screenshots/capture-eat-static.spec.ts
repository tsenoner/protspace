import { test } from '@playwright/test';
import * as path from 'path';
import { IMAGES_DIR, createSharedCapturePage, selectAnnotation } from './helpers';
import { DEMO_ANNOTATION, loadVenomEatBundle } from './eat-helpers';

/**
 * Static screenshots for `docs/explore/eat.md`.
 *
 * Kept out of `capture-static.spec.ts` because these need the venom EAT bundle
 * rather than the built-in demo dataset, and that file shares one pre-loaded
 * page across every test in it.
 */

const getPage = createSharedCapturePage(async (page) => {
  await loadVenomEatBundle(page);
  await selectAnnotation(page, DEMO_ANNOTATION);
});

test.describe('EAT Static Screenshots', () => {
  test('eat-legend-section.png - Predicted (transferred) legend controls', async () => {
    const page = getPage();
    const eatGroup = page
      .locator('protspace-legend')
      .getByRole('region', { name: 'Embedding Annotation Transfer' });

    await eatGroup.waitFor({ state: 'visible' });
    // The counts row renders a frame after the group itself; without it the
    // screenshot can catch the block before Observed/Predicted by EAT appear.
    await eatGroup.getByRole('region', { name: 'Transferred annotation counts' }).waitFor({
      state: 'visible',
    });

    await eatGroup.screenshot({ path: path.join(IMAGES_DIR, 'eat-legend-section.png') });
    console.log('📸 Captured: eat-legend-section.png');
  });

  test('eat-annotation-badge.png - EAT badge in the annotation dropdown', async () => {
    const page = getPage();
    const annotationSelect = page
      .locator('protspace-control-bar')
      .locator('protspace-annotation-select');

    await annotationSelect.locator('.dropdown-trigger').click();
    const badgedRow = annotationSelect.locator(
      `.dropdown-item[data-annotation="${DEMO_ANNOTATION}"]`,
    );
    await badgedRow.locator('.eat-badge').waitFor({ state: 'visible' });

    // The list scrolls and `ec` sits well below the fold, so bring it into the
    // menu's viewport before capturing. Screenshotting the host element instead
    // would only catch the collapsed trigger: the menu is a taller sibling that
    // overflows it.
    await badgedRow.scrollIntoViewIfNeeded();

    await annotationSelect.locator('.dropdown-menu').screenshot({
      path: path.join(IMAGES_DIR, 'eat-annotation-badge.png'),
    });
    console.log('📸 Captured: eat-annotation-badge.png');

    // Leave the dropdown closed so a rerun starts from the same state.
    await page.keyboard.press('Escape');
  });
});
