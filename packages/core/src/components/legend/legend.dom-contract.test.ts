// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

// Hidden values persist per dataset: an in-memory store keeps one test's clicks out of the next.
vi.stubGlobal('localStorage', createLocalStorageMock());

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function mount(data: VisualizationData, annotation = 'family'): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, annotation);
  await settleLegend(legend);
  return legend;
}

const rows = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item'));
const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ten rows by count, N/A (20) first; J, K and L are grouped under Other. */
const SHOWN = ['__NA__', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'Other'];

describe('legend DOM contract', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders each row as a list item directly inside the items list', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const list = legend.shadowRoot!.querySelector<HTMLElement>('.legend-items')!;

    expect(list.getAttribute('part')).toBe('items');
    expect(list.getAttribute('role')).toBe('list');
    expect(rows(legend).map((item) => item.dataset.value)).toEqual(SHOWN);
    for (const item of rows(legend)) {
      // Sortable moves the rows as direct children of the list.
      expect(item.parentElement).toBe(list);
      expect(item.getAttribute('part')).toBe('item');
      expect(item.getAttribute('role')).toBe('listitem');
      expect(item.dataset.displayValue).toBeTruthy();
    }
  });

  it('marks the Other row for the tour and gives it a View button; N/A reads "N/A"', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const other = row(legend, 'Other');

    expect(other.classList.contains('legend-item-other')).toBe(true);
    expect(other.dataset.driverId).toBe('other-row');
    expect(
      other.querySelector<HTMLButtonElement>('button.view-button')!.getAttribute('aria-label'),
    ).toBe('View items grouped under Other');

    const na = row(legend, '__NA__');
    expect(na.dataset.displayValue).toBe('N/A');
    expect(na.querySelector('.legend-text')!.textContent!.trim()).toBe('N/A');
  });

  it('names each main button "{label}: N proteins, shown|hidden" and toggles .hidden on click', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    for (const item of rows(legend)) {
      const main = item.querySelector<HTMLButtonElement>('button.legend-item-main')!;
      expect(main.getAttribute('aria-pressed')).toBe('true');
      expect(main.getAttribute('aria-label')).toMatch(
        // Other's label adds " · N categories" after its display value.
        new RegExp(
          `^${escapeRegExp(item.dataset.displayValue!)}( · [^:]*)?: [\\d,]+ proteins?, (shown|hidden)$`,
        ),
      );
    }

    row(legend, 'A')
      .querySelector<HTMLButtonElement>('.legend-item-main')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
    await settleLegend(legend);

    const main = row(legend, 'A').querySelector<HTMLButtonElement>('.legend-item-main')!;
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    expect(main.getAttribute('aria-pressed')).toBe('false');
    expect(main.getAttribute('aria-label')).toBe('A: 12 proteins, hidden');
  });

  it('renders once per toggle', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const render = vi.spyOn(legend as unknown as { render(): unknown }, 'render');
    row(legend, 'A')
      .querySelector<HTMLButtonElement>('.legend-item-main')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
    await settleLegend(legend);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps the parts and classes the e2e, perf, tour and docs scripts read', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const root = legend.shadowRoot!;

    expect(root.querySelector('.legend-container')!.getAttribute('part')).toBe('container');
    expect(root.querySelector('.legend-header')!.getAttribute('part')).toBe('header');
    expect(root.querySelector('.legend-title')!.textContent!.trim()).toBe('Family');
    for (const item of rows(legend)) {
      expect(item.querySelector('.legend-text')!.getAttribute('part')).toBe('text');
      expect(item.querySelector('.legend-count')!.getAttribute('part')).toBe('count');
      // Two steps: jsdom's selector engine misses `[part="symbol"] .legend-symbol path` on every
      // row after the first, although the DOM matches it.
      const symbol = item.querySelector('.legend-item-main [part="symbol"]')!;
      expect(symbol.querySelector('.legend-symbol path')!.getAttribute('fill')).toBeTruthy();
      expect(item.querySelector('button.drag-handle')).not.toBeNull();
    }
    expect(row(legend, 'A').querySelector('.legend-count')!.textContent!.trim()).toBe('12');

    const otherHandle = row(legend, 'Other').querySelector<HTMLButtonElement>('.drag-handle')!;
    expect(otherHandle.classList.contains('drag-handle-disabled')).toBe(true);
    expect(otherHandle.disabled).toBe(true);
    expect(row(legend, 'A').querySelector('.drag-handle-disabled')).toBeNull();
    expect(root.querySelector('.legend-symbol-button')).toBeNull();
  });

  it('shows the empty part when there is no data', async () => {
    const legend = document.createElement('protspace-legend');
    document.body.append(legend);
    await legend.updateComplete;

    const empty = legend.shadowRoot!.querySelector('.legend-empty')!;
    expect(empty.getAttribute('part')).toBe('empty');
    expect(empty.textContent!.trim()).toBe('No data available');
  });

  it('marks a predicted annotation with the predicted mark, not the predicted-note part', async () => {
    const legend = await mount(
      categoricalData({ yes: 3, no: 1 }, 'predicted_membrane'),
      'predicted_membrane',
    );
    const root = legend.shadowRoot!;
    expect(root.querySelector('[part="predicted-note"]')).toBeNull();
    expect(root.querySelector('.legend-predicted')?.getAttribute('aria-label')).toBe(
      'Predicted annotation',
    );
  });

  it('the View button announces the Other popover it opens', async () => {
    const legend = await mount(categoricalData(TWELVE));
    const root = legend.shadowRoot!;
    const view = root.querySelector('.legend-item-other button.view-button')!;
    expect(view.getAttribute('aria-haspopup')).toBe('dialog');
    expect(view.getAttribute('aria-expanded')).toBe('false');
    const popover = root.querySelector('.legend-container > protspace-legend-other-popover');
    expect(popover).not.toBeNull();
    expect(root.querySelector('.legend-items protspace-legend-other-popover')).toBeNull();
    expect(root.querySelector('[part="dialog-overlay"]')).toBeNull();
  });
});
