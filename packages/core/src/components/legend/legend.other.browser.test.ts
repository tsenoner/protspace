import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsPopover } from '../kit/popover';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import type { ProtspaceLegend } from './legend';
import type { ProtspaceLegendOtherPopover } from './legend-other-popover';
import { TWELVE, categoricalData } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

// Six categories by count: a (6) down to f (1).
const SIX = { a: 6, b: 5, c: 4, d: 3, e: 2, f: 1 } as const;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const root = (legend: ProtspaceLegend) => legend.shadowRoot!;
const otherPopover = (legend: ProtspaceLegend) =>
  root(legend).querySelector<ProtspaceLegendOtherPopover>('protspace-legend-other-popover')!;
const panel = (legend: ProtspaceLegend) =>
  otherPopover(legend)
    .shadowRoot!.querySelector<PsPopover>('ps-popover')!
    .shadowRoot!.querySelector<HTMLElement>('.panel')!;
const viewButton = (legend: ProtspaceLegend) =>
  root(legend).querySelector<HTMLButtonElement>('.legend-item-other .view-button');
const addButton = (legend: ProtspaceLegend, name: string) =>
  [
    ...otherPopover(legend).shadowRoot!.querySelectorAll<HTMLButtonElement>('button.other-add'),
  ].find((b) => b.getAttribute('aria-label') === `Add to legend: ${name}`)!;
const rowValues = (legend: ProtspaceLegend) =>
  [...root(legend).querySelectorAll<HTMLElement>('.legend-item')].map((row) => row.dataset.value!);
const firstRowMain = (legend: ProtspaceLegend) =>
  root(legend).querySelector<HTMLElement>('.legend-item .legend-item-main')!;

