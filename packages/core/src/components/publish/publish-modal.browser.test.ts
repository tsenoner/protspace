import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsDialog } from '../kit/dialog';
import { ESCAPE_ORDER, onEscapeFallback } from '../kit/layers';
import './publish-modal';

type Selected = { kind: 'overlay' | 'inset'; index: number };

interface ModalInternals {
  _state: {
    overlays: unknown[];
    insets: unknown[];
    dpi: number;
    background: string;
  };
  _selectedItem: Selected | null;
  _setSelection(selected: Selected | null): void;
  _updateState(partial: Record<string, unknown>): void;
}

const circle = {
  type: 'circle',
  cx: 0.5,
  cy: 0.5,
  rx: 0.1,
  ry: 0.1,
  rotation: 0,
  color: '#000',
  strokeWidth: 2,
};
const inset = {
  sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
  targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  border: 2,
  connector: 'lines',
  pointSizeScale: 1,
};

beforeAll(() => adoptTheme());
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

/** Opens the editor the way the app does: a control has focus, then the element is appended. */
async function mount() {
  const opener = document.createElement('button');
  opener.textContent = 'Open the editor';
  document.body.append(opener);
  opener.focus();
  const modal = document.createElement('protspace-publish-modal');
  document.body.append(modal);
  await modal.updateComplete;
  const dialog = modal.shadowRoot!.querySelector('ps-dialog') as PsDialog;
  await dialog.updateComplete;
  const native = dialog.shadowRoot!.querySelector('dialog')!;
  return { opener, modal, internals: modal as unknown as ModalInternals, native };
}

/** Escape where a user presses it: on the focused element, inside any shadow roots. */
function escape(): void {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  (active ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

function button(modal: HTMLElement, name: string): HTMLElement {
  const found = [...modal.shadowRoot!.querySelectorAll<HTMLElement>('ps-button')].find(
    (each) => each.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button in the editor`);
  return found;
}

const undoText = (modal: HTMLElement) =>
  modal.shadowRoot!.querySelector('.publish-undo')!.textContent!.replace(/\s+/g, ' ').trim();

describe('protspace-publish-modal dialog', () => {
  it('the dialog has role dialog named Figure editor and is modal', async () => {
    const { native } = await mount();
    expect(native.open).toBe(true);
    expect(native.matches(':modal')).toBe(true);
    const heading = native.getRootNode() as ShadowRoot;
    expect(heading.getElementById(native.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Figure editor',
    );
  });

  it('hovering the locked width field shows its reason', async () => {
    const { modal, internals } = await mount();
    internals._updateState({ preset: 'nature-1col' });
    await modal.updateComplete;
    const input = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-input="width"]',
    )!;
    expect(input.disabled).toBe(true);
    const tooltip = input.nextElementSibling as HTMLElement;
    expect(tooltip.localName).toBe('ps-tooltip');

    await userEvent.hover(input);
    await expect
      .poll(() => tooltip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
  });

  it('Escape with an item selected deselects it and keeps the dialog open; a second Escape closes it and fires close with the state', async () => {
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    const { modal, internals, native } = await mount();
    internals._state = { ...internals._state, overlays: [circle] };
    internals._setSelection({ kind: 'overlay', index: 0 });
    await modal.updateComplete;
    const closed = vi.fn();
    modal.addEventListener('close', closed);

    escape();
    await modal.updateComplete;
    expect(internals._selectedItem).toBeNull();
    expect(internals._state.overlays).toHaveLength(1);
    expect(native.open).toBe(true);
    expect(closed).not.toHaveBeenCalled();

    escape();
    expect(closed).toHaveBeenCalledOnce();
    const detail = (closed.mock.calls[0][0] as CustomEvent<{ state: { overlays: unknown[] } }>)
      .detail;
    expect(detail.state.overlays).toHaveLength(1);
    // Both presses were the editor's: the plot's selection fallback never ran.
    expect(fallback).not.toHaveBeenCalled();
  });

  it('a press on the backdrop does not close it', async () => {
    const { native } = await mount();
    native.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    native.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    expect(native.open).toBe(true);
  });

  it('focus returns to the control that opened it', async () => {
    const { opener, modal } = await mount();
    escape();
    await modal.updateComplete;
    expect(document.activeElement).toBe(opener);
  });
});

describe('protspace-publish-modal undo', () => {
  it('New figure, then Undo, restores overlays and insets', async () => {
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, overlays: [circle], insets: [inset] };
    await modal.updateComplete;

    button(modal, 'New figure').click();
    await modal.updateComplete;
    expect(internals._state.overlays).toHaveLength(0);
    expect(internals._state.insets).toHaveLength(0);
    expect(modal.shadowRoot!.querySelector('.publish-undo')!.getAttribute('role')).toBe('status');
    expect(undoText(modal)).toBe('Overlays and insets cleared Undo');

    button(modal, 'Undo').click();
    await modal.updateComplete;
    expect(internals._state.overlays).toHaveLength(1);
    expect(internals._state.insets).toHaveLength(1);
    expect(undoText(modal)).toBe('');
  });

  it('Reset, then Undo, restores the state', async () => {
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, dpi: 600 };
    await modal.updateComplete;

    button(modal, 'Reset').click();
    await modal.updateComplete;
    expect(internals._state.dpi).toBe(300);
    expect(undoText(modal)).toBe('Settings reset Undo');

    button(modal, 'Undo').click();
    await modal.updateComplete;
    expect(internals._state.dpi).toBe(600);
  });

  it('an edit after New figure removes the Undo strip', async () => {
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, overlays: [circle] };
    await modal.updateComplete;
    button(modal, 'New figure').click();
    await modal.updateComplete;
    expect(undoText(modal)).not.toBe('');

    internals._updateState({ background: 'transparent' });
    await modal.updateComplete;
    expect(undoText(modal)).toBe('');
  });
});

describe('protspace-publish-modal export and keys', () => {
  it('showExportError renders an alert, and the next export clears it', async () => {
    const { modal } = await mount();
    modal.showExportError('Export failed. The disk is full.');
    await modal.updateComplete;
    const alert = modal.shadowRoot!.querySelector('.publish-export-error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent!.trim()).toBe('Export failed. The disk is full.');

    button(modal, 'Export').click();
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector('.publish-export-error')).toBeNull();
  });

  it('Delete still removes a selected overlay; Backspace in a number field edits the field', async () => {
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, overlays: [circle] };
    internals._setSelection({ kind: 'overlay', index: 0 });
    await modal.updateComplete;

    const field = modal.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-publish-item="overlay-0"] input[type="number"]',
    )!;
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true }),
    );
    await modal.updateComplete;
    expect(internals._state.overlays).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    await modal.updateComplete;
    expect(internals._state.overlays).toHaveLength(0);
    expect(internals._selectedItem).toBeNull();
  });
});
