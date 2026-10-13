import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CategoryScore } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsIconButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import { LEGEND_VALUES } from './config';
import type { ProtspaceLegend } from './legend';
import type { LegendSortMode } from './types';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

interface Internals {
  _applySortMode(mode: LegendSortMode): void;
  _updateLegendItems(): void;
  _categoryScores: CategoryScore[];
}
const internals = (legend: ProtspaceLegend) => legend as unknown as Internals;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Wait until the legend and its menu stop re-rendering, then let the top layer paint. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  await settleLegend(legend);
  await menu(legend)?.updateComplete;
  await frame();
  await frame();
}

async function mount(
  ...args: Parameters<typeof mountLegendWithScatterplot>
): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(...args);
  await settle(legend);
  return legend;
}

const root = (legend: ProtspaceLegend) => legend.shadowRoot!;
const sortButton = (legend: ProtspaceLegend) =>
  root(legend).querySelector<PsIconButton>('.legend-header ps-icon-button.sort-button')!;
const settingsButton = (legend: ProtspaceLegend) =>
  root(legend).querySelector<PsIconButton>('.legend-header ps-icon-button.settings-button')!;
const innerButton = (host: PsIconButton) => host.shadowRoot!.querySelector('button')!;
const menu = (legend: ProtspaceLegend) => root(legend).querySelector<PsMenu>('ps-menu.sort-menu');
const menuItems = (legend: ProtspaceLegend) => [
  ...root(legend).querySelectorAll<PsMenuItem>('ps-menu.sort-menu ps-menu-item'),
];
const menuItem = (legend: ProtspaceLegend, value: string) =>
  menuItems(legend).find((item) => item.value === value);
const checkedRadios = (legend: ProtspaceLegend) =>
  menuItems(legend)
    .filter((item) => item.type === 'radio' && item.checked)
    .map((item) => item.value);
const rowValues = (legend: ProtspaceLegend) =>
  [...root(legend).querySelectorAll<HTMLElement>('.legend-item')].map((row) => row.dataset.value!);

/** The stored record for `annotation`, whatever the dataset hash. */
function storedRecord(annotation: string): Record<string, unknown> | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith('protspace:legend:') && key.endsWith(`:${annotation}`)) {
      return JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    }
  }
  return null;
}

async function openSortMenu(legend: ProtspaceLegend): Promise<PsMenu> {
  const button = innerButton(sortButton(legend));
  button.focus();
  button.click();
  await settle(legend);
  const open = menu(legend)!;
  expect(open.open).toBe(true);
  return open;
}

async function pick(legend: ProtspaceLegend, value: string): Promise<void> {
  menuItem(legend, value)!.click();
  await settle(legend);
}

