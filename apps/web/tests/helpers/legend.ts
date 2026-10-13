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
