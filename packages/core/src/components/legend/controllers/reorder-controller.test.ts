/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtspaceLegend } from '../legend';
import { categoricalData, TWELVE } from '../test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from '../test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from '../test-support/local-storage-mock';
import { ReorderController } from './reorder-controller';

vi.stubGlobal('localStorage', createLocalStorageMock());

async function setup(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settleLegend(legend);
  return legend;
}

const reorder = (legend: ProtspaceLegend) =>
  (legend as unknown as { _reorder: ReorderController })._reorder;
const order = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item')).map(
    (row) => row.dataset.value,
  );
const sortMode = (legend: ProtspaceLegend) => legend.getAllPersistedSettings().family.sortMode;

describe('ReorderController', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('move promotes a sorted list to manual and moves the row one place', async () => {
    const legend = await setup();
    expect(reorder(legend)).toBeInstanceOf(ReorderController);
    expect(order(legend).slice(0, 3)).toEqual(['A', 'B', 'C']);

    const first = reorder(legend).move('B', -1);
    await settleLegend(legend);

    expect(first?.moved.value).toBe('B');
    expect(first?.promoted).toBe(true);
    expect(order(legend).slice(0, 3)).toEqual(['B', 'A', 'C']);
    expect(sortMode(legend)).toBe('manual');

    // Already manual: the next move promotes nothing, and the top row cannot move up.
    expect(reorder(legend).move('A', 1)?.promoted).toBe(false);
    await settleLegend(legend);
    expect(order(legend).slice(0, 3)).toEqual(['B', 'C', 'A']);
    expect(reorder(legend).move('B', -1)).toBeNull();
  });

  it('restore after a move puts the order back and keeps a colour changed meanwhile', async () => {
    const legend = await setup();
    // Manual first, so nothing re-derives the rows after the restore (as
    // legend.escape-order.browser.test.ts does).
    reorder(legend).move('B', -1);
    await settleLegend(legend);
    const snapshot = reorder(legend).snapshot();

    reorder(legend).move('C', -1);
    await settleLegend(legend);
    expect(order(legend).slice(0, 3)).toEqual(['B', 'C', 'A']);
    legend._legendItems = legend._legendItems.map((item) =>
      item.value === 'A' ? { ...item, color: '#00ff00' } : item,
    );
    await settleLegend(legend);

    reorder(legend).restore(snapshot);
    await settleLegend(legend);

    expect(order(legend).slice(0, 3)).toEqual(['B', 'A', 'C']);
    expect(sortMode(legend)).toBe('manual');
    expect(legend._legendItems.find((item) => item.value === 'A')?.color).toBe('#00ff00');
  });
});
