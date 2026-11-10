import type { ProtspaceData } from './types';
import type {
  FilterQuery,
  FilterQueryItem,
  FilterCondition,
  NumericCondition,
} from './query-types';
import { isFilterGroup, ANY_VALUE } from './query-types';
import { isNumericConditionReady, matchesNumericValue } from './query-numeric-helpers';
import {
  NA_VALUE,
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  isNAValue,
  readNumericValue,
  toInternalValue,
  type AnnotationData,
} from '@protspace/utils';

/**
 * An annotation's declared values, each `toInternalValue`-normalised once: `values[slot]` is a
 * distinct internal value and `slotOf[idx]` the slot of declared index `idx`, so values that
 * normalise alike (null and N/A) share one. `naSlot` is N/A's, present even when no declared value
 * is N/A, because a protein with no label, or an index outside the list, reads as N/A.
 *
 * Built once per values array (a dataset swap brings a new one), so the per-protein walks compare
 * integers instead of normalising, deduplicating and allocating for every label of every protein:
 * at Swiss-Prot scale that is ~570K rows on every count the builder makes.
 */
interface ValueSlots {
  values: readonly string[];
  slotOf: Int32Array;
  naSlot: number;
}

const slotsCache = new WeakMap<readonly (string | null)[], ValueSlots>();

export function valueSlots(declared: readonly (string | null)[]): ValueSlots {
  const cached = slotsCache.get(declared);
  if (cached) return cached;
  const values: string[] = [];
  const bySlot = new Map<string, number>();
  const slotFor = (value: string) => {
    let slot = bySlot.get(value);
    if (slot === undefined) {
      slot = values.length;
      values.push(value);
      bySlot.set(value, slot);
    }
    return slot;
  };
  const slotOf = new Int32Array(declared.length);
  for (let v = 0; v < declared.length; v++) slotOf[v] = slotFor(toInternalValue(declared[v]));
  const slots = { values, slotOf, naSlot: slotFor(NA_VALUE) };
  slotsCache.set(declared, slots);
  return slots;
}

/**
 * The slot of a protein's `k`-th label (`0 <= k < getProteinAnnotationCount`); an index outside
 * the declared values reads as N/A.
 */
export function slotAt(
  idxData: AnnotationData,
  slots: ValueSlots,
  proteinIndex: number,
  k: number,
): number {
  const idx = getProteinAnnotationIndexAt(idxData, proteinIndex, k);
  return idx >= 0 && idx < slots.slotOf.length ? slots.slotOf[idx] : slots.naSlot;
}

/**
 * Whether a protein carries a value whose slot is set in `wanted` (one byte per slot); a protein
 * with no label carries N/A. Multi-label aware: any one of its labels is enough.
 */
export function carriesWanted(
  idxData: AnnotationData,
  slots: ValueSlots,
  wanted: Uint8Array,
  proteinIndex: number,
): boolean {
  const count = getProteinAnnotationCount(idxData, proteinIndex);
  if (count === 0) return wanted[slots.naSlot] === 1;
  for (let k = 0; k < count; k++) {
    if (wanted[slotAt(idxData, slots, proteinIndex, k)] === 1) return true;
  }
  return false;
}

/**
 * Resolve ALL normalized annotation values for a protein (multi-label aware),
 * deduplicated. A protein with no labels — or a missing annotation column —
 * resolves to ['__NA__'], mirroring how the single-value path normalizes a
 * missing value, so N/A can still be selected and counted as a filter value.
 *
 * Matching semantics match the legend/visibility model: a multi-label protein
 * carries every one of its values, so it satisfies "annotation is X" when ANY
 * of its labels is X. The evaluator and the value list apply this same rule
 * through `valueSlots` rather than calling it once per protein.
 */
