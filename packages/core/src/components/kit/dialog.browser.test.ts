import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsDialog } from './dialog';
import './dialog';
import { dialogStyles } from './dialog.styles';
import { ESCAPE_ORDER, onEscapeFallback, topLayer } from './layers';
import type { PsMenu } from './menu';
import './menu';

beforeAll(() => adoptTheme());
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (el: { updateComplete: Promise<unknown> }) => {
  await el.updateComplete;
  await frame();
  await frame();
};
const nativeDialog = (d: PsDialog) => d.shadowRoot!.querySelector('dialog')!;
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

async function setup() {
  document.body.innerHTML = `
    <button id="opener">Settings</button>
    <ps-dialog heading="Legend settings">
      <button id="menu-anchor" autofocus>Palette</button>
      <p id="text">Body text</p>
      <ps-menu label="Palette"><ps-menu-item value="kelly">Kelly</ps-menu-item></ps-menu>
      <ps-button slot="footer">Reset</ps-button>
    </ps-dialog>`;
  const opener = document.getElementById('opener')!;
  const dialog = document.querySelector('ps-dialog') as PsDialog;
  const menu = document.querySelector('ps-menu') as PsMenu;
  menu.anchor = document.getElementById('menu-anchor');
  opener.focus();
  dialog.open = true;
  await settle(dialog);
  return { opener, dialog, menu };
}

