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

/** The query with the card's condition replaced by `next` (same id), its joiner kept. */
export function replaceCondition(query: FilterQuery, next: FilterCondition) {
  return editCard(query, next.id, ({ joiner }) => [storeCard(next, joiner)]);
}

/**
 * The query without the card or group `id`; the item that becomes first loses its joiner.
 */
export function removeCard(query: FilterQuery, id: string): FilterQuery {
  const prune = (items: FilterQuery): FilterQuery => {
    const out = items.flatMap((item, index): FilterQueryItem[] => {
      const card = cardOf(item, index === 0);
      if (card) return card.condition.id === id ? [] : [item];
      const group = item as FilterGroup;
      if (group.id === id) return [];
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

// ─── Joiners and groups ──────────────────────────────────────────────────────
//
// A joiner belongs to an item: a card or a group, at any depth. "is none of" counts as "and"
// (NOT reads "and has a value but not"), except the "or" group a negated card is stored in.

/** How the item at `index` of its list joins the items before it; a first item has none. */
export function itemJoiner(item: FilterQueryItem, index: number): Joiner | undefined {
  if (index === 0) return undefined;
  return isNoneOfGroup(item) || item.logicalOp === 'OR' ? 'OR' : 'AND';
}

/** One list (the query's top level or a group's) joins with both "and" and "or". */
export function isMixed(items: FilterQuery): boolean {
  const joiners = new Set(items.map(itemJoiner).filter(Boolean));
  return joiners.size > 1;
}

/** A group the user built, negated as a whole: shown as such, never offered as an operator. */
export function isNegatedGroup(item: FilterQueryItem): item is FilterGroup {
  return isUserGroup(item) && item.logicalOp === 'NOT';
}

/** A group the user built, not the one "is none of" is stored in. */
function isUserGroup(item: FilterQueryItem): item is FilterGroup {
  // isNoneOfGroup narrows to FilterGroup, so its negation would narrow a group away.
  const noneOf: (item: FilterQueryItem) => boolean = isNoneOfGroup;
  return isFilterGroup(item) && !noneOf(item);
}

/** `item` at `index` of its list, joined by `joiner` (none when first). */
function withJoiner(item: FilterQueryItem, joiner: Joiner | undefined): FilterQueryItem {
  const card = cardOf(item, false);
  if (card) return storeCard(card.condition, joiner);
  if (item.logicalOp !== 'NOT') return { ...item, logicalOp: joiner };
  // A negated group keeps its NOT under "and"; under "or" it goes in a group of its own.
  if (joiner === 'OR') return createGroup({ logicalOp: 'OR', conditions: [item] });
  return item;
}

/**
 * `edit` applied to the list holding the item `id` (a card's condition id, or an item's own id),
 * at any depth; it gets the list and the item's index there.
 */
function editList(
  items: FilterQuery,
  id: string,
  edit: (items: FilterQuery, index: number) => FilterQuery,
): FilterQuery {
  const index = items.findIndex(
    (item) => item.id === id || cardOf(item, false)?.condition.id === id,
  );
  if (index >= 0) return edit(items, index);
  let changed = false;
  const out = items.map((item) => {
    if (!isUserGroup(item)) return item;
    const conditions = editList(item.conditions, id, edit);
    if (conditions === item.conditions) return item;
    changed = true;
    return { ...item, conditions };
  });
  return changed ? out : items;
}

/** The list holding the item `id`, or null. */
function listOf(query: FilterQuery, id: string): FilterQuery | null {
  let found: FilterQuery | null = null;
  editList(query, id, (items) => ((found = items), items));
  return found;
}

/**
 * The query with the item `id` joined by `joiner`; nothing else changes. A negated group picked
 * "and" or "or" here drops its NOT: the user chose the joiner over "and not".
 */
export function setJoiner(query: FilterQuery, id: string, joiner: Joiner) {
  return editList(query, id, (items, index) =>
    items.map((item, i) => {
      if (i !== index) return item;
      if (isNegatedGroup(item)) return { ...item, logicalOp: index === 0 ? 'NOT' : joiner };
      return withJoiner(item, index === 0 ? undefined : joiner);
    }),
  );
}

/** Joining the item `id` by `joiner` would leave its list mixing "and" and "or". */
export function joinerWouldMix(query: FilterQuery, id: string, joiner: Joiner): boolean {
  const list = listOf(setJoiner(query, id, joiner), id);
  return list !== null && isMixed(list);
}

/** The query with every item in the list holding `id` joined by `joiner`. */
export function setJoinerForAll(query: FilterQuery, id: string, joiner: Joiner) {
  return editList(query, id, (items) =>
    items.map((item, i) => withJoiner(item, i === 0 ? undefined : joiner)),
  );
}

/**
 * The query with the item `id` joined by `joiner`, and the run of items that joiner now links
 * (the item, the one before it, and their neighbours joined the same way) wrapped in one group.
 * Every condition keeps its id, so counts and the EAT condition still find it.
 */
export function groupRun(query: FilterQuery, id: string, joiner: Joiner) {
  return editList(setJoiner(query, id, joiner), id, (items, index) => {
    if (index === 0) return items;
    let start = index - 1;
    while (start > 0 && itemJoiner(items[start], start) === joiner) start--;
    let end = index;
    while (end + 1 < items.length && itemJoiner(items[end + 1], end + 1) === joiner) end++;
    if (start === 0 && end === items.length - 1) return items;
    const run = items
      .slice(start, end + 1)
      .map((item, i) => (i === 0 ? withJoiner(item, undefined) : item));
    const group = createGroup({ logicalOp: itemJoiner(items[start], start), conditions: run });
    return [...items.slice(0, start), group, ...items.slice(end + 1)];
  });
}

/** The query with the group `id` replaced by its items; the first takes the group's joiner. */
export function ungroup(query: FilterQuery, id: string) {
  return editList(query, id, (items, index) => {
    const group = items[index];
    if (!isUserGroup(group) || group.logicalOp === 'NOT') return items;
    const inner = group.conditions.map((item, i) =>
      i === 0 ? withJoiner(item, itemJoiner(group, index)) : item,
    );
    return clearLeadingOpInList([...items.slice(0, index), ...inner, ...items.slice(index + 1)]);
  });
}

/** The joiner a new item at the end of `items` takes: the list's last one, else "and". */
export function nextJoiner(items: FilterQuery): Joiner | undefined {
  if (items.length === 0) return undefined;
  return itemJoiner(items[items.length - 1], items.length - 1) ?? 'AND';
}

/** The query with `condition` added at the end of the group `id`, joined like its last item. */
export function addToGroup(query: FilterQuery, id: string, condition: FilterCondition) {
  const add = (items: FilterQuery): FilterQuery =>
    items.map((item) => {
      if (!isUserGroup(item)) return item;
      if (item.id === id)
        return {
          ...item,
          conditions: [...item.conditions, withJoiner(condition, nextJoiner(item.conditions))],
        };
      return { ...item, conditions: add(item.conditions) };
    });
  return add(query);
}