export function resolveAnnotationInternalValues(
  proteinIndex: number,
  annotation: string,
  data: ProtspaceData,
): string[] {
  const idxData = data.annotation_data?.[annotation];
  const valuesArr = data.annotations?.[annotation]?.values;

  if (!idxData || !valuesArr) return [NA_VALUE];

  const slots = valueSlots(valuesArr);
  const count = getProteinAnnotationCount(idxData, proteinIndex);
  if (count === 0) return [NA_VALUE];

  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    const value = slots.values[slotAt(idxData, slots, proteinIndex, k)];
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Evaluate a single condition against all proteins, returning a Set of matching indices.
 * Categorical conditions use "is" semantics (value is among the selected set);
 * numeric conditions keep the values in their range. Both kinds additionally
 * honour the presence sentinels `NA_VALUE` and `ANY_VALUE`. Negation is handled
 * at the combining level via the NOT logical operator.
 */
function evaluateCondition(
  condition: FilterCondition,
  data: ProtspaceData,
  numProteins: number,
): Set<number> {
  if (condition.kind === 'numeric') {
    return evaluateNumericCondition(condition, data, numProteins);
  }

  const idxData = data.annotation_data?.[condition.annotation];
  const valuesArr = data.annotations?.[condition.annotation]?.values;
  if (!idxData || !valuesArr) return new Set();

  // Which slots match, decided once per distinct value rather than once per label per protein.
  // ANY_VALUE means "carries a real label", so it is satisfied by any value other than the N/A
  // sentinel — including a multi-label protein whose labels mix real values and nulls.
  const slots = valueSlots(valuesArr);
  const selected = new Set(condition.values);
  const wantsAnyValue = selected.has(ANY_VALUE);
  const wanted = new Uint8Array(slots.values.length);
  slots.values.forEach((value, slot) => {
    if (selected.has(value) || (wantsAnyValue && !isNAValue(value))) wanted[slot] = 1;
  });

  const matches = new Set<number>();
  for (let i = 0; i < numProteins; i++) {
    if (carriesWanted(idxData, slots, wanted, i)) matches.add(i);
  }
  return matches;
}

/**
 * Every annotation referenced by an item (a condition, or every condition
 * nested in a group). Used to scope NOT's "must have a value" guard.
 */
function collectAnnotations(item: FilterQueryItem, out: Set<string>): void {
  if (isFilterGroup(item)) {
    for (const condition of item.conditions) collectAnnotations(condition, out);
  } else if (item.annotation) {
    out.add(item.annotation);
  }
}

/**
 * Proteins carrying a value for at least ONE of the given annotations.
 *
 * "At least one" rather than "all" keeps NOT over a multi-annotation group as
 * permissive as possible: only a protein that is N/A across every annotation
 * the group touches is dropped. For the overwhelmingly common single-condition
 * case the distinction does not arise.
 */
function proteinsWithAnyValue(
  annotations: Set<string>,
  data: ProtspaceData,
  numProteins: number,
): Set<number> {
  const result = new Set<number>();

  for (const annotation of annotations) {
    const numericValues = data.numeric_annotation_data?.[annotation];
    if (numericValues) {
      for (let i = 0; i < numProteins; i++) {
        if (readNumericValue(numericValues, i) !== null) result.add(i);
      }
      continue;
    }

    const idxData = data.annotation_data?.[annotation];
    const valuesArr = data.annotations?.[annotation]?.values;
    if (!idxData || !valuesArr) continue;

    // Every slot but N/A's is a real value: one table per annotation, not a string per label.
    const slots = valueSlots(valuesArr);
    const real = new Uint8Array(slots.values.length).fill(1);
    real[slots.naSlot] = 0;
    for (let i = 0; i < numProteins; i++) {
      if (!result.has(i) && carriesWanted(idxData, slots, real, i)) result.add(i);
    }
  }

  return result;
}

/**
 * Evaluate a numeric condition: a protein matches when its raw numeric value
 * lies in its range, both ends included. With no bound it is the full range and
 * matches everything, so `NOT (full range)` matches nothing.
 */
function evaluateNumericCondition(
  condition: NumericCondition,
  data: ProtspaceData,
  numProteins: number,
): Set<number> {
  if (!isNumericConditionReady(condition)) return allIndices(numProteins);

  const values = data.numeric_annotation_data?.[condition.annotation];
  if (!values) return new Set();

  const matches = new Set<number>();
  for (let i = 0; i < numProteins; i++) {
    if (matchesNumericValue(readNumericValue(values, i), condition)) {
      matches.add(i);
    }
  }
  return matches;
}

/**
 * True when the query constrains the result at all — i.e. at least one
 * condition (at any group depth) is configured. Unconfigured conditions are
 * left out of the count (see evaluateCounted), so a query without a single
 * configured condition matches every protein; Apply gates on this so such a
 * query can't be applied as if it were a real filter.
 */
export function hasConfiguredCondition(items: FilterQueryItem[]): boolean {
  return items.some((item) => {
    if (isFilterGroup(item)) return hasConfiguredCondition(item.conditions);
    if (item.kind === 'numeric') return isNumericConditionReady(item);
    return item.values.length > 0;
  });
}

/**
 * Evaluate a FilterQuery and return the Set of matching protein indices.
 */
export function evaluateQuery(query: FilterQuery, data: ProtspaceData): Set<number> {
  const numProteins = data.protein_ids?.length ?? 0;
  if (numProteins === 0) return new Set();
  if (query.length === 0) return allIndices(numProteins);

  return evaluateItems(query, data, numProteins);
}

/**
 * Evaluate a FilterQuery with one condition excluded (by id).
 * Used to compute value counts that are independent of the current condition's own selections.
 */
export function evaluateQueryExcluding(
  query: FilterQuery,
  data: ProtspaceData,
  excludeId: string,
): Set<number> {
  const numProteins = data.protein_ids?.length ?? 0;
  if (numProteins === 0) return new Set();

  const filtered = excludeItemById(query, excludeId);
  if (filtered.length === 0) return allIndices(numProteins);

  return evaluateItems(filtered, data, numProteins);
}

/**
 * Return a shallow copy of the query with the item matching `id` removed — a condition or a whole
 * group. Searches every depth; a group left empty goes with it.
 */
function excludeItemById(items: FilterQueryItem[], id: string): FilterQueryItem[] {
  const result: FilterQueryItem[] = [];
  for (const item of items) {
    if (item.id === id) continue;
    if (isFilterGroup(item)) {
      const filteredConditions = excludeItemById(item.conditions, id);
      if (filteredConditions.length > 0) {
        result.push({ ...item, conditions: filteredConditions });
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

/** A row with no value or bound yet (or no annotation): it constrains nothing. */
const isIncomplete = (condition: FilterCondition) =>
  condition.kind === 'numeric'
    ? !isNumericConditionReady(condition)
    : condition.values.length === 0;

function evaluateItems(
  items: FilterQueryItem[],
  data: ProtspaceData,
  numProteins: number,
): Set<number> {
  return evaluateCounted(items, data, numProteins) ?? allIndices(numProteins);
}

/**
 * The items' matches, or null when none of them constrains anything. Incomplete rows and empty
 * groups are left out rather than read as "every protein": under "or" that reading would make
 * the whole query match everything, and under NOT match nothing, while the row still waits for
 * a value. Apply is gated separately by hasConfiguredCondition.
 */
function evaluateCounted(
  items: FilterQueryItem[],
  data: ProtspaceData,
  numProteins: number,
): Set<number> | null {
  let accumulated: Set<number> | null = null;

  for (const item of items) {
    let itemResult: Set<number>;

    if (isFilterGroup(item)) {
      const inner = evaluateCounted(item.conditions, data, numProteins);
      if (!inner) continue;
      itemResult = inner;
    } else {
      if (isIncomplete(item)) continue;
      itemResult = evaluateCondition(item, data, numProteins);
    }

    const op = item.logicalOp;

    if (op === 'NOT') {
      // NOT means "has a value AND does not match" — not a bare set complement.
      // Complementing alone would sweep in every protein that is N/A on the
      // negated annotation, which is what forced users to bolt an explicit
      // `AND NOT N/A` onto their queries. Subtracting the matches from the
      // proteins that actually carry a value makes `NOT` self-contained, and
      // makes `NOT (is N/A)` mean exactly "has any value".
      const annotations = new Set<string>();
      collectAnnotations(item, annotations);
      itemResult = difference(proteinsWithAnyValue(annotations, data, numProteins), itemResult);
    }

    if (accumulated === null) {
      accumulated = itemResult;
    } else if (op === 'OR') {
      accumulated = union(accumulated, itemResult);
    } else {
      accumulated = intersection(accumulated, itemResult);
    }
  }

  return accumulated;
}

function allIndices(n: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < n; i++) s.add(i);
  return s;
}

function union(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set(a);
  for (const v of b) result.add(v);
  return result;
}

function intersection(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set<number>();
  for (const v of a) {
    if (b.has(v)) result.add(v);
  }
  return result;
}

/** `a \ b`. Used by NOT, whose scope is already narrowed to proteins with a value. */
function difference(a: Set<number>, b: Set<number>): Set<number> {
  const result = new Set<number>();
  for (const v of a) {
    if (!b.has(v)) result.add(v);
  }
  return result;
}
