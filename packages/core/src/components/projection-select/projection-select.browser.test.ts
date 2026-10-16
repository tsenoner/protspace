import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import type { ProtspaceProjectionSelect } from './projection-select';
import './projection-select';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Resolves in the task after the next frame: a pick made now has been committed by then. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function mount(): Promise<ProtspaceProjectionSelect> {
  const el = document.createElement('protspace-projection-select');
  el.projections = ['UMAP', 'PCA', 't-SNE'];
  el.selectedProjection = 'UMAP';
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const innerButton = (el: ProtspaceProjectionSelect) =>
  el.shadowRoot!.querySelector('.trigger')!.shadowRoot!.querySelector('button')!;
const menu = (el: ProtspaceProjectionSelect) => el.shadowRoot!.querySelector('ps-menu') as PsMenu;
const items = (el: ProtspaceProjectionSelect) => [
  ...el.shadowRoot!.querySelectorAll<PsMenuItem>('ps-menu-item'),
];
const shownValue = (el: ProtspaceProjectionSelect) =>
  el.shadowRoot!.querySelector('.value')!.textContent!.trim();
async function settle(el: ProtspaceProjectionSelect): Promise<void> {
  await el.updateComplete;
  await frame();
  await frame();
}
async function openMenu(el: ProtspaceProjectionSelect): Promise<void> {
  innerButton(el).click();
  await settle(el);
}

describe('protspace-projection-select', () => {
  it('lists the projections as radio items and checks the selected one', async () => {
    const el = await mount();
    await openMenu(el);
    expect(menu(el).open).toBe(true);
    expect(
      items(el).map((item) => [item.textContent!.trim(), item.getAttribute('role'), item.checked]),
    ).toEqual([
      ['UMAP', 'menuitemradio', true],
      ['PCA', 'menuitemradio', false],
      ['t-SNE', 'menuitemradio', false],
    ]);
  });

  it('a pick shows at once and dispatches projection-change after the next paint', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('projection-change', onChange);
    await openMenu(el);

    items(el)[1].click();
    await el.updateComplete;

    expect(shownValue(el)).toBe('PCA');
    expect(menu(el).open).toBe(false);
    expect(el.selectedProjection).toBe('UMAP');
    expect(onChange).not.toHaveBeenCalled();

    await afterNextPaint();

    expect(el.selectedProjection).toBe('PCA');
    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ projection: 'PCA' });
  });

  it('re-picking the projection on screen dispatches nothing and drops a waiting pick', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('projection-change', onChange);
    await openMenu(el);
    items(el)[1].click(); // PCA waits for the paint
    items(el)[0].click(); // back to UMAP before it, as a quick second pick
    await el.updateComplete;
    await afterNextPaint();

    expect(onChange).not.toHaveBeenCalled();
    expect(el.selectedProjection).toBe('UMAP');
    expect(shownValue(el)).toBe('UMAP');
    expect(menu(el).open).toBe(false);
  });

  it('applySelection dispatches at once and drops a waiting pick', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('projection-change', onChange);
    await openMenu(el);
    items(el)[1].click();

    el.applySelection('t-SNE');

    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ projection: 't-SNE' });
    await afterNextPaint();
    await el.updateComplete;
    expect(onChange).toHaveBeenCalledOnce();
    expect(el.selectedProjection).toBe('t-SNE');
    expect(shownValue(el)).toBe('t-SNE');
  });

  it('Enter opens, arrows move, Escape closes and focus returns to the trigger', async () => {
    const el = await mount();
    innerButton(el).focus();

    await userEvent.keyboard('{Enter}');
    await settle(el);
    expect(menu(el).open).toBe(true);
    expect(deepActiveElement()).toBe(items(el)[0]);

    await userEvent.keyboard('{ArrowDown}');
    expect(deepActiveElement()).toBe(items(el)[1]);

    await userEvent.keyboard('{Escape}');
    await settle(el);
    expect(menu(el).open).toBe(false);
    expect(deepActiveElement()).toBe(innerButton(el));
  });

  it("the trigger's name starts with Projection and holds the value", async () => {
    const el = await mount();
    await expect
      .element(page.getByRole('button', { name: 'Projection UMAP', exact: true }))
      .toBeInTheDocument();
    // ps-menu marks its anchor, and ps-button forwards the state to its inner button.
    expect(innerButton(el).getAttribute('aria-haspopup')).toBe('menu');
    expect(innerButton(el).getAttribute('aria-expanded')).toBe('false');
  });
});
