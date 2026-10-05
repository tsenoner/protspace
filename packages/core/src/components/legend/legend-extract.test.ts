/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type { LegendItem, OtherItem } from './types';
import { LEGEND_VALUES, NA_VALUE, LEGEND_EVENTS } from './config';

// Import the component to register the custom element
import './legend';
import type { ProtspaceLegend } from './legend';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

type AnyLegend = HTMLElement & Record<string, unknown>;

function createLegendItem(value: string, overrides: Partial<LegendItem> = {}): LegendItem {
  return {
    value,
    color: '#000',
    shape: 'circle',
    count: 1,
    isVisible: true,
    zOrder: 0,
    ...overrides,
  };
}

function createLegend(): AnyLegend {
  const el = document.createElement('protspace-legend') as AnyLegend;
  // Stub persistence controller to avoid localStorage calls
  el._persistenceController = {
    saveSettings: vi.fn(),
    removeSettings: vi.fn(),
    clearPendingCategories: vi.fn(),
  };
  return el;
}

describe('legend extract methods', () => {
  let el: AnyLegend;

  beforeEach(() => {
    el = createLegend();
  });

  describe('_handleExtractFromOther', () => {
    beforeEach(() => {
      el._showOtherDialog = true;
      el._mouseDownOutsideOther = true;
      el.maxVisibleValues = 5;
    });

    it('sets _pendingExtractValue to the given value', () => {
      (el as AnyLegend)._handleExtractFromOther('cat1');
      expect(el._pendingExtractValue).toBe('cat1');
    });

    it('increments maxVisibleValues by 1', () => {
      (el as AnyLegend)._handleExtractFromOther('cat1');
      expect(el.maxVisibleValues).toBe(6);
    });

    it('dispatches extract event with the value', () => {
      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      (el as AnyLegend)._handleExtractFromOther('cat1');

      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({ value: 'cat1', action: 'extract' });
    });

    it('handles __NA__ extraction', () => {
      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      (el as AnyLegend)._handleExtractFromOther(NA_VALUE);

      expect(el._pendingExtractValue).toBe(NA_VALUE);
      expect(events[0].detail.value).toBe(NA_VALUE);
    });

    it('schedules settings save after update completes', async () => {
      const resolved = Promise.resolve(true);
      vi.spyOn(el, 'updateComplete', 'get').mockReturnValue(resolved);

      (el as AnyLegend)._handleExtractFromOther('cat1');

      // Queued on updateComplete — flush the microtask
      await resolved;
      expect(el._persistenceController.saveSettings).toHaveBeenCalled();
    });
  });

  describe('_handleExtractAllFromOther', () => {
    const otherItems: OtherItem[] = [
      { value: 'cat1', count: 5 },
      { value: 'cat2', count: 3 },
      { value: NA_VALUE, count: 2 },
    ];

    beforeEach(() => {
      el._showOtherDialog = true;
      el._mouseDownOutsideOther = true;
      el._otherItems = otherItems;
      el._legendItems = [
        createLegendItem('visible1', { zOrder: 0 }),
        createLegendItem('visible2', { zOrder: 1 }),
        createLegendItem(LEGEND_VALUES.OTHER, { zOrder: 2, count: 10 }),
      ];
    });

    it('sets maxVisibleValues to nonOtherCount + otherItems.length', () => {
      (el as AnyLegend)._handleExtractAllFromOther();
      // 2 non-Other legend items + 3 other items = 5
      expect(el.maxVisibleValues).toBe(5);
    });

    it('dispatches extract event for each other item', () => {
      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      (el as AnyLegend)._handleExtractAllFromOther();

      expect(events).toHaveLength(3);
      expect(events[0].detail).toEqual({ value: 'cat1', action: 'extract' });
      expect(events[1].detail).toEqual({ value: 'cat2', action: 'extract' });
      expect(events[2].detail).toEqual({ value: NA_VALUE, action: 'extract' });
    });

    it('dispatches events before setting maxVisibleValues', () => {
      // Pins the current order: extract listeners see the cap from before the extract.
      // It does not protect _otherItems: Lit re-renders asynchronously, so setting
      // maxVisibleValues first could not clear them before the loop ran either.
      const eventValues: string[] = [];
      let maxVisibleAtEventTime: number | undefined;

      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, (() => {
        if (maxVisibleAtEventTime === undefined) {
          maxVisibleAtEventTime = el.maxVisibleValues as number;
        }
        eventValues.push('event');
      }) as EventListener);

      const origMaxVisible = el.maxVisibleValues;
      (el as AnyLegend)._handleExtractAllFromOther();

      // maxVisibleValues should have been the original value when first event fired
      expect(maxVisibleAtEventTime).toBe(origMaxVisible);
      expect(eventValues).toHaveLength(3);
    });

    it('syncs settings dialog when it is open', () => {
      el._showSettingsDialog = true;
      el._dialogSettings = {
        maxVisibleValues: 10,
        shapeSize: 1,
        enableDuplicateStackUI: false,
        annotationSortModes: {},
        selectedPaletteId: 'kellys',
      };

      (el as AnyLegend)._handleExtractAllFromOther();

      expect(el._dialogSettings.maxVisibleValues).toBe(5);
    });

    it('does not modify _dialogSettings when settings dialog is closed', () => {
      el._showSettingsDialog = false;
      const original = {
        maxVisibleValues: 10,
        shapeSize: 1,
        enableDuplicateStackUI: false,
        annotationSortModes: {},
        selectedPaletteId: 'kellys',
      };
      el._dialogSettings = { ...original };

      (el as AnyLegend)._handleExtractAllFromOther();

      expect(el._dialogSettings.maxVisibleValues).toBe(10);
    });

    it('schedules settings save after update completes', async () => {
      const resolved = Promise.resolve(true);
      vi.spyOn(el, 'updateComplete', 'get').mockReturnValue(resolved);

      (el as AnyLegend)._handleExtractAllFromOther();

      await resolved;
      expect(el._persistenceController.saveSettings).toHaveBeenCalled();
    });

    it('handles empty otherItems gracefully', () => {
      el._otherItems = [];
      el._legendItems = [
        createLegendItem('visible1', { zOrder: 0 }),
        createLegendItem(LEGEND_VALUES.OTHER, { zOrder: 1, count: 0 }),
      ];

      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      (el as AnyLegend)._handleExtractAllFromOther();

      expect(events).toHaveLength(0);
      // 1 non-Other + 0 other items
      expect(el.maxVisibleValues).toBe(1);
    });
  });
});