describe('ps-dialog', () => {
  it('opens as a modal dialog, labelled by its heading, with focus on the autofocus element', async () => {
    const { dialog } = await setup();
    expect(nativeDialog(dialog).matches(':modal')).toBe(true);
    expect(nativeDialog(dialog).getAttribute('aria-labelledby')).toBe('heading');
    expect(document.activeElement?.id).toBe('menu-anchor');
  });

  it('closes on a real Escape key, once, and returns focus to the opener', async () => {
    const { opener, dialog } = await setup();
    const onClose = vi.fn();
    dialog.addEventListener('ps-close', onClose);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(nativeDialog(dialog).open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it('closes from its close button', async () => {
    const { dialog } = await setup();
    dialog
      .shadowRoot!.querySelector('ps-icon-button')!
      .shadowRoot!.querySelector('button')!
      .click();
    await settle(dialog);
    expect(dialog.open).toBe(false);
  });

  it('closes on a press on the backdrop but not inside the frame', async () => {
    const { dialog } = await setup();
    press(document.getElementById('text')!);
    expect(dialog.open).toBe(true);
    press(nativeDialog(dialog));
    expect(dialog.open).toBe(false);
  });

  it('closes a menu opened inside it first, on Escape and on a press elsewhere in the dialog', async () => {
    const { dialog, menu } = await setup();
    menu.open = true;
    await settle(menu);
    await userEvent.keyboard('{Escape}');
    await settle(menu);
    expect(menu.open).toBe(false);
    expect(dialog.open).toBe(true);
    menu.open = true;
    await settle(menu);
    press(document.getElementById('text')!);
    await settle(menu);
    expect(menu.open).toBe(false);
    expect(dialog.open).toBe(true);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
  });

  it('releases its layer when removed while open', async () => {
    const { dialog } = await setup();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    dialog.remove();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('hides the footer when nothing is slotted into it', async () => {
    document.body.innerHTML = '<ps-dialog heading="Info"><p>Only text</p></ps-dialog>';
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    dialog.open = true;
    await settle(dialog);
    expect(dialog.shadowRoot!.querySelector('footer')!.hidden).toBe(true);
  });

  it('stays open on a backdrop press when not dismissible', async () => {
    const { dialog } = await setup();
    dialog.dismissible = false;
    press(nativeDialog(dialog));
    expect(dialog.open).toBe(true);
  });

  it('shows again when a keyed re-render moves it while open', async () => {
    const { opener, dialog } = await setup();
    const onClose = vi.fn();
    dialog.addEventListener('ps-close', onClose);
    document.body.append(dialog); // a move: disconnect, then connect
    await settle(dialog);
    expect(nativeDialog(dialog).matches(':modal')).toBe(true);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('menu-anchor');
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(topLayer()).toBeUndefined();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps a nested menu's ps-close from the dialog's owner", async () => {
    const { dialog, menu } = await setup();
    const onClose = vi.fn();
    dialog.addEventListener('ps-close', onClose);
    dialog.addEventListener('ps-close', () => (dialog.open = false)); // a controlled owner
    const onMenuClose = vi.fn();
    menu.addEventListener('ps-close', onMenuClose);
    menu.open = true;
    await settle(menu);
    await userEvent.keyboard('{Enter}');
    await settle(dialog);
    expect(onMenuClose).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
  });

  it("keeps a nested dialog's ps-close from the outer dialog's owner", async () => {
    document.body.innerHTML = `
      <ps-dialog id="outer" heading="Outer">
        <ps-dialog id="inner" heading="Inner"><p>Inner text</p></ps-dialog>
      </ps-dialog>`;
    const outer = document.getElementById('outer') as PsDialog;
    const inner = document.getElementById('inner') as PsDialog;
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    outer.addEventListener('ps-close', onOuterClose);
    inner.addEventListener('ps-close', onInnerClose);
    outer.open = true;
    await settle(outer);
    inner.open = true;
    await settle(inner);
    await userEvent.keyboard('{Escape}');
    await settle(inner);
    expect(onInnerClose).toHaveBeenCalledOnce();
    expect(onOuterClose).not.toHaveBeenCalled();
    expect(outer.open).toBe(true);
  });

  it('follows a close the browser makes on its own', async () => {
    const { opener, dialog } = await setup();
    const onClose = vi.fn();
    dialog.addEventListener('ps-close', onClose);
    nativeDialog(dialog).close();
    await settle(dialog);
    expect([dialog.open, onClose.mock.calls.length, topLayer()]).toEqual([false, 1, undefined]);
    expect(document.activeElement).toBe(opener);
  });

  it('reads dismissible="false" in markup as false', async () => {
    document.body.innerHTML = `
      <ps-dialog id="off" heading="Info" dismissible="false"><p>Only text</p></ps-dialog>
      <ps-dialog id="bare" heading="Info" dismissible></ps-dialog>
      <ps-dialog id="none" heading="Info"></ps-dialog>`;
    const off = document.getElementById('off') as PsDialog;
    const bare = document.getElementById('bare') as PsDialog;
    const none = document.getElementById('none') as PsDialog;
    expect([off.dismissible, bare.dismissible, none.dismissible]).toEqual([false, true, true]);
    off.open = true;
    await settle(off);
    press(nativeDialog(off));
    expect(off.open).toBe(true);
  });

  it('focuses the frame when nothing is marked autofocus', async () => {
    document.body.innerHTML = '<ps-dialog heading="Info"><p>Only text</p></ps-dialog>';
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    dialog.open = true;
    await settle(dialog);
    expect(dialog.shadowRoot!.activeElement).toBe(dialog.shadowRoot!.querySelector('.frame'));
  });

  it('focuses an autofocus button in the footer when built and opened in one go', async () => {
    const dialog = document.createElement('ps-dialog') as PsDialog;
    dialog.heading = 'Clear stored data?';
    const cancel = document.createElement('ps-button');
    cancel.slot = 'footer';
    cancel.setAttribute('autofocus', '');
    cancel.textContent = 'Cancel';
    dialog.append(cancel);
    document.body.append(dialog);
    dialog.open = true;
    await settle(dialog);
    expect(dialog.shadowRoot!.querySelector('footer')!.hidden).toBe(false);
    expect(document.activeElement).toBe(cancel);
  });

  it('sizes by the dynamic viewport, so a full dialog fits under a phone toolbar', () => {
    const cssText = dialogStyles.map((sheet) => sheet.cssText).join('');
    expect(cssText).not.toMatch(/100vh/);
    expect(cssText).toMatch(/100dvh/);
  });

  it('returns focus to the opener when removed while open', async () => {
    const { opener, dialog } = await setup();
    dialog.remove();
    await frame();
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the pressed control when the press left focus on the body, as in Safari', async () => {
    document.body.innerHTML = `
      <button id="opener">Settings</button>
      <ps-dialog heading="Info"><p>Only text</p></ps-dialog>`;
    const opener = document.getElementById('opener')!;
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    (document.activeElement as HTMLElement | null)?.blur();
    press(opener); // Safari does not focus a clicked button
    expect(document.activeElement).toBe(document.body);
    dialog.open = true;
    await settle(dialog);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the menu anchor after a dialog opened from ps-select closes', async () => {
    document.body.innerHTML = `
      <button id="anchor">More</button>
      <ps-menu label="More"><ps-menu-item value="settings">Settings</ps-menu-item></ps-menu>
      <ps-dialog heading="Settings"><p>Only text</p></ps-dialog>`;
    const anchor = document.getElementById('anchor')!;
    const menu = document.querySelector('ps-menu') as PsMenu;
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    menu.anchor = anchor;
    menu.addEventListener('ps-select', () => (dialog.open = true));
    anchor.focus();
    menu.open = true;
    await settle(menu);
    await userEvent.keyboard('{Enter}');
    await settle(dialog);
    expect(nativeDialog(dialog).matches(':modal')).toBe(true);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });
});

describe('ps-dialog size sheet', () => {
  async function openSheet(rows: number) {
    const buttons = Array.from(
      { length: rows },
      (_, index) =>
        `<button class="row" style="display: block; width: 100%; height: 48px">Row ${index + 1}</button>`,
    ).join('');
    document.body.innerHTML = `
      <button id="opener">More</button>
      <ps-dialog heading="More" size="sheet">${buttons}</ps-dialog>`;
    const opener = document.getElementById('opener')!;
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    opener.focus();
    dialog.open = true;
    await settle(dialog);
    return { opener, dialog };
  }

  it('size sheet sits on the bottom edge at full width', async () => {
    await page.viewport(375, 667);
    const { dialog } = await openSheet(3);
    const native = nativeDialog(dialog);
    const box = native.getBoundingClientRect();

    expect(native.matches(':modal')).toBe(true);
    expect(box.left).toBe(0);
    expect(Math.abs(box.width - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.bottom - window.innerHeight)).toBeLessThanOrEqual(1);
    // Three rows: a short sheet, not a centred box.
    expect(box.top).toBeGreaterThan(window.innerHeight / 2);
    const style = getComputedStyle(native);
    expect(style.borderBottomLeftRadius).toBe('0px');
    expect(style.borderTopLeftRadius).not.toBe('0px');
    // A grip at the top, as on the structure sheet.
    const grip = getComputedStyle(dialog.shadowRoot!.querySelector('.frame')!, '::before');
    expect([grip.width, grip.height]).toEqual(['36px', '4px']);
  });

  it('a sheet taller than a short viewport (375×360) scrolls its body while the header stays', async () => {
    await page.viewport(375, 360);
    const { dialog } = await openSheet(12);
    const native = nativeDialog(dialog);
    const box = native.getBoundingClientRect();

    expect(box.height).toBeLessThanOrEqual(Math.min(0.85 * 360, 360 - 48) + 1);
    expect(Math.abs(box.bottom - 360)).toBeLessThanOrEqual(1);
    const body = dialog.shadowRoot!.querySelector('.body') as HTMLElement;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);

    body.scrollTop = body.scrollHeight;
    const header = dialog.shadowRoot!.querySelector('header')!.getBoundingClientRect();
    // Under the 12 px grip, where it was before the scroll.
    expect(header.top - box.top).toBeLessThanOrEqual(12 + 1);
    expect(native.scrollTop).toBe(0);
    const last = dialog.querySelector('.row:last-of-type')!.getBoundingClientRect();
    expect(last.bottom).toBeLessThanOrEqual(box.bottom + 1);
    expect(last.top).toBeGreaterThanOrEqual(header.bottom - 1);
  });

  it('Escape and a backdrop press close a sheet and return focus', async () => {
    await page.viewport(375, 667);
    const { opener, dialog } = await openSheet(3);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    opener.focus();
    dialog.open = true;
    await settle(dialog);
    press(nativeDialog(dialog));
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe('ps-dialog on a phone', () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  async function openSized(size: 'md' | 'full'): Promise<HTMLDialogElement> {
    document.body.innerHTML = `<ps-dialog heading="Figure editor" size="${size}"><p>Body</p></ps-dialog>`;
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    dialog.open = true;
    await settle(dialog);
    return nativeDialog(dialog);
  }

  it('at 375×667 a full dialog fills the viewport', async () => {
    await page.viewport(375, 667);
    const native = await openSized('full');
    const box = native.getBoundingClientRect();
    expect(box.left).toBeCloseTo(0, 0);
    expect(box.top).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(375, 0);
    expect(box.height).toBeCloseTo(667, 0);
    expect(getComputedStyle(native).borderTopLeftRadius).toBe('0px');
  });

  it('md is 359 px wide at 375', async () => {
    await page.viewport(375, 667);
    const box = (await openSized('md')).getBoundingClientRect();
    expect(box.width).toBeCloseTo(359, 0);
    expect(box.left).toBeCloseTo(8, 0);
  });

  it('at 740×360 a full dialog fills the short landscape screen and md keeps 480 px', async () => {
    await page.viewport(740, 360);
    const full = (await openSized('full')).getBoundingClientRect();
    expect(full.width).toBeCloseTo(740, 0);
    expect(full.height).toBeCloseTo(360, 0);
    const md = (await openSized('md')).getBoundingClientRect();
    expect(md.width).toBeCloseTo(480, 0);
  });
});
