// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import type { PsMenu } from '../kit/menu';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import { TWELVE, categoricalData, numericData } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';
import { stubPopoverApi } from './test-support/popover-stub';

// Hidden values persist per dataset: an in-memory store keeps one test's clicks out of the next.
vi.stubGlobal('localStorage', createLocalStorageMock());
// jsdom has no CSS.escape; a cancelled reorder refocuses its handle through it in a frame callback.
vi.stubGlobal('CSS', { escape: (value: string) => value });
// The row menu opens a ps-popover.
stubPopoverApi();

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const OTHER = LEGEND_VALUES.OTHER;
/** Eleven categories: the default ten rows leave one in Other. */
const ELEVEN = Object.fromEntries(Object.entries(TWELVE).slice(0, 11));

const mount = (counts: Readonly<Record<string, number>>) =>
  mountLegendWithScatterplot(categoricalData(counts), 'family');

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const main = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-item-main')!;
const eye = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-eye')!;
const more = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-more');
const handle = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.drag-handle')!;
const rowMenu = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
const menuItems = (legend: ProtspaceLegend) =>
  [...rowMenu(legend).querySelectorAll('ps-menu-item')].map((item) => item.textContent!.trim());
const rowValues = (legend: ProtspaceLegend) =>
  [...legend.shadowRoot!.querySelectorAll('.legend-item')].map((each) =>
    each.getAttribute('data-value'),
  );
const tabbable = (legend: ProtspaceLegend, selector: string) =>
  [...legend.shadowRoot!.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => el.getAttribute('tabindex') === '0')
    .map((el) => el.closest('.legend-item')!.getAttribute('data-value'));

async function openMenu(legend: ProtspaceLegend, value: string): Promise<void> {
  more(legend, value)!.click();
  await settleLegend(legend);
}

/** What the menu dispatches after it has closed itself; jsdom cannot show it to click an item. */
async function choose(legend: ProtspaceLegend, value: string): Promise<void> {
  rowMenu(legend).dispatchEvent(
    new CustomEvent('ps-select', {
      bubbles: true,
      composed: true,
      detail: { value, checked: false },
    }),
  );
  await settleLegend(legend);
}

async function press(legend: ProtspaceLegend, target: HTMLElement, key: string): Promise<void> {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
  );
  await settleLegend(legend);
}

function watchActions(legend: ProtspaceLegend): string[] {
  const actions: string[] = [];
  legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((event: CustomEvent) => {
    actions.push(`${event.detail.action}:${event.detail.value}`);
  }) as EventListener);
  return actions;
}

