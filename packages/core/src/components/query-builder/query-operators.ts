import { NA_VALUE } from '@protspace/utils';
import type { FilterCondition, FilterGroup, FilterQuery, FilterQueryItem } from './query-types';
import { ANY_VALUE, clearLeadingOpInList, createGroup, isFilterGroup } from './query-types';
import { presenceOf } from './query-numeric-helpers';

/**
 * The filter's operators in words, read from and written to the query model without new fields
 * (the plan's "Operator mapping"):
 *
 * - is any of: `values`, joined by the card's joiner
 * - is none of: `logicalOp: 'NOT'` under "and" or on a first card; under "or", a one-condition
 *   group `{ logicalOp: 'OR', conditions: [{ logicalOp: 'NOT', … }] }` that renders as a plain card
 * - has any value / has no value: `values: [ANY_VALUE]` / `[NA_VALUE]`; numeric: no bounds,
 *   `presence: [ANY_VALUE]` / `[NA_VALUE]`
 * - is at least / at most / more than / less than / between: `gte lte gt lt between`
 */
export type ConditionOperator =
  | 'any-of'
  | 'none-of'
  | 'has-any'
  | 'has-none'
  | 'gte'
  | 'lte'
  | 'gt'
  | 'lt'
  | 'between';

/** How a card joins the cards before it. A first card has none. */
export type Joiner = 'AND' | 'OR';

export const CATEGORICAL_OPERATORS: readonly ConditionOperator[] = [
  'any-of',
  'none-of',
  'has-any',
  'has-none',
];

export const NUMERIC_OPERATORS: readonly ConditionOperator[] = [
  'gte',
  'lte',
  'gt',
  'lt',
  'between',
  'has-any',
  'has-none',
];

const LABELS: Record<ConditionOperator, string> = {
  'any-of': 'is any of',
  'none-of': 'is none of',
  'has-any': 'has any value',
  'has-none': 'has no value',
  gte: 'is at least',
  lte: 'is at most',
  gt: 'is more than',
  lt: 'is less than',
  between: 'is between',
};

export function operatorLabel(operator: ConditionOperator): string {
  return LABELS[operator];
}

export function isPresenceOperator(operator: ConditionOperator): boolean {
  return operator === 'has-any' || operator === 'has-none';
}

const only = (list: readonly string[], value: string) => list.length === 1 && list[0] === value;

/**
 * The operator a condition shows. A negated condition reads "is none of" whatever it holds;
 * a numeric one keeps its comparison (the card says "not" in front, see `operatorText`).
 */
export function operatorOf(condition: FilterCondition): ConditionOperator {
  const negated = condition.logicalOp === 'NOT';
  if (condition.kind === 'categorical') {
    if (negated) return 'none-of';
    if (only(condition.values, ANY_VALUE)) return 'has-any';
    if (only(condition.values, NA_VALUE)) return 'has-none';
    return 'any-of';
  }
  const presence = presenceOf(condition);
  if (!negated && presence.includes(ANY_VALUE)) return 'has-any';
  if (!negated && only(presence, NA_VALUE) && condition.min === null && condition.max === null)
    return 'has-none';
  return condition.operator;
}

/** The words on a card's operator pill: "is" for one chosen value, "not …" over a negated number. */
export function operatorText(condition: FilterCondition): string {
  const operator = operatorOf(condition);
  if (condition.kind === 'categorical' && operator === 'any-of' && condition.values.length <= 1)
    return 'is';
  if (condition.kind === 'numeric' && condition.logicalOp === 'NOT')
    return `not ${operatorLabel(operator)}`;
  return operatorLabel(operator);
}

/**
 * The condition with `operator`'s fields; its `logicalOp` is left for `setOperator`, which knows
 * where the card sits. Values the new operator still reads are kept, the rest cleared, so a
 * switch never leaves a hidden value constraining the filter.
 */
function withOperatorFields(
  condition: FilterCondition,
  operator: ConditionOperator,
): FilterCondition {
  const from = operatorOf(condition);
  if (condition.kind === 'categorical') {
    if (operator === 'has-any') return { ...condition, values: [ANY_VALUE] };
    if (operator === 'has-none') return { ...condition, values: [NA_VALUE] };
    // A presence sentinel means nothing as a chosen value, so it does not carry over.
    return isPresenceOperator(from) ? { ...condition, values: [] } : condition;
  }
  if (operator === 'has-any' || operator === 'has-none')
    return {
      ...condition,
      min: null,
      max: null,
      presence: [operator === 'has-any' ? ANY_VALUE : NA_VALUE],
    };
  if (operator === 'any-of' || operator === 'none-of') return condition;
  const usesMin = operator !== 'lt' && operator !== 'lte';
  const usesMax = operator === 'lt' || operator === 'lte' || operator === 'between';
  return {
    ...condition,
    operator,
    min: usesMin ? condition.min : null,
    max: usesMax ? condition.max : null,
    // Leaving "has any/no value" drops its sentinel; an N/A chip on a comparison stays.
    presence: isPresenceOperator(from) ? [] : presenceOf(condition).filter((p) => p !== ANY_VALUE),
  };
}

