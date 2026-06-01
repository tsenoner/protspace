import { describe, it, expect, beforeEach } from 'vitest';
import {
  LegendDataProcessor,
  createProcessorContext,
  type LegendProcessorContext,
} from './legend-data-processor';
import { getVisualEncoding } from './visual-encoding';
import type { LegendItem } from './types';
import { LEGEND_VALUES, NA_VALUE, NA_DEFAULT_COLOR } from './config';

describe('legend-data-processor', () => {
  let ctx: LegendProcessorContext;

  beforeEach(() => {
    ctx = createProcessorContext();
  });

  describe('createProcessorContext', () => {
    it('creates a new context with empty slot tracker', () => {
      const context = createProcessorContext();
      expect(context.slotTracker).toBeDefined();
      expect(context.slotTracker.isEmpty()).toBe(true);
      expect(context.currentAnnotation).toBeNull();
    });
  });

  describe('getFilteredIndices', () => {
    it('returns empty set when not in isolation mode', () => {
      const result = LegendDataProcessor.getFilteredIndices(
        false,
        [['id1', 'id2']],
        ['id1', 'id2', 'id3'],
      );
      expect(result.size).toBe(0);
    });

    it('returns empty set when isolation history is empty', () => {
      const result = LegendDataProcessor.getFilteredIndices(true, [], ['id1', 'id2', 'id3']);
      expect(result.size).toBe(0);
    });

    it('filters indices based on isolation history', () => {
      const result = LegendDataProcessor.getFilteredIndices(
        true,
        [['id1', 'id2']],
        ['id1', 'id2', 'id3'],
      );
      expect(result.has(0)).toBe(true);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(false);
    });

    it('handles multiple isolation history levels', () => {
      const result = LegendDataProcessor.getFilteredIndices(
        true,
        [
          ['id1', 'id2', 'id3'],
          ['id1', 'id2'],
        ],
        ['id1', 'id2', 'id3'],
      );
      // Only id1 and id2 are in both histories
      expect(result.has(0)).toBe(true);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(false);
    });
  });

  describe('countAnnotationFrequencies', () => {
    it('counts all values when not in isolation mode', () => {
      const values = ['a', 'b', 'a', 'c', 'a'];
      const result = LegendDataProcessor.countAnnotationFrequencies(values, false, [], new Set());
      expect(result.get('a')).toBe(3);
      expect(result.get('b')).toBe(1);
      expect(result.get('c')).toBe(1);
    });

    it('handles null values (converts to __NA__)', () => {
      const values = ['a', null, 'a', null];
      const result = LegendDataProcessor.countAnnotationFrequencies(values, false, [], new Set());
      expect(result.get('a')).toBe(2);
      // Null values are converted to '__NA__' internally
      expect(result.get(NA_VALUE)).toBe(2);
    });

    it('filters by indices in isolation mode', () => {
      const values = ['a', 'b', 'a', 'c', 'a'];
      const filtered = new Set([0, 2, 4]);
      const result = LegendDataProcessor.countAnnotationFrequencies(
        values,
        true,
        [['id1']],
        filtered,
      );
      expect(result.get('a')).toBe(3);
      expect(result.has('b')).toBe(false);
      expect(result.has('c')).toBe(false);
    });
  });

  describe('sortAndLimitItems', () => {
    it('sorts by size (descending) by default', () => {
      const freq = new Map<string, number>([
        ['small', 5],
        ['large', 20],
        ['medium', 10],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'size-desc');
      expect(result.topItems[0][0]).toBe('large');
      expect(result.topItems[1][0]).toBe('medium');
      expect(result.topItems[2][0]).toBe('small');
    });

    it('sorts alphabetically with alpha mode', () => {
      const freq = new Map<string, number>([
        ['10-20', 5],
        ['1-5', 10],
        ['5-10', 8],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-asc');
      expect(result.topItems[0][0]).toBe('1-5');
      expect(result.topItems[1][0]).toBe('5-10');
      expect(result.topItems[2][0]).toBe('10-20');
    });

    it('limits items to maxVisibleValues', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 9],
        ['c', 8],
        ['d', 7],
        ['e', 6],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 3, false, 'size-desc');
      expect(result.topItems).toHaveLength(3);
      expect(result.otherItems).toHaveLength(2);
    });

    it('calculates other count correctly', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 9],
        ['c', 8],
        ['d', 7],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 2, false, 'size-desc');
      expect(result.otherCount).toBe(15); // 8 + 7
    });

    it('handles N/A values in sorting (uses __NA__)', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        [NA_VALUE, 5],
        ['b', 8],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'size-desc');
      expect(result.topItems.some(([v]) => v === NA_VALUE)).toBe(true);
    });

    it('sorts by size ascending', () => {
      const freq = new Map<string, number>([
        ['small', 5],
        ['large', 20],
        ['medium', 10],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'size-asc');
      expect(result.topItems[0][0]).toBe('small');
      expect(result.topItems[1][0]).toBe('medium');
      expect(result.topItems[2][0]).toBe('large');
    });

    it('sorts alphabetically descending', () => {
      const freq = new Map<string, number>([
        ['apple', 5],
        ['cherry', 10],
        ['banana', 8],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-desc');
      expect(result.topItems[0][0]).toBe('cherry');
      expect(result.topItems[1][0]).toBe('banana');
      expect(result.topItems[2][0]).toBe('apple');
    });

    it('sorts protein family names alphabetically (not by embedded numbers)', () => {
      const freq = new Map<string, number>([
        ['scoloptoxin-25 family', 1],
        ['phospholipase A2 family', 539],
        ['arthropod phospholipase D family', 219],
        ['conotoxin O1 superfamily', 278],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-asc');
      expect(result.topItems[0][0]).toBe('arthropod phospholipase D family');
      expect(result.topItems[1][0]).toBe('conotoxin O1 superfamily');
      expect(result.topItems[2][0]).toBe('phospholipase A2 family');
      expect(result.topItems[3][0]).toBe('scoloptoxin-25 family');
    });

    it('sorts numeric ranges naturally with localeCompare numeric option', () => {
      const freq = new Map<string, number>([
        ['10-20', 5],
        ['1-5', 10],
        ['5-10', 8],
        ['20+', 3],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-asc');
      expect(result.topItems[0][0]).toBe('1-5');
      expect(result.topItems[1][0]).toBe('5-10');
      expect(result.topItems[2][0]).toBe('10-20');
      expect(result.topItems[3][0]).toBe('20+');
    });

    it('does not treat hyphens in names as minus signs', () => {
      const freq = new Map<string, number>([
        ['scoloptoxin-25 family', 1],
        ['scoloptoxin-4 family', 3],
        ['limacoditoxin-59 family', 1],
        ['alpha toxin family', 10],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-asc');
      // 'alpha toxin family' should come first alphabetically, not last
      expect(result.topItems[0][0]).toBe('alpha toxin family');
      // Numeric natural sort within scoloptoxin: 4 before 25
      expect(result.topItems[2][0]).toBe('scoloptoxin-4 family');
      expect(result.topItems[3][0]).toBe('scoloptoxin-25 family');
    });

    it('sorts N/A by frequency in alpha-asc mode (categorical)', () => {
      const freq = new Map<string, number>([
        ['zebra', 5],
        [NA_VALUE, 10],
        ['alpha', 3],
      ]);
      // Categorical NA sorts as a regular value: alpha-asc by display name; '__NA__' < 'alpha'
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-asc');
      expect(result.topItems.map(([v]) => v)).toEqual([NA_VALUE, 'alpha', 'zebra']);
    });

    it('sorts N/A by frequency in alpha-desc mode (categorical)', () => {
      const freq = new Map<string, number>([
        ['zebra', 5],
        [NA_VALUE, 10],
        ['alpha', 3],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(freq, 10, false, 'alpha-desc');
      expect(result.topItems.map(([v]) => v)).toEqual(['zebra', 'alpha', NA_VALUE]);
    });

    it('sorts numeric interval labels by lower bound in alpha-asc mode', () => {
      const freq = new Map<string, number>([
        ['10 - <20', 5],
        ['2 - <5', 10],
        ['5 - <10', 8],
      ]);
      const numericOrderValues = new Map<string, number>([
        ['10 - <20', 10],
        ['2 - <5', 2],
        ['5 - <10', 5],
      ]);

      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'alpha-asc',
        new Map(),
        new Set(),
        numericOrderValues,
      );

      expect(result.topItems.map(([value]) => value)).toEqual(['2 - <5', '5 - <10', '10 - <20']);
    });

    it('sorts numeric interval labels by lower bound in alpha-desc mode', () => {
      const freq = new Map<string, number>([
        ['10 - <20', 5],
        ['2 - <5', 10],
        ['5 - <10', 8],
      ]);
      const numericOrderValues = new Map<string, number>([
        ['10 - <20', 10],
        ['2 - <5', 2],
        ['5 - <10', 5],
      ]);

      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'alpha-desc',
        new Map(),
        new Set(),
        numericOrderValues,
      );

      expect(result.topItems.map(([value]) => value)).toEqual(['10 - <20', '5 - <10', '2 - <5']);
    });

    it('uses visibleValues to prioritize items and expands when maxVisibleValues allows', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 8],
        ['c', 6],
        ['d', 4],
      ]);
      const visibleValues = new Set(['a', 'c']);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10, // maxVisibleValues > visibleValues.size, so should expand
        false,
        'size-desc',
        new Map(),
        visibleValues,
      );
      // Should include all 4 items since maxVisibleValues=10 allows expansion
      expect(result.topItems).toHaveLength(4);
      // Visible values should come first (in sort order), followed by expanded items
      expect(result.topItems.map(([v]) => v)).toContain('a');
      expect(result.topItems.map(([v]) => v)).toContain('c');
      expect(result.topItems.map(([v]) => v)).toContain('b');
      expect(result.topItems.map(([v]) => v)).toContain('d');
    });

    it('includes pendingExtract item in visible set', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 8],
        ['c', 6],
      ]);
      const visibleValues = new Set(['a']);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'size-desc',
        new Map(),
        visibleValues,
        new Map(),
        true,
        'b', // pendingExtract
      );
      expect(result.topItems.map(([v]) => v)).toContain('b');
    });

    it('excludes pendingMerge item from visible set', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 8],
        ['c', 6],
      ]);
      const visibleValues = new Set(['a', 'b']);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'size-desc',
        new Map(),
        visibleValues,
        new Map(),
        true,
        undefined,
        'b', // pendingMerge
      );
      expect(result.topItems.map(([v]) => v)).not.toContain('b');
    });

    it('handles N/A extraction via pendingExtract', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        [NA_VALUE, 5],
      ]);
      const visibleValues = new Set(['a']);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'size-desc',
        new Map(),
        visibleValues,
        new Map(),
        true,
        NA_VALUE, // Extract N/A
      );
      expect(result.topItems.map(([v]) => v)).toContain(NA_VALUE);
    });

    it('handles N/A merge via pendingMerge', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        [NA_VALUE, 5],
      ]);
      const visibleValues = new Set(['a', NA_VALUE]);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'size-desc',
        new Map(),
        visibleValues,
        new Map(),
        true,
        undefined,
        NA_VALUE, // Merge N/A back
      );
      expect(result.topItems.map(([v]) => v)).not.toContain(NA_VALUE);
    });

    it('uses existing zOrders for manual sort mode', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 8],
        ['c', 6],
      ]);
      const existingZOrders = new Map([
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'manual',
        existingZOrders,
      );
      expect(result.topItems[0][0]).toBe('c');
      expect(result.topItems[1][0]).toBe('a');
      expect(result.topItems[2][0]).toBe('b');
    });

    it('uses existing zOrders reversed for manual-reverse sort mode', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        ['b', 8],
        ['c', 6],
      ]);
      const existingZOrders = new Map([
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'manual-reverse',
        existingZOrders,
      );
      expect(result.topItems[0][0]).toBe('b');
      expect(result.topItems[1][0]).toBe('a');
      expect(result.topItems[2][0]).toBe('c');
    });
  });

  describe('categorical NA behaves like any other category', () => {
    it('NA sorts by frequency in size-desc when categorical', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        [NA_VALUE, 50],
        ['b', 8],
      ]);
      // NA has the highest count — should be FIRST in size-desc, not last
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'size-desc',
        new Map(),
        new Set(),
        new Map(),
        true,
        undefined,
        undefined,
        false,
      );
      expect(result.topItems[0][0]).toBe(NA_VALUE);
    });

    it('NA sorts by frequency in size-asc when categorical', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        [NA_VALUE, 1],
        ['b', 8],
      ]);
      // NA has the lowest count — should be FIRST in size-asc
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'size-asc',
        new Map(),
        new Set(),
        new Map(),
        true,
        undefined,
        undefined,
        false,
      );
      expect(result.topItems[0][0]).toBe(NA_VALUE);
    });

    it('NA respects manual zOrder when categorical', () => {
      const freq = new Map<string, number>([
        ['a', 10],
        [NA_VALUE, 5],
        ['b', 8],
      ]);
      const zOrders = new Map([
        ['a', 2],
        [NA_VALUE, 0], // NA dragged to top
        ['b', 1],
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        10,
        false,
        'manual',
        zOrders,
        new Set(),
        new Map(),
        true,
        undefined,
        undefined,
        false,
      );
      expect(result.topItems[0][0]).toBe(NA_VALUE);
      expect(result.topItems[1][0]).toBe('b');
      expect(result.topItems[2][0]).toBe('a');
    });

    it('NA can fall into Other when maxVisibleValues is exceeded (categorical)', () => {
      const freq = new Map<string, number>([
        ['a', 100],
        ['b', 90],
        ['c', 80],
        [NA_VALUE, 1], // very low count
      ]);
      const result = LegendDataProcessor.sortAndLimitItems(
        freq,
        3,
        false,
        'size-desc',
        new Map(),
        new Set(),
        new Map(),
        true,
        undefined,
        undefined,
        false,
      );
      // Top 3 by count are a, b, c — NA falls into Other
      expect(result.topItems.map(([v]) => v)).toEqual(['a', 'b', 'c']);
      expect(result.otherItems.some(({ value }) => value === NA_VALUE)).toBe(true);
    });

    it('categorical NA color uses persistedCategories override when present', () => {
      const topItems: Array<[string, number]> = [
        ['a', 10],
        [NA_VALUE, 5],
      ];
      const persistedCategories = {
        [NA_VALUE]: { zOrder: 1, color: '#00FF00', shape: 'diamond' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
        false, // isNumericSource=false
      );
      const naItem = items.find((i) => i.value === NA_VALUE);
      expect(naItem).toBeDefined();
      expect(naItem!.color).toBe('#00FF00');
      expect(naItem!.shape).toBe('diamond');
    });

    it('categorical NA defaults to NA_DEFAULT_COLOR when no persisted/existing color', () => {
      const topItems: Array<[string, number]> = [
        ['a', 10],
        [NA_VALUE, 5],
      ];
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        {},
        false,
      );
      const naItem = items.find((i) => i.value === NA_VALUE);
      expect(naItem).toBeDefined();
      expect(naItem!.color).toBe(NA_DEFAULT_COLOR);
    });
  });

  describe('numeric NA pins to end regardless of sort mode', () => {
    it('NA is last in all sort modes when isNumericSource is true', () => {
      const freq = new Map<string, number>([
        ['bin-0', 10],
        [NA_VALUE, 50],
        ['bin-1', 8],
      ]);
      for (const mode of ['size-desc', 'size-asc', 'alpha-asc', 'alpha-desc'] as const) {
        const result = LegendDataProcessor.sortAndLimitItems(
          freq,
          10,
          false,
          mode,
          new Map(),
          new Set(),
          new Map(),
          true,
          undefined,
          undefined,
          true, // isNumericSource=true
        );
        const last = result.topItems[result.topItems.length - 1];
        expect(last[0]).toBe(NA_VALUE);
      }
    });

    it('numeric NA color is locked even when persistedCategories has an override', () => {
      const topItems: Array<[string, number]> = [
        ['bin-0', 10],
        [NA_VALUE, 5],
      ];
      const persistedCategories = {
        [NA_VALUE]: { zOrder: 0, color: '#FF0000', shape: 'square' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
        true, // isNumericSource=true
      );
      const naItem = items.find((i) => i.value === NA_VALUE);
      expect(naItem).toBeDefined();
      expect(naItem!.color).toBe(NA_DEFAULT_COLOR); // locked, persisted '#FF0000' ignored
      expect(naItem!.shape).toBe('circle'); // locked
    });
  });

  describe('createLegendItems', () => {
    it('creates legend items with correct properties', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        ['category2', 5],
      ];
      const items = LegendDataProcessor.createLegendItems(ctx, topItems, 0, []);
      expect(items).toHaveLength(2);
      expect(items[0].value).toBe('category1');
      expect(items[0].count).toBe(10);
      expect(items[0].isVisible).toBe(true);
      expect(items[0].color).toBeDefined();
      expect(items[0].shape).toBe('circle');
    });

    it('adds Other item when otherCount > 0', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const items = LegendDataProcessor.createLegendItems(ctx, topItems, 5, []);
      expect(items.some((i) => i.value === 'Other')).toBe(true);
    });

    it('sets correct count on Other item', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const items = LegendDataProcessor.createLegendItems(ctx, topItems, 5, []);
      expect(items.find((i) => i.value === 'Other')?.count).toBe(5);
    });

    it('preserves existing z-order in manual mode', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        ['category2', 5],
      ];
      const existing: LegendItem[] = [
        {
          value: 'category2',
          color: '#000',
          shape: 'circle',
          count: 5,
          isVisible: true,
          zOrder: 99,
        },
      ];
      // In manual mode, existing zOrders should be preserved
      const items = LegendDataProcessor.createLegendItems(ctx, topItems, 0, existing, 'manual');
      const cat2 = items.find((i) => i.value === 'category2');
      expect(cat2?.zOrder).toBe(99);
    });

    it('uses sorted index for z-order in non-manual modes', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        ['category2', 5],
      ];
      const existing: LegendItem[] = [
        {
          value: 'category2',
          color: '#000',
          shape: 'circle',
          count: 5,
          isVisible: true,
          zOrder: 99,
        },
      ];
      // In size mode, zOrder should be based on sorted index, not existing
      const items = LegendDataProcessor.createLegendItems(ctx, topItems, 0, existing, 'size-desc');
      const cat1 = items.find((i) => i.value === 'category1');
      const cat2 = items.find((i) => i.value === 'category2');
      expect(cat1?.zOrder).toBe(0); // First in sorted order
      expect(cat2?.zOrder).toBe(1); // Second in sorted order
    });

    it('reassigns z-order based on reversed position in manual-reverse mode', () => {
      // Items are passed in reverse order (as sortAndLimitItems would sort them)
      const topItems: Array<[string, number]> = [
        ['category2', 5], // Was at zOrder 1, now first
        ['category1', 10], // Was at zOrder 0, now second
      ];
      const existing: LegendItem[] = [
        {
          value: 'category1',
          color: '#000',
          shape: 'circle',
          count: 10,
          isVisible: true,
          zOrder: 0,
        },
        {
          value: 'category2',
          color: '#000',
          shape: 'circle',
          count: 5,
          isVisible: true,
          zOrder: 1,
        },
      ];
      // In manual-reverse mode, zOrder should be based on sorted index (reversed position)
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        existing,
        'manual-reverse',
      );
      const cat1 = items.find((i) => i.value === 'category1');
      const cat2 = items.find((i) => i.value === 'category2');
      expect(cat2?.zOrder).toBe(0); // First in reversed order
      expect(cat1?.zOrder).toBe(1); // Second in reversed order
    });

    it('uses circle as the default shape for every item', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        ['category2', 5],
      ];
      const items = LegendDataProcessor.createLegendItems(ctx, topItems, 0, []);
      expect(items.every((i) => i.shape === 'circle')).toBe(true);
    });

    it('applies colors from persistedCategories', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        ['category2', 5],
      ];
      const persistedCategories = {
        category1: { zOrder: 0, color: '#custom1', shape: 'circle' },
        category2: { zOrder: 1, color: '#custom2', shape: 'square' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].color).toBe('#custom1');
      expect(items[1].color).toBe('#custom2');
    });

    it('prefers persisted colors over existing colors', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const existing: LegendItem[] = [
        {
          value: 'category1',
          color: '#existing',
          shape: 'circle',
          count: 10,
          isVisible: true,
          zOrder: 0,
        },
      ];
      const persistedCategories = {
        category1: { zOrder: 0, color: '#persisted', shape: 'circle' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        existing,
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].color).toBe('#persisted');
    });

    it('applies persisted colors to N/A items using __NA__ key', () => {
      const topItems: Array<[string, number]> = [[NA_VALUE, 10]];
      const persistedCategories = {
        [NA_VALUE]: { zOrder: 0, color: '#na-color', shape: 'circle' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].color).toBe('#na-color');
    });

    it('uses existing colors when no persisted categories', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const existing: LegendItem[] = [
        {
          value: 'category1',
          color: '#existing',
          shape: 'square',
          count: 10,
          isVisible: true,
          zOrder: 0,
        },
      ];
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        existing,
        'size-desc',
        new Map(),
        {}, // empty persisted
      );
      expect(items[0].color).toBe('#existing');
    });

    it('bumps categorical N/A to a different color when another category claims NA_DEFAULT_COLOR', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        [NA_VALUE, 8],
      ];
      const persistedCategories = {
        category1: { zOrder: 0, color: NA_DEFAULT_COLOR, shape: 'circle' },
      };

      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );

      const naItem = items.find((item) => item.value === NA_VALUE);
      // Categorical NA participates in conflict resolution like any regular category;
      // it does not get to keep NA_DEFAULT_COLOR if another category already claimed it.
      expect(naItem?.color).not.toBe(NA_DEFAULT_COLOR);
    });

    it('applies shapes from persistedCategories', () => {
      const topItems: Array<[string, number]> = [
        ['category1', 10],
        ['category2', 5],
      ];
      const persistedCategories = {
        category1: { zOrder: 0, color: '#custom1', shape: 'diamond' },
        category2: { zOrder: 1, color: '#custom2', shape: 'triangle-up' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].shape).toBe('diamond');
      expect(items[1].shape).toBe('triangle-up');
    });

    it('uses computed shapes (not stale existing shapes) when no persisted categories', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const existing: LegendItem[] = [
        {
          value: 'category1',
          color: '#existing',
          shape: 'square',
          count: 10,
          isVisible: true,
          zOrder: 0,
        },
      ];
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        existing,
        'size-desc',
        new Map(),
        {}, // empty persisted
      );
      // Computed shape is always 'circle' regardless of what existing items had.
      expect(items[0].shape).toBe('circle');
    });

    it('keeps every default shape as circle even with prior items', () => {
      const topItems: Array<[string, number]> = [
        ['cat1', 30],
        ['cat2', 20],
      ];
      const existing: LegendItem[] = [
        { value: 'cat1', color: '#F3C300', shape: 'circle', count: 30, isVisible: true, zOrder: 0 },
        { value: 'cat2', color: '#875692', shape: 'circle', count: 20, isVisible: true, zOrder: 1 },
      ];
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        existing,
        'size-desc',
        new Map(),
        {}, // empty persisted — simulates cleared pending categories
      );
      expect(items[0].shape).toBe('circle');
      expect(items[1].shape).toBe('circle');
    });

    it('prefers persisted shapes over existing shapes', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const existing: LegendItem[] = [
        {
          value: 'category1',
          color: '#existing',
          shape: 'square',
          count: 10,
          isVisible: true,
          zOrder: 0,
        },
      ];
      const persistedCategories = {
        category1: { zOrder: 0, color: '#persisted', shape: 'diamond' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        existing,
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].shape).toBe('diamond');
    });

    it('preserves shapes when only persisted shape is set (no persisted color)', () => {
      const topItems: Array<[string, number]> = [['category1', 10]];
      const persistedCategories = {
        category1: { zOrder: 0, color: '', shape: 'triangle-down' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].shape).toBe('triangle-down');
      // Color should fall back to default encoding since persisted.color is empty
      expect(items[0].color).toBeDefined();
    });

    it('resolves color conflict when new item default color matches a persisted color', () => {
      // Scenario: itemB has persisted color = slot 1's color (#875692)
      // itemA gets slot 1 by default -> conflict -> should get a different color
      const slot1Color = getVisualEncoding(1, 'itemA').color; // #875692
      const topItems: Array<[string, number]> = [
        ['itemB', 10],
        ['itemA', 5],
      ];
      const persistedCategories = {
        itemB: { zOrder: 0, color: slot1Color, shape: 'circle' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );
      // itemB should keep its persisted color
      expect(items[0].color).toBe(slot1Color);
      // itemA should NOT have the same color as itemB
      expect(items[1].color).not.toBe(slot1Color);
    });

    it('resolves cascading color conflicts when multiple persisted colors block defaults', () => {
      // Scenario: two items have persisted colors matching slots 0 and 1
      // A new third item at slot 0 should skip both and land on slot 2's color
      const slot0Color = getVisualEncoding(0, 'x').color; // #F3C300
      const slot1Color = getVisualEncoding(1, 'x').color; // #875692
      const slot2Color = getVisualEncoding(2, 'x').color; // #F38400
      const topItems: Array<[string, number]> = [
        ['persistedA', 10],
        ['persistedB', 8],
        ['newItem', 5],
      ];
      const persistedCategories = {
        persistedA: { zOrder: 0, color: slot0Color, shape: 'circle' },
        persistedB: { zOrder: 1, color: slot1Color, shape: 'circle' },
      };
      const items = LegendDataProcessor.createLegendItems(
        ctx,
        topItems,
        0,
        [],
        'size-desc',
        new Map(),
        persistedCategories,
      );
      expect(items[0].color).toBe(slot0Color);
      expect(items[1].color).toBe(slot1Color);
      // newItem should skip both claimed colors and get slot 2's color (or beyond)
      expect(items[2].color).not.toBe(slot0Color);
      expect(items[2].color).not.toBe(slot1Color);
      expect(items[2].color).toBe(slot2Color);
    });
  });

  describe('processLegendItems', () => {
    it('processes basic annotation values', () => {
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        ['a', 'b', 'a', 'c', 'a', 'b'],
        ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
        10,
        false,
        [],
        [],
        'size-desc',
      );
      expect(result.legendItems.length).toBeGreaterThan(0);
      expect(result.legendItems.find((i) => i.value === 'a')?.count).toBe(3);
    });

    it('resets slot tracker on annotation change', () => {
      LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        ['a', 'b'],
        ['p1', 'p2'],
        10,
        false,
        [],
        [],
        'size-desc',
      );
      expect(ctx.currentAnnotation).toBe('annotation1');

      LegendDataProcessor.processLegendItems(
        ctx,
        'annotation2',
        ['c', 'd'],
        ['p1', 'p2'],
        10,
        false,
        [],
        [],
        'size-desc',
      );
      expect(ctx.currentAnnotation).toBe('annotation2');
    });

    it('creates Other bucket when exceeding max visible', () => {
      const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        3,
        false,
        [],
        [],
        'size-desc',
      );
      expect(result.legendItems.some((i) => i.value === 'Other')).toBe(true);
      expect(result.otherItems.length).toBeGreaterThan(0);
    });

    it('handles isolation mode', () => {
      const values = ['a', 'b', 'a', 'c'];
      const proteinIds = ['p1', 'p2', 'p3', 'p4'];
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        10,
        true,
        [['p1', 'p3']],
        [],
        'size-desc',
      );
      // Only p1 and p3 are in isolation, both have value 'a'
      expect(result.legendItems.find((i) => i.value === 'a')?.count).toBe(2);
    });

    it('retains known numeric values with zero counts when the current view is empty', () => {
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'length',
        [],
        [],
        10,
        false,
        [],
        [],
        'alpha-asc',
        {},
        new Set(),
        new Map([
          ['0 - <10', 0],
          ['10 - 20', 10],
        ]),
        false,
        undefined,
        undefined,
        ['0 - <10', '10 - 20'],
      );

      expect(result.legendItems).toEqual([
        expect.objectContaining({ value: '0 - <10', count: 0 }),
        expect.objectContaining({ value: '10 - 20', count: 0 }),
      ]);
      expect(result.otherItems).toEqual([]);
    });

    it('preserves Other category during isolation mode', () => {
      // 7 unique values but maxVisibleValues=3 → 4 overflow into Other
      const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const proteinIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        3,
        true,
        [proteinIds], // all proteins in isolation history
        [],
        'size-desc',
      );
      // Should still have Other with the 4 overflow items
      expect(result.legendItems.some((i) => i.value === 'Other')).toBe(true);
      expect(result.legendItems.find((i) => i.value === 'Other')?.count).toBe(4);
      expect(result.otherItems.length).toBe(4);
    });

    it('preserves existing z-order across processing in manual mode', () => {
      const values = ['a', 'b', 'c'];
      const existing: LegendItem[] = [
        {
          value: 'a',
          color: '#000',
          shape: 'circle',
          count: 1,
          isVisible: true,
          zOrder: 99,
        },
      ];
      // In manual mode, existing zOrders should be preserved
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        existing,
        'manual',
      );
      expect(result.legendItems.find((i) => i.value === 'a')?.zOrder).toBe(99);
    });

    it('uses sorted index for z-order across processing in non-manual modes', () => {
      const values = ['a', 'b', 'c'];
      const existing: LegendItem[] = [
        {
          value: 'a',
          color: '#000',
          shape: 'circle',
          count: 1,
          isVisible: true,
          zOrder: 99,
        },
      ];
      // In size mode, zOrder should be based on sorted position
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        existing,
        'size-desc',
      );
      // All items have count 1, so they're equal in size; order depends on implementation
      const itemA = result.legendItems.find((i) => i.value === 'a');
      expect(itemA?.zOrder).toBeGreaterThanOrEqual(0);
      expect(itemA?.zOrder).toBeLessThan(3);
    });

    it('applies persisted categories to legend items', () => {
      const values = ['a', 'b'];
      const persistedCategories = {
        a: { zOrder: 0, color: '#custom-a', shape: 'circle' },
        b: { zOrder: 1, color: '#custom-b', shape: 'square' },
      };
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        [],
        'size-desc',
        persistedCategories,
      );
      const itemA = result.legendItems.find((i) => i.value === 'a');
      const itemB = result.legendItems.find((i) => i.value === 'b');
      expect(itemA?.color).toBe('#custom-a');
      expect(itemB?.color).toBe('#custom-b');
    });

    it('uses visibleValues to restore specific categories', () => {
      const values = ['a', 'b', 'c', 'd', 'e'];
      const visibleValues = new Set(['a', 'c']);
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        [],
        'size-desc',
        {},
        visibleValues,
      );
      // Should only include visible values (plus Other for the rest)
      const visibleLegendValues = result.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(visibleLegendValues).toContain('a');
      expect(visibleLegendValues).toContain('c');
    });

    it('handles pendingExtract to add new item', () => {
      const values = ['a', 'b', 'c'];
      const visibleValues = new Set(['a']);
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        [],
        'size-desc',
        {},
        visibleValues,
        new Map(),
        true,
        'b', // pendingExtract
      );
      const legendValues = result.legendItems.map((i) => i.value);
      expect(legendValues).toContain('a');
      expect(legendValues).toContain('b');
    });

    it('handles pendingMerge to remove item', () => {
      const values = ['a', 'b', 'c'];
      const visibleValues = new Set(['a', 'b']);
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        [],
        'size-desc',
        {},
        visibleValues,
        new Map(),
        true,
        undefined,
        'b', // pendingMerge
      );
      const legendValues = result.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(legendValues).toContain('a');
      expect(legendValues).not.toContain('b');
    });

    it('converts null annotation values to __NA__', () => {
      const values: (string | null)[] = ['a', null, 'b', null];
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10,
        false,
        [],
        [],
        'size-desc',
      );
      const naItem = result.legendItems.find((i) => i.value === NA_VALUE);
      expect(naItem).toBeDefined();
      expect(naItem?.count).toBe(2);
    });

    it('removes Other item when otherItems become empty after filtering', () => {
      const values = ['a', 'b'];
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        10, // High max, so no Other needed
        false,
        [],
        [],
        'size-desc',
      );
      const otherItem = result.legendItems.find((i) => i.value === 'Other');
      expect(otherItem).toBeUndefined();
      expect(result.otherItems).toHaveLength(0);
    });

    it('expands categories when maxVisibleValues increases beyond visibleValues size', () => {
      const values = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e', 'f', 'g'];
      const visibleValues = new Set(['a', 'b']); // Only 2 visible
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        5, // maxVisibleValues = 5, but visibleValues only has 2
        false,
        [],
        [],
        'size-desc',
        {},
        visibleValues,
      );
      // Should have 5 items (not 2) plus Other
      const legendValues = result.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(legendValues.length).toBe(5);
      expect(legendValues).toContain('a');
      expect(legendValues).toContain('b');
      // Should include next highest frequency items from "Other"
    });

    it('restores legend correctly after exiting isolation', () => {
      // Setup: 5 categories, maxVisibleValues=3 → a, b, c visible + Other(d, e)
      const values = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e'];
      const proteinIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const preIsolationVisibleValues = new Set(['a', 'b', 'c']);

      // Step 1: Enter isolation (select p1='a' and p7='d')
      const isolated = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        3,
        true,
        [['p1', 'p7']],
        [],
        'size-desc',
        {},
        preIsolationVisibleValues,
      );
      // During isolation: 'a' visible, 'd' stays in Other
      expect(isolated.legendItems.filter((i) => i.value !== 'Other').map((i) => i.value)).toContain(
        'a',
      );
      expect(
        isolated.legendItems.filter((i) => i.value !== 'Other').map((i) => i.value),
      ).not.toContain('d');

      // Step 2: Exit isolation — use isolation-period legend items as existing
      const visibleAfterIsolation = new Set(
        isolated.legendItems.filter((i) => i.value !== 'Other').map((i) => i.value),
      );
      const restored = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        3,
        false, // isolation off
        [],
        isolated.legendItems,
        'size-desc',
        {},
        visibleAfterIsolation,
      );
      // Should restore to pre-isolation state: a, b, c + Other(d, e)
      const restoredValues = restored.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(restoredValues).toContain('a');
      expect(restoredValues).toContain('b');
      expect(restoredValues).toContain('c');
      expect(restoredValues).not.toContain('d');
      expect(restoredValues).not.toContain('e');
      expect(restored.legendItems.some((i) => i.value === 'Other')).toBe(true);
    });

    it('preserves pre-isolation visible values across stacked isolation', () => {
      // Setup: 5 categories, maxVisibleValues=3 → a, b, c visible + Other(d, e)
      const values = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e'];
      const proteinIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const preIsolationVisibleValues = new Set(['a', 'b', 'c']);

      // Step 1: First isolation (select p1='a', p4='b', p7='d')
      const firstIsolation = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        3,
        true,
        [['p1', 'p4', 'p7']],
        [],
        'size-desc',
        {},
        preIsolationVisibleValues,
      );
      // 'd' should NOT be promoted from Other
      expect(
        firstIsolation.legendItems.filter((i) => i.value !== 'Other').map((i) => i.value),
      ).not.toContain('d');

      // Step 2: Second isolation (stacked — narrow to p1='a' only)
      // Crucially, we still use the ORIGINAL pre-isolation visible values
      const secondIsolation = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        3,
        true,
        [['p1', 'p4', 'p7'], ['p1']],
        firstIsolation.legendItems,
        'size-desc',
        {},
        preIsolationVisibleValues, // same pre-isolation values throughout
      );
      // Still no promotion from Other
      const secondValues = secondIsolation.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(secondValues).toContain('a');
      expect(secondValues).not.toContain('d');
    });

    it('handles isolation when all isolated proteins are from Other', () => {
      // Setup: a(3), b(2), c(1) visible + Other(d, e)
      const values = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e'];
      const proteinIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const preIsolationVisibleValues = new Set(['a', 'b', 'c']);

      // Isolate only proteins from Other: p7='d', p8='e'
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        proteinIds,
        3,
        true,
        [['p7', 'p8']],
        [],
        'size-desc',
        {},
        preIsolationVisibleValues,
      );
      // Neither d nor e should be promoted — they should stay in Other
      const visibleValues = result.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(visibleValues).not.toContain('d');
      expect(visibleValues).not.toContain('e');
      // Other should contain both d and e
      expect(result.otherItems.map((oi) => oi.value)).toContain('d');
      expect(result.otherItems.map((oi) => oi.value)).toContain('e');
    });

    it('contracts categories when maxVisibleValues decreases', () => {
      const values = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'e'];
      const visibleValues = new Set(['a', 'b', 'c', 'd', 'e']); // 5 visible
      const result = LegendDataProcessor.processLegendItems(
        ctx,
        'annotation1',
        values,
        values.map((_, i) => `p${i}`),
        3, // maxVisibleValues = 3
        false,
        [],
        [],
        'size-desc',
        {},
        visibleValues,
      );
      // Should have only 3 items plus Other
      const legendValues = result.legendItems
        .filter((i) => i.value !== 'Other')
        .map((i) => i.value);
      expect(legendValues.length).toBe(3);
    });
  });
});
