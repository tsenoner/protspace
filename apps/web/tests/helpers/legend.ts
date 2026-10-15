/**
 * Legend helpers. Each finds the legend's controls by role, accessible name or tag; Playwright's
 * locators pierce the legend's shadow root, so none reaches into it by hand.
 */
import { expect, type Locator, type Page } from '@playwright/test';
// helpers/explore.ts re-exports three helpers from here; the two only call each other at run time.
import { waitForExploreInteractionReady } from './explore';

/** `value` as a literal inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A row's name up to its count, "{label}: N proteins, "; Other's label is "Other · N categories".
 * Anchoring on the count keeps "GO" from matching "GO:0005524: …", since values carry colons.
 */
function rowName(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value)}( · [^:]*)?: [\\d,]+ proteins?, `);
}

export const legend = (page: Page): Locator => page.locator('protspace-legend');

/** A row's main button, which toggles the category, found by the start of its accessible name. */
export const legendRow = (page: Page, value: string): Locator =>
  legend(page).getByRole('button', { name: rowName(value) });

/** The row around a row's main button. */
const legendItem = (page: Page, value: string): Locator =>
  legend(page)
    .locator('.legend-item')
    .filter({ has: page.getByRole('button', { name: rowName(value) }) });

/** Every row's value in display order; `visible` keeps only the shown or only the hidden rows. */
export async function legendRowValues(
  page: Page,
  options: { visible?: boolean } = {},
): Promise<string[]> {
  return legend(page)
    .locator('.legend-item')
    .evaluateAll(
      (rows, visible) =>
        rows
          .filter(
            (row) =>
              visible === null ||
              (row.querySelector('.legend-item-main')?.getAttribute('aria-pressed') === 'true') ===
                visible,
          )
          .map((row) => row.getAttribute('data-value') ?? ''),
      options.visible ?? null,
    );
}

/** The legend's raw value for a category whose value contains `needle`, case-insensitive. */
export async function legendValueContaining(page: Page, needle: string): Promise<string> {
  const values = await legendRowValues(page);
  const value = values.find((v) => v.toLowerCase().includes(needle.toLowerCase()));
  if (!value) throw new Error(`No legend row contains "${needle}"; rows: ${values.join(', ')}`);
  return value;
}

/** Hovers a row so its actions show, then clicks its eye or picks an item from its "⋯" menu. */
export async function legendRowAction(
  page: Page,
  value: string,
  action: 'Hide' | 'Show' | 'Show only this' | 'Show all' | 'Colour and shape',
): Promise<void> {
  const item = legendItem(page, value);
  await legendRow(page, value).hover();
  if (action === 'Hide' || action === 'Show') {
    await item.getByRole('button', { name: new RegExp(`^${action} `) }).click();
    return;
  }
  await item.getByRole('button', { name: /^More actions for / }).click();
  await legend(page).getByRole('menuitem', { name: action, exact: true }).click();
  await expect(legend(page).getByRole('menu', { name: /^Actions for / })).toBeHidden();
}

export async function getFirstLegendItemValue(page: Page): Promise<string> {
  const value = await legend(page)
    .locator('.legend-item:not([data-value="Other"]):not([data-value="__NA__"])')
    .first()
    .getAttribute('data-value', { timeout: 5_000 })
    .catch((): null => null);
  if (!value) {
    throw new Error('No legend item found');
  }
  return value;
}

export async function clickLegendItem(page: Page, value: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await legendRow(page, value).click();
}

/**
 * Whether a row is hidden, read from its main button's `aria-pressed`; false when no such row. The
 * row is found by its raw value (`data-value`), so `__NA__` and numeric bin ids work as before.
 */
export async function isLegendItemHidden(page: Page, value: string): Promise<boolean> {
  const main = legend(page).locator(
    `.legend-item[data-value="${value.replace(/["\\]/g, '\\$&')}"] .legend-item-main`,
  );
  if ((await main.count()) === 0) return false;
  return (await main.first().getAttribute('aria-pressed')) === 'false';
}

type LegendSortChoice = 'By count' | 'By name' | 'By value' | 'By separation' | 'Your order';

/** The header's sort button; its name reads "Sort: {active order}". */
export function legendSortButton(page: Page): Locator {
  return legend(page).getByRole('button', { name: /^Sort: / });
}

/** The active order as the sort button names it, e.g. "By count, largest first". */
export async function legendSortLabel(page: Page): Promise<string> {
  const name = (await legendSortButton(page).getAttribute('aria-label')) ?? '';
  return name.replace(/^Sort: /, '');
}

