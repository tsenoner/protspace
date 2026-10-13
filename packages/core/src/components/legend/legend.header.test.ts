// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotationLabel,
  DEFAULT_NUMERIC_PALETTE_ID,
  generateDatasetHash,
  type VisualizationData,
} from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import {
  categoricalData,
  legendStorageKey,
  numericData,
  TWELVE,
} from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

async function mount(data: VisualizationData, annotation: string): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, annotation);
  await settleLegend(legend);
  return legend;
}

const reverseButton = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<HTMLButtonElement>('button.reverse-button')!;
const LENGTHS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('legend header', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('titles the legend with the display name, never the key', async () => {
    const legend = await mount(
      categoricalData({ X: 2, Y: 1 }, 'protein_families'),
      'protein_families',
    );
    const title = legend.shadowRoot!.querySelector('.legend-title')!.textContent!.trim();
    expect(title).toBe(annotationLabel('protein_families'));
    expect(title).toBe('Protein family');
    expect(title).not.toContain('protein_families');
  });

  it('names the reverse button for a categorical annotation', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    expect(reverseButton(legend).getAttribute('aria-label')).toBe(
      'Reverse z-order (keep Other last)',
    );
  });

  it('names the numeric reverse button by the order it switches to', async () => {
    const legend = await mount(numericData(LENGTHS), 'length');
    expect(reverseButton(legend).getAttribute('aria-label')).toBe('Show high to low');

    reverseButton(legend).click();
    await settleLegend(legend);
    expect(reverseButton(legend).getAttribute('aria-label')).toBe('Show low to high');
  });

  it('names it "Reverse manual order" for a numeric manual order', async () => {
    const data = numericData(LENGTHS);
    localStorage.setItem(
      legendStorageKey(generateDatasetHash(data), 'length'),
      JSON.stringify({
        maxVisibleValues: 10,
        shapeSize: 10,
        sortMode: 'manual',
        hiddenValues: [],
        categories: {},
        enableDuplicateStackUI: false,
        selectedPaletteId: DEFAULT_NUMERIC_PALETTE_ID,
      }),
    );
    const legend = await mount(data, 'length');
    expect(reverseButton(legend).getAttribute('aria-label')).toBe('Reverse manual order');
  });

  it('opens settings from the settings button and focuses the dialog', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const onCustomize = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.CUSTOMIZE, onCustomize);

    legend
      .shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Legend settings"]')!
      .click();
    await settleLegend(legend);

    expect(onCustomize).toHaveBeenCalledOnce();
    expect(legend.shadowRoot!.activeElement?.id).toBe('legend-settings-dialog');
  });

  it('marks a predicted annotation with the badge and the note', async () => {
    const legend = await mount(
      categoricalData({ yes: 3, no: 1 }, 'predicted_membrane'),
      'predicted_membrane',
    );
    const root = legend.shadowRoot!;
    expect(root.querySelector('.legend-predicted-badge')!.textContent).toContain('Predicted');
    expect(root.querySelector('.legend-predicted-note')!.textContent!.trim()).toBe(
      'Computationally predicted, not experimentally curated.',
    );
    expect(root.querySelector('.legend-header protspace-info-popover')).not.toBeNull();
  });
});
