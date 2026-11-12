import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { layOutForMouse } from '../../test-support/mouse-media';
import type { PsTooltip } from '../kit/tooltip';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import { legendStyles } from './legend.styles';
import { NAME_TOOLTIP_DELAY_MS, SWATCH_HINT } from './legend-list';
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
// Every test but the coarse-pointer one lays out for a mouse, whatever pointer the host reports.
let leaveMouse = () => {};
beforeEach(() => {
  leaveMouse = layOutForMouse(legendStyles);
});
afterEach(() => {
  leaveMouse();
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
    await expect.poll(() => opacity(part(legend, LEGEND_VALUES.OTHER, '.legend-eye'))).toBe('1');

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

  it('the eye is transparent at rest and opaque on hover and focus-within, and never moves the label', async () => {
    const legend = await mount();
    const actions = part(legend, 'Short', '.legend-eye');
    const label = part(legend, 'Short', '.legend-text');
    const count = part(legend, 'Short', '.legend-count');
    const before = label.getBoundingClientRect();
    const countBefore = count.getBoundingClientRect();
    expect(opacity(actions)).toBe('0');
    // At rest the eye takes no room: the count sits one gap after the name's button.
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

  it('at 240 px a hovered row shows the handle before the swatch, and the eye before a count that stays visible, and its name ends in an ellipsis', async () => {
    const legend = await mount();
    await userEvent.hover(part(legend, LONG, '.legend-item-main'));
    const actions = part(legend, LONG, '.legend-eye');
    await expect.poll(() => opacity(actions)).toBe('1');

    const rowBox = row(legend, LONG).getBoundingClientRect();
    const text = part(legend, LONG, '.legend-text');
    const count = part(legend, LONG, '.legend-count');
    const box = (selector: string) => part(legend, LONG, selector).getBoundingClientRect();
    const [eye, handle, countBox] = [
      box('.legend-eye'),
      box('.drag-handle'),
      count.getBoundingClientRect(),
    ];
    expect(handle.left).toBeGreaterThanOrEqual(rowBox.left - 0.5);
    // It hangs in the row's gutter, starting before the swatch, and takes no room from the row.
    expect(handle.left).toBeLessThan(box('.legend-symbol').left);
    expect(box('.legend-symbol').left - rowBox.left).toBeCloseTo(12, 0);
    // The swatch's button is a 24 px target centred on its 16 px mark.
    const swatch = box('.legend-swatch-button');
    expect(swatch.width).toBeCloseTo(24, 0);
    expect(swatch.left + swatch.width / 2).toBeCloseTo(
      box('.legend-symbol').left + box('.legend-symbol').width / 2,
      0,
    );
    expect(eye.right).toBeLessThanOrEqual(countBox.left + 0.5);
    expect(countBox.right).toBeLessThanOrEqual(rowBox.right + 0.5);
    expect(row(legend, LONG).querySelector('.legend-more')).toBeNull();

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

    // Shown, the handle must be on top where it is drawn.
    await userEvent.hover(part(legend, LONG, '.legend-item-main'));
    await expect.poll(() => opacity(part(legend, LONG, '.legend-eye'))).toBe('1');
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

  it('the eye says Hide or Show in the shared tooltip, after a hover or at once on keyboard focus', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await userEvent.hover(part(legend, 'Short', '.legend-eye'));
    await expect.poll(shown, { timeout: NAME_TOOLTIP_DELAY_MS + 1000 }).toBe(true);
    expect(tooltip.text).toBe('Hide');
    // The eye's own name stays the full one; the tooltip names nothing.
    expect(part(legend, 'Short', '.legend-eye').getAttribute('aria-label')).toBe('Hide Short');

    await userEvent.hover(part(legend, LONG, '.legend-count'));
    await expect.poll(shown).toBe(false);
    // From the row's name, Tab reaches the swatch and then the eye (keyboard focus is :focus-visible).
    part(legend, LONG, '.legend-item-main').focus();
    await settle(legend);
    for (
      let i = 0;
      i < 3 && legend.shadowRoot!.activeElement !== part(legend, LONG, '.legend-eye');
      i++
    ) {
      await userEvent.keyboard('{Tab}');
    }
    expect(legend.shadowRoot!.activeElement).toBe(part(legend, LONG, '.legend-eye'));
    await expect.poll(shown).toBe(true);
    expect(tooltip.text).toBe('Hide');
  });

  it("the eye's tooltip names its new action after a click within the delay, or a key on it", async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');
    const eye = () => part(legend, 'Short', '.legend-eye');

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await userEvent.hover(eye());
    await userEvent.click(eye());
    await settle(legend);
    expect(row(legend, 'Short').classList.contains('hidden')).toBe(true);
    await expect.poll(shown, { timeout: NAME_TOOLTIP_DELAY_MS + 1000 }).toBe(true);
    expect(tooltip.text).toBe('Show');

    // Keyboard: the tooltip open on the focused eye follows the toggle.
    await userEvent.hover(part(legend, LONG, '.legend-count'));
    await expect.poll(shown).toBe(false);
    part(legend, 'Short', '.legend-item-main').focus();
    await settle(legend);
    for (let i = 0; i < 3 && legend.shadowRoot!.activeElement !== eye(); i++) {
      await userEvent.keyboard('{Tab}');
    }
    expect(legend.shadowRoot!.activeElement).toBe(eye());
    await expect.poll(shown).toBe(true);
    expect(tooltip.text).toBe('Show');
    await userEvent.keyboard('{Enter}');
    await settle(legend);
    expect(row(legend, 'Short').classList.contains('hidden')).toBe(false);
    await expect.poll(() => tooltip.text).toBe('Hide');
  });

  it('a click on the swatch opens the picker and toggles nothing; a click on the name still hides', async () => {
    const legend = await mount();
    const actions: string[] = [];
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((event: CustomEvent) => {
      actions.push(`${event.detail.action}:${event.detail.value}`);
    }) as EventListener);
    const swatch = part(legend, 'Short', '.legend-swatch-button');

    await userEvent.click(swatch);
    await settle(legend);
    expect(legend._colorPicker.value).toBe('Short');
    expect(swatch.getAttribute('aria-expanded')).toBe('true');
    expect(actions).toEqual([]);

    // A second click on the same swatch closes it.
    await userEvent.click(part(legend, 'Short', '.legend-swatch-button'));
    await settle(legend);
    expect(legend._colorPicker.value).toBeNull();

    await userEvent.click(part(legend, 'Short', '.legend-item-main'));
    await settle(legend);
    expect(actions).toEqual(['toggle:Short']);
    expect(row(legend, 'Short').classList.contains('hidden')).toBe(true);
  });

  it('hovering the swatch rings it and, after 500 ms, says Change colour and shape', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');
    const swatch = part(legend, 'Short', '.legend-swatch-button');
    const ring = () => getComputedStyle(swatch, '::before').boxShadow;
    expect(ring()).toBe('none');
    expect(getComputedStyle(swatch).cursor).toBe('pointer');

    await userEvent.hover(swatch);
    await expect.poll(ring).not.toBe('none');
    await expect.poll(shown, { timeout: NAME_TOOLTIP_DELAY_MS + 1000 }).toBe(true);
    expect(tooltip.text).toBe(SWATCH_HINT);

    await userEvent.unhover(swatch);
    await expect.poll(shown).toBe(false);
  });

  it("a hidden row's crossed-out eye sits where it stays on hover: nothing moves", async () => {
    const legend = await mount();
    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(part(legend, 'Short', '.legend-eye'))).toBe('1');
    await userEvent.click(part(legend, 'Short', '.legend-eye'));
    await userEvent.unhover(part(legend, 'Short', '.legend-eye'));
    await settle(legend);
    expect(row(legend, 'Short').classList.contains('hidden')).toBe(true);

    const eye = part(legend, 'Short', '.legend-eye');
    const boxes = () =>
      ['.legend-eye', '.legend-count', '.legend-text'].map((selector) => {
        const box = part(legend, 'Short', selector).getBoundingClientRect();
        return [Math.round(box.left), Math.round(box.right)];
      });
    await expect.poll(() => opacity(eye)).toBe('1');
    const atRest = boxes();
    expect(eye.getBoundingClientRect().width).toBeCloseTo(24, 0);

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await settle(legend);
    expect(boxes()).toEqual(atRest);
    expect(eye.getAttribute('aria-label')).toBe('Show Short');
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

  /** Synthetic touch on a row's main button, at its name; `dx` moves the finger. */
  function touchOn(main: HTMLElement) {
    const box = main.getBoundingClientRect();
    const at = { x: box.left + 20, y: box.top + box.height / 2 };
    return (type: string, dx = 0) =>
      main.dispatchEvent(
        new PointerEvent(type, {
          pointerType: 'touch',
          pointerId: 7,
          isPrimary: true,
          bubbles: true,
          composed: true,
          clientX: at.x + dx,
          clientY: at.y,
          detail: type === 'click' ? 1 : 0,
        }),
      );
  }

  it('a 500 ms touch hold on a truncated name shows it, and the click that ends it does not toggle', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');
    const main = part(legend, LONG, '.legend-item-main');
    const touch = touchOn(main);

    touch('pointerdown');
    await pause(NAME_TOOLTIP_DELAY_MS - 200);
    expect(shown()).toBe(false);
    await expect.poll(shown, { timeout: 1000 }).toBe(true);
    expect(tooltip.text).toBe(LONG);

    touch('pointerup');
    touch('click');
    await settle(legend);
    expect(shown()).toBe(false);
    expect(main.getAttribute('aria-pressed')).toBe('true');
  });

  it('moving 12 px first cancels it, and the tap toggles', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');
    const main = part(legend, LONG, '.legend-item-main');
    const touch = touchOn(main);

    touch('pointerdown');
    touch('pointermove', 12);
    await pause(NAME_TOOLTIP_DELAY_MS + 200);
    expect(shown()).toBe(false);
    touch('pointerup');
    touch('click');
    await settle(legend);
    expect(main.getAttribute('aria-pressed')).toBe('false');
  });

  it('a touch pointerenter on a truncated name shows nothing', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const main = part(legend, LONG, '.legend-item-main');
    touchOn(main)('pointerenter');
    await pause(NAME_TOOLTIP_DELAY_MS + 200);
    expect(tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open')).toBe(false);
  });

  it('under a coarse pointer rows are 40 px, the eye always shows and every target is 40 px', async () => {
    leaveMouse();
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      // Touch emulation flips the pointer media feature; fail loudly if this Chromium does not.
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const legend = await mount();
      expect(row(legend, 'Short').getBoundingClientRect().height).toBeCloseTo(40, 0);
      expect(opacity(part(legend, 'Short', '.legend-eye'))).toBe('1');
      for (const selector of ['.legend-eye', '.drag-handle', '.legend-swatch-button']) {
        const box = part(legend, 'Short', selector).getBoundingClientRect();
        expect(box.width, selector).toBeCloseTo(40, 0);
        expect(box.height, selector).toBeCloseTo(40, 0);
      }
      // Sortable's floating copy in a touch drag never catches its hit test.
      const copy = row(legend, 'Short').cloneNode(true) as HTMLElement;
      copy.classList.add('sortable-fallback');
      row(legend, 'Short').after(copy);
      expect(getComputedStyle(copy.querySelector('.drag-handle')!).pointerEvents).toBe('none');
      copy.remove();
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
