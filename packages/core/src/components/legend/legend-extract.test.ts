/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LegendItem, OtherItem } from './types';
import { LEGEND_VALUES, NA_VALUE, LEGEND_EVENTS } from './config';

// Import the component to register the custom element
import './legend';

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

  describe('_closeOtherDialog', () => {
    it('sets _showOtherDialog to false', () => {
      el._showOtherDialog = true;
      (el as AnyLegend)._closeOtherDialog();
      expect(el._showOtherDialog).toBe(false);
    });

    it('resets _mouseDownOutsideOther to false', () => {
      el._mouseDownOutsideOther = true;
      (el as AnyLegend)._closeOtherDialog();
      expect(el._mouseDownOutsideOther).toBe(false);
    });

    it('handles already-closed state', () => {
      el._showOtherDialog = false;
      el._mouseDownOutsideOther = false;
      (el as AnyLegend)._closeOtherDialog();
      expect(el._showOtherDialog).toBe(false);
      expect(el._mouseDownOutsideOther).toBe(false);
    });
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

    it('closes the other dialog', () => {
      (el as AnyLegend)._handleExtractFromOther('cat1');
      expect(el._showOtherDialog).toBe(false);
      expect(el._mouseDownOutsideOther).toBe(false);
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

    it('closes the other dialog', () => {
      (el as AnyLegend)._handleExtractAllFromOther();
      expect(el._showOtherDialog).toBe(false);
      expect(el._mouseDownOutsideOther).toBe(false);
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
      // Events must fire while _otherItems still has items.
      // If maxVisibleValues were set first, a reactive update could clear _otherItems.
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
