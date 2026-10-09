import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from './adopt-theme';
import type { PsMenu, PsMenuItem } from './menu';
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
