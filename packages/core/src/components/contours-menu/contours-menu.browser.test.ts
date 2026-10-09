import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import type { ProtspaceContoursMenu } from './contours-menu';
import './contours-menu';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function mount(): Promise<ProtspaceContoursMenu> {
  const el = document.createElement('protspace-contours-menu');
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const innerButton = (el: ProtspaceContoursMenu) =>
  el.shadowRoot!.querySelector('.trigger')!.shadowRoot!.querySelector('button')!;
const menu = (el: ProtspaceContoursMenu) => el.shadowRoot!.querySelector('ps-menu') as PsMenu;
const items = (el: ProtspaceContoursMenu) => [
  ...el.shadowRoot!.querySelectorAll<PsMenuItem>('ps-menu-item'),
];
const shownValue = (el: ProtspaceContoursMenu) =>
  el.shadowRoot!.querySelector('.value')!.textContent!.trim();
async function openMenu(el: ProtspaceContoursMenu): Promise<void> {
  innerButton(el).click();
  await el.updateComplete;
  await frame();
  await frame();
}

describe('protspace-contours-menu', () => {
  it('offers Off, Auto and Always with their hints', async () => {
    const el = await mount();
    await openMenu(el);
    expect(
      items(el).map((item) => [
        item.value,
        item.querySelector('.item-label')!.textContent!.trim(),
        item.querySelector('.hint')!.textContent!.trim(),
        item.checked,
      ]),
    ).toEqual([
      ['off', 'Off', 'No contours', true],
      [
        'auto',
        'Auto',
        'Fades out as you zoom in; faint or hidden when few points are shown',
        false,
      ],
      ['on', 'Always', 'Full strength at every zoom level', false],
    ]);
  });

  it('a menu pick dispatches density-layer-change after the paint', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('density-layer-change', onChange);
    await openMenu(el);

    items(el)[1].click();
    await el.updateComplete;

    expect(el.densityLayer).toBe('auto');
    expect(shownValue(el)).toBe('Auto');
    expect(menu(el).open).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    await afterNextPaint();
    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: 'auto' });
  });

  it('pick from code behaves like a menu pick', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('density-layer-change', onChange);

    el.pick('on');
    await el.updateComplete;
    expect(shownValue(el)).toBe('Always');
    expect(onChange).not.toHaveBeenCalled();

    await afterNextPaint();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: 'on' });
  });

  it('applySelection changes the value without an event', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('density-layer-change', onChange);

    el.pick('on');
    el.applySelection('auto');
    await el.updateComplete;
    await afterNextPaint();

    expect(el.densityLayer).toBe('auto');
    expect(shownValue(el)).toBe('Auto');
    // The waiting pick was dropped, and an apply from outside dispatches nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the trigger's name starts with Contours", async () => {
    const el = await mount();
    await expect
      .element(page.getByRole('button', { name: 'Contours Off', exact: true }))
      .toBeInTheDocument();
    el.applySelection('on');
    await el.updateComplete;
    await expect
      .element(page.getByRole('button', { name: 'Contours Always', exact: true }))
      .toBeInTheDocument();
  });
});