/** Wait until the legend and the popover stop re-rendering; the legend needs several passes. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await settleLegend(legend);
    await otherPopover(legend).updateComplete;
    await frame();
  }
}

async function mountWithOther(maxVisible: number): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(SIX), 'family');
  legend.maxVisibleValues = maxVisible;
  await settle(legend);
  return legend;
}

async function openOther(legend: ProtspaceLegend): Promise<void> {
  const view = viewButton(legend)!;
  view.focus();
  view.click();
  await settle(legend);
}

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

describe('the legend’s Other popover', () => {
  it('View opens the popover and sets aria-expanded', async () => {
    const legend = await mountWithOther(3);
    expect(rowValues(legend)).toEqual(['a', 'b', 'c', LEGEND_VALUES.OTHER]);
    const view = viewButton(legend)!;
    expect(view.getAttribute('aria-haspopup')).toBe('dialog');
    expect(view.getAttribute('aria-expanded')).toBe('false');

    await openOther(legend);

    expect(otherPopover(legend).open).toBe(true);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    expect(panel(legend).getAttribute('aria-label')).toBe('Other categories');
    expect(viewButton(legend)!.getAttribute('aria-expanded')).toBe('true');

    viewButton(legend)!.click();
    await settle(legend);
    expect(otherPopover(legend).open).toBe(false);
    expect(viewButton(legend)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a pointer reaches View past the row’s hover actions', async () => {
    const legend = await mountWithOther(3);
    legend.style.cssText = 'display: block; width: 240px;';
    await settle(legend);
    // A real pointer: the row's hover actions show as it arrives, and must not cover View.
    await userEvent.click(viewButton(legend)!, { timeout: 2000 });
    await settle(legend);
    expect(otherPopover(legend).open).toBe(true);
  });

  it('adding a category shows its row, keeps the popover open and focuses the next Add button', async () => {
    const legend = await mountWithOther(3);
    const actions: string[] = [];
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
      actions.push(`${e.detail.action}:${e.detail.value}`)) as EventListener);
    await openOther(legend);

    addButton(legend, 'e').click();
    await settle(legend);

    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'e', LEGEND_VALUES.OTHER]);
    expect(actions).toEqual(['extract:e']);
    expect(otherPopover(legend).open).toBe(true);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    expect(deepActiveElement()?.getAttribute('aria-label')).toBe('Add to legend: f');
    // The row re-render replaced the View button; the popover follows the new one.
    expect(otherPopover(legend).anchor).toBe(viewButton(legend));
    expect(viewButton(legend)!.getAttribute('aria-expanded')).toBe('true');
  });

  it('adding the last category removes Other, closes the popover and focuses the first row', async () => {
    const legend = await mountWithOther(5);
    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'd', 'e', LEGEND_VALUES.OTHER]);
    await openOther(legend);

    addButton(legend, 'f').click();
    await settle(legend);

    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(viewButton(legend)).toBeNull();
    expect(otherPopover(legend).open).toBe(false);
    expect(panel(legend).matches(':popover-open')).toBe(false);
    expect(deepActiveElement()).toBe(firstRowMain(legend));
  });

  it('Add all closes it', async () => {
    const legend = await mountWithOther(3);
    const onItemClick = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, onItemClick);
    await openOther(legend);

    (
      otherPopover(legend).shadowRoot!.querySelector('ps-button.other-add-all') as HTMLElement
    ).click();
    await settle(legend);

    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(onItemClick).toHaveBeenCalledTimes(3);
    expect(otherPopover(legend).open).toBe(false);
    expect(panel(legend).matches(':popover-open')).toBe(false);
    expect(deepActiveElement()).toBe(firstRowMain(legend));
  });

  it('after an add, Escape closes it and focuses the View button', async () => {
    const legend = await mountWithOther(3);
    await openOther(legend);
    addButton(legend, 'd').click();
    await settle(legend);
    expect(otherPopover(legend).open).toBe(true);

    escape();
    await settle(legend);

    expect(otherPopover(legend).open).toBe(false);
    expect(deepActiveElement()).toBe(viewButton(legend));
  });

  it('an annotation change closes it', async () => {
    // Two annotations with twelve categories each: the default ten rows leave two under Other.
    const data = categoricalData(TWELVE);
    const kind = categoricalData(TWELVE, 'kind');
    data.annotations.kind = kind.annotations.kind;
    data.annotation_data.kind = kind.annotation_data.kind;
    const { legend, plot, picker } = await mountLegendWithScatterplot(data, 'family');
    await settle(legend);
    await openOther(legend);
    expect(otherPopover(legend).open).toBe(true);

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
    expect(viewButton(legend)).not.toBeNull();
    expect(otherPopover(legend).open).toBe(false);
    expect(panel(legend).matches(':popover-open')).toBe(false);
  });

  it('a new dataset closes it', async () => {
    const legend = await mountWithOther(3);
    await openOther(legend);
    expect(otherPopover(legend).open).toBe(true);

    legend.clearForNewDataset('next-dataset');
    await settle(legend);

    expect(otherPopover(legend).open).toBe(false);
    expect(panel(legend).matches(':popover-open')).toBe(false);
  });

  it('a legend removed with the popover open settles', async () => {
    const legend = await mountWithOther(3);
    await openOther(legend);
    legend.remove();
    legend.requestUpdate();
    // Its View button is detached with it: following that button would update forever.
    expect(await legend.updateComplete).toBe(true);
  });

  it('the popover is topmost over a docked-structure stand-in', async () => {
    const legend = await mountWithOther(3);
    const standIn = document.createElement('div');
    standIn.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; background: grey';
    document.body.append(standIn);
    await openOther(legend);

    const rect = panel(legend).getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // Inside two shadow roots, the hit retargets to the legend host.
    expect(hit).toBe(legend);
  });
  it('in a right-hand sidebar it opens beside the legend, below the sidebar top, and leaves Other readable', async () => {
    await page.viewport(1440, 900);
    try {
      // The workbench at 1440 × 900: app bar and view bar above (92 px), the legend a 300 px
      // column to the right of the plot, the Other row about two thirds of the way down.
      // Enough categories under Other for the panel's full height.
      const counts = Object.fromEntries(
        Array.from({ length: 300 }, (_, i) => [`family ${String(i).padStart(3, '0')}`, 400 - i]),
      );
      const { legend } = await mountLegendWithScatterplot(categoricalData(counts), 'family');
      legend.style.cssText =
        'display: block; position: fixed; top: 92px; right: 44px; bottom: 0; width: 300px;';
      legend.maxVisibleValues = 14;
      await settle(legend);
      const other = root(legend).querySelector<HTMLElement>('.legend-item-other')!;
      expect(other.getBoundingClientRect().top).toBeGreaterThan(450);

      await userEvent.click(viewButton(legend)!);
      await settle(legend);
      expect(otherPopover(legend).open).toBe(true);

      const box = panel(legend).getBoundingClientRect();
      const legendBox = legend.getBoundingClientRect();
      expect(box.height).toBeGreaterThan(400);
      expect(box.top).toBeGreaterThanOrEqual(legendBox.top);
      expect(box.bottom).toBeLessThanOrEqual(900);
      // Over the plot, not over the list it was opened from.
      expect(box.right).toBeLessThanOrEqual(legendBox.left + 0.5);

      // The open row's count stays whole and on top beside View and the eye.
      const count = other.querySelector<HTMLElement>('.legend-count')!;
      const countBox = count.getBoundingClientRect();
      expect(count.scrollWidth).toBeLessThanOrEqual(count.clientWidth);
      expect(countBox.right).toBeLessThanOrEqual(other.getBoundingClientRect().right + 0.5);
      const y = countBox.top + countBox.height / 2;
      expect(root(legend).elementFromPoint(countBox.left + 2, y)).toBe(count);
      expect(root(legend).elementFromPoint(countBox.right - 2, y)).toBe(count);
      expect(countBox.left).toBeGreaterThanOrEqual(
        other.querySelector('.view-button')!.getBoundingClientRect().right,
      );
    } finally {
      await page.viewport(414, 896);
    }
  });
});