/** Picks an order from the header's sort menu and waits until the button shows it. */
export async function setLegendSort(page: Page, choice: LegendSortChoice): Promise<void> {
  await legendSortButton(page).click();
  await legend(page).getByRole('menuitemradio', { name: choice, exact: true }).click();
  await expect(legendSortButton(page)).toHaveAccessibleName(new RegExp(`^Sort: ${choice}`));
}

/** Runs "Reverse order" from the sort menu, closes the menu and waits for the order to flip. */
export async function toggleLegendReverse(page: Page): Promise<void> {
  const before = await legendSortLabel(page);
  await legendSortButton(page).click();
  await legend(page).getByRole('menuitemcheckbox', { name: 'Reverse order' }).click();
  // A checkbox item keeps the menu open.
  await page.keyboard.press('Escape');
  await expect(legend(page).getByRole('menu', { name: 'Sort legend' })).toHaveCount(0);
  await expect.poll(() => legendSortLabel(page)).not.toBe(before);
}

/** The Other popover's panel (role dialog), for visibility and boxes; its content is slotted. */
export const legendOtherDialog = (page: Page): Locator =>
  legend(page).getByRole('dialog', { name: 'Other categories' });

/**
 * Opens the Other popover from the Other row's View button; returns the popover element, the scope
 * for its controls (the panel's content is slotted, so a locator scoped to the panel finds nothing).
 */
export async function openLegendOther(page: Page): Promise<Locator> {
  await legend(page).getByRole('button', { name: 'View items grouped under Other' }).click();
  await expect(legendOtherDialog(page)).toBeVisible();
  return legend(page).locator('protspace-legend-other-popover');
}

/** Adds one category from the open Other popover and waits for its legend row. */
export async function addFromOther(page: Page, name: string): Promise<void> {
  await legend(page)
    .getByRole('button', { name: `Add to legend: ${name}`, exact: true })
    .click();
  await expect(legendRow(page, name)).toBeVisible();
}

/** The settings popover's panel, a dialog named "Legend settings: {display name}". */
export function legendSettingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Legend settings/ });
}

/**
 * Opens the legend settings popover unless it is open, and returns its element: the scope for its
 * controls. The panel's content is slotted, so a locator scoped to the panel would not find it.
 */
export async function openLegendSettings(page: Page): Promise<Locator> {
  if (!(await legendSettingsDialog(page).isVisible())) {
    await legend(page).getByRole('button', { name: 'Legend settings', exact: true }).click();
  }
  await expect(legendSettingsDialog(page)).toBeVisible();
  return legend(page).locator('protspace-legend-settings-popover');
}

/**
 * The legend's entries in localStorage (its record and the dataset's point size), to wait for an
 * edit to be stored. Other `protspace:` keys, such as the layout, would end the wait early.
 */
function storedState(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify(
      Object.keys(localStorage)
        .filter(
          (key) => key.startsWith('protspace:legend:') || key.startsWith('protspace:shape-size:'),
        )
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  );
}

/**
 * Types `value` into a number field and leaves it, then waits until the edit is stored. The value
 * must differ from the field's, or nothing is stored to wait for.
 */
export async function setLegendSetting(
  page: Page,
  field: 'Max legend items' | 'Bins' | 'Shape size' | 'Point size',
  value: string,
): Promise<void> {
  const settings = await openLegendSettings(page);
  const before = await storedState(page);
  const input = settings.getByRole('spinbutton', { name: field, exact: true });
  await input.fill(value);
  await input.blur();
  await expect.poll(() => storedState(page)).not.toBe(before);
}

/** Picks a palette swatch by its label, e.g. "Okabe-Ito" or "Viridis". */
export async function pickLegendPalette(page: Page, label: string): Promise<void> {
  const settings = await openLegendSettings(page);
  const swatch = settings.getByRole('radio', { name: label, exact: true });
  await swatch.click();
  await expect(swatch).toBeChecked();
}

export async function setBinDistribution(
  page: Page,
  label: 'Linear' | 'Quantile' | 'Logarithmic',
): Promise<void> {
  const settings = await openLegendSettings(page);
  await settings.getByRole('combobox', { name: 'Bin distribution' }).selectOption({ label });
}