async function escape(legend: ProtspaceLegend): Promise<void> {
  (deepActiveElement() ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  await settle(legend);
}

const THREE = { beta: 3, alpha: 2, gamma: 1 } as const;

describe('legend sort menu', () => {
  it('picking By name applies without Save, persists sortMode alpha-asc and runs one legendUpdate', async () => {
    const legend = await mount(categoricalData(THREE), 'family');
    expect(rowValues(legend)).toEqual(['beta', 'alpha', 'gamma']);
    await openSortMenu(legend);
    expect(menuItems(legend).map((item) => item.textContent!.trim())).toEqual([
      'By count',
      'By name',
      'Your order',
      'Reverse order',
    ]);
    // perfCounters.legendUpdate counts exactly the calls of _updateLegendItems.
    const update = vi.spyOn(internals(legend), '_updateLegendItems');

    await pick(legend, 'alpha-asc');

    expect(update).toHaveBeenCalledOnce();
    expect(rowValues(legend)).toEqual(['alpha', 'beta', 'gamma']);
    expect(storedRecord('family')?.sortMode).toBe('alpha-asc');
    expect(menu(legend)).toBeNull();
    expect(sortButton(legend).label).toBe('Sort: By name, A to Z');
    expect(sortButton(legend).icon).toBe('arrow-down-a-z');
  });

  it('Your order keeps the current display order and persists manual', async () => {
    const legend = await mount(categoricalData(THREE), 'family');
    await openSortMenu(legend);
    await pick(legend, 'alpha-asc');
    expect(rowValues(legend)).toEqual(['alpha', 'beta', 'gamma']);

    await openSortMenu(legend);
    await pick(legend, 'manual');

    expect(rowValues(legend)).toEqual(['alpha', 'beta', 'gamma']);
    expect(storedRecord('family')?.sortMode).toBe('manual');
    expect(sortButton(legend).label).toBe('Sort: Your order');
    expect(sortButton(legend).icon).toBe('arrow-up-down');
  });

  it('Reverse order maps each mode as the old reverse button did and keeps Other last', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    expect(rowValues(legend).at(-1)).toBe(LEGEND_VALUES.OTHER);
    const cases: Array<[LegendSortMode, LegendSortMode]> = [
      ['size-desc', 'size-asc'],
      ['alpha-asc', 'alpha-desc'],
      ['manual', 'manual-reverse'],
    ];
    for (const [base, reversed] of cases) {
      internals(legend)._applySortMode(base);
      await settle(legend);
      const before = rowValues(legend);

      await openSortMenu(legend);
      await pick(legend, 'reverse');

      expect(storedRecord('family')?.sortMode).toBe(reversed);
      const after = rowValues(legend);
      expect(after.at(-1)).toBe(LEGEND_VALUES.OTHER);
      expect(after.slice(0, -1)).toEqual(before.slice(0, -1).reverse());
      // A checkbox item keeps the menu open, now showing the new direction.
      expect(menu(legend)?.open).toBe(true);
      expect(menuItem(legend, 'reverse')!.checked).toBe(true);
      await escape(legend);
    }

    document.body.replaceChildren();
    const numeric = await mount(numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'length');
    const lowToHigh = rowValues(numeric);
    await openSortMenu(numeric);
    expect(menuItems(numeric).map((item) => item.textContent!.trim())).toEqual([
      'By value',
      'Your order',
      'Reverse order',
    ]);
    await pick(numeric, 'reverse');
    expect(storedRecord('length')?.sortMode).toBe('alpha-desc');
    expect(sortButton(numeric).label).toBe('Sort: By value, high to low');
    expect(rowValues(numeric)).toEqual([...lowToHigh].reverse());
  });

  it('By separation appears only with scores or while active', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    await openSortMenu(legend);
    expect(menuItem(legend, 'silhouette-desc')).toBeUndefined();
    await escape(legend);

    internals(legend)._applySortMode('silhouette-desc');
    await settle(legend);
    await openSortMenu(legend);
    expect(menuItem(legend, 'silhouette-desc')?.checked).toBe(true);
    expect(menuItem(legend, 'silhouette-desc')?.textContent!.trim()).toBe('By separation');
    await escape(legend);

    internals(legend)._applySortMode('size-desc');
    internals(legend)._categoryScores = [
      { category: 'A', silhouette: 0.5, silhouetteEmbedding: null, daviesBouldin: 1 },
    ];
    await settle(legend);
    await openSortMenu(legend);
    expect(menuItem(legend, 'silhouette-desc')).toBeDefined();
    expect(menuItem(legend, 'silhouette-desc')?.checked).toBe(false);
  });

  it('the checked radio and the Reverse checkbox follow the active mode', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    await openSortMenu(legend);
    expect(
      root(legend).querySelector('ps-menu.sort-menu ps-menu-group')!.getAttribute('aria-label'),
    ).toBe('Sort by');
    expect(checkedRadios(legend)).toEqual(['size-desc']);
    expect(menuItem(legend, 'reverse')!.getAttribute('role')).toBe('menuitemcheckbox');
    expect(menuItem(legend, 'reverse')!.checked).toBe(false);
    await escape(legend);

    const cases: Array<[LegendSortMode, string, boolean]> = [
      ['size-asc', 'size-desc', true],
      ['alpha-desc', 'alpha-asc', true],
      ['alpha-asc', 'alpha-asc', false],
      ['manual-reverse', 'manual', true],
      ['manual', 'manual', false],
    ];
    for (const [mode, radio, reversed] of cases) {
      internals(legend)._applySortMode(mode);
      await settle(legend);
      await openSortMenu(legend);
      expect(checkedRadios(legend)).toEqual([radio]);
      expect(menuItem(legend, 'reverse')!.checked).toBe(reversed);
      await escape(legend);
    }
  });

  it('picking the checked radio again keeps the reversed order', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    internals(legend)._applySortMode('size-asc');
    await settle(legend);
    await openSortMenu(legend);
    expect(checkedRadios(legend)).toEqual(['size-desc']);
    const update = vi.spyOn(internals(legend), '_updateLegendItems');

    await pick(legend, 'size-desc');

    expect(update).not.toHaveBeenCalled();
    expect(storedRecord('family')?.sortMode).toBe('size-asc');
    expect(sortButton(legend).label).toBe('Sort: By count, smallest first');
  });

  it('Escape closes the menu and returns focus to the sort button', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const button = sortButton(legend);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await openSortMenu(legend);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(deepActiveElement()?.closest('ps-menu-item')?.value).toBe('size-desc');

    await escape(legend);

    expect(menu(legend)).toBeNull();
    expect(deepActiveElement()).toBe(innerButton(button));
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('at 240 px the title truncates and the sort and settings buttons stay fully visible', async () => {
    const name = `predicted_${'very_long_annotation_name_for_a_narrow_sidebar_'.repeat(2)}check`;
    const legend = await mount(categoricalData({ A: 3, B: 2, C: 1 }, name), name);
    legend.style.width = '240px';
    await settle(legend);

    const header = root(legend).querySelector<HTMLElement>('.legend-header')!;
    const title = root(legend).querySelector<HTMLElement>('.legend-title')!;
    const legendRect = legend.getBoundingClientRect();
    expect(header.getBoundingClientRect().height).toBeCloseTo(44, 0);
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis');
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    expect(title.getBoundingClientRect().height).toBeLessThan(24);
    expect(root(legend).querySelector('.legend-predicted')!.getBoundingClientRect().width).toBe(14);

    const titleRight = title.getBoundingClientRect().right;
    for (const button of [sortButton(legend), settingsButton(legend)]) {
      const rect = button.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(28, 0);
      expect(rect.height).toBeCloseTo(28, 0);
      expect(rect.left).toBeGreaterThanOrEqual(titleRight);
      expect(rect.right).toBeLessThanOrEqual(legendRect.right);
    }
  });
});
