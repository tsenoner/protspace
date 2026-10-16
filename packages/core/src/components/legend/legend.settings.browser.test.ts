import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { COLOR_SCHEMES } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement, flatContains } from '../kit/focus';
import { pushLayer } from '../kit/layers';
import { LEGEND_EVENTS } from './config';
import type { ProtspaceLegend } from './legend';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

beforeAll(() => {
  adoptTheme();
  // The layer stack installs its window listeners on first use: install them now, so the spy in
  // the last case sees only listeners the legend adds.
  pushLayer({ close() {}, elements: [] })();
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Counts the item passes: `perfCounters.legendUpdate` and `legendRebuild` are incremented once
 * each, at the start of `LegendDataController.updateItems` (reached only through the element's
 * `_updateLegendItems`) and `rebuildItems`, so the spies count what the perf budgets count.
 */
function spies(legend: ProtspaceLegend) {
  const internals = legend as unknown as {
    _updateLegendItems(): void;
    _data: { rebuildItems(): void };
  };
  return {
    update: vi.spyOn(internals, '_updateLegendItems'),
    rebuild: vi.spyOn(internals._data, 'rebuildItems'),
  };
}

/** Until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
  await frame();
  await frame();
}

async function mount(data = categoricalData(TWELVE), annotation = 'family') {
  const mounted = await mountLegendWithScatterplot(data, annotation);
  await settle(mounted.legend);
  return mounted;
}

const popover = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;
const settingsButton = () => page.getByRole('button', { name: 'Legend settings', exact: true });
const dialog = (name: string | RegExp = /^Legend settings/) => page.getByRole('dialog', { name });

/** The stored legend record for `annotation`, found by its key's suffix. */
function stored(annotation = 'family'): Record<string, unknown> | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith('protspace:legend:') && key.endsWith(`:${annotation}`)) {
      return JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    }
  }
  return null;
}

async function openSettings(legend: ProtspaceLegend): Promise<void> {
  await userEvent.click(settingsButton());
  await settle(legend);
  await expect.element(dialog()).toBeVisible();
}

