import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsMenu, PsMenuItem } from './menu';
import './button';
import './menu';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function key(name: string): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }),
  );
}
const focused = () => (document.activeElement as PsMenuItem | null)?.value;

async function setup(extra = '', attrs = '') {
  document.body.innerHTML = `
    <button id="anchor">Color by</button>
    <ps-menu label="Color by" ${attrs}>
      <ps-menu-label>UniProt</ps-menu-label>
      <ps-menu-item value="family" type="radio" checked>Protein family</ps-menu-item>
      <ps-menu-item value="species" type="radio">Species</ps-menu-item>
      <ps-menu-item value="ec" type="radio" disabled>EC number</ps-menu-item>
      <ps-menu-item value="length" type="radio">Length</ps-menu-item>
      ${extra}
    </ps-menu>`;
  const anchor = document.getElementById('anchor')!;
  const menu = document.querySelector('ps-menu') as PsMenu;
  menu.anchor = anchor;
  anchor.focus();
  menu.open = true;
  await menu.updateComplete;
  await frame();
  await frame();
  return { anchor, menu };
}

describe('ps-menu', () => {
  it('focuses the checked item when it opens', async () => {
    await setup();
    expect(focused()).toBe('family');
  });

  it('moves with the arrow keys, skips disabled items and wraps', async () => {
    await setup();
    key('ArrowDown');
    expect(focused()).toBe('species');
    key('ArrowDown');
    expect(focused()).toBe('length');
    key('ArrowDown');
    expect(focused()).toBe('family');
    key('ArrowUp');
    expect(focused()).toBe('length');
    key('Home');
    expect(focused()).toBe('family');
    key('End');
    expect(focused()).toBe('length');
  });

  it('jumps to an item by typing its first letters', async () => {
    await setup();
    key('l');
    expect(focused()).toBe('length');
  });

  it('selects with Enter, tells the owner, closes and returns focus to the anchor', async () => {
    const { anchor, menu } = await setup();
    const onSelect = vi.fn();
    menu.addEventListener('ps-select', onSelect);
    key('ArrowDown');
    key('Enter');
    await menu.updateComplete;
    await frame();
    expect(onSelect.mock.calls[0][0].detail).toEqual({ value: 'species', checked: true });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(anchor);
    expect(menu.querySelector<PsMenuItem>('[value="family"]')!.checked).toBe(false);
  });

  it('closes before ps-select, so ps-close comes first and focus is on the anchor', async () => {
    const { menu } = await setup();
    const events: string[] = [];
    menu.addEventListener('ps-close', () => events.push('close'));
    menu.addEventListener('ps-select', () =>
      events.push(`select, focus on ${document.activeElement?.id}`),
    );
    key('ArrowDown');
    key('Enter');
    expect(events).toEqual(['close', 'select, focus on anchor']);
  });

  it('returns focus to the anchor after a dialog opened from ps-select closes', async () => {
    const { anchor, menu } = await setup();
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<button>OK</button>';
    document.body.append(dialog);
    menu.addEventListener('ps-select', () => dialog.showModal());
    key('ArrowDown');
    key('Enter');
    expect(dialog.open).toBe(true);
    dialog.close();
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on Escape with one ps-close and focus on the anchor', async () => {
    const { anchor, menu } = await setup();
    const onClose = vi.fn();
    menu.addEventListener('ps-close', onClose);
    key('Escape');
    await menu.updateComplete;
    expect(menu.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on Tab, and Tab moves on from the anchor', async () => {
    const { menu } = await setup('', '');
    const after = document.createElement('button');
    after.id = 'after';
    document.body.append(after);
    const onClose = vi.fn();
    menu.addEventListener('ps-close', onClose);
    await userEvent.tab();
    expect(menu.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(after);
  });

  it('keeps a searchable menu open on Shift+Tab from an item back to the search field', async () => {
    const { menu } = await setup('', 'searchable');
    key('ArrowDown');
    expect(focused()).toBe('family');
    await userEvent.tab({ shift: true });
    expect(menu.open).toBe(true);
    expect(menu.shadowRoot!.activeElement).toBe(menu.shadowRoot!.querySelector('input'));
  });

  it('marks its anchor as a menu button and tracks aria-expanded', async () => {
    const { anchor, menu } = await setup();
    expect(anchor.getAttribute('aria-haspopup')).toBe('menu');
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    key('Escape');
    await menu.updateComplete;
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks a searchable menu anchor as opening a dialog', async () => {
    const { anchor } = await setup('', 'searchable');
    expect(anchor.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('restores the anchor attributes it changed when the anchor changes or it disconnects', async () => {
    const { anchor, menu } = await setup();
    anchor.setAttribute('data-x', '');
    const other = document.createElement('button');
    other.setAttribute('aria-expanded', 'false');
    document.body.append(other);
    menu.anchor = other;
    await menu.updateComplete;
    expect(anchor.hasAttribute('aria-haspopup')).toBe(false);
    expect(anchor.hasAttribute('aria-expanded')).toBe(false);
    expect(other.getAttribute('aria-haspopup')).toBe('menu');
    menu.remove();
    expect(other.hasAttribute('aria-haspopup')).toBe(false);
    expect(other.getAttribute('aria-expanded')).toBe('false');
  });

  it('marks a ps-button anchor so its inner button exposes the state', async () => {
    document.body.innerHTML = `<ps-button>Color by</ps-button>
      <ps-menu label="Color by"><ps-menu-item value="a">A</ps-menu-item></ps-menu>`;
    const menu = document.querySelector('ps-menu') as PsMenu;
    menu.anchor = document.querySelector('ps-button');
    await menu.updateComplete;
    await expect
      .element(page.getByRole('button', { name: 'Color by', expanded: false }))
      .toHaveAttribute('aria-haspopup', 'menu');
  });

  it('names the menu list, not a role-less panel', async () => {
    const { menu } = await setup();
    const panel = menu
      .shadowRoot!.querySelector('ps-popover')!
      .shadowRoot!.querySelector('.panel')!;
    expect(panel.hasAttribute('aria-label')).toBe(false);
    await expect.element(page.getByRole('menu', { name: 'Color by' })).toBeInTheDocument();
  });

  it('names the panel of a searchable menu, which is a dialog', async () => {
    await setup('', 'searchable');
    await expect.element(page.getByRole('dialog', { name: 'Color by' })).toBeInTheDocument();
  });

  it('toggles checkbox items and stays open', async () => {
    const { menu } = await setup(
      '<ps-menu-item value="tooltip" type="checkbox">Show in tooltip</ps-menu-item>',
    );
    const item = menu.querySelector<PsMenuItem>('[value="tooltip"]')!;
    item.click();
    await menu.updateComplete;
    expect(item.checked).toBe(true);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(menu.open).toBe(true);
  });

  it('exposes menu roles', async () => {
    const { menu } = await setup();
    expect(menu.querySelector('[value="species"]')!.getAttribute('role')).toBe('menuitemradio');
    const list = menu.shadowRoot!.querySelector('[role="menu"]')!;
    expect(list.getAttribute('aria-label')).toBe('Color by');
  });

  it('filters items as you type in a searchable menu', async () => {
    const { menu } = await setup('', 'searchable');
    const input = menu.shadowRoot!.querySelector('input')!;
    expect(menu.shadowRoot!.activeElement).toBe(input);
    input.value = 'spe';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await menu.updateComplete;
    const visible = [...menu.querySelectorAll<PsMenuItem>('ps-menu-item')]
      .filter((i) => !i.hidden)
      .map((i) => i.value);
    expect(visible).toEqual(['species']);
    key('ArrowDown');
    expect(focused()).toBe('species');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await menu.updateComplete;
    expect(menu.shadowRoot!.querySelector('.empty')?.textContent).toBe('No matches');
  });

  it('truncates a very long label instead of widening past the viewport', async () => {
    const { menu } = await setup(
      `<ps-menu-item value="long">${'metalloproteinase '.repeat(12)}</ps-menu-item>`,
    );
    const panel = menu
      .shadowRoot!.querySelector('ps-popover')!
      .shadowRoot!.querySelector('.panel')!;
    const rect = panel.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(360);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  });
});
