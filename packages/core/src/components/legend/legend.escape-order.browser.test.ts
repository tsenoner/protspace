import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import type { ProtspaceLegend } from './legend';
import { COLOR_COMMIT_DELAY_MS } from './legend-color-picker';
import type { ProtspaceLegendOtherPopover } from './legend-other-popover';
import { TWELVE, categoricalData } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

const cleanups: Array<() => void> = [];
beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 800);
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(legend: ProtspaceLegend): Promise<void> {
  await legend.updateComplete;
  await frame();
  await frame();
}

/** At the window's right edge, so the picker opens over empty space left of the legend. */
async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  legend.style.cssText = 'position: fixed; top: 0; right: 0; width: 240px; height: 480px;';
  await settle(legend);
  return legend;
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const handle = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.drag-handle')!;
const rowMenu = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
const picker = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsPopover>('ps-popover.color-picker')!;
const viewButton = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<HTMLButtonElement>('.legend-item-other .view-button')!;
const other = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<ProtspaceLegendOtherPopover>('protspace-legend-other-popover')!;
const order = (legend: ProtspaceLegend) =>
  [...legend.shadowRoot!.querySelectorAll('.legend-item')].map((each) =>
    each.getAttribute('data-value'),
  );
const picked = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('.legend-item.picked')?.getAttribute('data-value') ?? null;
const status = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim();

async function key(legend: ProtspaceLegend, target: HTMLElement, name: string): Promise<void> {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }),
  );
  await settle(legend);
}

async function openRowMenu(legend: ProtspaceLegend, value: string): Promise<void> {
  await userEvent.hover(row(legend, value).querySelector<HTMLElement>('.legend-item-main')!);
  await userEvent.click(row(legend, value).querySelector<HTMLElement>('.legend-more')!);
  await settle(legend);
}

async function choose(legend: ProtspaceLegend, label: string): Promise<void> {
  const item = [...rowMenu(legend).querySelectorAll('ps-menu-item')].find(
    (each) => each.textContent!.trim() === label,
  )!;
  await userEvent.click(item);
  await settle(legend);
}

/** Opens the picker as "Colour and shape" in the row menu does, without a press outside. */
async function openPickerFromMenu(legend: ProtspaceLegend, value: string): Promise<void> {
  row(legend, value).querySelector<HTMLButtonElement>('.legend-more')!.click();
  await settle(legend);
  rowMenu(legend).dispatchEvent(
    new CustomEvent('ps-select', {
      bubbles: true,
      composed: true,
      detail: { value: 'customize', checked: false },
    }),
  );
  await settle(legend);
}

function press(target: Element): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

