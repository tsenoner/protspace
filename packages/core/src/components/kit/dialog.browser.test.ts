import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
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
