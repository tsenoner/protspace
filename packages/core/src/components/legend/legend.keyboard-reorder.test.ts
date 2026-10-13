// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());
// jsdom has no CSS.escape; after a move the legend refocuses the row's handle through it in a
// frame callback, which would otherwise throw outside the test.
vi.stubGlobal('CSS', { escape: (value: string) => value });

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function setup() {
  const { legend, plot } = await mountLegendWithScatterplot(
    categoricalData({ ...TWELVE, __NA__: 20 }),
    'family',
  );
  await settle(legend);
  return { legend, plot };
}

/** A key on a row's drag handle, from the handle, as a keyboard would send it. */
function handleKey(legend: ProtspaceLegend, value: string, key: string): void {
  legend
    .shadowRoot!.querySelector<HTMLButtonElement>(
      `.legend-item[data-value="${value}"] .drag-handle`,
    )!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
    );
}

const order = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item')).map(
    (row) => row.dataset.value,
  );
const status = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim();
const sortMode = (legend: ProtspaceLegend) => legend.getAllPersistedSettings().family.sortMode;

describe('legend keyboard reorder', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('picks a row up with Space on its handle and announces it', async () => {
    const { legend } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    expect(status(legend)).toBe('Picked up B for reordering');
    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'B', 'C']);
  });

  it('moves the picked row one place, switches to manual and fires one legend-zorder-change', async () => {
    const { legend, plot } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    const onZOrder = vi.fn();
    plot.addEventListener('legend-zorder-change', onZOrder);

    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);

    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'C', 'B']);
    expect(sortMode(legend)).toBe('manual');
    expect(onZOrder).toHaveBeenCalledOnce();
    // Task 3.6 changes this line to the display name.
    expect(status(legend)).toBe('Moved B. Switched family to Manual order.');

    // The switch to manual order is announced once, not on every later move.
    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);
    expect(status(legend)).toBe('Moved B.');
  });

  it('restores the order and the sort mode on Escape and announces it', async () => {
    const { legend } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);

    handleKey(legend, 'B', 'Escape');
    await settle(legend);

    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'B', 'C']);
    expect(sortMode(legend)).toBe('size-desc');
    expect(status(legend)).toBe('Reordering canceled.');
  });

  it("puts focus back on the picked row's handle after Escape", async () => {
    const { legend } = await setup();
    const handle = (v: string) =>
      legend.shadowRoot!.querySelector<HTMLElement>(
        `.legend-item[data-value="${v}"] .drag-handle`,
      )!;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    handle('B').focus();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);
    await frame();
    expect(legend.shadowRoot!.activeElement).toBe(handle('B'));

    handleKey(legend, 'B', 'Escape');
    await settle(legend);
    await frame();
    expect(legend.shadowRoot!.activeElement).toBe(handle('B'));
  });

  it('drops the row where it is on Enter and announces it', async () => {
    const { legend } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);

    handleKey(legend, 'B', 'Enter');
    await settle(legend);

    expect(status(legend)).toBe('Dropped B');
    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'C', 'B']);
    expect(sortMode(legend)).toBe('manual');
  });

  it('ignores Space on the Other handle; N/A is picked up like any category', async () => {
    const { legend } = await setup();
    handleKey(legend, 'Other', ' ');
    await settle(legend);
    expect(status(legend)).toBe('');

    handleKey(legend, '__NA__', ' ');
    await settle(legend);
    expect(status(legend)).toBe('Picked up N/A for reordering');
  });
});
