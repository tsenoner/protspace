import type { FilterQuery, FilterQueryItem, NumericCondition } from './query-types';
import { clearLeadingOpInList, isFilterGroup } from './query-types';

/**
 * Locating and replacing every numeric condition targeting one annotation column.
 *
 * The EAT reliability slider used to identify "its" condition by matching the shape
 * `NOT(<eatKey> < X)` on operator and logical op, at the top level only. That made
 * `>`, `between`, a non-negated `<`, and anything nested in a group invisible to it —
 * so a drag appended a second, contradictory condition instead of replacing the first
 * (#380). Matching on the column instead makes every operator recognisable, and
 * recursing makes depth irrelevant.
 *
 * Identity is the column, not a tag the control writes. An eat-confidence column
 * exists *only* to drive the reliability filter — the frontend synthesises it and
 * keeps it out of the colour-by dropdown — so a numeric condition on it is that
 * filter however it was built. A tag would have to be honoured for untagged
 * hand-built conditions anyway, which is precisely the bug this fixes, so it would
 * decide nothing.
 */

/** A numeric condition targeting `annotation`, at this level (groups are walked separately). */
function isConditionFor(item: FilterQueryItem, annotation: string): item is NumericCondition {
  return !isFilterGroup(item) && item.kind === 'numeric' && item.annotation === annotation;
}

/** Every numeric condition on `annotation`, at any depth, in document order. */
export function findConditionsForAnnotation(
  query: FilterQuery,
  annotation: string,
): NumericCondition[] {
  const found: NumericCondition[] = [];
  const walk = (items: readonly FilterQueryItem[]) => {
    for (const item of items) {
      if (isFilterGroup(item)) walk(item.conditions);
      else if (isConditionFor(item, annotation)) found.push(item);
    }
  };
  walk(query);
  return found;
}

/**
 * Leave `next` as the column's only numeric condition, at any depth — or, given
 * `null`, remove the column's conditions entirely. Conditions on a DIFFERENT
 * annotation, and every hand-built condition elsewhere, are preserved untouched.
 *
 * One condition, not a list: a reliability state is always expressible as a single
 * un-negated condition (`conditionsForReliability` emits at most one), so a list
 * parameter would only ever carry zero or one and the queue that served it was
 * machinery no caller could reach.
 *
 * Replacement happens IN PLACE — the condition keeps its slot, its group, and the
 * connector the surrounding query gave it. Stripping and re-appending at the top
 * level instead rewrote `A OR <condition>` into `A AND <condition>`: with the
 * condition gone, `A` became first, and a first item's leading operator is ignored,
 * so the `OR` the user wrote was silently dropped. A `NOT` on the replaced condition
 * is not carried over — the control only ever emits positive conditions, and
 * re-negating one would invert the mode the user just picked.
 *
 * Only the FIRST match is replaced; any further condition on the same column is a
 * duplicate left by an older build and is swept up. With no match at all, `next`
 * joins at the top level.
 *
 * A group left empty by the removal is pruned: `evaluateItems` treats an empty group
 * as match-all, but keeping a visibly empty group in the builder is confusing, and an
 * empty group is never something the user authored.
 */
export function replaceConditionsForAnnotation(
  query: FilterQuery,
  annotation: string,
  next: NumericCondition | null,
): FilterQuery {
  let placed = false;

  const rewrite = (items: readonly FilterQueryItem[]): FilterQueryItem[] => {
    const out: FilterQueryItem[] = [];
    for (const item of items) {
      if (isFilterGroup(item)) {
        const conditions = rewrite(item.conditions);
        if (conditions.length > 0)
          out.push({ ...item, conditions: clearLeadingOpInList(conditions) });
      } else if (isConditionFor(item, annotation)) {
        if (next && !placed) {
          placed = true;
          out.push(
            item.logicalOp === undefined || item.logicalOp === 'NOT'
              ? next
              : { ...next, logicalOp: item.logicalOp },
          );
        }
      } else {
        out.push(item);
      }
    }
    return out;
  };

  const rewritten = rewrite(query);
  if (next && !placed) rewritten.push(next);
  return clearLeadingOpInList(rewritten);
}
