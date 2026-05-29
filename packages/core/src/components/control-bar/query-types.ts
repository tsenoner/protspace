export type LogicalOp = 'AND' | 'OR' | 'NOT';
export type NumericOperator = 'gt' | 'lt' | 'between';

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
