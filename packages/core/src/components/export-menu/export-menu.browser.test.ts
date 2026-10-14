import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import { EXPORT_DEFAULTS } from './export-defaults';
import './export-menu';
import type { ExportEventDetail, ProtspaceExportMenu } from './export-menu';

let menu: ProtspaceExportMenu;

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 720);
});
beforeEach(async () => {
  document.body.innerHTML = `
    <div style="display: flex; justify-content: flex-end; padding: 8px 24px">
      <protspace-export-menu></protspace-export-menu>
    </div>`;
  menu = document.querySelector('protspace-export-menu')!;
  await menu.updateComplete;
});
afterEach(() => {
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const root = () => menu.shadowRoot!;
const trigger = () => root().querySelector('.trigger') as HTMLElement;
const triggerButton = () => trigger().shadowRoot!.querySelector('button') as HTMLButtonElement;
const psMenu = () => root().querySelector('ps-menu') as PsMenu;
const popover = () => psMenu().shadowRoot!.querySelector('ps-popover') as PsPopover;
const isOpen = () => popover().shadowRoot!.querySelector('.panel')!.matches(':popover-open');
const item = (value: string) =>
  root().querySelector(`ps-menu-item[value="${value}"]`) as PsMenuItem;

async function settle(): Promise<void> {
  await menu.updateComplete;
  await psMenu().updateComplete;
  await popover().updateComplete;
  await frame();
  await frame();
}

async function open(): Promise<void> {
  if (!isOpen()) triggerButton().click();
  await settle();
}

function exportsSeen(): ExportEventDetail[] {
  const seen: ExportEventDetail[] = [];
  menu.addEventListener('export', (event) =>
    seen.push((event as CustomEvent<ExportEventDetail>).detail),
  );
  return seen;
}

const defaults = (type: ExportEventDetail['type'], includeLegendSettings = true) => ({
  type,
  imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
  imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
  legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
  legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
  includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
  includeLegendSettings,
});

describe('protspace-export-menu', () => {
  it('lists the five exports, the legend-settings checkbox and the contours note, in a menu named Export', async () => {
    await open();

    const items = [...root().querySelectorAll('ps-menu-item')] as PsMenuItem[];
    expect(items.map((each) => each.value)).toEqual([
      'figure',
      'png',
      'pdf',
      'ids',
      'parquet',
      'include-settings',
    ]);
    expect(items.map((each) => each.textContent!.trim())).toEqual([
      'Figure editor…',
      'Quick PNG',
      'Quick PDF',
      'Protein IDs (.txt)',
      'Data bundle (.parquetbundle)',
      'Include legend settings',
    ]);
    expect(item('png').getAttribute('role')).toBe('menuitem');
    expect(item('include-settings').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('include-settings').getAttribute('aria-checked')).toBe('true');
    expect(root().querySelector('ps-menu-label')!.textContent!.trim()).toBe(
      'Quick exports leave out contours.',
    );
    const list = psMenu().shadowRoot!.querySelector('[role="menu"]')!;
    expect(list.getAttribute('aria-label')).toBe('Export');
    expect(triggerButton().getAttribute('aria-haspopup')).toBe('menu');
    expect(triggerButton().getAttribute('aria-expanded')).toBe('true');
    // The name comes from the trigger's slotted label; its icons are aria-hidden.
    expect(trigger().textContent!.replace(/\s+/g, ' ').trim()).toBe('Export');
  });

  it('Quick PNG and Quick PDF are described by the contours note', async () => {
    await open();
    for (const name of ['Quick PNG', 'Quick PDF']) {
      await expect
        .element(page.getByRole('menuitem', { name }))
        .toHaveAccessibleDescription('Quick exports leave out contours.');
    }
    expect(item('ids').hasAttribute('aria-describedby')).toBe(false);
  });

  it('each quick item dispatches export with its type and the EXPORT_DEFAULTS sizes, and closes the menu', async () => {
    const seen = exportsSeen();
    for (const type of ['png', 'pdf', 'ids', 'parquet'] as const) {
      await open();
      item(type).click();
      await settle();
      expect(isOpen(), type).toBe(false);
    }
    expect(seen).toEqual([defaults('png'), defaults('pdf'), defaults('ids'), defaults('parquet')]);
  });

  it('Figure editor… fires open-publish-editor and no export', async () => {
    const seen = exportsSeen();
    const editor = vi.fn();
    menu.addEventListener('open-publish-editor', editor);
    await open();
    item('figure').click();
    await settle();

    expect(editor).toHaveBeenCalledOnce();
    expect((editor.mock.calls[0][0] as CustomEvent).detail).toEqual({});
    expect(seen).toEqual([]);
    expect(isOpen()).toBe(false);
  });

  it('the checkbox keeps the menu open and travels as includeLegendSettings', async () => {
    const seen = exportsSeen();
    await open();
    item('include-settings').click();
    await settle();

    expect(isOpen()).toBe(true);
    expect(item('include-settings').getAttribute('aria-checked')).toBe('false');
    item('parquet').click();
    await settle();
    expect(seen).toEqual([defaults('parquet', false)]);
  });

  it('reset() re-checks it', async () => {
    const seen = exportsSeen();
    await open();
    item('include-settings').click();
    await settle();
    expect(item('include-settings').checked).toBe(false);

    menu.reset();
    await settle();
    expect(item('include-settings').checked).toBe(true);
    item('parquet').click();
    await settle();
    expect(seen).toEqual([defaults('parquet', true)]);
  });

  it('Escape closes it and focus returns to the trigger', async () => {
    triggerButton().focus();
    await open();
    expect(root().activeElement).toBe(item('figure'));

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(isOpen()).toBe(false);
    expect(triggerButton().getAttribute('aria-expanded')).toBe('false');
    expect(root().activeElement).toBe(trigger());
    expect(trigger().shadowRoot!.activeElement).toBe(triggerButton());
  });

  it('with file settings, the trigger carries the custom-settings tooltip', async () => {
    expect(root().querySelector('ps-tooltip')).toBeNull();
    menu.hasFileSettings = true;
    await menu.updateComplete;
    expect(root().querySelector('ps-tooltip')?.getAttribute('text')).toBe(
      'File contains custom settings',
    );
  });

  it('the trigger is exposed as the part trigger', () => {
    expect(trigger().getAttribute('part')).toBe('trigger');
  });
});
