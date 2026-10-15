import { describe, it, expect } from 'vitest';
import type { LegendItem, OtherItem } from './types';
import { NA_VALUE } from './config';
import {
  expandHiddenValues,
  computeOtherConcreteValues,
  buildZOrderMapping,
  buildColorShapeMappings,
  calculatePointSize,
  defaultShapeSize,
  explicitShapeSize,
  createDefaultSettings,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  updateItemsVisibility,
  isolateItem,
} from './legend-helpers';
import { initializeAnnotationSortMode } from './legend-settings-dialog';

describe('legend-helpers', () => {
  describe('expandHiddenValues', () => {
    const otherItems: OtherItem[] = [
      { value: 'cat1', count: 5 },
      { value: 'cat2', count: 3 },
      { value: NA_VALUE, count: 2 },
    ];

    it('expands Other to concrete values', () => {
      const result = expandHiddenValues(['Other'], otherItems);
      expect(result).toEqual(['cat1', 'cat2', NA_VALUE]);
    });

    it('keeps non-Other values unchanged', () => {
      const result = expandHiddenValues(['value1', 'value2'], otherItems);
      expect(result).toEqual(['value1', 'value2']);
    });

    it('combines expanded Other with other values', () => {
      const result = expandHiddenValues(['value1', 'Other'], otherItems);
      expect(result).toEqual(['value1', 'cat1', 'cat2', NA_VALUE]);
    });

    it('deduplicates values', () => {
      const result = expandHiddenValues(['cat1', 'Other'], otherItems);
      expect(result).toEqual(['cat1', 'cat2', NA_VALUE]);
    });

    it('returns empty array for empty input', () => {
      expect(expandHiddenValues([], otherItems)).toEqual([]);
    });
  });

  describe('computeOtherConcreteValues', () => {
    it('converts other items to string keys', () => {
      const otherItems: OtherItem[] = [
        { value: 'cat1', count: 5 },
        { value: NA_VALUE, count: 2 },
      ];
      expect(computeOtherConcreteValues(otherItems)).toEqual(['cat1', NA_VALUE]);
    });

    it('returns empty array for empty input', () => {
      expect(computeOtherConcreteValues([])).toEqual([]);
    });
  });

  describe('buildZOrderMapping', () => {
    it('builds mapping from legend items', () => {
      const items: LegendItem[] = [
        { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 0 },
        { value: 'b', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 1 },
      ];

      expect(buildZOrderMapping(items)).toEqual({ a: 0, b: 1 });
    });

    it('includes N/A values with __NA__ key', () => {
      const items: LegendItem[] = [
        {
          value: NA_VALUE,
          color: '#000',
          shape: 'circle',
          count: 1,
          isVisible: true,
          zOrder: 0,
        },
        { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 1 },
      ];

      expect(buildZOrderMapping(items)).toEqual({ [NA_VALUE]: 0, a: 1 });
    });
  });

  describe('buildColorShapeMappings', () => {
    it('builds color and shape mappings', () => {
      const items: LegendItem[] = [
        { value: 'a', color: '#f00', shape: 'circle', count: 1, isVisible: true, zOrder: 0 },
        { value: 'b', color: '#0f0', shape: 'square', count: 1, isVisible: true, zOrder: 1 },
      ];

      const result = buildColorShapeMappings(items);

      expect(result.colorMapping).toEqual({ a: '#f00', b: '#0f0' });
      expect(result.shapeMapping).toEqual({ a: 'circle', b: 'square' });
    });

    it('handles N/A values with __NA__ key', () => {
      const items: LegendItem[] = [
        {
          value: NA_VALUE,
          color: '#888',
          shape: 'circle',
          count: 1,
          isVisible: true,
          zOrder: 0,
        },
      ];

      const result = buildColorShapeMappings(items);

      expect(result.colorMapping).toEqual({ [NA_VALUE]: '#888' });
      expect(result.shapeMapping).toEqual({ [NA_VALUE]: 'circle' });
    });
  });

  describe('calculatePointSize', () => {
    it('calculates point size from shape size', () => {
      // With symbolSizeMultiplier of 8, shape size 10 -> 80
      expect(calculatePointSize(10)).toBe(80);
    });

    it('enforces minimum of 10', () => {
      expect(calculatePointSize(1)).toBe(10);
      expect(calculatePointSize(0)).toBe(10);
    });

    it('maps the default shape size 10 to point size 80', () => {
      expect(calculatePointSize(createDefaultSettings('a').shapeSize)).toBe(80);
    });
  });

  describe('defaultShapeSize', () => {
    it('keeps 10 up to 10,000 proteins', () => {
      expect(defaultShapeSize(1)).toBe(10);
      expect(defaultShapeSize(5_000)).toBe(10);
      expect(defaultShapeSize(10_000)).toBe(10);
    });

    it('shrinks with the protein count as (10,000 / N)^(2/3)', () => {
      expect(defaultShapeSize(20_000)).toBe(6);
      expect(defaultShapeSize(40_000)).toBe(4);
      expect(defaultShapeSize(105_562)).toBe(2);
      expect(defaultShapeSize(127_000)).toBe(2);
    });

    it('never goes below the smallest size the dialog accepts', () => {
      expect(defaultShapeSize(573_649)).toBe(1);
      expect(defaultShapeSize(10_000_000)).toBe(1);
    });

    it('gives the base default 10 for a count of 0 or below', () => {
      expect(defaultShapeSize(0)).toBe(10);
      expect(defaultShapeSize(-5)).toBe(10);
    });

    it('gives a whole size for a non-finite count', () => {
      expect(defaultShapeSize(Number.NaN)).toBe(10);
      expect(defaultShapeSize(Number.POSITIVE_INFINITY)).toBe(1);
    });

    it('returns whole sizes', () => {
      for (const n of [12_345, 33_333, 77_777, 250_000]) {
        expect(Number.isInteger(defaultShapeSize(n))).toBe(true);
      }
    });
  });

  describe('explicitShapeSize', () => {
    it('reads the fillers 10 and 30 as unset', () => {
      expect(explicitShapeSize(10)).toBeNull();
      expect(explicitShapeSize(30)).toBeNull();
    });

    it('reads the size createDefaultSettings writes as unset', () => {
      expect(explicitShapeSize(createDefaultSettings('a').shapeSize)).toBeNull();
    });

    it('keeps any other positive size', () => {
      expect(explicitShapeSize(5)).toBe(5);
      expect(explicitShapeSize(12)).toBe(12);
      expect(explicitShapeSize(200)).toBe(200);
    });

    it('reads a missing, non-numeric, non-positive or non-finite size as unset', () => {
      expect(explicitShapeSize(undefined)).toBeNull();
      expect(explicitShapeSize('12')).toBeNull();
      expect(explicitShapeSize(0)).toBeNull();
      expect(explicitShapeSize(-3)).toBeNull();
      expect(explicitShapeSize(Number.NaN)).toBeNull();
    });
  });

  describe('createDefaultSettings', () => {
    it('creates default settings with size-desc sort for regular annotations', () => {
      const settings = createDefaultSettings('some_annotation');
      expect(settings.sortMode).toBe('size-desc');
      expect(settings.maxVisibleValues).toBe(10);
      expect(settings.hiddenValues).toEqual([]);
      expect(settings.categories).toEqual({});
    });
  });

  describe('getDefaultSortMode', () => {
    it('returns size-desc for other annotations', () => {
      expect(getDefaultSortMode('some_annotation')).toBe('size-desc');
    });
  });

  describe('getItemClasses', () => {
    const baseItem: LegendItem = {
      value: 'test',
      color: '#000',
      shape: 'circle',
      count: 1,
      isVisible: true,
      zOrder: 0,
    };

    it('returns base class for visible, unselected item', () => {
      expect(getItemClasses(baseItem, false, false)).toBe('legend-item');
    });

    it('adds hidden class when not visible', () => {
      const item = { ...baseItem, isVisible: false };
      expect(getItemClasses(item, false, false)).toBe('legend-item hidden');
    });

    it('adds selected class when selected', () => {
      expect(getItemClasses(baseItem, true, false)).toBe('legend-item selected');
    });

    it('adds dragging class when dragging', () => {
      expect(getItemClasses(baseItem, false, true)).toBe('legend-item dragging');
    });

    it('combines multiple classes', () => {
      const item = { ...baseItem, isVisible: false };
      expect(getItemClasses(item, true, true)).toBe('legend-item hidden dragging selected');
    });
  });

  describe('isItemSelected', () => {
    it('returns true when item value is in selectedItems', () => {
      const item: LegendItem = {
        value: 'a',
        color: '#000',
        shape: 'circle',
        count: 1,
        isVisible: true,
        zOrder: 0,
      };
      expect(isItemSelected(item, ['a', 'b'])).toBe(true);
    });

    it('returns false when item value is not in selectedItems', () => {
      const item: LegendItem = {
        value: 'c',
        color: '#000',
        shape: 'circle',
        count: 1,
        isVisible: true,
        zOrder: 0,
      };
      expect(isItemSelected(item, ['a', 'b'])).toBe(false);
    });

    it('returns false for Other item even when in selectedItems', () => {
      const item: LegendItem = {
        value: 'Other',
        color: '#888',
        shape: 'circle',
        count: 1,
        isVisible: true,
        zOrder: 0,
      };
      expect(isItemSelected(item, ['Other'])).toBe(false);
    });
  });

  describe('initializeAnnotationSortMode', () => {
    it('returns unchanged modes if annotation already has a mode', () => {
      const existing = { annotation1: 'alpha-asc' as const };
      const result = initializeAnnotationSortMode(existing, 'annotation1', {});
      expect(result).toEqual({ annotation1: 'alpha-asc' });
    });

    it('returns unchanged modes if no selected annotation', () => {
      const existing = { annotation1: 'size-desc' as const };
      const result = initializeAnnotationSortMode(existing, '', {});
      expect(result).toEqual({ annotation1: 'size-desc' });
    });

    it('uses existing mode from current modes if exists', () => {
      const existing = {};
      const current = { newAnnotation: 'alpha-desc' as const };
      const result = initializeAnnotationSortMode(existing, 'newAnnotation', current);
      expect(result).toEqual({ newAnnotation: 'alpha-desc' });
    });

    it('defaults to size-desc for regular annotations', () => {
      const result = initializeAnnotationSortMode({}, 'some_annotation', {});
      expect(result).toEqual({ some_annotation: 'size-desc' });
    });
  });

  describe('createItemActionEvent', () => {
    it('creates a toggle action event', () => {
      const event = createItemActionEvent('legend-item-click', 'testValue', 'toggle');
      expect(event.type).toBe('legend-item-click');
      expect(event.detail).toEqual({ value: 'testValue', action: 'toggle' });
      expect(event.bubbles).toBe(true);
      expect(event.composed).toBe(true);
    });
  });

  describe('updateItemsVisibility', () => {
    const items: LegendItem[] = [
      { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 0 },
      { value: 'b', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 1 },
      { value: 'c', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 2 },
    ];

    it('hides a visible item', () => {
      const result = updateItemsVisibility(items, [], 'a');
      expect(result.items[0].isVisible).toBe(false);
      expect(result.items[1].isVisible).toBe(true);
      expect(result.items[2].isVisible).toBe(true);
      expect(result.hiddenValues).toEqual(['a']);
    });

    it('shows a hidden item', () => {
      const result = updateItemsVisibility(items, ['a'], 'a');
      expect(result.items[0].isVisible).toBe(true);
      expect(result.hiddenValues).toEqual([]);
    });

    it('resets to all visible if hiding last visible item', () => {
      const hiddenItems = [
        { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: false, zOrder: 0 },
        { value: 'b', color: '#000', shape: 'circle', count: 1, isVisible: false, zOrder: 1 },
        { value: 'c', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 2 },
      ];
      const result = updateItemsVisibility(hiddenItems, ['a', 'b'], 'c');
      expect(result.items.every((i) => i.isVisible)).toBe(true);
      expect(result.hiddenValues).toEqual([]);
    });

    it('handles N/A values correctly', () => {
      const itemsWithNA: LegendItem[] = [
        {
          value: NA_VALUE,
          color: '#000',
          shape: 'circle',
          count: 1,
          isVisible: true,
          zOrder: 0,
        },
        { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 1 },
      ];
      const result = updateItemsVisibility(itemsWithNA, [], NA_VALUE);
      expect(result.items[0].isVisible).toBe(false);
      expect(result.hiddenValues).toEqual([NA_VALUE]);
    });
  });

  describe('isolateItem', () => {
    const items: LegendItem[] = [
      { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 0 },
      { value: 'b', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 1 },
      { value: 'c', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 2 },
    ];

    it('isolates a single item (shows only that item)', () => {
      const result = isolateItem(items, 'a');
      expect(result.items[0].isVisible).toBe(true);
      expect(result.items[1].isVisible).toBe(false);
      expect(result.items[2].isVisible).toBe(false);
      expect(result.hiddenValues).toEqual(['b', 'c']);
    });

    it('shows all items when isolating an already isolated item', () => {
      const isolatedItems: LegendItem[] = [
        { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 0 },
        { value: 'b', color: '#000', shape: 'circle', count: 1, isVisible: false, zOrder: 1 },
        { value: 'c', color: '#000', shape: 'circle', count: 1, isVisible: false, zOrder: 2 },
      ];
      const result = isolateItem(isolatedItems, 'a');
      expect(result.items.every((i) => i.isVisible)).toBe(true);
      expect(result.hiddenValues).toEqual([]);
    });

    it('returns unchanged if item not found', () => {
      const result = isolateItem(items, 'nonexistent');
      expect(result.items).toBe(items);
      expect(result.hiddenValues).toEqual([]);
    });

    it('handles N/A value correctly', () => {
      const itemsWithNA: LegendItem[] = [
        {
          value: NA_VALUE,
          color: '#000',
          shape: 'circle',
          count: 1,
          isVisible: true,
          zOrder: 0,
        },
        { value: 'a', color: '#000', shape: 'circle', count: 1, isVisible: true, zOrder: 1 },
      ];
      const result = isolateItem(itemsWithNA, NA_VALUE);
      expect(result.items[0].isVisible).toBe(true);
      expect(result.items[1].isVisible).toBe(false);
      expect(result.hiddenValues).toEqual(['a']);
    });
  });
});
