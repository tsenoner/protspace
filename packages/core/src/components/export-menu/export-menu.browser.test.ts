import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsCheckbox } from '../kit/checkbox';
import type { PsPopover } from '../kit/popover';
import type { PsSegmented } from '../kit/segmented';
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
const popover = () => root().querySelector('ps-popover') as PsPopover;
const panel = () => popover().shadowRoot!.querySelector('.panel') as HTMLElement;
const isOpen = () => panel().matches(':popover-open');
const kindPicker = () => root().querySelector('.export-kind') as PsSegmented;
const formatPicker = () => root().querySelector('.export-format') as PsSegmented | null;
const radio = (picker: PsSegmented, value: string) =>
  picker.shadowRoot!.querySelector(`[data-value="${value}"]`) as HTMLButtonElement;
const settings = () => root().querySelector('.export-settings') as PsCheckbox | null;
const download = () => root().querySelector('.export-download') as HTMLElement;
const downloadButton = () => download().shadowRoot!.querySelector('button') as HTMLButtonElement;
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();

async function settle(): Promise<void> {
  await menu.updateComplete;
  await popover().updateComplete;
  await kindPicker().updateComplete;
  await frame();
  await frame();
}

async function open(): Promise<void> {
  if (!isOpen()) triggerButton().click();
  await settle();
}

