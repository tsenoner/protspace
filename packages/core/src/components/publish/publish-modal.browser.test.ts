import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsDialog } from '../kit/dialog';
import { deepActiveElement } from '../kit/focus';
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
  vi.useRealTimers();
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

  it('focus returns to the opener from the footer Close and from the dialog ✕', async () => {
    const first = await mount();
    button(first.modal, 'Close').click();
    expect(document.activeElement).toBe(first.opener);
    first.modal.remove();

    const second = await mount();
    const dialog = second.modal.shadowRoot!.querySelector('ps-dialog')!;
    dialog.shadowRoot!.querySelector<HTMLElement>('ps-icon-button[label="Close"]')!.click();
    expect(document.activeElement).toBe(second.opener);
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

  it('New figure with nothing to clear offers no Undo', async () => {
    const { modal } = await mount();
    button(modal, 'New figure').click();
    await modal.updateComplete;
    expect(undoText(modal)).toBe('');
  });

  it('Undo from the keyboard gives focus back to the button that offered it', async () => {
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, overlays: [circle] };
    await modal.updateComplete;
    button(modal, 'New figure').click();
    await modal.updateComplete;

    button(modal, 'Undo').focus();
    await userEvent.keyboard('{Enter}');
    await modal.updateComplete;
    expect(internals._state.overlays).toHaveLength(1);
    const newFigure = button(modal, 'New figure').shadowRoot!.querySelector('button');
    await expect.poll(() => deepActiveElement()).toBe(newFigure);
  });

  it('the strip leaves after 8 s', async () => {
    vi.useFakeTimers();
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, overlays: [circle] };
    await modal.updateComplete;
    button(modal, 'New figure').click();
    await modal.updateComplete;

    vi.advanceTimersByTime(8_000);
    await modal.updateComplete;
    expect(undoText(modal)).toBe('');
  });

  it('the strip stays while Undo has focus, and its 8 s restart on blur', async () => {
    vi.useFakeTimers();
    const { modal, internals } = await mount();
    internals._state = { ...internals._state, dpi: 600 };
    await modal.updateComplete;
    button(modal, 'Reset').click();
    await modal.updateComplete;

    button(modal, 'Undo').focus();
    vi.advanceTimersByTime(8_000);
    await modal.updateComplete;
    expect(undoText(modal)).toBe('Settings reset Undo');

    button(modal, 'Export').focus();
    vi.advanceTimersByTime(7_999);
    await modal.updateComplete;
    expect(undoText(modal)).toBe('Settings reset Undo');
    vi.advanceTimersByTime(1);
    await modal.updateComplete;
    expect(undoText(modal)).toBe('');
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

describe('protspace-publish-modal on a phone', () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  const rect = (modal: HTMLElement, selector: string) =>
    modal.shadowRoot!.querySelector(selector)!.getBoundingClientRect();

  it('at 375 × 667 the preview sits over the settings and takes 40% of the height', async () => {
    await page.viewport(375, 667);
    const { modal, native } = await mount();
    // The full dialog is the screen on a phone (ps-dialog's compact rule).
    expect(native.getBoundingClientRect().width).toBeCloseTo(375, 0);
    const container = rect(modal, '.publish-container');
    const preview = rect(modal, '.publish-preview');
    const sidebar = rect(modal, '.publish-sidebar');
    expect(preview.bottom).toBeLessThanOrEqual(sidebar.top + 0.5);
    expect(Math.abs(preview.height - 0.4 * container.height)).toBeLessThan(1);
    expect(sidebar.width).toBeCloseTo(container.width, 0);
    expect(sidebar.bottom).toBeLessThanOrEqual(container.bottom + 0.5);
  });

  it('at 375 × 667 the tool row wraps inside the preview', async () => {
    await page.viewport(375, 667);
    const { modal } = await mount();
    const toolbar = rect(modal, '.publish-preview-toolbar');
    const tools = [...modal.shadowRoot!.querySelectorAll('.publish-tool-btn')];
    expect(tools.length).toBe(5);
    for (const tool of tools) {
      expect(tool.getBoundingClientRect().right).toBeLessThanOrEqual(toolbar.right + 0.5);
    }
  });

  it('under a coarse pointer the editor’s buttons and fields are 40 px targets', async () => {
    await page.viewport(375, 667);
    const { modal } = await mount();
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      const small = [
        ...modal.shadowRoot!.querySelectorAll<HTMLElement>(
          'button, .publish-row-input, .publish-select',
        ),
      ].flatMap((target) => {
        const box = target.getBoundingClientRect();
        if (box.width === 0 || !target.checkVisibility()) return [];
        const tooSmall =
          box.height < 40 - 0.5 || (target.localName === 'button' && box.width < 39.5);
        return tooSmall
          ? [`${target.className}: ${Math.round(box.width)}x${Math.round(box.height)}`]
          : [];
      });
      expect(small).toEqual([]);
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('at 740 × 360 the preview and the settings stay side by side, the settings 340 px wide', async () => {
    await page.viewport(740, 360);
    const { modal } = await mount();
    const preview = rect(modal, '.publish-preview');
    const sidebar = rect(modal, '.publish-sidebar');
    expect(preview.right).toBeLessThanOrEqual(sidebar.left + 0.5);
    expect(sidebar.width).toBeCloseTo(340, 0);
    expect(preview.width).toBeGreaterThan(200);
  });
});

describe('protspace-publish-modal preview paper', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  const preview = (modal: HTMLElement) =>
    modal.shadowRoot!.querySelector<HTMLCanvasElement>('.publish-preview-canvas')!;

  it("the preview's backdrop is the light paper in dark", async () => {
    document.documentElement.dataset.theme = 'dark';
    const { modal } = await mount();
    const style = getComputedStyle(preview(modal));
    // Exports are light in both themes, so the figure is previewed on light paper:
    // white with a slate-200 checkerboard, never the dark surface.
    expect(style.backgroundImage).toContain('rgb(255, 255, 255)');
    expect(style.backgroundImage).toContain('rgb(226, 232, 240)');
    expect(style.backgroundImage).not.toContain('rgb(15, 23, 42)');
    expect(style.backgroundColor).not.toBe('rgb(15, 23, 42)');
  });

  it('a white figure still previews white', async () => {
    document.documentElement.dataset.theme = 'dark';
    const { modal, internals } = await mount();
    // A plot whose capture is fully transparent: only the figure's own background shows.
    modal.plotElement = Object.assign(document.createElement('div'), {
      captureAtResolution: (width: number, height: number) =>
        Object.assign(document.createElement('canvas'), { width, height }),
    });
    internals._updateState({ background: 'white' });
    await modal.updateComplete;
    const canvas = preview(modal);
    await vi.waitFor(() => {
      expect(canvas.width).toBeGreaterThan(300);
      const pixel = Array.from(canvas.getContext('2d')!.getImageData(1, 1, 1, 1).data);
      expect(pixel).toEqual([255, 255, 255, 255]);
    });
  });
});
