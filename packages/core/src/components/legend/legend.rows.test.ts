// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
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
// The swatch opens the colour and shape picker, a ps-popover.
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
const swatch = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLElement>('.legend-swatch')!;
const handle = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.drag-handle')!;
const rowValues = (legend: ProtspaceLegend) =>
  [...legend.shadowRoot!.querySelectorAll('.legend-item')].map((each) =>
    each.getAttribute('data-value'),
  );
const tabbable = (legend: ProtspaceLegend, selector: string) =>
  [...legend.shadowRoot!.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => el.getAttribute('tabindex') === '0')
    .map((el) => el.closest('.legend-item')!.getAttribute('data-value'));

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

  it('a hidden row keeps .hidden, stays listed and has its one eye, crossed out, named Show', async () => {
    const { legend } = await mount(TWELVE);
    eye(legend, 'A').click();
    await settleLegend(legend);

    expect(rowValues(legend)).toContain('A');
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    // One control in the eye's slot, at rest and on hover alike: no second mark beside it.
    expect(row(legend, 'A').querySelectorAll('.legend-eye')).toHaveLength(1);
    expect(row(legend, 'A').querySelectorAll('svg').length).toBe(
      row(legend, 'B').querySelectorAll('svg').length,
    );
    expect(eye(legend, 'A').getAttribute('aria-label')).toBe('Show A');
  });

  it('a row has no ⋯ button: its hover controls are the handle and the eye', async () => {
    const { legend } = await mount(TWELVE);
    const buttons = [...row(legend, 'A').querySelectorAll('button')].map(
      (button) => button.getAttribute('aria-label')!,
    );
    expect(buttons).toEqual([
      'Reorder A',
      'Colour and shape for A',
      'A: 12 proteins, shown',
      'Hide A',
    ]);
    expect(legend.shadowRoot!.querySelector('ps-menu')).toBeNull();
  });

  it('the swatch is a button that opens and closes the colour and shape picker', async () => {
    const { legend } = await mount(TWELVE);
    const actions = watchActions(legend);
    const button = swatch(legend, 'B');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('Colour and shape for B');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.click();
    await settleLegend(legend);
    expect(legend._colorPicker.value).toBe('B');
    expect(swatch(legend, 'B').getAttribute('aria-expanded')).toBe('true');
    // It neither hides nor shows the row.
    expect(actions).toEqual([]);
    expect(row(legend, 'B').classList.contains('hidden')).toBe(false);

    swatch(legend, 'B').click();
    await settleLegend(legend);
    expect(legend._colorPicker.value).toBeNull();
    expect(swatch(legend, 'B').getAttribute('aria-expanded')).toBe('false');
  });

  it('a press on another row’s swatch moves the picker there', async () => {
    const { legend } = await mount(TWELVE);
    swatch(legend, 'A').click();
    await settleLegend(legend);
    swatch(legend, 'C').click();
    await settleLegend(legend);
    expect(legend._colorPicker.value).toBe('C');
    expect(swatch(legend, 'A').getAttribute('aria-expanded')).toBe('false');
  });

  it('Other and numeric rows keep a plain swatch, no button', async () => {
    const categorical = await mount(TWELVE);
    expect(swatch(categorical.legend, OTHER).tagName).toBe('SPAN');
    expect(swatch(categorical.legend, 'A').tagName).toBe('BUTTON');
    document.body.replaceChildren();

    const numeric = await mountLegendWithScatterplot(
      numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      'length',
    );
    const swatches = [
      ...numeric.legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item .legend-swatch'),
    ];
    expect(swatches.length).toBeGreaterThan(0);
    expect(swatches.every((each) => each.tagName === 'SPAN')).toBe(true);
  });

  it('I on a row still shows only it (double-click: legend.double-click.test.ts)', async () => {
    const { legend } = await mount(TWELVE);
    const actions = watchActions(legend);

    await press(legend, main(legend, 'A'), 'i');
    expect(actions).toEqual(['isolate:A']);
    expect(row(legend, 'B').classList.contains('hidden')).toBe(true);
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
    expect(tabbable(legend, '.legend-swatch-button')).toEqual(['C']);
  });

  it('the Tab stop stays on its category through a re-sort', async () => {
    const { legend } = await mount(TWELVE);
    main(legend, 'C').focus();
    await settleLegend(legend);

    legend._actions.toggleOrderDirection();
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

  it('renders no row menu and one ps-tooltip whatever the row count', async () => {
    const counts = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`C${index}`, 40 - index]),
    );
    const { legend } = await mount(counts);
    legend.maxVisibleValues = 40;
    await vi.waitFor(() =>
      expect(legend.shadowRoot!.querySelectorAll('.legend-item')).toHaveLength(40),
    );

    const root = legend.shadowRoot!;
    expect(root.querySelectorAll('ps-menu')).toHaveLength(0);
    expect(root.querySelectorAll('ps-tooltip.name-tooltip')).toHaveLength(1);
    expect(root.querySelectorAll('.legend-items ps-menu, .legend-items ps-tooltip')).toHaveLength(
      0,
    );
  });
});