describe('legend rows', () => {
  it("a row is named '{label}: 1 protein, shown'", async () => {
    const { legend } = await mount({ A: 1234, B: 1 });
    expect(main(legend, 'B').getAttribute('aria-label')).toBe('B: 1 protein, shown');
    expect(main(legend, 'B').getAttribute('aria-pressed')).toBe('true');
  });

  it("and '{label}: 1,234 proteins, hidden'", async () => {
    const { legend } = await mount({ A: 1234, B: 1 });
    main(legend, 'A').click();
    await settleLegend(legend);
    expect(main(legend, 'A').getAttribute('aria-label')).toBe('A: 1,234 proteins, hidden');
    expect(main(legend, 'A').getAttribute('aria-pressed')).toBe('false');
  });

  it('the count reads 1,234', async () => {
    const { legend } = await mount({ A: 1234, B: 1 });
    expect(row(legend, 'A').querySelector('.legend-count')!.textContent!.trim()).toBe('1,234');
  });

  it("the Other row reads 'Other · 1 category' / 'Other · 2 categories'", async () => {
    const otherLabel = (legend: ProtspaceLegend) =>
      row(legend, OTHER).querySelector('.legend-text')!.textContent!.trim();

    const eleven = await mount(ELEVEN);
    expect(otherLabel(eleven.legend)).toBe('Other · 1 category');
    expect(main(eleven.legend, OTHER).getAttribute('aria-label')).toBe(
      'Other · 1 category: 2 proteins, shown',
    );
    document.body.replaceChildren();

    const twelve = await mount(TWELVE);
    expect(otherLabel(twelve.legend)).toBe('Other · 2 categories');
  });

  it('the eye toggles and dispatches toggle, and is named Show on a hidden row', async () => {
    const { legend } = await mount(TWELVE);
    const actions = watchActions(legend);
    expect(eye(legend, 'A').getAttribute('aria-label')).toBe('Hide A');

    eye(legend, 'A').click();
    await settleLegend(legend);

    expect(actions).toEqual(['toggle:A']);
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    expect(eye(legend, 'A').getAttribute('aria-label')).toBe('Show A');
  });

  it('a hidden row keeps .hidden, stays listed and shows the hidden mark', async () => {
    const { legend } = await mount(TWELVE);
    eye(legend, 'A').click();
    await settleLegend(legend);

    expect(rowValues(legend)).toContain('A');
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    const mark = row(legend, 'A').querySelector('.legend-hidden-mark');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(row(legend, 'B').querySelector('.legend-hidden-mark')).toBeNull();
  });

  it('the menu offers Show only this and Colour and shape; Other has no ⋯; numeric rows offer only Show only this', async () => {
    const categorical = await mount(TWELVE);
    expect(more(categorical.legend, OTHER)).toBeNull();
    await openMenu(categorical.legend, 'A');
    expect(rowMenu(categorical.legend).open).toBe(true);
    expect(rowMenu(categorical.legend).label).toBe('Actions for A');
    expect(menuItems(categorical.legend)).toEqual(['Show only this', 'Colour and shape']);
    document.body.replaceChildren();

    const numeric = await mountLegendWithScatterplot(
      numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      'length',
    );
    const firstBin = numeric.legend.shadowRoot!.querySelector(
      '.legend-item:not(.legend-item-other)',
    )!;
    await openMenu(numeric.legend, firstBin.getAttribute('data-value')!);
    expect(menuItems(numeric.legend)).toEqual(['Show only this']);
  });

  it('Show only this dispatches isolate; on the only visible row it reads Show all', async () => {
    const { legend } = await mount(TWELVE);
    const actions = watchActions(legend);

    await openMenu(legend, 'A');
    await choose(legend, 'isolate');

    expect(actions).toEqual(['isolate:A']);
    expect(row(legend, 'B').classList.contains('hidden')).toBe(true);
    expect(rowMenu(legend).open).toBe(false);

    await openMenu(legend, 'A');
    expect(menuItems(legend)[0]).toBe('Show all');
  });

  it('every ⋯ is announced as a menu button, before and after the menu has opened', async () => {
    const { legend } = await mount(TWELVE);
    expect(more(legend, 'B')!.getAttribute('aria-haspopup')).toBe('menu');

    await openMenu(legend, 'A');
    await choose(legend, 'isolate');

    expect(more(legend, 'A')!.getAttribute('aria-haspopup')).toBe('menu');
    expect(more(legend, 'B')!.getAttribute('aria-haspopup')).toBe('menu');
  });

  it("Other's disabled handle is hidden from assistive tech; a row's handle is not", async () => {
    const { legend } = await mount(TWELVE);
    expect(handle(legend, OTHER).getAttribute('aria-hidden')).toBe('true');
    expect(handle(legend, 'A').hasAttribute('aria-hidden')).toBe(false);
  });

  it('only one row is tabbable, and focusing row 3 moves the stop there', async () => {
    const { legend } = await mount(TWELVE);
    expect(tabbable(legend, '.legend-item-main')).toEqual(['A']);

    main(legend, 'C').focus();
    await settleLegend(legend);

    expect(tabbable(legend, '.legend-item-main')).toEqual(['C']);
    expect(tabbable(legend, '.legend-eye')).toEqual(['C']);
    expect(tabbable(legend, '.drag-handle')).toEqual(['C']);
    expect(tabbable(legend, '.legend-more')).toEqual(['C']);
  });

  it('the Tab stop stays on its category through a re-sort', async () => {
    const { legend } = await mount(TWELVE);
    main(legend, 'C').focus();
    await settleLegend(legend);

    (legend as unknown as { _toggleLegendOrderDirection(): void })._toggleLegendOrderDirection();
    await settleLegend(legend);

    expect(rowValues(legend)[0]).not.toBe('A');
    expect(tabbable(legend, '.legend-item-main')).toEqual(['C']);
  });

  it('the Tab stop falls back to the first row when its category leaves the list', async () => {
    const { legend } = await mount(TWELVE);
    main(legend, 'C').focus();
    await settleLegend(legend);

    // With two rows shown, C folds into Other.
    legend.maxVisibleValues = 2;
    await settleLegend(legend);

    expect(rowValues(legend)).not.toContain('C');
    expect(tabbable(legend, '.legend-item-main')).toEqual([rowValues(legend)[0]]);
  });

  it('Space on the handle adds .picked and aria-pressed; Escape removes them', async () => {
    const { legend } = await mount(TWELVE);
    expect(handle(legend, 'A').getAttribute('aria-pressed')).toBe('false');

    await press(legend, handle(legend, 'A'), ' ');
    expect(row(legend, 'A').classList.contains('picked')).toBe(true);
    expect(handle(legend, 'A').getAttribute('aria-pressed')).toBe('true');

    await press(legend, handle(legend, 'A'), 'Escape');
    expect(row(legend, 'A').classList.contains('picked')).toBe(false);
    expect(handle(legend, 'A').getAttribute('aria-pressed')).toBe('false');
  });

  it('renders one ps-menu and one ps-tooltip whatever the row count', async () => {
    const counts = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`C${index}`, 40 - index]),
    );
    const { legend } = await mount(counts);
    legend.maxVisibleValues = 40;
    await vi.waitFor(() =>
      expect(legend.shadowRoot!.querySelectorAll('.legend-item')).toHaveLength(40),
    );

    const root = legend.shadowRoot!;
    expect(root.querySelectorAll('ps-menu.row-menu')).toHaveLength(1);
    expect(root.querySelectorAll('ps-tooltip.name-tooltip')).toHaveLength(1);
    expect(root.querySelectorAll('.legend-items ps-menu, .legend-items ps-tooltip')).toHaveLength(
      0,
    );
  });
});
