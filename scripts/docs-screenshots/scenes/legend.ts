/**
 * The legend page's captures (docs/explore/legend.md): hiding and showing, reordering, the Other
 * popover, and the two popovers as stills. The demo colours by protein family.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';
import { around } from './clip';
import { PLA2, THREE_FINGER } from './demo';
import { statusChip } from '../../../apps/web/tests/helpers/explore';
import {
  doubleClickLegendRow,
  dragLegendRow,
  isLegendItemHidden,
  legend,
  legendOtherDialog,
  legendRow,
  legendRowValues,
  legendSettingsDialog,
  legendSortButton,
  legendValueContaining,
  openLegendOther,
  openLegendSettings,
} from '../../../apps/web/tests/helpers/legend';

const NA = '__NA__';
const OTHER = 'Other';

/** The text a row's name starts with: N/A's raw value is a sentinel, every other one is its label. */
const label = (value: string): string => (value === NA ? 'N/A' : value);

const otherViewButton = (page: Page): Locator =>
  legend(page).getByRole('button', { name: 'View items grouped under Other', exact: true });

/** The open Other popover's element: the scope for its slotted search box and rows. */
const otherPopover = (page: Page): Locator =>
  legend(page).locator('protspace-legend-other-popover');

async function toggleSteps(page: Page, cap: CaptureApi): Promise<void> {
  const hidden = await legendValueContaining(page, PLA2);
  const only = await legendValueContaining(page, THREE_FINGER);

  await cap.hold(500);
  // A click on the row hides the category.
  await cap.moveTo(legendRow(page, hidden), { steps: 15 });
  await cap.hold(300);
  await cap.click(legendRow(page, hidden), { label: 'Click' });
  await expect.poll(() => isLegendItemHidden(page, hidden)).toBe(true);
  await cap.hold(1000);

  // The row's eye, shown on hover, brings it back.
  const eye = legend(page).getByRole('button', { name: `Show ${hidden}`, exact: true });
  await cap.moveTo(eye, { steps: 10 });
  await cap.hold(300);
  await cap.click(eye, { label: 'Show' });
  await expect.poll(() => isLegendItemHidden(page, hidden)).toBe(false);
  await cap.hold(1000);

  // A double click shows only that category; the plot's chip counts the hidden rest.
  await cap.moveTo(legendRow(page, only), { steps: 15 });
  await cap.hold(300);
  await cap.label('Double-click');
  await doubleClickLegendRow(page, only, (ms) => cap.hold(ms));
  await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([only]);
  await expect(statusChip(page, 'hidden')).toBeVisible();
  await cap.hold(1500);

  // The chip's ✕ shows every category again.
  const showAll = statusChip(page, 'hidden').getByRole('button', {
    name: 'Show hidden categories',
    exact: true,
  });
  await cap.moveTo(showAll, { steps: 20 });
  await cap.hold(300);
  await cap.click(showAll, { label: 'Show all' });
  await expect(statusChip(page, 'hidden')).toHaveCount(0);
  await cap.hold(1000);
}

async function reorderSteps(page: Page, cap: CaptureApi): Promise<void> {
  const values = (await legendRowValues(page)).filter((v) => v !== OTHER);
  if (values.length < 3) throw new Error(`Too few legend rows to reorder: ${values.join(', ')}`);
  // N/A to the top, as the old GIF did; the last row if N/A is missing or already first.
  const moving = values.includes(NA) && values[0] !== NA ? NA : values[values.length - 1];
  const top = values[0];

  await cap.hold(500);
  await cap.moveTo(legendRow(page, label(moving)), { steps: 15 });
  await cap.hold(400);
  await cap.label('Drag');
  await dragLegendRow(page, label(moving), label(top), {
    move: (point) => cap.moveTo(point, { steps: 6 }),
    pause: (ms) => cap.hold(ms),
  });
  await expect.poll(async () => (await legendRowValues(page))[0]).toBe(moving);
  await expect(legendSortButton(page)).toHaveAccessibleName(/^Sort: Your order/);
  await cap.hold(1500);

  // The sort button names the order; its menu puts the rows back by count.
  await cap.moveTo(legendSortButton(page), { steps: 15 });
  await cap.click(legendSortButton(page), { label: 'Sort' });
  const byCount = legend(page).getByRole('menuitemradio', { name: 'By count', exact: true });
  await expect(byCount).toBeVisible();
  await cap.hold(1200);
  await cap.moveTo(byCount, { steps: 10 });
  await cap.click(byCount, { label: 'By count' });
  await expect(legendSortButton(page)).toHaveAccessibleName(/^Sort: By count/);
  await cap.hold(1200);
}

async function othersSteps(page: Page, cap: CaptureApi): Promise<void> {
  await expect(otherViewButton(page)).toBeVisible();
  await cap.hold(500);
  await cap.moveTo(otherViewButton(page), { steps: 15 });
  await cap.hold(300);
  await cap.click(otherViewButton(page), { label: 'View' });
  await expect(legendOtherDialog(page)).toBeVisible();
  await cap.hold(1200);

  // The third category listed (largest first), found again by typing the first word of its name.
  const adds = otherPopover(page).getByRole('button', { name: /^Add to legend: / });
  const count = await adds.count();
  if (count === 0) throw new Error('The Other popover lists no category');
  const name = ((await adds.nth(Math.min(2, count - 1)).getAttribute('aria-label')) ?? '').replace(
    /^Add to legend: /,
    '',
  );
  const term = name.split(/\s+/)[0].slice(0, 8);
  const search = otherPopover(page).getByRole('searchbox', {
    name: 'Search Other categories',
  });
  await cap.moveTo(search, { steps: 10 });
  await cap.click(search, { label: 'Search' });
  for (const character of term) {
    await page.keyboard.type(character);
    await cap.hold(120);
  }
  const add = otherPopover(page).getByRole('button', {
    name: `Add to legend: ${name}`,
    exact: true,
  });
  await expect(add).toBeVisible();
  // The popover re-centres as the list shrinks: bring the pointer back to the search box.
  await cap.moveTo(search, { steps: 8 });
  await cap.hold(1000);

  await cap.moveTo(add, { steps: 10 });
  await cap.hold(300);
  await cap.click(add, { label: 'Add to legend' });
  await expect(legendRow(page, name)).toBeVisible();
  await cap.hold(800);
  await cap.press('Escape', { label: 'Esc' });
  await expect(legendOtherDialog(page)).toBeHidden();
  await cap.hold(1500);
}

export const LEGEND_CAPTURES: CaptureEntry[] = [
  {
    name: 'legend-toggle',
    kind: 'gif',
    viewport: 'desktop',
    steps: toggleSteps,
    timeoutMs: 120_000,
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-reorder',
    kind: 'gif',
    viewport: 'desktop',
    steps: reorderSteps,
    timeoutMs: 120_000,
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-others',
    kind: 'gif',
    viewport: 'desktop',
    steps: othersSteps,
    timeoutMs: 120_000,
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-settings',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: async (page) => {
      await openLegendSettings(page);
    },
    target: (page) => around([legendSettingsDialog(page)], 4),
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-other-popover',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: async (page) => {
      await openLegendOther(page);
    },
    target: (page) => around([legend(page), legendOtherDialog(page)]),
    docs: ['explore/legend.md'],
  },
];
