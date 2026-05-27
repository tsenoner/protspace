import type {
  LegendItem,
  OtherItem,
  LegendSortMode,
  LegendPersistedSettings,
  ItemAction,
} from './types';
import { LEGEND_DEFAULTS, LEGEND_VALUES } from './config';

/**
 * Pure helper functions for legend component.
 * These are extracted to enable easier unit testing.
 */

/**
 * Converts a legend item value to its string key representation.
 * This is used for storage keys, hidden values tracking, etc.
 * N/A items use NA_VALUE ('__NA__') as their value.
 */
export function valueToKey(value: string): string {
  return value;
}

/**
 * Expands hidden values by resolving the "Other" bucket to its concrete values.
 */
export function expandHiddenValues(hiddenValues: string[], otherItems: OtherItem[]): string[] {
  const expanded: string[] = [];

  for (const value of hiddenValues) {
    if (value === LEGEND_VALUES.OTHER) {
      // Expand the synthetic Other bucket to its actual values
      for (const otherItem of otherItems) {
        expanded.push(valueToKey(otherItem.value));
      }
    } else {
      expanded.push(value);
    }
  }

  // De-duplicate in case of overlaps
  return Array.from(new Set(expanded));
}

/**
 * Computes list of concrete values that belong to the synthetic "Other" bucket.
 */
export function computeOtherConcreteValues(otherItems: OtherItem[]): string[] {
  return otherItems.map((item) => valueToKey(item.value));
}

/**
 * Builds a z-order mapping from legend items.
 * All items (including N/A with __NA__ value) are included.
 */
export function buildZOrderMapping(items: LegendItem[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  items.forEach((item) => {
    mapping[item.value] = item.zOrder;
  });
  return mapping;
}

/**
 * Builds color and shape mappings from legend items.
 */
export function buildColorShapeMappings(items: LegendItem[]): {
  colorMapping: Record<string, string>;
  shapeMapping: Record<string, string>;
} {
  const colorMapping: Record<string, string> = {};
  const shapeMapping: Record<string, string> = {};

  items.forEach((item) => {
    const key = valueToKey(item.value);
    colorMapping[key] = item.color;
    shapeMapping[key] = item.shape;
  });

  return { colorMapping, shapeMapping };
}

/**
 * Calculates scatterplot point size from legend shape size.
 */
export function calculatePointSize(shapeSize: number): number {
  return Math.max(10, Math.round(shapeSize * LEGEND_DEFAULTS.symbolSizeMultiplier));
}

/**
 * Creates default persisted settings for an annotation.
 */
export function createDefaultSettings(selectedAnnotation: string): LegendPersistedSettings {
  void selectedAnnotation;
  return {
    maxVisibleValues: LEGEND_DEFAULTS.maxVisibleValues,
    shapeSize: LEGEND_DEFAULTS.symbolSize,
    sortMode: 'size-desc',
    hiddenValues: [],
    categories: {},
    enableDuplicateStackUI: LEGEND_DEFAULTS.enableDuplicateStackUI,
    selectedPaletteId: 'kellys',
  };
}

/**
 * Gets the default sort mode for an annotation.
 */
export function getDefaultSortMode(annotationName: string): LegendSortMode {
  void annotationName;
  return 'size-desc';
}

/**
 * Determines CSS classes for a legend item.
 */
export function getItemClasses(item: LegendItem, isSelected: boolean, isDragging: boolean): string {
  const classes = ['legend-item'];

  if (!item.isVisible) classes.push('hidden');
  if (isDragging) classes.push('dragging');
  if (isSelected) classes.push('selected');
  // Add class for "Other" item to prevent dragging (used by Sortable filter)
  if (item.value === LEGEND_VALUES.OTHER) classes.push('legend-item-other');

  return classes.join(' ');
}

/**
 * Checks if an item is selected based on selectedItems array.
 */
export function isItemSelected(item: LegendItem, selectedItems: string[]): boolean {
  if (item.value === LEGEND_VALUES.OTHER) return false;
  return selectedItems.includes(item.value);
}

/**
 * Creates a CustomEvent for item actions with consistent options.
 * Events use bubbles: true and composed: true for Shadow DOM compatibility.
 */
export function createItemActionEvent(
  eventName: string,
  value: string,
  action: ItemAction,
): CustomEvent<{ value: string; action: ItemAction }> {
  return new CustomEvent(eventName, {
    detail: { value, action },
    bubbles: true,
    composed: true,
  });
}

/**
 * Updates item visibility and returns updated items with new hidden values.
 * If all items would be hidden, returns all visible instead.
 */
export function updateItemsVisibility(
  items: LegendItem[],
  hiddenValues: string[],
  valueToToggle: string,
): { items: LegendItem[]; hiddenValues: string[] } {
  const valueKey = valueToToggle;

  // Compute proposed hidden values
  const proposedHiddenValues = hiddenValues.includes(valueKey)
    ? hiddenValues.filter((v) => v !== valueKey)
    : [...hiddenValues, valueKey];

  // Compute visibility after the toggle
  const proposedItems = items.map((item) => ({
    ...item,
    isVisible: !proposedHiddenValues.includes(valueToKey(item.value)),
  }));

  // If no items would remain visible, reset to show everything
  const anyVisible = proposedItems.some((item) => item.isVisible);
  if (!anyVisible) {
    return {
      items: items.map((item) => ({ ...item, isVisible: true })),
      hiddenValues: [],
    };
  }

  return {
    items: proposedItems,
    hiddenValues: proposedHiddenValues,
  };
}

/**
 * Isolates an item (shows only it) or shows all if it's already isolated.
 * Returns updated items and hidden values.
 */
export function isolateItem(
  items: LegendItem[],
  valueToIsolate: string,
): { items: LegendItem[]; hiddenValues: string[] } {
  const clickedItem = items.find((item) => item.value === valueToIsolate);
  if (!clickedItem) {
    return { items, hiddenValues: [] };
  }

  const visibleItems = items.filter((item) => item.isVisible);
  const isOnlyVisible = visibleItems.length === 1 && visibleItems[0].value === valueToIsolate;

  let updatedItems: LegendItem[];

  if (isOnlyVisible) {
    // Show all items
    updatedItems = items.map((item) => ({ ...item, isVisible: true }));
  } else {
    // Show only this item
    updatedItems = items.map((item) => ({
      ...item,
      isVisible: item.value === valueToIsolate,
    }));
  }

  // Compute hidden values from visibility state
  const hiddenValues = updatedItems.filter((item) => !item.isVisible).map((item) => item.value);

  return { items: updatedItems, hiddenValues };
}