async function choose(kind: string, format?: string): Promise<void> {
  radio(kindPicker(), kind).click();
  await settle();
  if (format) {
    radio(formatPicker()!, format).click();
    await settle();
  }
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
  it('is a dialog named Export that asks what first, then how, with one Download', async () => {
    await open();

    await expect.element(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
    expect(text(root().querySelector('.export-title'))).toBe('Export');
    await expect.element(page.getByRole('radiogroup', { name: 'What to export' })).toBeVisible();
    const kinds = [...kindPicker().shadowRoot!.querySelectorAll('[role="radio"]')];
    expect(kinds.map((each) => text(each))).toEqual([
      'Image',
      'Protein IDs',
      'Table',
      'Data bundle',
    ]);
    // An image is the first choice, as a PNG.
    expect(radio(kindPicker(), 'image').getAttribute('aria-checked')).toBe('true');
    expect(radio(formatPicker()!, 'png').getAttribute('aria-checked')).toBe('true');
    await expect.element(page.getByRole('radiogroup', { name: 'Format' })).toBeVisible();
    expect(text(download())).toBe('Download PNG');
    expect(text(root().querySelector('.export-note'))).toContain('without contours');
    // The figure editor has its own button in the host: nothing here opens it.
    expect(root().textContent).not.toContain('Figure editor…');
    expect(triggerButton().getAttribute('aria-haspopup')).toBe('dialog');
    expect(triggerButton().getAttribute('aria-expanded')).toBe('true');
    // The name comes from the trigger's slotted label; its icons are aria-hidden.
    expect(trigger().textContent!.replace(/\s+/g, ' ').trim()).toBe('Export');
  });

  it('shows only the options of the chosen kind, and the Download names its file', async () => {
    await open();
    const expected: Array<[string, string | undefined, string]> = [
      ['image', 'pdf', 'Download PDF'],
      ['ids', undefined, 'Download .txt'],
      ['tsv', undefined, 'Download .tsv'],
      ['parquet', undefined, 'Download .parquetbundle'],
      ['image', 'png', 'Download PNG'],
    ];
    for (const [kind, format, label] of expected) {
      await choose(kind, format);
      expect(text(download()), kind).toBe(label);
      expect(formatPicker() !== null, kind).toBe(kind === 'image');
      expect(settings() !== null, kind).toBe(kind === 'parquet');
    }
  });

  it('each download dispatches export with its type and the EXPORT_DEFAULTS sizes, and closes the panel', async () => {
    const seen = exportsSeen();
    const choices: Array<[string, string | undefined]> = [
      ['image', 'png'],
      ['image', 'pdf'],
      ['ids', undefined],
      ['tsv', undefined],
      ['parquet', undefined],
    ];
    for (const [kind, format] of choices) {
      await open();
      await choose(kind, format);
      downloadButton().click();
      await settle();
      expect(isOpen(), kind).toBe(false);
    }
    expect(seen).toEqual(
      ['png', 'pdf', 'ids', 'tsv', 'parquet'].map((type) => defaults(type as never)),
    );
  });

  it('keeps the last choice for the next opening', async () => {
    await open();
    await choose('tsv');
    await userEvent.keyboard('{Escape}');
    await settle();

    await open();
    expect(radio(kindPicker(), 'tsv').getAttribute('aria-checked')).toBe('true');
    expect(text(download())).toBe('Download .tsv');
  });

  it('Include legend settings sits with the bundle, checked, and travels as includeLegendSettings', async () => {
    const seen = exportsSeen();
    await open();
    await choose('parquet');
    expect(settings()!.checked).toBe(true);
    expect(text(settings())).toBe('Include legend settings');
    expect(text(root().querySelector('.export-settings-help'))).toBe(
      'Opening the file restores your colours, shapes and order.',
    );

    settings()!.shadowRoot!.querySelector('input')!.click();
    await settle();
    // A setting, not an export: the panel stays open.
    expect(isOpen()).toBe(true);
    expect(settings()!.checked).toBe(false);
    downloadButton().click();
    await settle();
    expect(seen).toEqual([defaults('parquet', false)]);
  });

  it('reset() re-checks it', async () => {
    const seen = exportsSeen();
    await open();
    await choose('parquet');
    settings()!.shadowRoot!.querySelector('input')!.click();
    await settle();
    expect(settings()!.checked).toBe(false);

    menu.reset();
    await settle();
    expect(settings()!.checked).toBe(true);
    downloadButton().click();
    await settle();
    expect(seen).toEqual([defaults('parquet', true)]);
  });

  it('with file settings, the bundle says the loaded file contains custom settings', async () => {
    await open();
    await choose('parquet');
    expect(root().querySelector('.export-file-settings')).toBeNull();

    menu.hasFileSettings = true;
    await settle();
    expect(text(root().querySelector('.export-file-settings'))).toBe(
      'The loaded file contains custom settings.',
    );
    // Only the bundle carries settings.
    await choose('image');
    expect(root().querySelector('.export-file-settings')).toBeNull();
    // The trigger, hidden in the app, no longer holds the hint.
    expect(root().querySelector('ps-tooltip')).toBeNull();
  });

  it('opens with focus on the chosen kind; Tab reaches the Download; Escape returns focus', async () => {
    triggerButton().focus();
    await open();
    expect(root().activeElement).toBe(kindPicker());
    expect(kindPicker().shadowRoot!.activeElement).toBe(radio(kindPicker(), 'image'));

    // The arrow keys move between the kinds, as in any radio group.
    await userEvent.keyboard('{ArrowRight}');
    await settle();
    expect(text(download())).toBe('Download .txt');
    await userEvent.keyboard('{Tab}');
    expect(root().activeElement).toBe(download());

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(isOpen()).toBe(false);
    expect(triggerButton().getAttribute('aria-expanded')).toBe('false');
    expect(root().activeElement).toBe(trigger());
    expect(trigger().shadowRoot!.activeElement).toBe(triggerButton());
  });

  it('Tab past the Download closes the panel', async () => {
    triggerButton().focus();
    await open();
    await choose('ids');
    downloadButton().focus();
    await userEvent.keyboard('{Tab}');
    await settle();
    expect(isOpen()).toBe(false);
  });

  it('the close button closes it and focus returns to the trigger', async () => {
    triggerButton().focus();
    await open();
    const close = root().querySelector('.export-close') as HTMLElement;
    expect(close.shadowRoot!.querySelector('button')!.getAttribute('aria-label')).toBe('Close');
    close.shadowRoot!.querySelector('button')!.click();
    await settle();
    expect(isOpen()).toBe(false);
    expect(trigger().shadowRoot!.activeElement).toBe(triggerButton());
  });

  it('openFigureEditor fires open-publish-editor and no export', async () => {
    const seen = exportsSeen();
    const editor = vi.fn();
    document.body.addEventListener('open-publish-editor', editor);
    menu.openFigureEditor();

    expect(editor).toHaveBeenCalledOnce();
    expect((editor.mock.calls[0][0] as CustomEvent).detail).toEqual({});
    expect(seen).toEqual([]);
    document.body.removeEventListener('open-publish-editor', editor);
  });

  it('the trigger is exposed as the part trigger', () => {
    expect(trigger().getAttribute('part')).toBe('trigger');
  });

  /** A More button at the left of the window, and the panel's own trigger hidden by its part. */
  function moreAnchor(): HTMLButtonElement {
    const style = document.createElement('style');
    style.textContent = 'protspace-export-menu::part(trigger) { display: none; }';
    document.body.append(style);
    const more = document.createElement('button');
    more.id = 'more';
    more.textContent = 'More';
    more.style.cssText = 'position: fixed; left: 300px; top: 200px; width: 80px; height: 40px';
    document.body.append(more);
    return more;
  }

  it('openFrom positions the panel under the given anchor and focuses its first choice', async () => {
    const more = moreAnchor();
    more.focus();
    menu.openFrom(more);
    await settle();

    expect(isOpen()).toBe(true);
    expect(popover().anchor).toBe(more);
    const anchor = more.getBoundingClientRect();
    const box = panel().getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.top).toBeGreaterThanOrEqual(anchor.bottom);
    expect(box.top - anchor.bottom).toBeLessThan(16);
    // bottom-end: the panel's right edge lines up with the anchor's.
    expect(Math.abs(box.right - anchor.right)).toBeLessThan(2);
    expect(kindPicker().shadowRoot!.activeElement).toBe(radio(kindPicker(), 'image'));
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('openFrom with bottom-start lines the panel up with the anchor’s left edge', async () => {
    const more = moreAnchor();
    menu.openFrom(more, 'bottom-start');
    await settle();
    const anchor = more.getBoundingClientRect();
    expect(Math.abs(panel().getBoundingClientRect().left - anchor.left)).toBeLessThan(2);
  });

  it('closing returns focus to that anchor and the trigger is the anchor again', async () => {
    const more = moreAnchor();
    more.focus();
    menu.openFrom(more);
    await settle();

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(more);
    expect(popover().anchor).toBe(trigger());
    // The attributes the panel set on More are gone again; the trigger is the disclosure button.
    expect(more.hasAttribute('aria-expanded')).toBe(false);
    expect(more.hasAttribute('aria-haspopup')).toBe(false);
    expect(triggerButton().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('an anchor keeps the attributes it had before', async () => {
    const more = moreAnchor();
    more.setAttribute('aria-haspopup', 'dialog');
    more.setAttribute('aria-expanded', 'false');
    menu.openFrom(more);
    await settle();
    expect(more.getAttribute('aria-expanded')).toBe('true');

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(more.getAttribute('aria-haspopup')).toBe('dialog');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('a download from openFrom returns focus to that anchor before it asks for the file', async () => {
    const more = moreAnchor();
    more.focus();
    let focusedAtExport: Element | null = null;
    menu.addEventListener('export', () => (focusedAtExport = document.activeElement));
    menu.openFrom(more);
    await settle();
    downloadButton().click();
    await settle();
    expect(focusedAtExport).toBe(more);
    expect(isOpen()).toBe(false);
  });

  it('openFrom while open from the same anchor keeps it open', async () => {
    const more = moreAnchor();
    more.focus();
    menu.openFrom(more);
    await settle();
    menu.openFrom(more);
    await settle();
    expect(isOpen()).toBe(true);
    expect(kindPicker().shadowRoot!.activeElement).toBe(radio(kindPicker(), 'image'));
  });

  describe('on a phone', () => {
    beforeAll(async () => {
      await page.viewport(390, 844);
    });
    afterAll(async () => {
      await page.viewport(1280, 720);
    });

    it('opens as a bottom sheet across the window', async () => {
      const more = moreAnchor();
      menu.openFrom(more);
      await settle();
      expect(popover().hasAttribute('docked')).toBe(true);
      const box = panel().getBoundingClientRect();
      expect(Math.round(box.width)).toBe(window.innerWidth);
      // On the bottom edge, give or take the 2 px it slides in by.
      expect(Math.abs(box.bottom - window.innerHeight)).toBeLessThanOrEqual(2);
      // Every kind fits on the row.
      const kinds = kindPicker().shadowRoot!.querySelector('[role="radiogroup"]')!;
      expect(kinds.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    });
  });
});