export async function toggleLegendSetting(
  page: Page,
  name: 'Show duplicate counts and spread overlaps' | 'Reverse gradient',
): Promise<void> {
  const settings = await openLegendSettings(page);
  const control = settings.getByRole('switch', { name, exact: true });
  const checked = await control.getAttribute('aria-checked');
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
}

/** Reset; the popover stays open, and Reset disables itself once nothing is stored. */
export async function resetLegendSettings(page: Page): Promise<void> {
  const settings = await openLegendSettings(page);
  const reset = settings.getByRole('button', { name: 'Reset', exact: true });
  await reset.click();
  await expect(reset).toBeDisabled();
}

export async function closeLegendSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(legendSettingsDialog(page)).toBeHidden();
}

/** What the popover shows: the checked palette's label, the two fields and the numeric controls. */
export async function readLegendSettings(page: Page): Promise<{
  palette: string;
  maxItems: string;
  size: string;
  distribution?: string;
  reverseGradient?: boolean;
}> {
  const settings = await openLegendSettings(page);
  const fields = settings.getByRole('spinbutton');
  const result: {
    palette: string;
    maxItems: string;
    size: string;
    distribution?: string;
    reverseGradient?: boolean;
  } = {
    palette: ((await settings.getByRole('radio', { checked: true }).textContent()) ?? '').trim(),
    maxItems: await fields.nth(0).inputValue(),
    size: await fields.nth(1).inputValue(),
  };
  const distribution = settings.getByRole('combobox', { name: 'Bin distribution' });
  if ((await distribution.count()) > 0) {
    result.distribution = await distribution.evaluate(
      (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent?.trim() ?? '',
    );
  }
  const reverse = settings.getByRole('switch', { name: 'Reverse gradient', exact: true });
  if ((await reverse.count()) > 0) {
    result.reverseGradient = (await reverse.getAttribute('aria-checked')) === 'true';
  }
  return result;
}

/**
 * A real double click on a row: click (detail 1), a pause, click (detail 2) and dblclick, as a
 * hand makes one. Playwright's `dblclick()` sends the two clicks back to back, which the legend
 * cannot tell from one click being repeated. A capture passes `pause` as `(ms) => cap.hold(ms)`,
 * since `hold` is the only timer capture code may use.
 */
export async function doubleClickLegendRow(
  page: Page,
  value: string,
  pause: (ms: number) => Promise<void> = (ms) => page.waitForTimeout(ms),
  gapMs = 120,
): Promise<void> {
  const box = await legendRow(page, value).boundingBox();
  if (!box) throw new Error(`No legend row for ${value}`);
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await pause(gapMs);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

/** A point on the page, as `page.mouse.move` takes it. */
interface Point {
  x: number;
  y: number;
}

/**
 * Drags row `from` by its "Reorder …" handle onto the middle of row `to`, with the mouse, row by
 * row with a pause on each. One fast sweep over many rows leaves the order unchanged: Sortable
 * ignores a row it is still animating, and an emulated drag sends `dragover` only when the mouse
 * moves. A capture passes `move` as `(p) => cap.moveTo(p, { steps: 6 })` and `pause` as
 * `(ms) => cap.hold(ms)`, so the GIF shows the glide and times the holds.
 */
export async function dragLegendRow(
  page: Page,
  from: string,
  to: string,
  io: { move?: (point: Point) => Promise<void>; pause?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const move = io.move ?? ((point: Point) => page.mouse.move(point.x, point.y, { steps: 6 }));
  const pause = io.pause ?? ((ms: number) => page.waitForTimeout(ms));
  // Hovering the row shows its handle.
  const row = await legendItem(page, from).boundingBox();
  if (!row) throw new Error(`No legend row for ${from}`);
  await move({ x: row.x + row.width / 2, y: row.y + row.height / 2 });
  const handle = await legendItem(page, from)
    .getByRole('button', { name: /^Reorder / })
    .boundingBox();
  if (!handle) throw new Error(`No drag handle on the legend row ${from}`);
  const target = await legendItem(page, to).boundingBox();
  if (!target) throw new Error(`No legend row for ${to}`);
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const end = { x: start.x, y: target.y + target.height / 2 };
  await move(start);
  await page.mouse.down();
  const step = Math.sign(end.y - start.y) * target.height;
  // Through every row in between; the last step lands on `to` itself.
  for (let y = start.y + step; step !== 0 && (end.y - y) / step > 0.5; y += step) {
    await move({ x: start.x, y });
    await pause(80);
  }
  await move(end);
  await pause(400);
  await page.mouse.up();
}
