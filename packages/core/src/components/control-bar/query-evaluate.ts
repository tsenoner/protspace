import type { ProtspaceData } from './types';
import type {
  FilterQuery,
  FilterQueryItem,
  FilterCondition,
  NumericCondition,
} from './query-types';
import { isFilterGroup } from './query-types';
import { isNumericConditionReady, matchesNumericValue } from './query-numeric-helpers';
import { toInternalValue } from '../legend/config';
import { getFirstAnnotationIndex } from '@protspace/utils';

/**
 * Resolve the string annotation value for a protein at the given index.
 * Handles both Int32Array and number[][] formats in annotation_data.
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
 * Evaluate a single condition against all proteins, returning a Set of matching indices.
 * Categorical conditions use "is" semantics (value is among the selected set);
 * numeric conditions apply a comparison operator. Negation is handled at the
 * combining level via the NOT logical operator.
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
  const matches = new Set<number>();

  for (let i = 0; i < numProteins; i++) {
    const resolved = resolveAnnotationValue(i, condition.annotation, data);
    const normalized = normalizeValue(resolved);

    if (valuesSet.has(normalized)) {
      matches.add(i);
    }
  }

  return matches;
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
      itemResult = complement(itemResult, numProteins);
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
