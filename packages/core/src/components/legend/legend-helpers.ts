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

/** Datasets up to this many proteins keep the base default shape size. */
const DEFAULT_SHAPE_SIZE_REFERENCE_COUNT = 10_000;

/**
 * The default shape size for a dataset of `proteinCount` proteins:
 * `clamp(round(10 · (10000 / N)^⅔), 1, 10)`. Dot area grows linearly with the shape size, so
 * the total ink still grows as `N^⅓` and a larger dataset looks denser without the category
 * drawn on top covering the others. 10 up to 10,000 proteins (and for an empty dataset), 2 at
 * ~105K, 1 at Swiss-Prot.
 */
export function defaultShapeSize(proteinCount: number): number {
  const base = LEGEND_DEFAULTS.symbolSize;
  if (proteinCount <= DEFAULT_SHAPE_SIZE_REFERENCE_COUNT) return base;
  return Math.max(
    1,
    Math.round(base * (DEFAULT_SHAPE_SIZE_REFERENCE_COUNT / proteinCount) ** (2 / 3)),
  );
}

/**
 * The per-annotation shape size a bundle or browser record carries when nobody picked one: what
 * the CLI writers and `createDefaultSettings` emit. It reads as unset.
 */
export const SHAPE_SIZE_FILLER = 10;

/** The filler earlier writers emitted. */
const LEGACY_SHAPE_SIZE_FILLER = 30;

const UNSET_SHAPE_SIZES: ReadonlySet<number> = new Set([
  SHAPE_SIZE_FILLER,
  LEGACY_SHAPE_SIZE_FILLER,
]);

/** A stored shape size, or null unless it is a positive finite number. */
export function positiveSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * An annotation's own shape size from a bundle or browser storage, or null when it is unset,
 * so the dataset's default applies.
 */
export function explicitShapeSize(stored: unknown): number | null {
  const size = positiveSize(stored);
  return size !== null && UNSET_SHAPE_SIZES.has(size) ? null : size;
}

/**
 * Creates default persisted settings for an annotation.
 */
export function createDefaultSettings(selectedAnnotation: string): LegendPersistedSettings {
  void selectedAnnotation;
  return {
    maxVisibleValues: LEGEND_DEFAULTS.maxVisibleValues,
    shapeSize: SHAPE_SIZE_FILLER,
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
