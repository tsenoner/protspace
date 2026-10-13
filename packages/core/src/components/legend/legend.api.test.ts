// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import { LegendDataProcessor } from './legend-data-processor';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';
import { stubPopoverApi } from './test-support/popover-stub';

vi.stubGlobal('localStorage', createLocalStorageMock());
stubPopoverApi();

/** Public methods (docs/developers/api/index.md) and their arity today. */
const METHODS: Record<string, number> = {
  forceSync: 0,
  getLegendExportData: 0,
  downloadAsImage: 0,
  getAllPersistedSettings: 0,
  setFileSettings: 2,
  clearForNewDataset: 1,
  hasFileSettingsForAnnotation: 1,
  applyShapeSize: 2,
  applyEatSettings: 2,
  setReliabilityState: 1,
};
const GETTERS = ['hasFileSettings', 'reliabilityThreshold', 'pickedShapeSize', 'reliabilityState'];

async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settleLegend(legend);
  return legend;
}

describe('legend public API', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(Object.entries(METHODS))('keeps %s with arity %i', (name, arity) => {
    const method = (ProtspaceLegend.prototype as unknown as Record<string, unknown>)[name];
    expect(typeof method).toBe('function');
    expect((method as (...args: unknown[]) => unknown).length).toBe(arity);
  });

  it.each(GETTERS)('keeps the %s getter', (name) => {
    expect(typeof Object.getOwnPropertyDescriptor(ProtspaceLegend.prototype, name)?.get).toBe(
      'function',
    );
  });

  it('dispatches legend-customize from the settings button', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    await legend.updateComplete;
    const customize = vi.fn();
    legend.addEventListener('legend-customize', customize);
    const button = legend.shadowRoot!.querySelector<HTMLElement & { label: string }>(
      '.settings-button',
    )!;
    expect(button.label).toBe('Legend settings');
    const popover = () => legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;

    button.click();
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    expect(customize).toHaveBeenCalledOnce();
    expect(popover().open).toBe(true);

    button.click();
    await legend.updateComplete;
    expect(popover().open).toBe(false);
    expect(customize).toHaveBeenCalledOnce();
  });

  it('dispatches legend-item-click with the value and the action', async () => {
    const legend = await mount();
    const onItem = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, onItem);
    legend
      .shadowRoot!.querySelector<HTMLElement>('.legend-item[data-value="A"] .legend-item-main')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
    expect(onItem.mock.calls[0][0].detail).toEqual({ value: 'A', action: 'toggle' });
  });

  it('dispatches legend-error when processing the data fails', async () => {
    const legend = await mount();
    const onError = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.ERROR, onError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(LegendDataProcessor, 'processLegendItems').mockImplementation(() => {
      throw new Error('boom');
    });

    legend.maxVisibleValues = 5;
    await settleLegend(legend);

    expect(onError.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        source: 'data-processing',
        message: 'Failed to process legend data',
      }),
    );
  });

  it('dispatches eat-overlay-change when EAT settings are applied', async () => {
    const legend = await mount();
    const onEat = vi.fn();
    legend.addEventListener('eat-overlay-change', onEat);
    legend.applyEatSettings(false, 0.4);
    expect(onEat.mock.calls[0][0].detail).toEqual({
      enabled: false,
      confidenceThreshold: 0.4,
      reliability: { mode: 'atLeast', min: 0.4, max: 1 },
    });
  });

  it('dispatches legend-download from downloadAsImage', async () => {
    const legend = await mount();
    const onDownload = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.DOWNLOAD, onDownload);
    await legend.downloadAsImage();
    expect(onDownload).toHaveBeenCalledOnce();
  });
});
