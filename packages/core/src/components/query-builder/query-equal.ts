import type {
  CategoricalCondition,
  FilterQuery,
  FilterQueryItem,
  NumericCondition,
} from './query-types';
import { isFilterGroup } from './query-types';

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function sameItem(a: FilterQueryItem, b: FilterQueryItem): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.logicalOp !== b.logicalOp) return false;
  const aGroup = isFilterGroup(a);
  const bGroup = isFilterGroup(b);
  if (aGroup || bGroup) return aGroup && bGroup && sameQuery(a.conditions, b.conditions);
  if (a.kind !== b.kind || a.annotation !== b.annotation) return false;
  if (a.kind === 'categorical') return sameList(a.values, (b as CategoricalCondition).values);
  const numeric = b as NumericCondition;
  return (
    a.operator === numeric.operator &&
    a.min === numeric.min &&
    a.max === numeric.max &&
    sameList(a.presence ?? [], numeric.presence ?? [])
  );
}

/**
 * Whether two queries are the same tree: the same items in the same order, condition ids included
 * (an id is a row's identity in the builder, so a re-created row is a change). The filter
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
 * What the draft changes against the applied query, by condition id: `edited` holds the draft's
 * conditions that are new or differ (values, operator, joiner), and `count` adds the applied
 * conditions the draft removed. A draft that only regroups unchanged conditions still counts as
 * one change, so the count is 0 exactly when the two queries are the same.
 */
export function queryChanges(
  draft: FilterQuery,
  applied: FilterQuery,
): { edited: Set<string>; count: number } {
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
