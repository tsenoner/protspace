// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';
import type { PsMenu } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import { stubPopoverApi } from './test-support/popover-stub';

vi.stubGlobal('localStorage', createLocalStorageMock());
// jsdom has no CSS.escape; the reorder's frame callbacks refocus a handle through it.
vi.stubGlobal('CSS', { escape: (value: string) => value });
// "Colour and shape" lives in the row's "⋯" menu, which opens a ps-popover.
stubPopoverApi();

async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settleLegend(legend);
  return legend;
}

const q = (legend: ProtspaceLegend, selector: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(selector);
const click = (legend: ProtspaceLegend, selector: string) => q(legend, selector)!.click();
const status = (legend: ProtspaceLegend) => q(legend, '[role="status"]')!.textContent!.trim();

/** "⋯", then "Colour and shape", dispatched as the menu does; the menu's layer is released after. */
async function openPicker(legend: ProtspaceLegend, value: string): Promise<void> {
  click(legend, `.legend-item[data-value="${value}"] .legend-more`);
  await settleLegend(legend);
  const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
  menu.dispatchEvent(
    new CustomEvent('ps-select', {
      bubbles: true,
      composed: true,
      detail: { value: 'customize', checked: false },
    }),
  );
  await settleLegend(legend);
  await menu.updateComplete;
  await menu.shadowRoot!.querySelector<PsPopover>('ps-popover')!.updateComplete;
}

function pickUp(legend: ProtspaceLegend, value: string): void {
  q(legend, `.legend-item[data-value="${value}"] .drag-handle`)!.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true }),
  );
}

/** Escape as the keyboard sends it: from the focused element, through the window. */
function escape(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

/** What the legend has open: the picker, the Other dialog, the settings dialog. */
const open = (legend: ProtspaceLegend) => ({
  picker: q(legend, '.color-picker-popover') !== null,
  other: q(legend, '#legend-other-dialog') !== null,
  settings: q(legend, '#legend-settings-dialog') !== null,
});

describe('legend Escape order', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('closes the picker, then Other, then cancels a keyboard reorder, one per Escape', async () => {
    const legend = await mount();
    pickUp(legend, 'B');
    await settleLegend(legend);
    click(legend, 'button.view-button');
    await settleLegend(legend);
    await openPicker(legend, 'A');
    expect(open(legend)).toEqual({ picker: true, other: true, settings: false });
    expect(status(legend)).toBe('Picked up B for reordering');

    escape();
    await settleLegend(legend);
    expect(open(legend)).toEqual({ picker: false, other: true, settings: false });

    escape();
    await settleLegend(legend);
    expect(open(legend)).toEqual({ picker: false, other: false, settings: false });
    expect(status(legend)).toBe('Picked up B for reordering');

    escape();
    await settleLegend(legend);
    expect(status(legend)).toBe('Reordering canceled.');
  });

  it('closes the picker, then Other, then settings, one per Escape', async () => {
    const legend = await mount();
    // Opening settings clears a keyboard reorder, so settings is tested without one.
    click(legend, 'button[aria-label="Legend settings"]');
    await settleLegend(legend);
    click(legend, 'button.view-button');
    await settleLegend(legend);
    await openPicker(legend, 'A');
    expect(open(legend)).toEqual({ picker: true, other: true, settings: true });

    escape();
    await settleLegend(legend);
    expect(open(legend)).toEqual({ picker: false, other: true, settings: true });

    escape();
    await settleLegend(legend);
    expect(open(legend)).toEqual({ picker: false, other: false, settings: true });

    escape();
    await settleLegend(legend);
    expect(open(legend)).toEqual({ picker: false, other: false, settings: false });
  });

  it('lets Escape through to a document listener when nothing of the legend is open', async () => {
    const legend = await mount();
    const seen: boolean[] = [];
    const onKeyDown = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    document.addEventListener('keydown', onKeyDown);
    try {
      escape();
      await settleLegend(legend);
      expect(seen).toEqual([false]);
    } finally {
      document.removeEventListener('keydown', onKeyDown);
    }
  });
});
