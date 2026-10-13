import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settle(legend);
  await frame();
  return legend;
}

/** What a token resolves to on the page right now, as a computed colour. */
function tokenColour(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/** An outline or a box shadow in the focus colour. */
function drawsRing(element: Element, focus: string): boolean {
  const style = getComputedStyle(element);
  const outline = style.outlineStyle !== 'none' && style.outlineColor === focus;
  return outline || style.boxShadow.includes(focus);
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;

describe('legend styles', () => {
  it('has no border, radius or shadow on the host', async () => {
    const legend = await mount();
    const style = getComputedStyle(legend);
    expect([
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ]).toEqual(['0px', '0px', '0px', '0px']);
    expect(style.borderTopLeftRadius).toBe('0px');
    expect(style.boxShadow).toBe('none');
  });

  it('scrolls the list inside a 200 px tall legend', async () => {
    const legend = await mount();
    legend.style.height = '200px';
    await frame();

    const list = legend.shadowRoot!.querySelector<HTMLElement>('.legend-items')!;
    const host = legend.getBoundingClientRect();
    expect(host.height).toBe(200);
    expect(getComputedStyle(list).overflowY).toBe('auto');
    // Ten rows and Other at 28 px do not fit under the header.
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.bottom + 0.5);
  });

  it("resolves a row's label to the dark --ps-text and its count to the dark --ps-text-muted", async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const legend = await mount();
    // slate-100, the dark --ps-text.
    expect(tokenColour('--ps-text')).toBe('rgb(241, 245, 249)');

    const a = row(legend, 'A');
    expect(getComputedStyle(a.querySelector('.legend-text')!).color).toBe(tokenColour('--ps-text'));
    expect(getComputedStyle(a.querySelector('.legend-count')!).color).toBe(
      tokenColour('--ps-text-muted'),
    );
  });

  it("shows one focus ring for a row's main button", async () => {
    const legend = await mount();
    const mains = () => legend.shadowRoot!.querySelectorAll<HTMLButtonElement>('.legend-item-main');
    mains()[0].focus();
    await userEvent.keyboard('{ArrowDown}');
    await settle(legend);

    const focused = legend.shadowRoot!.activeElement as HTMLElement;
    expect(focused).toBe(mains()[1]);
    const focus = tokenColour('--ps-focus');
    const rings = [focused, focused.closest('.legend-item')!].filter((element) =>
      drawsRing(element, focus),
    );
    // The focus ring (--ps-focus), once: not the old button mixin's two-ring box shadow.
    expect(rings).toHaveLength(1);
  });

  it('turns the row transitions off under reduced motion', async () => {
    const legend = await mount();
    const a = row(legend, 'A');
    const moving = (element: Element) =>
      getComputedStyle(element)
        .transitionDuration.split(',')
        .some((duration) => parseFloat(duration) > 0);
    const animated = [a, ...a.querySelectorAll('*')].filter(moving);
    expect(animated.length).toBeGreaterThan(0);

    const session = cdp();
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    try {
      expect(animated.filter(moving)).toEqual([]);
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });
});