describe('legend Escape order', () => {
  it("with a reorder in progress, the picker opened from the row menu and the menu open again over it, each Escape closes one: menu, then picker, then the reorder (restored, 'Reordering canceled.')", async () => {
    const legend = await mount();
    await key(legend, handle(legend, 'A'), ' ');
    await key(legend, handle(legend, 'A'), 'ArrowDown');
    expect(order(legend).slice(0, 2)).toEqual(['B', 'A']);
    expect(picked(legend)).toBe('A');

    await openRowMenu(legend, 'A');
    await choose(legend, 'Colour and shape');
    expect(rowMenu(legend).open).toBe(false);
    expect(picker(legend).open).toBe(true);
    // The row is the picker's anchor, so its own "⋯" opens the menu over the picker.
    await openRowMenu(legend, 'A');
    expect(rowMenu(legend).open).toBe(true);
    expect(picker(legend).open).toBe(true);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect([rowMenu(legend).open, picker(legend).open, picked(legend)]).toEqual([false, true, 'A']);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect([rowMenu(legend).open, picker(legend).open, picked(legend)]).toEqual([
      false,
      false,
      'A',
    ]);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(picked(legend)).toBeNull();
    expect(order(legend).slice(0, 2)).toEqual(['A', 'B']);
    expect(status(legend)).toBe('Reordering canceled.');
  });

  it('canceling a reorder puts the rows back but keeps a colour set during it', async () => {
    const legend = await mount();
    // Make the order manual first, so nothing re-derives the rows after the cancel.
    await key(legend, handle(legend, 'A'), ' ');
    await key(legend, handle(legend, 'A'), 'ArrowDown');
    await key(legend, handle(legend, 'A'), ' ');
    expect(order(legend).slice(0, 2)).toEqual(['B', 'A']);

    await key(legend, handle(legend, 'A'), ' ');
    await key(legend, handle(legend, 'A'), 'ArrowUp');
    await openRowMenu(legend, 'A');
    await choose(legend, 'Colour and shape');
    const swatch = legend.shadowRoot!.querySelector<HTMLInputElement>('.color-picker-swatch')!;
    swatch.value = '#00ff00';
    swatch.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, COLOR_COMMIT_DELAY_MS + 50));
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(picker(legend).open).toBe(false);
    expect(picked(legend)).toBe('A');

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(picked(legend)).toBeNull();
    expect(order(legend).slice(0, 2)).toEqual(['B', 'A']);
    expect(row(legend, 'A').querySelector('.legend-symbol path')!.getAttribute('fill')).toBe(
      '#00ff00',
    );
  });

  it('a press outside during a reorder does not cancel it', async () => {
    const legend = await mount();
    await key(legend, handle(legend, 'A'), ' ');

    press(document.body);
    await settle(legend);

    expect(picked(legend)).toBe('A');
  });

  it("with nothing of the legend's open, Escape reaches a document keydown listener", async () => {
    const legend = await mount();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    cleanups.push(() => document.removeEventListener('keydown', seen));

    row(legend, 'A').querySelector<HTMLElement>('.legend-item-main')!.focus();
    await userEvent.keyboard('{Escape}');

    expect(seen).toHaveBeenCalledOnce();
    expect((seen.mock.calls[0][0] as KeyboardEvent).key).toBe('Escape');
  });

  it('with a reorder in progress, the Other popover open and the picker over it, each Escape closes one: picker, then Other, then the reorder', async () => {
    const legend = await mount();
    await key(legend, handle(legend, 'A'), ' ');
    await key(legend, handle(legend, 'A'), 'ArrowDown');
    expect(picked(legend)).toBe('A');

    await userEvent.click(viewButton(legend));
    await settle(legend);
    await openPickerFromMenu(legend, 'A');
    expect([picker(legend).open, other(legend).open, picked(legend)]).toEqual([true, true, 'A']);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect([picker(legend).open, other(legend).open, picked(legend)]).toEqual([false, true, 'A']);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect([picker(legend).open, other(legend).open, picked(legend)]).toEqual([false, false, 'A']);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(picked(legend)).toBeNull();
    expect(order(legend).slice(0, 2)).toEqual(['A', 'B']);
  });

  it('the picker closes before the settings dialog, one per Escape', async () => {
    const legend = await mount();
    const root = legend.shadowRoot!;
    const open = () => ({
      picker: picker(legend).open,
      settings: root.querySelector('#legend-settings-dialog') !== null,
    });
    root.querySelector<HTMLElement>('ps-icon-button.settings-button')!.click();
    await settle(legend);
    // The dialog's overlay covers the rows, so the picker is opened as the menu would open it.
    await openPickerFromMenu(legend, 'A');
    expect(open()).toEqual({ picker: true, settings: true });

    // The layer stack's window listener is installed on the first layer push, so in this file it
    // usually runs before the legend's. Drive the legend's handler directly so the guard that
    // leaves Escape to an open layer is pinned whatever the install order.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    (
      legend as unknown as { _onWindowKeydownCapture(e: KeyboardEvent): void }
    )._onWindowKeydownCapture(escape);
    await settle(legend);
    expect(escape.defaultPrevented).toBe(false);
    expect(open()).toEqual({ picker: true, settings: true });

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(open()).toEqual({ picker: false, settings: true });

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(open()).toEqual({ picker: false, settings: false });
  });

  it('the settings dialog still closes on Escape', async () => {
    const legend = await mount();
    const root = legend.shadowRoot!;

    root.querySelector<HTMLElement>('ps-icon-button.settings-button')!.click();
    await settle(legend);
    expect(root.querySelector('#legend-settings-dialog')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(root.querySelector('#legend-settings-dialog')).toBeNull();
  });

  it('the Other popover closes on the first Escape; the next reaches the document', async () => {
    const legend = await mount();
    const view = viewButton(legend);
    view.focus();
    view.click();
    await settle(legend);
    expect(other(legend).open).toBe(true);

    const onDocumentKey = vi.fn();
    document.addEventListener('keydown', onDocumentKey);
    cleanups.push(() => document.removeEventListener('keydown', onDocumentKey));
    const pressEscape = () =>
      (deepActiveElement() ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );

    pressEscape();
    await settle(legend);
    expect(other(legend).open).toBe(false);
    expect(onDocumentKey).not.toHaveBeenCalled();
    expect(deepActiveElement()).toBe(view);

    pressEscape();
    expect(onDocumentKey).toHaveBeenCalledOnce();
  });
});
