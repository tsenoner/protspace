/**
 * The overview's "Phones and tablets" captures on an emulated Pixel 7: the phone layout, the More
 * sheet and the structure sheet (light and dark), and the tablet layout (light). The structure
 * loads the real Mol* and AlphaFold, so these need network.
 */
import { expect, type Page } from '@playwright/test';
import type { CaptureEntry } from '../capture-plan';
import { legendRowValues } from '../../../apps/web/tests/helpers/legend';
import {
  moreButton,
  moreSheet,
  panelTab,
  plotTooltip,
  proteinNear,
  tap,
  themeSegment,
} from '../../../apps/web/tests/helpers/mobile';
import {
  waitForStructureLoaded,
  watchStructureLoads,
} from '../../../apps/web/tests/helpers/structure';

const workbench = (page: Page) => page.locator('.workbench');

/** The panel under the plot shows the legend, unfolded, with its rows. */
async function phoneLayoutSteps(page: Page): Promise<void> {
  await expect(panelTab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await legendRowValues(page)).length).toBeGreaterThan(0);
}

async function moreSheetSteps(page: Page): Promise<void> {
  await moreButton(page).tap();
  await expect(moreSheet(page)).toBeVisible();
  await expect(themeSegment(page, 'System')).toBeVisible();
}

/**
 * A tap selects a protein: its tooltip pins with View structure, and the structure sheet opens
 * folded to its header below the plot while the structure loads behind it.
 */
async function structureSheetSteps(page: Page): Promise<void> {
  await watchStructureLoads(page);
  const protein = await proteinNear(page, 0.5, 0.35);
  await tap(page, protein);
  await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
  await expect(plotTooltip(page).getByRole('button', { name: 'View structure' })).toBeVisible();
  await waitForStructureLoaded(page, protein.id, 90_000);
}

/** The tablet keeps the structure beside the legend under the plot; a tap shows one there. */
async function tabletSteps(page: Page): Promise<void> {
  await watchStructureLoads(page);
  const protein = await proteinNear(page, 0.5, 0.45);
  await tap(page, protein);
  await waitForStructureLoaded(page, protein.id, 90_000);
}

export const PHONE_CAPTURES: CaptureEntry[] = [
  {
    name: 'phone-layout',
    kind: 'png',
    viewport: 'phone',
    themes: ['light', 'dark'],
    steps: phoneLayoutSteps,
    docs: ['explore/index.md'],
  },
  {
    name: 'phone-more-sheet',
    kind: 'png',
    viewport: 'phone',
    themes: ['light', 'dark'],
    steps: moreSheetSteps,
    docs: ['explore/index.md'],
  },
  {
    name: 'phone-structure-sheet',
    kind: 'png',
    viewport: 'phone',
    themes: ['light', 'dark'],
    steps: structureSheetSteps,
    timeoutMs: 150_000,
    docs: ['explore/index.md'],
  },
  {
    name: 'tablet-layout',
    kind: 'png',
    viewport: 'tablet',
    steps: tabletSteps,
    timeoutMs: 150_000,
    docs: ['explore/index.md'],
  },
];
