import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsPopover } from '../kit/popover';
import { NA_VALUE } from './config';
import { OTHER_POPOVER_ROW_LIMIT, type ProtspaceLegendOtherPopover } from './legend-other-popover';
import type { OtherItem } from './types';
import './legend-other-popover';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle(el: ProtspaceLegendOtherPopover): Promise<void> {
  await el.updateComplete;
  await frame();
  await frame();
}

const innerPopover = (el: ProtspaceLegendOtherPopover) =>
  el.shadowRoot!.querySelector<PsPopover>('ps-popover')!;
const panel = (el: ProtspaceLegendOtherPopover) =>
  innerPopover(el).shadowRoot!.querySelector<HTMLElement>('.panel')!;
const searchInput = (el: ProtspaceLegendOtherPopover) =>
  el.shadowRoot!.querySelector('ps-input')!.shadowRoot!.querySelector('input')!;
const rowNames = (el: ProtspaceLegendOtherPopover) =>
  [...el.shadowRoot!.querySelectorAll('.other-item-name')].map((n) => n.textContent!.trim());
const rowCounts = (el: ProtspaceLegendOtherPopover) =>
  [...el.shadowRoot!.querySelectorAll('.other-item-count')].map((n) => n.textContent!.trim());
const addButtons = (el: ProtspaceLegendOtherPopover) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button.other-add'),
];
const addButton = (el: ProtspaceLegendOtherPopover, name: string) =>
  addButtons(el).find((b) => b.getAttribute('aria-label') === `Add to legend: ${name}`)!;
const status = (el: ProtspaceLegendOtherPopover) =>
  el.shadowRoot!.querySelector('.other-status')!.textContent!.trim();

