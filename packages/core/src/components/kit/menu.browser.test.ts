import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsMenu, PsMenuGroup, PsMenuItem } from './menu';
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
    await item.updateComplete;
    expect(item.checked).toBe(true);
    expect(item.getAttribute('aria-checked')).toBe('true');
    expect(menu.open).toBe(true);
  });

  it('exposes menu roles', async () => {
    await setup();
    await expect.element(page.getByRole('menu', { name: 'Color by' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('menuitemradio', { name: 'Species', checked: false }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('menuitemradio', { name: 'Protein family', checked: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('menuitemradio', { name: 'EC number', disabled: true }))
      .toBeInTheDocument();
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

  it('announces "No matches" through a live region that exists before typing', async () => {
    const { menu } = await setup('', 'searchable');
    const status = menu.shadowRoot!.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('');
    const input = menu.shadowRoot!.querySelector('input')!;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await menu.updateComplete;
    expect(menu.shadowRoot!.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe('No matches');
  });

  it('keeps an item or label its owner hid hidden when it opens and after a search', async () => {
    const { menu } = await setup(
      '<ps-menu-label id="more" hidden>More</ps-menu-label>' +
        '<ps-menu-item value="adv" hidden>Advanced</ps-menu-item>',
      'searchable',
    );
    const adv = menu.querySelector<PsMenuItem>('[value="adv"]')!;
    const more = document.getElementById('more')!;
    expect(adv.hidden).toBe(true);
    expect(more.hidden).toBe(true);
    const input = menu.shadowRoot!.querySelector('input')!;
    input.value = 'spe';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await menu.updateComplete;
    expect(adv.hidden).toBe(true);
    expect(more.hidden).toBe(true);
    expect(menu.querySelector<PsMenuItem>('[value="species"]')!.hidden).toBe(false);
  });

  it('does not focus or activate a disabled item on a press, and keys keep working', async () => {
    const { menu } = await setup();
    const onSelect = vi.fn();
    menu.addEventListener('ps-select', onSelect);
    await userEvent.click(menu.querySelector('[value="ec"]')!, { force: true });
    expect(focused()).toBe('family');
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu.open).toBe(true);
    key('End');
    expect(focused()).toBe('length');
  });

  it('rings a keyboard-focused item but not a hovered one', async () => {
    const { menu } = await setup();
    await userEvent.keyboard('{ArrowDown}');
    const species = menu.querySelector<PsMenuItem>('[value="species"]')!;
    expect(document.activeElement).toBe(species);
    expect(getComputedStyle(species).outlineStyle).toBe('solid');
    const length = menu.querySelector<PsMenuItem>('[value="length"]')!;
    await userEvent.hover(length);
    expect(getComputedStyle(length).outlineStyle).toBe('none');
    expect(getComputedStyle(length).backgroundColor).toBe(
      getComputedStyle(species).backgroundColor,
    );
  });

  it('tints the checked row, as the workbench mockups do, and keeps the tint under hover', async () => {
    const { menu } = await setup();
    const family = menu.querySelector<PsMenuItem>('[value="family"]')!;
    expect(family.getAttribute('aria-checked')).toBe('true');
    // --ps-accent-tint in the light theme (sky-100)
    expect(getComputedStyle(family).backgroundColor).toBe('rgb(224, 242, 254)');
    await userEvent.hover(family);
    expect(getComputedStyle(family).backgroundColor).toBe('rgb(224, 242, 254)');
    const species = menu.querySelector<PsMenuItem>('[value="species"]')!;
    expect(getComputedStyle(species).backgroundColor).not.toBe('rgb(224, 242, 254)');
  });

  it('marks the focused search field in forced colours', async () => {
    const session = cdp();
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    try {
      const { menu } = await setup('', 'searchable');
      const search = menu.shadowRoot!.querySelector('.search')!;
      expect(menu.shadowRoot!.activeElement).toBe(search.querySelector('input'));
      expect(getComputedStyle(search).outlineStyle).toBe('solid');
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
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
    const long = menu.querySelector<PsMenuItem>('[value="long"]')!;
    const label = long.shadowRoot!.querySelector<HTMLElement>('.label')!;
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth); // clipped, not wrapped
    expect(long.offsetHeight).toBe(
      menu.querySelector<PsMenuItem>('[value="species"]')!.offsetHeight,
    );
  });

  it('returns focus to a ps-icon-button at the right edge without its tooltip creeping', async () => {
    document.body.innerHTML = `
      <div style="position:fixed;top:0;right:0">
        <ps-icon-button icon="x" size="sm" label="Sort: By count, largest first"></ps-icon-button>
      </div>
      <ps-menu label="Sort"><ps-menu-item value="a" type="radio" checked>A</ps-menu-item></ps-menu>`;
    const host = document.querySelector('ps-icon-button')!;
    await host.updateComplete;
    const menu = document.querySelector('ps-menu') as PsMenu;
    menu.anchor = host;
    host.shadowRoot!.querySelector('button')!.focus();
    menu.open = true;
    await menu.updateComplete;
    await frame();
    await frame();
    key('Escape');
    const tip = host
      .shadowRoot!.querySelector('ps-tooltip')!
      .shadowRoot!.querySelector<HTMLElement>('.tip')!;
    expect(tip.matches(':popover-open')).toBe(true);
    await frame();
    const first = tip.getBoundingClientRect();
    for (let i = 0; i < 4; i++) await frame();
    const last = tip.getBoundingClientRect();
    expect(last.width).toBe(first.width);
    expect(last.height).toBeLessThan(24); // one line
  });
});

describe('ps-menu-group', () => {
  async function grouped(attrs = '', extra = '') {
    document.body.innerHTML = `
      <button id="anchor">Color by</button>
      <ps-menu label="Color by" ${attrs}>
        <ps-menu-label>Ungrouped</ps-menu-label>
        <ps-menu-item value="length" type="radio">Length</ps-menu-item>
        <ps-menu-group label="UniProt">
          <ps-menu-item value="family" type="radio" checked>Protein family</ps-menu-item>
          <ps-menu-item value="species" type="radio">Species</ps-menu-item>
        </ps-menu-group>
        <ps-menu-group label="InterPro" ${extra}>
          <ps-menu-item value="pfam" type="radio">Pfam clan</ps-menu-item>
        </ps-menu-group>
      </ps-menu>`;
    const anchor = document.getElementById('anchor')!;
    const menu = document.querySelector('ps-menu') as PsMenu;
    menu.anchor = anchor;
    anchor.focus();
    menu.open = true;
    await menu.updateComplete;
    await frame();
    await frame();
    const groups = [...menu.querySelectorAll<PsMenuGroup>('ps-menu-group')];
    return { menu, groups };
  }

  function search(menu: PsMenu, text: string) {
    const input = menu.shadowRoot!.querySelector('input')!;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return menu.updateComplete;
  }

  it('is a group named by its caption, which is not read twice', async () => {
    const { groups } = await grouped();
    await expect.element(page.getByRole('group', { name: 'UniProt' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('group', { name: 'UniProt' }))
      .toHaveTextContent('Protein family');
    const caption = groups[0].shadowRoot!.querySelector('.caption')!;
    expect(caption.textContent).toBe('UniProt');
    expect(caption.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws its caption like ps-menu-label', async () => {
    const { menu, groups } = await grouped();
    const caption = getComputedStyle(groups[0].shadowRoot!.querySelector('.caption')!);
    const label = getComputedStyle(menu.querySelector('ps-menu-label')!);
    for (const prop of [
      'color',
      'fontSize',
      'fontWeight',
      'letterSpacing',
      'textTransform',
      'paddingTop',
      'paddingLeft',
      'paddingBottom',
    ] as const)
      expect(caption[prop], prop).toBe(label[prop]);
  });

  it('lets arrow keys and type-ahead reach items inside groups', async () => {
    await grouped();
    expect(focused()).toBe('family');
    key('ArrowDown');
    expect(focused()).toBe('species');
    key('ArrowDown');
    expect(focused()).toBe('pfam');
    key('ArrowDown');
    expect(focused()).toBe('length');
    key('p');
    expect(focused()).toBe('family');
    key('End');
    expect(focused()).toBe('pfam');
  });

  it('filters items inside groups and hides a group with no match', async () => {
    const { menu, groups } = await grouped('searchable');
    await search(menu, 'spe');
    expect(groups.map((g) => g.hidden)).toEqual([false, true]);
    key('ArrowDown');
    expect(focused()).toBe('species');
    await search(menu, '');
    expect(groups.map((g) => g.hidden)).toEqual([false, false]);
  });

  it('skips the items of a group its owner hid, and keeps it hidden', async () => {
    const { menu, groups } = await grouped('searchable', 'hidden');
    await search(menu, 'pf');
    await search(menu, '');
    expect(groups[1].hidden).toBe(true);
    key('ArrowDown');
    key('End');
    expect(focused()).toBe('species');
  });
});

describe('ps-menu inside another element’s shadow root', () => {
  it('moves with the arrow keys and selects with Enter inside another element’s shadow root', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <button id="anchor">Projection</button>
      <ps-menu label="Projection">
        <ps-menu-item value="umap" type="radio" checked>UMAP</ps-menu-item>
        <ps-menu-item value="pca" type="radio">PCA</ps-menu-item>
      </ps-menu>`;
    const menu = root.querySelector('ps-menu') as PsMenu;
    menu.anchor = root.getElementById('anchor');
    menu.open = true;
    await menu.updateComplete;
    await frame();
    await frame();
    const deepKey = (name: string) =>
      (root.activeElement ?? host).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: name,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    const focusedValue = () => (root.activeElement as PsMenuItem | null)?.value;

    expect(focusedValue()).toBe('umap');
    deepKey('ArrowDown');
    expect(focusedValue()).toBe('pca');

    const onSelect = vi.fn();
    menu.addEventListener('ps-select', onSelect);
    deepKey('Enter');
    expect(onSelect).toHaveBeenCalledOnce();
    expect((onSelect.mock.calls[0][0] as CustomEvent).detail).toEqual({
      value: 'pca',
      checked: true,
    });
  });
});
