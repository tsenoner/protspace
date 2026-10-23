import type { FilterCondition, FilterQuery, FilterQueryItem } from './query-types';
import { isFilterGroup } from './query-types';

/** Why Apply is disabled (design decision 14); null from `applyBlock` means it is enabled. */
export type ApplyBlock =
  | { kind: 'empty' }
  | { kind: 'annotation'; n: number }
  | { kind: 'value'; n: number }
  | { kind: 'none-match' }
  | { kind: 'all-match' }
  | { kind: 'unchanged' }
  | { kind: 'counting' };

/** The query's conditions in display order, groups flattened; index + 1 is a condition's number. */
export function leafConditions(query: FilterQuery): FilterCondition[] {
  const leaves: FilterCondition[] = [];
  const walk = (items: readonly FilterQueryItem[]) => {
    for (const item of items) {
      if (isFilterGroup(item)) walk(item.conditions);
      else leaves.push(item);
    }
  };
  walk(query);
  return leaves;
}

/** A numeric row is never incomplete: with no ends it is the full range (a match-all no-op). */
const isConfigured = (condition: FilterCondition): boolean =>
  !!condition.annotation && (condition.kind === 'numeric' || condition.values.length > 0);

/**
 * A problem with the query's shape, found without counting. A row with an annotation and nothing
 * to match blocks, as does a negated row with no annotation; an untouched row (no annotation, not
 * negated) is a match-all no-op and is ignored. With no configured row at all there is nothing to
 * apply.
 */
function structuralBlock(query: FilterQuery): ApplyBlock | null {
  const leaves = leafConditions(query);
  for (const [index, condition] of leaves.entries()) {
    const n = index + 1;
    if (!condition.annotation) {
      if (condition.logicalOp === 'NOT') return { kind: 'annotation', n };
      continue;
    }
    if (isConfigured(condition)) continue;
    return { kind: 'value', n };
  }
  return leaves.some(isConfigured) ? null : { kind: 'empty' };
}

/**
 * Why Apply is disabled, or null when it is enabled. Structural reasons come first and need no
 * count, so they never wait on the 300 ms evaluation; then a draft equal to the applied filter;
 * then, while `matched` is null (the count is pending), a reasonless `counting` so the text never
 * shows a stale number; then a draft that keeps no protein or every protein.
 */
export function applyBlock({
  query,
  matched,
  total,
  dirty,
}: {
  query: FilterQuery;
  matched: number | null;
  total: number;
  /** null: the host keeps no draft, so "unchanged" never applies. */
  dirty: boolean | null;
}): ApplyBlock | null {
  const structural = structuralBlock(query);
  if (structural) return structural;
  if (dirty === false) return { kind: 'unchanged' };
  if (matched === null) return { kind: 'counting' };
  if (matched === 0) return { kind: 'none-match' };
  if (total > 0 && matched >= total) return { kind: 'all-match' };
  return null;
}

/** The visible reason under the count; empty while counting. */
export function applyBlockText(block: ApplyBlock): string {
  switch (block.kind) {
    case 'empty':
      return 'Choose an annotation to filter by';
    case 'annotation':
      return `Choose an annotation for condition ${block.n}`;
    case 'value':
      return `Choose a value for condition ${block.n}`;
    case 'none-match':
      return 'No proteins match';
    case 'all-match':
      return 'Every protein matches; nothing to filter';
    case 'unchanged':
      return 'No changes to apply';
    case 'counting':
      return '';
  }
}
