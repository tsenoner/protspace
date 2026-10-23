/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LegendItem, OtherItem } from './types';
import { LEGEND_VALUES, NA_VALUE, LEGEND_EVENTS } from './config';

// Import the component to register the custom element
import './legend';
import type { ProtspaceLegend } from './legend';
import { LegendDataProcessor } from './legend-data-processor';

type AnyLegend = HTMLElement & Record<string, unknown>;

/** The legend's item actions (controllers/item-actions-controller.ts). */
const actions = (el: AnyLegend) => (el as unknown as ProtspaceLegend)._actions;

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

  describe('extractFromOther', () => {
    beforeEach(() => {
      el._otherPopover.show(document.createElement('button'));
      el.maxVisibleValues = 5;
    });

    it('sets _pendingExtractValue to the given value', () => {
      actions(el).extractFromOther('cat1');
      expect(el._pendingExtractValue).toBe('cat1');
    });

    it('keeps a value extracted while isolated out of Other on later rebuilds', () => {
      el.isolationMode = true;
      el._preIsolationVisibleValues = new Set(['visible1']);
      actions(el).extractFromOther('cat1');
      expect([...(el._preIsolationVisibleValues as Set<string>)]).toEqual(['visible1', 'cat1']);
    });

    it('increments maxVisibleValues by 1', () => {
      actions(el).extractFromOther('cat1');
      expect(el.maxVisibleValues).toBe(6);
    });

    it('keeps the Other popover open', () => {
      actions(el).extractFromOther('cat1');
      expect(el._otherPopover.anchor).not.toBeNull();
    });

    it('dispatches extract event with the value', () => {
      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      actions(el).extractFromOther('cat1');

      expect(events).toHaveLength(1);
      expect(events[0].detail).toEqual({ value: 'cat1', action: 'extract' });
    });

    it('handles __NA__ extraction', () => {
      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      actions(el).extractFromOther(NA_VALUE);

      expect(el._pendingExtractValue).toBe(NA_VALUE);
      expect(events[0].detail.value).toBe(NA_VALUE);
    });

    it('schedules settings save after update completes', async () => {
      const resolved = Promise.resolve(true);
      vi.spyOn(el, 'updateComplete', 'get').mockReturnValue(resolved);

      actions(el).extractFromOther('cat1');

      // Queued on updateComplete — flush the microtask
      await resolved;
      expect(el._persistenceController.saveSettings).toHaveBeenCalled();
    });
  });

  describe('extractAllFromOther', () => {
    const otherItems: OtherItem[] = [
      { value: 'cat1', count: 5 },
      { value: 'cat2', count: 3 },
      { value: NA_VALUE, count: 2 },
    ];

    beforeEach(() => {
      el._otherPopover.show(document.createElement('button'));
      el._otherItems = otherItems;
      el._legendItems = [
        createLegendItem('visible1', { zOrder: 0 }),
        createLegendItem('visible2', { zOrder: 1 }),
        createLegendItem(LEGEND_VALUES.OTHER, { zOrder: 2, count: 10 }),
      ];
    });

    it('sets maxVisibleValues to nonOtherCount + otherItems.length', () => {
      actions(el).extractAllFromOther();
      // 2 non-Other legend items + 3 other items = 5
      expect(el.maxVisibleValues).toBe(5);
    });

    it('closes the Other popover', () => {
      actions(el).extractAllFromOther();
      expect(el._otherPopover.anchor).toBeNull();
    });

    it('dispatches extract event for each other item', () => {
      const events: CustomEvent[] = [];
      el.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
        events.push(e)) as EventListener);

      actions(el).extractAllFromOther();

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
      actions(el).extractAllFromOther();

      // maxVisibleValues should have been the original value when first event fired
      expect(maxVisibleAtEventTime).toBe(origMaxVisible);
      expect(eventValues).toHaveLength(3);
    });

    it('schedules settings save after update completes', async () => {
      const resolved = Promise.resolve(true);
      vi.spyOn(el, 'updateComplete', 'get').mockReturnValue(resolved);

      actions(el).extractAllFromOther();

      await resolved;
      expect(el._persistenceController.saveSettings).toHaveBeenCalled();
    });

    it('moves every Other value into the visible set while a subset is isolated', () => {
      el.isolationMode = true;
      el._preIsolationVisibleValues = new Set(['visible1', 'visible2']);

      actions(el).extractAllFromOther();

      // Isolation keeps this set and fills no free slots, so the cap alone promotes nothing.
      const visible = el._preIsolationVisibleValues as Set<string>;
      const { otherItems: left } = LegendDataProcessor.sortAndLimitItems(
        new Map([
          ['visible1', 9],
          ['visible2', 8],
          ['cat1', 5],
          ['cat2', 3],
          [NA_VALUE, 2],
        ]),
        el.maxVisibleValues as number,
        true,
        'size-desc',
        new Map(),
        visible,
      );
      expect([...visible]).toEqual(['visible1', 'visible2', 'cat1', 'cat2', NA_VALUE]);
      expect(left).toEqual([]);
    });

    it('keeps the visible set alone when not isolated', () => {
      el._preIsolationVisibleValues = new Set(['visible1']);
      actions(el).extractAllFromOther();
      expect([...(el._preIsolationVisibleValues as Set<string>)]).toEqual(['visible1']);
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

      actions(el).extractAllFromOther();

      expect(events).toHaveLength(0);
      // 1 non-Other + 0 other items
      expect(el.maxVisibleValues).toBe(1);
    });
  });
});
