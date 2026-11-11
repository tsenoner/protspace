import { DEFAULT_CATEGORICAL_PALETTE_ID } from '@protspace/utils';
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

/** The protein count where the default shape size is the base 10. */
const DEFAULT_SHAPE_SIZE_REFERENCE_COUNT = 10_000;
/** How fast the default grows below the reference count: gently, so 1,000 proteins get 18. */
const SMALL_DATASET_EXPONENT = 1 / 4;
/** How fast it shrinks above: dot area falls faster than the count grows. */
const LARGE_DATASET_EXPONENT = 2 / 3;
/** The largest default, ~12 px dots: tiny datasets stop growing here. */
const MAX_DEFAULT_SHAPE_SIZE = 40;

/**
 * The default shape size for a dataset of `proteinCount` proteins, one continuous curve through
 * 10 at 10,000 proteins: `min(40, round(10 · (10000 / N)^¼))` below it and
 * `max(1, round(10 · (10000 / N)^⅔))` above. Dot area grows linearly with the shape size, so a
 * small dataset opens with dots large enough to read, and on a large one the total ink still grows
 * as `N^⅓`, so it looks denser without the category drawn on top covering the others. 40 at 10
 * proteins, 32 at 100, 18 at 1,000, 2 at ~105K, 1 at Swiss-Prot; 10 for an empty dataset.
 */
export function defaultShapeSize(proteinCount: number): number {
  const base = LEGEND_DEFAULTS.symbolSize;
  // Negated so a NaN count gives the base size too, not NaN.
  if (!(proteinCount > 0)) return base;
  const ratio = DEFAULT_SHAPE_SIZE_REFERENCE_COUNT / proteinCount;
  if (ratio >= 1) {
    return Math.min(MAX_DEFAULT_SHAPE_SIZE, Math.round(base * ratio ** SMALL_DATASET_EXPONENT));
  }
  return Math.max(1, Math.round(base * ratio ** LARGE_DATASET_EXPONENT));
}

/** The ink budget for the largest size: 10,000 proteins at 64, in protein-shape-size units. */
const MAX_SHAPE_SIZE_INK = DEFAULT_SHAPE_SIZE_REFERENCE_COUNT * LEGEND_DEFAULTS.maxSymbolSize;

/**
 * The largest shape size the legend accepts for a dataset of `proteinCount` proteins: 64 from
 * 10,000 proteins up, rising as `640000 / N` below that to 128 at 5,000 proteins and fewer. The
 * GPU fills every dot's pixels each frame, so a size above 64 is only offered while the dataset
 * draws no more ink than 10,000 proteins at 64. The ceiling 128 while the count is unknown (no
 * dataset yet): the cap tightens once it is known, so a stored size is never cut short early.
 */
export function maxShapeSize(proteinCount: number): number {
  if (!(proteinCount > 0)) return LEGEND_DEFAULTS.smallDatasetMaxSymbolSize;
  return Math.min(
    LEGEND_DEFAULTS.smallDatasetMaxSymbolSize,
    Math.max(LEGEND_DEFAULTS.maxSymbolSize, Math.floor(MAX_SHAPE_SIZE_INK / proteinCount)),
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
    selectedPaletteId: DEFAULT_CATEGORICAL_PALETTE_ID,
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
export function getItemClasses(item: LegendItem, isSelected: boolean, isPicked: boolean): string {
  const classes = ['legend-item'];

  if (!item.isVisible) classes.push('hidden');
  // Picked up with the keyboard (Space on its handle) and moving with the arrow keys.
  if (isPicked) classes.push('picked');
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

/** The mouse click that toggled an item: the legend before it and as it left it. */
export interface FirstClick {
  valueKey: string;
  itemsBefore: LegendItem[];
  itemsAfter: LegendItem[];
}

/**
 * A mouse double-click arrives as click (detail 1), click (detail 2), dblclick, the last two in
 * one task. True for that second click: toggling on it only to isolate right after would hand the
 * plot the item's hide, show and isolate as separate states, so it is left to the dblclick. Touch
 * and pen clicks keep toggling: not every engine sends a dblclick for a double tap.
 */
export function isSecondClickOfDouble(
  firstClick: FirstClick | null,
  valueKey: string,
  click: { detail: number; pointerType?: string },
): boolean {
  return (
    click.detail === 2 &&
    firstClick?.valueKey === valueKey &&
    click.pointerType !== 'touch' &&
    click.pointerType !== 'pen'
  );
}

/**
 * The items a dblclick isolates from: the legend as it stood before the first click, so that
 * click's hide or show does not leak into the result and double-clicking the isolated item
 * restores the full set, as `isolateItem` intends. The current items when the first click was
 * on another item or something else has moved the legend since.
 */
export function isolationBase(
  firstClick: FirstClick | null,
  valueKey: string,
  items: LegendItem[],
): LegendItem[] {
  return firstClick?.valueKey === valueKey && firstClick.itemsAfter === items
    ? firstClick.itemsBefore
    : items;
}

/** Two taps on the same row this close together isolate it, as a double-click does. */
export const DOUBLE_TAP_MS = 300;

/** A click this soon after a pointerdown on a row came from that press. */
const CLICK_AFTER_PRESS_MS = 1000;

/**
 * True for the second of two touch or pen taps on the same row within DOUBLE_TAP_MS. Not every
 * engine sends a dblclick for a double tap (iOS Safari does not), so the legend counts the taps
 * itself; mouse double-clicks keep `isSecondClickOfDouble` and the dblclick.
 */
export function isDoubleTap(
  previous: { valueKey: string; time: number } | null,
  current: { valueKey: string; time: number; pointerType: string },
): boolean {
  if (current.pointerType !== 'touch' && current.pointerType !== 'pen') return false;
  if (!previous || previous.valueKey !== current.valueKey) return false;
  const gap = current.time - previous.time;
  return gap >= 0 && gap <= DOUBLE_TAP_MS;
}

/**
 * The pointer behind a click: its own `pointerType` (a click is a PointerEvent in current
 * engines), else the row press just before it, else a mouse (a script's or a screen reader's click).
 */
export function clickPointerType(
  click: { pointerType?: string; timeStamp: number },
  lastDown: { pointerType: string; time: number } | null,
): string {
  if (click.pointerType) return click.pointerType;
  if (lastDown && click.timeStamp - lastDown.time <= CLICK_AFTER_PRESS_MS) {
    return lastDown.pointerType;
  }
  return 'mouse';
}
