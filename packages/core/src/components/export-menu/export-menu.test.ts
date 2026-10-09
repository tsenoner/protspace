/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_DEFAULTS } from './export-defaults';
import './export-menu';
import type { ExportEventDetail, ProtspaceExportMenu } from './export-menu';

let menu: ProtspaceExportMenu;

beforeEach(async () => {
  document.body.innerHTML = '';
  menu = document.createElement('protspace-export-menu');
  document.body.append(menu);
  await menu.updateComplete;
});

afterEach(() => {
  // Removing an open menu releases its layer, so the next test starts with none.
  menu.remove();
});

const root = () => menu.shadowRoot!;
const panel = () => root().querySelector('.export-menu');
const trigger = () => root().querySelector<HTMLButtonElement>('.trigger')!;
/** A button of the menu by its visible text. */
const button = (text: string) =>
  [...root().querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === text,
  );

async function open(): Promise<void> {
  if (!panel()) trigger().click();
  await menu.updateComplete;
}

async function choose(format: string): Promise<void> {
  button(format)!.click();
  await menu.updateComplete;
}

describe('protspace-export-menu', () => {
  it('PNG and PDF offer the figure editor and a quick export', async () => {
    await open();
    expect(button('PNG')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Figure Editor')).toBeDefined();
    expect(button('Quick Export PNG')).toBeDefined();

    await choose('PDF');
    expect(button('PDF')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Figure Editor')).toBeDefined();
    expect(button('Quick Export PDF')).toBeDefined();
  });

  it('IDs and Parquet export directly', async () => {
    await open();
    await choose('IDs');
    expect(button('Figure Editor')).toBeUndefined();
    expect(button('Export IDS')).toBeDefined();

    await choose('Parquet');
    expect(button('Figure Editor')).toBeUndefined();
    expect(button('Export PARQUET')).toBeDefined();
  });

  it('Include legend settings shows only for Parquet and travels in the detail', async () => {
    const onExport = vi.fn();
    document.addEventListener('export', onExport);
    await open();
    expect(root().querySelector('.export-checkbox')).toBeNull();

    await choose('Parquet');
    const checkbox = root().querySelector<HTMLInputElement>('.export-checkbox')!;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    await menu.updateComplete;
    button('Export PARQUET')!.click();
    document.removeEventListener('export', onExport);

    expect(onExport).toHaveBeenCalledOnce();
    expect((onExport.mock.calls[0][0] as CustomEvent<ExportEventDetail>).detail).toMatchObject({
      type: 'parquet',
      includeLegendSettings: false,
    });
  });

  it('export carries the EXPORT_DEFAULTS sizes', async () => {
    const onExport = vi.fn();
    menu.addEventListener('export', onExport);
    await open();
    button('Quick Export PNG')!.click();
    await menu.updateComplete;

    expect((onExport.mock.calls[0][0] as CustomEvent<ExportEventDetail>).detail).toEqual({
      type: 'png',
      imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
      imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
      legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
      legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
      includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
      includeLegendSettings: true,
    });
    expect(panel()).toBeNull();
  });

  it('Figure Editor dispatches open-publish-editor', async () => {
    const onOpen = vi.fn();
    menu.addEventListener('open-publish-editor', onOpen);
    await open();
    button('Figure Editor')!.click();
    await menu.updateComplete;

    expect(onOpen).toHaveBeenCalledOnce();
    expect(panel()).toBeNull();
  });

  it('reset returns to PNG', async () => {
    await open();
    await choose('Parquet');
    root().querySelector<HTMLInputElement>('.export-checkbox')!.click();
    await menu.updateComplete;

    menu.reset();
    await menu.updateComplete;
    expect(button('PNG')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Quick Export PNG')).toBeDefined();
    // The legend settings come back included too.
    await choose('Parquet');
    expect(root().querySelector<HTMLInputElement>('.export-checkbox')!.checked).toBe(true);
  });

  it('Escape closes the panel', async () => {
    await open();
    expect(root().activeElement).toBe(button('PNG'));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(root().activeElement).toBe(trigger());
  });
});

function focusOutTo(from: Element, to: Element | null): void {
  from.dispatchEvent(
    new FocusEvent('focusout', { bubbles: true, composed: true, relatedTarget: to }),
  );
}

describe('protspace-export-menu focus', () => {
  it('Tab out of the panel closes it; focus moving inside keeps it open', async () => {
    await open();
    focusOutTo(button('PNG')!, button('PDF')!);
    focusOutTo(button('PNG')!, trigger());
    await menu.updateComplete;
    expect(panel()).not.toBeNull();

    const next = document.body.appendChild(document.createElement('button'));
    focusOutTo(button('Quick Export PNG')!, next);
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('a focus loss with no new target keeps the panel open', async () => {
    await open();
    focusOutTo(button('PNG')!, null);
    await menu.updateComplete;
    expect(panel()).not.toBeNull();
  });
});

describe('EXPORT_DEFAULTS', () => {
  it('has correct default values', () => {
    expect(EXPORT_DEFAULTS.FORMAT).toBe('png');
    expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBe(2048);
    expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBe(1024);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBe(20);
    expect(EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX).toBe(15);
    expect(EXPORT_DEFAULTS.BASE_FONT_SIZE).toBe(24);
    expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBe(8);
    expect(EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX).toBe(120);
    expect(EXPORT_DEFAULTS.LOCK_ASPECT_RATIO).toBe(true);
  });

  it('is defined and not undefined', () => {
    expect(EXPORT_DEFAULTS).toBeDefined();
    expect(typeof EXPORT_DEFAULTS).toBe('object');
  });

  it('has all required keys', () => {
    const requiredKeys = [
      'FORMAT',
      'IMAGE_WIDTH',
      'IMAGE_HEIGHT',
      'LEGEND_WIDTH_PERCENT',
      'LEGEND_FONT_SIZE_PX',
      'BASE_FONT_SIZE',
      'MIN_LEGEND_FONT_SIZE_PX',
      'MAX_LEGEND_FONT_SIZE_PX',
      'LOCK_ASPECT_RATIO',
      'INCLUDE_LEGEND',
    ];

    requiredKeys.forEach((key) => {
      expect(EXPORT_DEFAULTS).toHaveProperty(key);
    });
  });

  it('defaults INCLUDE_LEGEND to true', () => {
    expect(EXPORT_DEFAULTS.INCLUDE_LEGEND).toBe(true);
  });

  it('has valid numeric ranges', () => {
    expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBeGreaterThan(0);
    expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBeGreaterThan(0);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBeGreaterThan(0);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBeLessThanOrEqual(100);
    expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBeLessThan(
      EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX,
    );
  });

  describe('export dimension calculations', () => {
    it('calculates correct legend percentage', () => {
      const legendPercent = EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT / 100;
      expect(legendPercent).toBe(0.2);
    });

    it('calculates correct target width for scatterplot', () => {
      const legendPercent = EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT / 100;
      const targetWidth = Math.round(EXPORT_DEFAULTS.IMAGE_WIDTH * (1 - legendPercent));
      expect(targetWidth).toBe(1638); // 2048 * 0.80 = 1638
    });

    it('calculates correct legend scale factor', () => {
      const scaleFactor = EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
      expect(scaleFactor).toBe(0.625); // 15 / 24 = 0.625
    });

    it('calculates scale factor for minimum font size', () => {
      const scaleFactor = EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
      expect(scaleFactor).toBeCloseTo(0.333, 2); // 8 / 24 ≈ 0.333
    });

    it('calculates scale factor for maximum font size', () => {
      const scaleFactor = EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
      expect(scaleFactor).toBe(5.0); // 120 / 24 = 5.0
    });
  });
});
