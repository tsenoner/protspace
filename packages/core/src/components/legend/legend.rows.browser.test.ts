import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu } from '../kit/menu';
import type { PsTooltip } from '../kit/tooltip';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import { NAME_TOOLTIP_DELAY_MS } from './legend-list';
import { TWELVE, categoricalData } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

/** A 70-character family name, the kind Pfam and Swiss-Prot hand the legend. */
const LONG = 'Phosphatidylinositol 3,4,5-trisphosphate 3-phosphatase and dual-specificity'.slice(
  0,
  70,
);

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 800);
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function settle(legend: ProtspaceLegend): Promise<void> {
  await legend.updateComplete;
  await frame();
  await frame();
}

/** The legend at the sidebar's 240 px minimum, a long name over a short one. */
async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(
    categoricalData({ [LONG]: 123456, Short: 3 }),
    'family',
  );
  legend.style.width = '240px';
  await settle(legend);
  return legend;
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${CSS.escape(value)}"]`)!;
const part = (legend: ProtspaceLegend, value: string, selector: string) =>
  row(legend, value).querySelector<HTMLElement>(selector)!;
const opacity = (el: Element) => getComputedStyle(el).opacity;

describe('legend rows in a browser', () => {
  it('a row is 28 px tall', async () => {
    const legend = await mount();
    expect(row(legend, 'Short').getBoundingClientRect().height).toBeCloseTo(28, 0);
    expect(row(legend, LONG).getBoundingClientRect().height).toBeCloseTo(28, 0);
  });

  it('at 240 px a 70-character name stays on one line, ends in an ellipsis, and the count of 123,456 is fully visible', async () => {
    expect(LONG).toHaveLength(70);
    const legend = await mount();
    const rowBox = row(legend, LONG).getBoundingClientRect();
    const text = part(legend, LONG, '.legend-text');
    const count = part(legend, LONG, '.legend-count');
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);

    expect(text.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 1.5);
    expect(getComputedStyle(text).textOverflow).toBe('ellipsis');
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);

    expect(count.textContent!.trim()).toBe('123,456');
    expect(count.scrollWidth).toBeLessThanOrEqual(count.clientWidth);
    const countBox = count.getBoundingClientRect();
    expect(countBox.right).toBeLessThanOrEqual(rowBox.right + 0.5);
    expect(countBox.left).toBeGreaterThanOrEqual(text.getBoundingClientRect().right - 0.5);
    expect(part(legend, LONG, '.legend-item-main').getAttribute('aria-label')).toBe(
      `${LONG}: 123,456 proteins, shown`,
    );
  });

  it('at 240 px the Other row keeps the count column and room for its label, and View stays reachable on hover', async () => {
    const { legend } = await mountLegendWithScatterplot(
      categoricalData({ a: 61729, b: 61728, c: 61728 }),
      'family',
    );
    legend.style.width = '240px';
    legend.maxVisibleValues = 1;
    await settle(legend);
    await settle(legend);
    const other = row(legend, LEGEND_VALUES.OTHER);
    const right = (value: string, selector: string) =>
      part(legend, value, selector).getBoundingClientRect().right;
    expect(part(legend, LEGEND_VALUES.OTHER, '.legend-count').textContent!.trim()).toBe('123,456');

    await userEvent.hover(part(legend, LEGEND_VALUES.OTHER, '.legend-item-main'));
    await expect
      .poll(() => opacity(part(legend, LEGEND_VALUES.OTHER, '.legend-item-actions')))
      .toBe('1');

    expect(right(LEGEND_VALUES.OTHER, '.legend-count')).toBeCloseTo(right('a', '.legend-count'), 0);
    expect(right(LEGEND_VALUES.OTHER, '.legend-count')).toBeLessThanOrEqual(
      other.getBoundingClientRect().right,
    );
    expect(part(legend, LEGEND_VALUES.OTHER, '.legend-text').clientWidth).toBeGreaterThanOrEqual(
      60,
    );

    const view = part(legend, LEGEND_VALUES.OTHER, '.view-button');
    const box = view.getBoundingClientRect();
    const y = box.top + box.height / 2;
    for (const x of [box.left + box.width / 2, box.right - 1]) {
      expect(legend.shadowRoot!.elementFromPoint(x, y)?.closest('.view-button')).toBe(view);
    }
    await userEvent.unhover(part(legend, LEGEND_VALUES.OTHER, '.legend-item-main'));
  });

  it('at 240 px "Other · 2 categories" fits beside a short count', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    legend.style.width = '240px';
    await settle(legend);
    await settle(legend);
    const text = part(legend, LEGEND_VALUES.OTHER, '.legend-text');
    expect(text.textContent).toMatch(/2 categories/);
    expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
  });

  it('the actions are transparent at rest and opaque on hover and focus-within, and never move the label', async () => {
    const legend = await mount();
    const actions = part(legend, 'Short', '.legend-item-actions');
    const label = part(legend, 'Short', '.legend-text');
    const count = part(legend, 'Short', '.legend-count');
    const before = label.getBoundingClientRect();
    const countBefore = count.getBoundingClientRect();
    expect(opacity(actions)).toBe('0');
    // At rest the actions take no room: the count sits one gap after the name's button.
    expect(actions.getBoundingClientRect().width).toBe(0);
    expect(
      countBefore.left - part(legend, 'Short', '.legend-item-main').getBoundingClientRect().right,
    ).toBeCloseTo(8, 0);

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(actions)).toBe('1');
    expect(label.getBoundingClientRect().left).toBe(before.left);
    expect(count.getBoundingClientRect().right).toBeCloseTo(countBefore.right, 0);

    await userEvent.unhover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(actions)).toBe('0');

    part(legend, 'Short', '.legend-item-main').focus();
    await expect.poll(() => opacity(actions)).toBe('1');
  });

  it('at 240 px a hovered row shows eye, handle and ⋯ before a count that stays visible, and its name ends in an ellipsis', async () => {
    const legend = await mount();
    await userEvent.hover(part(legend, LONG, '.legend-item-main'));
    const actions = part(legend, LONG, '.legend-item-actions');
    await expect.poll(() => opacity(actions)).toBe('1');

    const rowBox = row(legend, LONG).getBoundingClientRect();
    const text = part(legend, LONG, '.legend-text');
    const count = part(legend, LONG, '.legend-count');
    const box = (selector: string) => part(legend, LONG, selector).getBoundingClientRect();
    const [eye, handle, more, countBox] = [
      box('.legend-eye'),
      box('.drag-handle'),
      box('.legend-more'),
      count.getBoundingClientRect(),
    ];
    expect(eye.right).toBeLessThanOrEqual(handle.left + 0.5);
    expect(handle.right).toBeLessThanOrEqual(more.left + 0.5);
    expect(more.right).toBeLessThanOrEqual(countBox.left + 0.5);
    expect(countBox.right).toBeLessThanOrEqual(rowBox.right + 0.5);

    // The count is on top where it is drawn, and drawn in full.
    expect(count.textContent!.trim()).toBe('123,456');
    expect(count.scrollWidth).toBeLessThanOrEqual(count.clientWidth);
    const y = countBox.top + countBox.height / 2;
    expect(legend.shadowRoot!.elementFromPoint(countBox.left + 2, y)).toBe(count);
    expect(legend.shadowRoot!.elementFromPoint(countBox.right - 2, y)).toBe(count);

    // The name gives way to the actions and ends in an ellipsis rather than under them.
    expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(eye.left + 0.5);
    expect(getComputedStyle(text).textOverflow).toBe('ellipsis');
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
    await userEvent.unhover(part(legend, LONG, '.legend-item-main'));
  });

  it('at 240 px the handle a hover reveals is under the pointer, and dragging it reorders the rows', async () => {
    const legend = await mount();
    const order = () =>
      [...legend.shadowRoot!.querySelectorAll('.legend-item')].map((el) =>
        el.getAttribute('data-value'),
      );
    expect(order()).toEqual([LONG, 'Short']);

    // Shown, the strip moves the handle to where the name gave way; it must be on top there.
    await userEvent.hover(part(legend, LONG, '.legend-item-main'));
    await expect.poll(() => opacity(part(legend, LONG, '.legend-item-actions'))).toBe('1');
    const handle = part(legend, LONG, '.drag-handle');
    const box = handle.getBoundingClientRect();
    const hit = legend.shadowRoot!.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    expect(hit?.closest('.drag-handle')).toBe(handle);

    await userEvent.dragAndDrop(handle, part(legend, 'Short', '.legend-item-main'));
    await expect.poll(order).toEqual(['Short', LONG]);
  });

  it('hovering a truncated name shows its full text after 500 ms; a name that fits shows nothing', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');

    await userEvent.hover(part(legend, LONG, '.legend-item-main'));
    expect(shown()).toBe(false);
    await expect.poll(shown, { timeout: NAME_TOOLTIP_DELAY_MS + 1000 }).toBe(true);
    expect(tooltip.text).toBe(LONG);

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    expect(shown()).toBe(false);
    await pause(NAME_TOOLTIP_DELAY_MS + 200);
    expect(shown()).toBe(false);
  });

  it('the ⋯ menu opens on its button, and Show only this isolates', async () => {
    const legend = await mount();
    const actions: string[] = [];
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((event: CustomEvent) => {
      actions.push(`${event.detail.action}:${event.detail.value}`);
    }) as EventListener);
    const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await userEvent.click(part(legend, 'Short', '.legend-more'));
    await settle(legend);
    expect(menu.open).toBe(true);
    expect(part(legend, 'Short', '.legend-more').getAttribute('aria-expanded')).toBe('true');

    const item = [...menu.querySelectorAll('ps-menu-item')].find(
      (each) => each.textContent!.trim() === 'Show only this',
    )!;
    await userEvent.click(item);
    await settle(legend);

    expect(actions).toEqual(['isolate:Short']);
    expect(row(legend, LONG).classList.contains('hidden')).toBe(true);
    expect(menu.open).toBe(false);
  });

  it('a row selected in the plot outlines its symbol in the accent, 2 px', async () => {
    const legend = await mount();
    legend.selectedItems = ['Short'];
    await settle(legend);

    const probe = document.createElement('span');
    probe.style.color = 'var(--ps-accent)';
    legend.shadowRoot!.append(probe);
    const path = part(legend, 'Short', '.legend-symbol path');
    expect(getComputedStyle(path).stroke).toBe(getComputedStyle(probe).color);
    expect(getComputedStyle(path).strokeWidth).toBe('2px');
    probe.remove();
  });

  it('under a coarse pointer rows are 40 px and the actions always show', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      // Touch emulation flips the pointer media feature; fail loudly if this Chromium does not.
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const legend = await mount();
      expect(row(legend, 'Short').getBoundingClientRect().height).toBeCloseTo(40, 0);
      expect(opacity(part(legend, 'Short', '.legend-item-actions'))).toBe('1');
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