function escape(): void {
  (deepActiveElement() ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

async function mount(items: readonly OtherItem[]) {
  document.body.innerHTML = `<button id="view">View</button><button id="outside">Outside</button>`;
  const anchor = document.getElementById('view')!;
  const el = document.createElement('protspace-legend-other-popover');
  el.items = items;
  el.anchor = anchor;
  document.body.append(el);
  await el.updateComplete;
  return { el, anchor };
}

async function open(el: ProtspaceLegendOtherPopover, anchor: HTMLElement): Promise<void> {
  anchor.focus();
  el.open = true;
  await settle(el);
}

async function search(el: ProtspaceLegendOtherPopover, text: string): Promise<void> {
  const input = searchInput(el);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(el);
}

const MIXED: OtherItem[] = [
  { value: 'beta', count: 2 },
  { value: 'alpha', count: 2 },
  { value: 'gamma', count: 1234 },
  { value: NA_VALUE, count: 1 },
];

describe('protspace-legend-other-popover', () => {
  it('lists items by count, largest first, then by name', async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    expect(rowNames(el)).toEqual(['gamma', 'alpha', 'beta', 'N/A']);
    expect(rowCounts(el)).toEqual(['1,234', '2', '2', '1']);
    expect(el.shadowRoot!.querySelector('.other-heading')!.textContent!.trim()).toBe(
      'Other · 4 categories',
    );
    expect(el.shadowRoot!.querySelector('.other-list')!.getAttribute('role')).toBe('list');
    expect(el.shadowRoot!.querySelector('ps-button.other-add-all')!.textContent!.trim()).toBe(
      'Add all (4)',
    );
  });

  it('search filters case-insensitively on display names, N/A included', async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    await search(el, 'n/a');
    expect(rowNames(el)).toEqual(['N/A']);
    await search(el, 'ALP');
    expect(rowNames(el)).toEqual(['alpha']);
    await search(el, 'zzz');
    expect(rowNames(el)).toEqual([]);
    expect(status(el)).toBe('No categories match “zzz”.');
    await search(el, '');
    expect(rowNames(el)).toHaveLength(4);
    expect(status(el)).toBe('');
  });

  it('Add to legend fires other-add with the raw value, __NA__ for N/A', async () => {
    const { el, anchor } = await mount(MIXED);
    const added: CustomEvent<{ value: string }>[] = [];
    el.addEventListener('other-add', (e) => added.push(e as CustomEvent<{ value: string }>));
    await open(el, anchor);
    addButton(el, 'N/A').click();
    addButton(el, 'gamma').click();
    expect(added.map((e) => e.detail.value)).toEqual([NA_VALUE, 'gamma']);
    expect(added[0].bubbles).toBe(false);
  });

  it('Add all fires once', async () => {
    const { el, anchor } = await mount(MIXED);
    const onAddAll = vi.fn();
    el.addEventListener('other-add-all', onAddAll);
    await open(el, anchor);
    (el.shadowRoot!.querySelector('ps-button.other-add-all') as HTMLElement).click();
    expect(onAddAll).toHaveBeenCalledOnce();
  });

  it("with 5,000 items it renders 200 rows and 'Showing 200 of 5,000'", async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      value: `family ${i}`,
      count: 5000 - i,
    }));
    const { el, anchor } = await mount(many);
    await open(el, anchor);
    expect(OTHER_POPOVER_ROW_LIMIT).toBe(200);
    expect(el.shadowRoot!.querySelectorAll('.other-item')).toHaveLength(200);
    expect(status(el)).toBe('Showing 200 of 5,000. Refine the search.');
    expect(el.shadowRoot!.querySelector('.other-heading')!.textContent!.trim()).toBe(
      'Other · 5,000 categories',
    );
    await search(el, 'family 4999');
    expect(rowNames(el)).toEqual(['family 4999']);
    expect(status(el)).toBe('');
  });

  it('the filter runs once per query, not per render', async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    const matches = () => (el as unknown as { _matches: readonly unknown[] })._matches;
    const all = matches();
    el.requestUpdate();
    await el.updateComplete;
    expect(matches()).toBe(all);

    await search(el, 'a');
    const filtered = matches();
    expect(filtered).not.toBe(all);
    el.requestUpdate();
    await el.updateComplete;
    expect(matches()).toBe(filtered);
  });

  it('Escape and an outside press close it and return focus to View', async () => {
    const { el, anchor } = await mount(MIXED);
    const onClose = vi.fn();
    el.addEventListener('ps-close', onClose);
    await open(el, anchor);

    escape();
    await settle(el);
    expect(onClose).toHaveBeenCalledOnce();
    expect(el.open).toBe(false);
    expect(panel(el).matches(':popover-open')).toBe(false);
    expect(document.activeElement).toBe(anchor);

    await open(el, anchor);
    expect(panel(el).matches(':popover-open')).toBe(true);
    press(document.getElementById('outside')!);
    await settle(el);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(el.open).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('the panel is a dialog named Other categories and the search field has focus on open', async () => {
    const { el, anchor } = await mount(MIXED);
    expect(el.shadowRoot!.querySelector('.other-popover')).toBeNull();
    await open(el, anchor);
    expect(panel(el).getAttribute('role')).toBe('dialog');
    expect(panel(el).getAttribute('aria-label')).toBe('Other categories');
    expect(panel(el).matches(':popover-open')).toBe(true);
    const focused = deepActiveElement()!;
    expect(focused).toBe(searchInput(el));
    expect(focused.getAttribute('aria-label')).toBe('Search Other categories');
    expect(focused.getAttribute('placeholder')).toBe('Search');
  });

  it("each Add button's name includes its category", async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    expect(addButtons(el).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Add to legend: gamma',
      'Add to legend: alpha',
      'Add to legend: beta',
      'Add to legend: N/A',
    ]);
    expect(addButtons(el).every((b) => b.textContent!.trim() === 'Add to legend')).toBe(true);
    expect(el.shadowRoot!.querySelector('[title]')).toBeNull();
  });

  it('after an add, focus moves to the next row’s button, then to the search field', async () => {
    const { el, anchor } = await mount([
      { value: 'a', count: 3 },
      { value: 'b', count: 2 },
      { value: 'c', count: 1 },
    ]);
    // The owner removes an added category from the list, as the legend does.
    el.addEventListener('other-add', (e) => {
      const { value } = (e as CustomEvent<{ value: string }>).detail;
      el.items = el.items.filter((item) => item.value !== value);
    });
    await open(el, anchor);

    addButton(el, 'b').click();
    await settle(el);
    expect(deepActiveElement()).toBe(addButton(el, 'c'));

    addButton(el, 'c').click();
    await settle(el);
    expect(deepActiveElement()).toBe(addButton(el, 'a'));

    addButton(el, 'a').click();
    await settle(el);
    expect(addButtons(el)).toHaveLength(0);
    expect(deepActiveElement()).toBe(searchInput(el));
  });
});
