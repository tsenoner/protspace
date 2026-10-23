import type {
  CategoricalCondition,
  FilterQuery,
  FilterQueryItem,
  NumericCondition,
} from './query-types';
import { clearLeadingOpInList, isFilterGroup } from './query-types';
import { toRange } from './query-numeric-helpers';
import { hasConfiguredCondition } from './query-evaluate';

/** The same values in any order: a condition matches a set of values, so order is no change. */
function sameValues(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameItem(a: FilterQueryItem, b: FilterQueryItem): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.logicalOp !== b.logicalOp) return false;
  const aGroup = isFilterGroup(a);
  const bGroup = isFilterGroup(b);
  if (aGroup || bGroup) return aGroup && bGroup && sameQuery(a.conditions, b.conditions);
  if (a.kind !== b.kind || a.annotation !== b.annotation) return false;
  if (a.kind === 'categorical') return sameValues(a.values, (b as CategoricalCondition).values);
  const left = toRange(a);
  const right = toRange(b as NumericCondition);
  return (
    left.min === right.min &&
    left.max === right.max &&
    sameValues(left.presence ?? [], right.presence ?? [])
  );
}

/**
 * Whether two queries are the same tree: the same items in the same order, condition ids included
 * (an id is a row's identity in the builder, so a re-created row is a change). A condition's own
 * values and presence chips are compared as sets. The filter
 * controller compares its draft with the applied filter through this to know whether the draft is
 * dirty.
 */
export function sameQuery(a: FilterQuery, b: FilterQuery): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((item, index) => sameItem(item, b[index]));
}

function leavesById(items: FilterQuery, into = new Map<string, FilterQueryItem>()) {
  for (const item of items) {
    if (isFilterGroup(item)) leavesById(item.conditions, into);
    else into.set(item.id, item);
  }
  return into;
}

/**
 * The query without its incomplete conditions (no annotation, or nothing to match yet) and the
 * groups they leave empty. Such a row filters nothing, so adding or removing one is no change.
 */
function withoutIncomplete(items: FilterQuery): FilterQuery {
  const out = items.flatMap((item): FilterQueryItem[] => {
    if (!isFilterGroup(item))
      return item.annotation && hasConfiguredCondition([item]) ? [item] : [];
    const conditions = withoutIncomplete(item.conditions);
    return conditions.length > 0 ? [{ ...item, conditions }] : [];
  });
  return clearLeadingOpInList(out);
}

/**
 * What the draft changes against the applied query, by condition id: `edited` holds the draft's
 * conditions that are new or differ (values, operator, joiner), and `count` adds the applied
 * conditions the draft removed. A draft that only regroups unchanged conditions still counts as
 * one change, so the count is 0 exactly when the two queries filter the same way. Incomplete
 * conditions are left out on both sides: an empty row added or removed changes nothing.
 */
export function queryChanges(
  draftQuery: FilterQuery,
  appliedQuery: FilterQuery,
): { edited: Set<string>; count: number } {
  const draft = withoutIncomplete(draftQuery);
  const applied = withoutIncomplete(appliedQuery);
  const before = leavesById(applied);
  const after = leavesById(draft);
  const edited = new Set<string>();
  for (const [id, leaf] of after) {
    const old = before.get(id);
    if (!old || !sameItem(old, leaf)) edited.add(id);
  }
  let count = edited.size;
  for (const id of before.keys()) if (!after.has(id)) count += 1;
  if (count === 0 && !sameQuery(draft, applied)) count = 1;
  return { edited, count };
}
