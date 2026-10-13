import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu } from '../kit/menu';
import type { PsTooltip } from '../kit/tooltip';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import { NAME_TOOLTIP_DELAY_MS } from './legend-list';
import { categoricalData } from './test-support/legend-fixtures';
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

  it('the actions are transparent at rest and opaque on hover and focus-within, and never move the label', async () => {
    const legend = await mount();
    const actions = part(legend, 'Short', '.legend-item-actions');
    const label = part(legend, 'Short', '.legend-text');
    const before = label.getBoundingClientRect();
    expect(opacity(actions)).toBe('0');

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(actions)).toBe('1');
    const hovered = label.getBoundingClientRect();
    expect([hovered.left, hovered.width]).toEqual([before.left, before.width]);

    await userEvent.unhover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(actions)).toBe('0');

    part(legend, 'Short', '.legend-item-main').focus();
    await expect.poll(() => opacity(actions)).toBe('1');
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
