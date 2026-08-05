export type LogicalOp = 'AND' | 'OR' | 'NOT';
export type NumericOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'between';

/**
 * Presence sentinel meaning "this annotation has a value at all".
 *
 * Companion to `NA_VALUE` ('__NA__') from @protspace/utils, and its exact
 * complement over a given annotation: NA_VALUE selects the proteins missing a
 * value, ANY_VALUE selects precisely the rest. Kept here rather than in
 * missing-values.ts because it is a filter-query concept, not an ingestion one
 * — nothing in the data pipeline ever produces it.
 *
 * Categorical conditions carry it in `values` alongside real values; numeric
 * conditions carry it in `presence`. Both kinds evaluate it identically.
 */
export const ANY_VALUE = '__ANY__';

interface BaseCondition {
  id: string;
  logicalOp?: LogicalOp;
  annotation: string;
}

export interface CategoricalCondition extends BaseCondition {
  kind: 'categorical';
  values: string[];
}

export interface NumericCondition extends BaseCondition {
  kind: 'numeric';
  operator: NumericOperator;
  min: number | null;
  max: number | null;
  /**
   * Presence sentinels (`NA_VALUE` / `ANY_VALUE`) unioned with the comparison,
   * mirroring how a categorical condition carries them among its `values`.
   * `>= 0.5` with `[NA_VALUE]` reads "at least 0.5, or no value at all".
   * A condition is configured when it has bounds OR a presence chip.
   */
  presence?: string[];
}

export type FilterCondition = CategoricalCondition | NumericCondition;

export interface FilterGroup {
  id: string;
  logicalOp?: LogicalOp;
  conditions: FilterQueryItem[];
}

export type FilterQueryItem = FilterCondition | FilterGroup;
export type FilterQuery = FilterQueryItem[];

let nextId = 0;

function generateId(): string {
  return `q-${Date.now()}-${nextId++}`;
}

export function createCondition(overrides?: Partial<CategoricalCondition>): CategoricalCondition {
  return {
    id: generateId(),
    kind: 'categorical',
    annotation: '',
    values: [],
    ...overrides,
  };
}

export function createNumericCondition(overrides?: Partial<NumericCondition>): NumericCondition {
  return {
    id: generateId(),
    kind: 'numeric',
    annotation: '',
    operator: 'gt',
    min: null,
    max: null,
    presence: [],
    ...overrides,
  };
}

export function createGroup(overrides?: Partial<FilterGroup>): FilterGroup {
  return {
    id: generateId(),
    // No leading logicalOp by default, mirroring createCondition — the builder
    // sets one only for a group that is not first (query-builder._addGroup).
    conditions: [createCondition()],
    ...overrides,
  };
}

export function isFilterGroup(item: FilterQueryItem): item is FilterGroup {
  return 'conditions' in item;
}
