import type { FilterCondition, FilterGroup, FilterQuery, FilterQueryItem } from './query-types';
import { isFilterGroup } from './query-types';
import { cardOf, itemJoiner } from './query-operators';
import { evaluateQueryExcluding, hasConfiguredCondition } from './query-evaluate';
import type { ProtspaceData } from './types';

/**
 * A card's count base: the proteins its values are counted among, null for the whole dataset. A
 * card joined with "or" adds proteins from anywhere its list reaches, so it counts over its list's
 * base; so does the first card of an "or" list. A card joined with "and" (or "and not") counts
 * inside what the rest of its list keeps. A group passes its own base down to its cards, worked
 * out by the same rule; the top-level list's base is the whole dataset.
 *
 * Only an open value list reads a base, so it is worked out for one card at a time: the walk
 * evaluates the lists on the way to that card and no other. undefined: no card has the id `id`.
 */
export function countBase(
  query: FilterQuery,
  data: ProtspaceData,
  id: string,
): Set<number> | null | undefined {
  const walk = (
    items: FilterQuery,
    context: Set<number> | null,
  ): Set<number> | null | undefined => {
    for (const [index, item] of items.entries()) {
      const card = cardOf(item, index === 0);
      if (card ? card.condition.id !== id : !holdsCard(item as FilterGroup, id)) continue;
      const base = itemBase(items, index, context, data);
      return card ? base : walk((item as FilterGroup).conditions, base);
    }
    return undefined;
  };
  return walk(query, null);
}

/** The base the item at `index` of `items` counts among, inside its list's `context`. */
function itemBase(
  items: FilterQuery,
  index: number,
  context: Set<number> | null,
  data: ProtspaceData,
): Set<number> | null {
  const item = items[index];
  const orJoined =
    itemJoiner(item, index) === 'OR' ||
    (index === 0 && items.length > 1 && itemJoiner(items[1], 1) === 'OR');
  if (orJoined || !hasConfiguredCondition(items.filter((_, i) => i !== index))) return context;
  const rest = evaluateQueryExcluding(items, data, item.id);
  if (!context) return rest;
  const base = new Set<number>();
  for (const i of rest) if (context.has(i)) base.add(i);
  return base;
}

/** The group holds the card `id`, at any depth. */
function holdsCard(group: FilterGroup, id: string): boolean {
  return group.conditions.some((item, index) => {
    const card = cardOf(item, index === 0);
    return card ? card.condition.id === id : holdsCard(item as FilterGroup, id);
  });
}

/**
 * What the card `id`'s count base depends on: the query with that card reduced to its place and
 * its joiner ("and" or "or"; "and not" counts as "and"). Two queries with the same key give the
 * card the same base, so ticking values in the card's own list does not count it again.
 */
export function countBaseKey(query: FilterQuery, id: string): FilterQuery {
  const mask = (items: FilterQuery): FilterQueryItem[] =>
    items.map((item, index) => {
      const card = cardOf(item, index === 0);
      if (card) {
        if (card.condition.id !== id) return item;
        const place: FilterCondition = {
          id,
          kind: 'categorical',
          annotation: '',
          values: [],
          logicalOp: itemJoiner(item, index),
        };
        return place;
      }
      return isFilterGroup(item) ? { ...item, conditions: mask(item.conditions) } : item;
    });
  return mask(query);
}