const NONE_OF_GROUP = ':none-of';

/** The one-condition group "is none of" needs under "or"; the builder renders it as a card. */
export function isNoneOfGroup(item: FilterQueryItem): item is FilterGroup {
  if (!isFilterGroup(item) || !item.id.endsWith(NONE_OF_GROUP)) return false;
  const [only, ...rest] = item.conditions;
  return (
    rest.length === 0 &&
    only !== undefined &&
    !isFilterGroup(only) &&
    only.logicalOp === 'NOT' &&
    item.logicalOp !== 'NOT' &&
    item.logicalOp !== 'AND'
  );
}

/** A card: the condition it shows and the joiner it shows (none on a first card). */
interface Card {
  condition: FilterCondition;
  joiner: Joiner | undefined;
}

/** `item` read as a card, or null for a group the user built. */
export function cardOf(item: FilterQueryItem, isFirst: boolean): Card | null {
  if (isNoneOfGroup(item)) {
    return { condition: item.conditions[0] as FilterCondition, joiner: isFirst ? undefined : 'OR' };
  }
  if (isFilterGroup(item)) return null;
  return { condition: item, joiner: isFirst ? undefined : item.logicalOp === 'OR' ? 'OR' : 'AND' };
}

/** The item a card is stored as: under "or", a negated card goes in its group. */
function storeCard(condition: FilterCondition, joiner: Joiner | undefined): FilterQueryItem {
  const negated = condition.logicalOp === 'NOT';
  if (negated && joiner === 'OR')
    return createGroup({
      id: `${condition.id}${NONE_OF_GROUP}`,
      logicalOp: 'OR',
      conditions: [condition],
    });
  if (negated) return condition;
  return { ...condition, logicalOp: joiner };
}

/**
 * `edit` applied to the card whose condition has `id`, at any depth: it gets the card and its
 * index in its list, and returns the items that replace it (none removes it).
 */
function editCard(
  items: FilterQuery,
  id: string,
  edit: (card: Card, index: number) => FilterQueryItem[],
): FilterQuery {
  let changed = false;
  const out = items.flatMap((item, index): FilterQueryItem[] => {
    const card = cardOf(item, index === 0);
    if (card) {
      if (card.condition.id !== id) return [item];
      changed = true;
      return edit(card, index);
    }
    const group = item as FilterGroup;
    const conditions = editCard(group.conditions, id, edit);
    if (conditions === group.conditions) return [item];
    changed = true;
    return [{ ...group, conditions }];
  });
  return changed ? out : items;
}

/** The query with the card `id` showing `operator`; "is none of" under "or" gets its group. */
export function setOperator(query: FilterQuery, id: string, operator: ConditionOperator) {
  return editCard(query, id, ({ condition, joiner }) => {
    const fields = withOperatorFields(condition, operator);
    return [
      storeCard({ ...fields, logicalOp: operator === 'none-of' ? 'NOT' : undefined }, joiner),
    ];
  });
}

/** The query with the card `id` joined by `joiner`. */
export function setJoiner(query: FilterQuery, id: string, joiner: Joiner) {
  return editCard(query, id, ({ condition }, index) => [
    storeCard(condition, index === 0 ? undefined : joiner),
  ]);
}

/** The query with the card's condition replaced by `next` (same id), its joiner kept. */
export function replaceCondition(query: FilterQuery, next: FilterCondition) {
  return editCard(query, next.id, ({ joiner }) => [storeCard(next, joiner)]);
}

/** The query without the card `id`; the card that becomes first loses its joiner. */
export function removeCard(query: FilterQuery, id: string): FilterQuery {
  const prune = (items: FilterQuery): FilterQuery => {
    const out = items.flatMap((item, index): FilterQueryItem[] => {
      const card = cardOf(item, index === 0);
      if (card) return card.condition.id === id ? [] : [item];
      const group = item as FilterGroup;
      return [{ ...group, conditions: prune(group.conditions) }];
    });
    return clearLeadingOpInList(out);
  };
  return prune(query);
}

/** The query with a copy of the card `id`, under `copyId`, right after it. */
export function duplicateCard(query: FilterQuery, id: string, copyId: string) {
  return editCard(query, id, ({ condition, joiner }, index) => {
    const copy = { ...structuredClone(condition), id: copyId };
    // A first card has no joiner; its copy follows it, so it joins with "and".
    return [storeCard(condition, joiner), storeCard(copy, index === 0 ? 'AND' : joiner)];
  });
}