/** The element painted at a point, looking through every open shadow root. */
function deepElementFromPoint(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

describe('legend settings popover, mounted', () => {
  it('the settings button opens the popover under it, named Legend settings: Family, focus on the checked swatch, and closes it again', async () => {
    const { legend } = await mount();
    const customize = vi.fn();
    legend.addEventListener('legend-customize', customize);
    await openSettings(legend);

    await expect.element(dialog('Legend settings: Family')).toBeVisible();
    expect(customize).toHaveBeenCalledOnce();
    const button = settingsButton().element() as HTMLElement;
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = dialog().element() as HTMLElement;
    expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      button.getBoundingClientRect().bottom,
    );
    const focused = deepActiveElement();
    expect(focused?.getAttribute('role')).toBe('radio');
    expect(focused?.getAttribute('aria-checked')).toBe('true');
    expect(focused?.textContent?.trim()).toBe("Kelly's Colors");

    await userEvent.click(settingsButton());
    await settle(legend);
    expect(popover(legend).open).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(customize).toHaveBeenCalledOnce();
  });

  it('a palette pick recolours the rows, is stored at once and runs one legendUpdate', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    const { update, rebuild } = spies(legend);

    await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
    await settle(legend);

    expect(update).toHaveBeenCalledOnce();
    expect(rebuild).not.toHaveBeenCalled();
    const okabe = COLOR_SCHEMES.okabeIto.map((color) => color.toLowerCase());
    const fills = [
      ...legend.shadowRoot!.querySelectorAll(
        '.legend-item:not(.legend-item-other) .legend-symbol path',
      ),
    ].map((path) => (path.getAttribute('fill') ?? '').toLowerCase());
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) expect(okabe).toContain(fill);
    expect(stored()?.selectedPaletteId).toBe('okabeIto');
    expect(popover(legend).open).toBe(true);
    await expect
      .element(page.getByRole('radio', { name: 'Okabe-Ito' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('Max legend items 25 typed then Escape keeps 25 in storage', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('25');
    // Escape before the debounce ends: the pending value is applied, not dropped.
    await userEvent.keyboard('{Escape}');
    await settle(legend);

    expect(popover(legend).open).toBe(false);
    expect(legend.maxVisibleValues).toBe(25);
    expect(stored()?.maxVisibleValues).toBe(25);
    expect(legend.shadowRoot!.querySelector('.legend-item-other')).toBeNull();
    expect(legend.shadowRoot!.querySelectorAll('.legend-item')).toHaveLength(12);
  });

  it('a burst of input runs one legendRebuild', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    const { rebuild } = spies(legend);

    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('25');
    await expect.poll(() => stored()?.maxVisibleValues).toBe(25);
    await settle(legend);

    // One committed edit: one rebuild (`updated()` rebuilds once because maxVisibleValues changed).
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('Reset keeps the popover open with the defaults and focuses the checked swatch', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
    await settle(legend);
    const reset = page.getByRole('button', { name: 'Reset', exact: true });
    await expect.element(reset).toBeEnabled();

    await userEvent.click(reset);
    await settle(legend);

    expect(popover(legend).open).toBe(true);
    await expect
      .element(page.getByRole('radio', { name: "Kelly's Colors" }))
      .toHaveAttribute('aria-checked', 'true');
    expect(stored()).toBeNull();
    await expect.element(reset).toBeDisabled();
    expect(deepActiveElement()?.textContent?.trim()).toBe("Kelly's Colors");
  });

  it('a press on the Bin distribution select is inside the popover, and choosing an option keeps it open', async () => {
    const { legend } = await mount(numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'length');
    expect(popover(legend).numeric).toBe(true);
    await openSettings(legend);
    const select = page.getByRole('combobox', { name: 'Bin distribution' });
    const native = select.element() as HTMLSelectElement;
    // The press a click on the select makes, which opens its picker: inside the panel.
    native.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    native.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await userEvent.selectOptions(select, 'linear');
    await settle(legend);

    expect(popover(legend).open).toBe(true);
    const numericSettings = stored('length')?.numericSettings as { strategy?: string } | undefined;
    expect(numericSettings?.strategy).toBe('linear');
  });

  it('the popover is topmost over a docked-structure stand-in', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    // The docked structure's section sits at z-index 3 beside the sidebar (phase 2).
    const standIn = document.createElement('div');
    standIn.style.cssText = 'position: fixed; inset: 0; z-index: 3;';
    document.body.append(standIn);
    const panel = dialog().element() as HTMLElement;
    const box = panel.getBoundingClientRect();
    for (const [x, y] of [
      [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + 12, box.top + 12],
      [box.right - 12, box.bottom - 12],
    ]) {
      expect(flatContains(panel, deepElementFromPoint(x, y)), `${x},${y}`).toBe(true);
    }
  });

  it('after closing, Escape reaches a document keydown listener and the legend adds no window keydown listener', async () => {
    const { legend } = await mount();
    const added = vi.spyOn(window, 'addEventListener');
    await openSettings(legend);
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(popover(legend).open).toBe(false);

    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    try {
      await userEvent.keyboard('{Escape}');
      expect(onKey).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener('keydown', onKey);
    }
    const types = added.mock.calls.map(([type]) => type);
    expect(types).not.toContain('keydown');
    expect(types).not.toContain('mousedown');
    expect(types).not.toContain('mouseup');
  });

  it('an annotation change closes the popover; a value typed is kept for the annotation it was typed for', async () => {
    const data = categoricalData(TWELVE);
    const kind = categoricalData(TWELVE, 'kind');
    data.annotations.kind = kind.annotations.kind;
    data.annotation_data.kind = kind.annotation_data.kind;
    const { legend, plot, picker } = await mount(data);
    await openSettings(legend);
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('5');

    // Before the debounce ends.
    plot.selectedAnnotation = 'kind';
    picker.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.ANNOTATION_CHANGE, {
        detail: { annotation: 'kind' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(legend);

    expect(legend.selectedAnnotation).toBe('kind');
    expect(popover(legend).open).toBe(false);
    expect(stored('family')?.maxVisibleValues).toBe(5);
    expect(stored('kind')?.maxVisibleValues).not.toBe(5);
    expect(legend.maxVisibleValues).toBe(10);
  });

  it('the annotation set from outside closes the popover and drops a value typed for the old one', async () => {
    const data = categoricalData(TWELVE);
    const kind = categoricalData(TWELVE, 'kind');
    data.annotations.kind = kind.annotations.kind;
    data.annotation_data.kind = kind.annotation_data.kind;
    const { legend } = await mount(data);
    await openSettings(legend);
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('5');

    // Before the debounce ends, with no picker event: the old annotation cannot be flushed onto.
    legend.selectedAnnotation = 'kind';
    await settle(legend);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle(legend);

    expect(popover(legend).open).toBe(false);
    expect(stored('kind')?.maxVisibleValues).not.toBe(5);
    expect(legend.maxVisibleValues).toBe(10);
  });

  it('a new dataset closes the popover; a value typed is kept for the dataset it was typed for', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('5');

    legend.clearForNewDataset('next-dataset');
    await settle(legend);

    expect(popover(legend).open).toBe(false);
    expect(stored('family')?.maxVisibleValues).toBe(5);
  });

  it('a legend removed with the popover open and a value typed keeps the value and settles', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('5');

    legend.remove();
    legend.requestUpdate();

    // The flush applies the value (a few passes, as any edit takes), then the legend settles.
    let settled = false;
    for (let i = 0; i < 10 && !settled; i++) settled = await legend.updateComplete;
    expect(settled).toBe(true);
    expect(stored('family')?.maxVisibleValues).toBe(5);
  });
});