// Four categories by count: a (4), b (3), c (2), d (1).
function makeExtractData(): VisualizationData {
  return {
    protein_ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'],
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(20) }],
    annotations: {
      family: {
        kind: 'categorical',
        values: ['a', 'b', 'c', 'd'],
        colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
        shapes: ['circle', 'circle', 'circle', 'circle'],
      },
    },
    annotation_data: {
      family: new Int32Array([0, 0, 0, 0, 1, 1, 1, 2, 2, 3]),
    },
  };
}

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

describe('extracting from Other in a mounted legend', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the extracted item as a row, not the largest Other item', async () => {
    const { legend } = await mountLegendWithScatterplot(makeExtractData(), 'family');
    legend.maxVisibleValues = 2;
    await settle(legend);

    const root = legend.shadowRoot!;
    const rowValues = () =>
      Array.from(root.querySelectorAll<HTMLElement>('.legend-item')).map(
        (row) => row.dataset.value,
      );
    expect(rowValues()).toEqual(['a', 'b', LEGEND_VALUES.OTHER]);

    root.querySelector<HTMLButtonElement>('.view-button')!.click();
    await settle(legend);
    const otherRow = Array.from(root.querySelectorAll('.other-item')).find(
      (row) => row.querySelector('.other-item-name')?.textContent === 'd',
    )!;
    otherRow.querySelector<HTMLButtonElement>('.extract-button')!.click();
    await settle(legend);

    // The cap grows by one and the extract decides who fills it: d, not the larger c.
    expect(rowValues()).toEqual(['a', 'b', 'd', LEGEND_VALUES.OTHER]);
    // The Other dialog closed.
    expect(root.querySelector('.other-item')).toBeNull();
  });

  it('renders every Other item as a row after Extract All and closes the dialog', async () => {
    const { legend } = await mountLegendWithScatterplot(makeExtractData(), 'family');
    legend.maxVisibleValues = 2;
    await settle(legend);

    const root = legend.shadowRoot!;
    root.querySelector<HTMLButtonElement>('.view-button')!.click();
    await settle(legend);
    expect(root.querySelectorAll('.other-item')).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('.extract-all-button')!.click();
    await settle(legend);

    const rowValues = Array.from(root.querySelectorAll<HTMLElement>('.legend-item')).map(
      (row) => row.dataset.value,
    );
    expect(rowValues).toEqual(['a', 'b', 'c', 'd']);
    // The dialog itself closed: with Other emptied, no .other-item rows would render even if
    // it stayed open.
    expect(root.querySelector('#legend-other-dialog')).toBeNull();
  });
});
