// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDatasetHash, type LegendPersistedSettings } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { LEGEND_STYLES, SHAPE_PATH_GENERATORS } from './config';
import { COLOR_COMMIT_DELAY_MS } from './legend-color-picker';
import {
  categoricalData,
  legendStorageKey,
  numericData,
  TWELVE,
} from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function setup() {
  const data = categoricalData(TWELVE);
  const { legend, plot } = await mountLegendWithScatterplot(data, 'family');
  await settle(legend);
  return { legend, plot, key: legendStorageKey(generateDatasetHash(data), 'family') };
}

const q = <T extends Element = HTMLElement>(legend: ProtspaceLegend, selector: string) =>
  legend.shadowRoot!.querySelector<T>(selector);

async function openPicker(legend: ProtspaceLegend, value: string): Promise<HTMLElement> {
  q<HTMLButtonElement>(
    legend,
    `.legend-item[data-value="${value}"] .legend-symbol-button`,
  )!.click();
  await settle(legend);
  return q(legend, '.color-picker-popover')!;
}

function setColour(legend: ProtspaceLegend, color: string): void {
  const input = q<HTMLInputElement>(legend, '.color-picker-swatch')!;
  input.value = color;
  input.dispatchEvent(new Event('input'));
}

const stored = (key: string) =>
  JSON.parse(localStorage.getItem(key) ?? 'null') as LegendPersistedSettings | null;

describe('legend colour and shape picker', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it("opens from a categorical row's symbol, headed by the row's label", async () => {
    const { legend } = await setup();
    const picker = await openPicker(legend, 'B');
    expect(picker.querySelector('.color-picker-header')!.textContent!.trim()).toBe('B');
    expect(picker.querySelector('input[type="color"]')!.getAttribute('aria-label')).toBe(
      'Set color for B',
    );
  });

  it('turns three colour inputs within 150 ms into one legend-colormapping-change', async () => {
    const { legend, plot } = await setup();
    await openPicker(legend, 'B');
    vi.useFakeTimers();
    const onMapping = vi.fn();
    plot.addEventListener('legend-colormapping-change', onMapping);

    for (const color of ['#ff0000', '#00ff00', '#0000ff']) {
      setColour(legend, color);
      vi.advanceTimersByTime(40);
    }
    expect(onMapping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COLOR_COMMIT_DELAY_MS);
    expect(onMapping).toHaveBeenCalledOnce();
    expect(onMapping.mock.calls[0][0].detail.colorOnly).toBe(true);
  });

  it('stores a shape pick', async () => {
    const { legend, key } = await setup();
    await openPicker(legend, 'B');
    q<HTMLButtonElement>(legend, '.shape-picker-swatch')!.click();
    await settle(legend);
    q<HTMLButtonElement>(
      legend,
      '.shape-picker-item[aria-label="Use diamond shape for B"]',
    )!.click();
    await settle(legend);

    expect(stored(key)!.categories.B.shape).toBe('diamond');
    expect(q(legend, '.legend-item[data-value="B"] .legend-symbol path')!.getAttribute('d')).toBe(
      SHAPE_PATH_GENERATORS.diamond(LEGEND_STYLES.legendDisplaySize),
    );
  });

  it('closes on a press outside and flushes the pending colour', async () => {
    const { legend, plot } = await setup();
    await openPicker(legend, 'B');
    vi.useFakeTimers();
    const onMapping = vi.fn();
    plot.addEventListener('legend-colormapping-change', onMapping);
    setColour(legend, '#ff0000');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(onMapping).toHaveBeenCalledOnce();
    await settle(legend);
    expect(q(legend, '.color-picker-popover')).toBeNull();
  });

  it('stays open when a press starts inside and ends outside', async () => {
    const { legend } = await setup();
    const picker = await openPicker(legend, 'B');

    picker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await settle(legend);

    expect(q(legend, '.color-picker-popover')).not.toBeNull();
  });

  it('lands a colour still waiting for its delay on the dataset it was picked on', async () => {
    const { legend, plot, key } = await setup();
    await openPicker(legend, 'B');
    vi.useFakeTimers();
    const onMapping = vi.fn();
    plot.addEventListener('legend-colormapping-change', onMapping);
    setColour(legend, '#ff0000');

    legend.clearForNewDataset('next-dataset');
    expect(onMapping).toHaveBeenCalledOnce();
    expect(stored(key)!.categories.B.color).toBe('#ff0000');

    vi.advanceTimersByTime(COLOR_COMMIT_DELAY_MS);
    expect(onMapping).toHaveBeenCalledOnce();
  });

  it('offers no symbol button on numeric rows', async () => {
    const { legend } = await mountLegendWithScatterplot(
      numericData(Array.from({ length: 20 }, (_, i) => i + 1)),
      'length',
    );
    await settle(legend);
    expect(legend.shadowRoot!.querySelectorAll('.legend-item').length).toBeGreaterThan(1);
    expect(legend.shadowRoot!.querySelector('.legend-symbol-button')).toBeNull();
  });
});
