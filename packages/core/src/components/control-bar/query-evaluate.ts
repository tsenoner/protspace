import type { ProtspaceData } from './types';
import type {
  FilterQuery,
  FilterQueryItem,
  FilterCondition,
  NumericCondition,
} from './query-types';
import { isFilterGroup, ANY_VALUE } from './query-types';
import { isNumericConditionReady, matchesNumericValue } from './query-numeric-helpers';
import { toInternalValue } from '../legend/config';
import { getFirstAnnotationIndex, getProteinAnnotationIndices, NA_VALUE } from '@protspace/utils';

/**
 * Resolve the FIRST string annotation value for a protein at the given index.
 * Handles both Int32Array and number[][] formats in annotation_data.
 * Multi-label-aware callers (matching, counting) must use
 * resolveAnnotationInternalValues instead — this sees only the primary label.
 */
export function resolveAnnotationValue(
  proteinIndex: number,
  annotation: string,
  data: ProtspaceData,
): string | null {
  const idxData = data.annotation_data?.[annotation];
  const valuesArr = data.annotations?.[annotation]?.values;

  if (!idxData || !valuesArr) return null;

  const idx = getFirstAnnotationIndex(idxData, proteinIndex);

  if (idx < 0 || idx >= valuesArr.length) return null;

  return valuesArr[idx] ?? null;
}

/**
 * Normalize a resolved annotation value for consistent comparison.
 * Applies toInternalValue() to convert null/empty to '__NA__'.
 */
function normalizeValue(value: string | null): string {
  return toInternalValue(value);
}

/**
 * Resolve ALL normalized annotation values for a protein (multi-label aware),
 * deduplicated. A protein with no labels — or a missing annotation column —
 * resolves to ['__NA__'], mirroring how the single-value path normalizes a
 * missing value, so N/A can still be selected and counted as a filter value.
 *
 * Matching semantics match the legend/visibility model: a multi-label protein
 * carries every one of its values, so it satisfies "annotation is X" when ANY
 * of its labels is X.
 */
export function resolveAnnotationInternalValues(
  proteinIndex: number,
  annotation: string,
  data: ProtspaceData,
): string[] {
  const idxData = data.annotation_data?.[annotation];
  const valuesArr = data.annotations?.[annotation]?.values;

  if (!idxData || !valuesArr) return [normalizeValue(null)];

  const indices = getProteinAnnotationIndices(idxData, proteinIndex);
  if (indices.length === 0) return [normalizeValue(null)];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const idx of indices) {
    const raw = idx >= 0 && idx < valuesArr.length ? (valuesArr[idx] ?? null) : null;
    const normalized = normalizeValue(raw);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Evaluate a single condition against all proteins, returning a Set of matching indices.
 * Categorical conditions use "is" semantics (value is among the selected set);
 * numeric conditions apply a comparison operator. Both kinds additionally
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

  if (condition.values.length === 0) {
    return allIndices(numProteins);
  }

  if (!data.annotation_data?.[condition.annotation] || !data.annotations?.[condition.annotation]) {
    return new Set();
  }

  const valuesSet = new Set(condition.values);
  // ANY_VALUE means "carries a real label", so it is satisfied by any resolved
  // value other than the N/A sentinel — including a multi-label protein whose
  // labels are a mix of real values and nulls.
  const wantsAnyValue = valuesSet.has(ANY_VALUE);
  const matches = new Set<number>();

  for (let i = 0; i < numProteins; i++) {
    const resolved = resolveAnnotationInternalValues(i, condition.annotation, data);

    if (wantsAnyValue && resolved.some((value) => value !== NA_VALUE)) {
      matches.add(i);
      continue;
    }

    if (resolved.some((value) => valuesSet.has(value))) {
      matches.add(i);
    }
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
        if ((numericValues[i] ?? null) !== null) result.add(i);
      }
      continue;
    }

    if (!data.annotation_data?.[annotation] || !data.annotations?.[annotation]) continue;

    for (let i = 0; i < numProteins; i++) {
      const resolved = resolveAnnotationInternalValues(i, annotation, data);
      if (resolved.some((value) => value !== NA_VALUE)) result.add(i);
    }
  }

  return result;
}

/**
 * Evaluate a numeric condition: a protein matches when its raw numeric value
 * satisfies the operator. An unconfigured condition (missing a required bound) is
 * a no-op and matches everything — mirroring an empty categorical condition. This
 * keeps the two kinds symmetric under NOT: `NOT (unconfigured)` then matches
 * nothing (and leaves Apply disabled) instead of isolating every protein.
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
    if (matchesNumericValue(values[i] ?? null, condition)) {
      matches.add(i);
    }
  }
  return matches;
}

/**
 * True when the query constrains the result at all — i.e. at least one
 * condition (at any group depth) is configured. Unconfigured conditions are
 * match-all no-ops (see evaluateCondition), so a query without a single
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
 * Return a shallow copy of the query with the item matching `id` removed.
 * Searches both top-level items and group conditions.
 */
function excludeItemById(items: FilterQueryItem[], id: string): FilterQueryItem[] {
  const result: FilterQueryItem[] = [];
  for (const item of items) {
    if (isFilterGroup(item)) {
      const filteredConditions = item.conditions.filter((c) => c.id !== id);
      if (filteredConditions.length > 0) {
        result.push({ ...item, conditions: filteredConditions });
      }
    } else if (item.id !== id) {
      result.push(item);
    }
  }
  return result;
}

function evaluateItems(
  items: FilterQueryItem[],
  data: ProtspaceData,
  numProteins: number,
): Set<number> {
  // An empty item list (e.g. a group whose last condition was removed) is a
  // match-all no-op, symmetric with an empty top-level query (evaluateQuery)
  // and an empty/unconfigured condition (evaluateCondition). Without this an
  // empty group would return ∅ and AND-kill the whole query (count 0, Apply
  // disabled). Apply is still gated separately by hasConfiguredCondition.
  if (items.length === 0) return allIndices(numProteins);

  let accumulated: Set<number> | null = null;

  for (const item of items) {
    let itemResult: Set<number>;

    if (isFilterGroup(item)) {
      itemResult = evaluateItems(item.conditions, data, numProteins);
    } else {
      itemResult = evaluateCondition(item, data, numProteins);
    }

    const op = item.logicalOp;

    if (op === 'NOT') {
      // NOT means "has a value AND does not match" — not a bare set complement.
      // Complementing alone would sweep in every protein that is N/A on the
      // negated annotation, which is what forced users to bolt an explicit
      // `AND NOT N/A` onto their queries. Scoping the complement to proteins
      // that actually carry a value makes `NOT` self-contained, and makes
      // `NOT (is N/A)` mean exactly "has any value".
      const annotations = new Set<string>();
      collectAnnotations(item, annotations);
      itemResult = intersection(
        complement(itemResult, numProteins),
        proteinsWithAnyValue(annotations, data, numProteins),
      );
    }

    if (accumulated === null) {
      accumulated = itemResult;
    } else if (op === 'OR') {
      accumulated = union(accumulated, itemResult);
    } else {
      accumulated = intersection(accumulated, itemResult);
    }
  }

  return accumulated ?? new Set();
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

function complement(s: Set<number>, n: number): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (!s.has(i)) result.add(i);
  }
  return result;
}
