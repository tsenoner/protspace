/**
 * Captures for the importing and exporting pages: the notification an export ends with, and the
 * loading card an example download shows.
 */
import { expect, type Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';
import { around } from './clip';
import { findExampleDataset } from '../../../apps/web/src/explore/example-datasets';
import {
  exportAction,
  holdNextRequest,
  importPanel,
  pickExample,
  toast,
} from '../../../apps/web/tests/helpers/explore';
import { clickLegendItem, legendValueContaining } from '../../../apps/web/tests/helpers/legend';
import { PLA2 } from './demo';

/** A release-hosted example: its download is the one held, so its file need not be fetched. */
const LOADING_EXAMPLE = 'three-finger-toxins';

const exportReady = (page: Page) => toast(page, 'Export ready.');

async function exportToastSteps(page: Page, cap: CaptureApi): Promise<void> {
  // The phospholipase cluster sits where the toast opens, and would show around its edges.
  await clickLegendItem(page, await legendValueContaining(page, PLA2));
  const download = page.waitForEvent('download');
  await exportAction(page, 'Quick PNG');
  await download;
  await expect(exportReady(page)).toBeVisible();
  await expect(
    exportReady(page).getByRole('button', { name: 'Dismiss notification' }),
  ).toBeVisible();
  // Sonner slides the toast up from below the viewport; measuring mid-slide clips it.
  await expect(exportReady(page)).toHaveAttribute('data-mounted', 'true');
  await exportReady(page).evaluate(async (el) => {
    await new Promise(requestAnimationFrame);
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished));
  });
  // The toast closes itself after 4 s; Sonner pauses that while the pointer rests on it.
  await cap.moveTo(exportReady(page), { steps: 1 });
}

async function loadingOverlaySteps(page: Page): Promise<void> {
  const example = findExampleDataset(LOADING_EXAMPLE);
  if (!example) throw new Error(`The catalog has no "${LOADING_EXAMPLE}" example`);
  // Held until the page closes, so the card stays on its first frame for the shutter.
  await holdNextRequest(page, `**/${example.url.replace(/^\.\//, '')}`);
  await pickExample(page, LOADING_EXAMPLE);
  await expect(importPanel(page)).toBeHidden();
  const overlay = page.locator('#progressive-loading');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Cancel download' })).toBeVisible();
}

export const IMPORT_EXPORT_CAPTURES: CaptureEntry[] = [
  {
    name: 'toast',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: exportToastSteps,
    target: (page) => around([exportReady(page)], 16),
    keepPointer: true,
    docs: ['explore/exporting.md'],
  },
  {
    name: 'loading-overlay',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: loadingOverlaySteps,
    target: (page) => around([page.locator('#progressive-loading .ps-loading__card')], 40),
    docs: ['explore/importing-data.md'],
  },
];
