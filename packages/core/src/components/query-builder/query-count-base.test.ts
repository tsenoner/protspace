import { describe, expect, it } from 'vitest';
import { NA_VALUE } from '@protspace/utils';
import { countBase, countBaseKey } from './query-count-base';
import { cardOf, itemJoiner, setJoiner, setOperator } from './query-operators';
import { evaluateQueryExcluding, hasConfiguredCondition } from './query-evaluate';
import { sameQuery } from './query-equal';
import { leafConditions } from './query-apply-state';
import {
  createCondition,
  createGroup,
  createNumericCondition,
  type FilterGroup,
  type FilterQuery,
  type FilterQueryItem,
} from './query-types';
import type { ProtspaceData } from './types';

/**
 * Every card's base worked out at once, on every edit: the builder's algorithm before bases were
 * worked out for an open value list only. `countBase` must give each card the same base.
 */
function eagerBases(query: FilterQuery, data: ProtspaceData): Map<string, Set<number> | null> {
  const bases = new Map<string, Set<number> | null>();
  const walk = (items: FilterQueryItem[], context: Set<number> | null) => {
    items.forEach((item, index) => {
      const orJoined =
        itemJoiner(item, index) === 'OR' ||
        (index === 0 && items.length > 1 && itemJoiner(items[1], 1) === 'OR');
      let base = context;
      if (!orJoined && hasConfiguredCondition(items.filter((_, i) => i !== index))) {
        const rest = evaluateQueryExcluding(items, data, item.id);
        base = context ? new Set([...rest].filter((i) => context.has(i))) : rest;
      }
      const card = cardOf(item, index === 0);
      if (card) bases.set(card.condition.id, base);
      else walk((item as FilterGroup).conditions, base);
    });
  };
  walk(query, null);
  return bases;
}

// Eight proteins: organism, family (P7 has none) and length (P6 has none).
const data: ProtspaceData = {
  protein_ids: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
  annotations: {
    organism: { kind: 'categorical', values: ['Human', 'Mouse', 'Yeast'] },
    family: { kind: 'categorical', values: ['a', 'b', null] },
    length: { kind: 'numeric', values: [] },
  },
  annotation_data: {
    organism: [[0], [1], [0], [1], [2], [2], [0], [1]],
    family: [[0], [1], [1], [0], [0], [1], [0, 1], [2]],
  },
  // NaN is a missing value.
  numeric_annotation_data: {
    length: new Float64Array([50, 80, 120, 200, 90, 60, NaN, 300]),
  },
};

const organism = (values: string[], logicalOp?: 'AND' | 'OR') =>
  createCondition({ annotation: 'organism', values, logicalOp });
const family = (values: string[], logicalOp?: 'AND' | 'OR') =>
  createCondition({ annotation: 'family', values, logicalOp });
const length = (min: number | null, max: number | null, logicalOp?: 'AND' | 'OR') =>
  createNumericCondition({ annotation: 'length', min, max, presence: [], logicalOp });
/** `item` with the joiner "and not". */
const andNot = (query: FilterQuery, id: string) => setJoiner(query, id, 'NOT');

/** Queries of every shape the builder writes. */
function shapes(): [string, FilterQuery][] {
  const human = organism(['Human']);
  const famB = family(['b'], 'AND');
  const len = length(70, 250, 'AND');
  const orFam = family(['a'], 'OR');
  const group = createGroup({
    logicalOp: 'AND',
    conditions: [organism(['Mouse']), family(['a'], 'OR')],
  });
  const orGroup = createGroup({
    logicalOp: 'OR',
    conditions: [family(['b']), length(null, 100, 'AND')],
  });
  const nested = createGroup({
    logicalOp: 'AND',
    conditions: [
      organism(['Yeast', 'Mouse']),
      createGroup({ logicalOp: 'AND', conditions: [length(60, null), family(['a'], 'OR')] }),
    ],
  });
  const plain: FilterQuery = [human, famB, len];
  return [
    ['one card', [human]],
    ['and', plain],
    ['or', [human, orFam]],
    ['mixed', [human, famB, orFam]],
    ['an "or" group joined with "and"', [human, group]],
    ['a group joined with "or"', [human, len, orGroup]],
    ['nested groups', [human, nested, len]],
    ['"is none of" under "or"', setOperator([human, orFam], orFam.id, 'none-of')],
    ['"is none of" under "and"', setOperator(plain, famB.id, 'none-of')],
    ['"and not" on a categorical card', andNot(plain, famB.id)],
    ['"and not" on a numeric card', andNot(plain, len.id)],
    ['"and not" on a group', andNot([human, group], group.id)],
    [
      '"and not" inside a group',
      [human, { ...group, conditions: andNot(group.conditions, group.conditions[1].id) }],
    ],
    ['a first card with "not"', andNot(plain, human.id)],
    ['an empty card', [human, createCondition({ logicalOp: 'AND' }), len]],
    ['N/A', [family([NA_VALUE]), len]],
  ];
}

describe('countBase', () => {
  for (const [name, query] of shapes()) {
    it(`gives every card the base the eager count gave it: ${name}`, () => {
      const eager = eagerBases(query, data);
      expect(eager.size).toBe(leafConditions(query).length);
      for (const [id, expected] of eager) {
        const base = countBase(query, data, id);
        expect(base === null ? null : [...base!].sort(), id).toEqual(
          expected === null ? null : [...expected].sort(),
        );
      }
    });
  }

  it('is undefined for a card the query does not hold', () => {
    expect(countBase([organism(['Human'])], data, 'missing')).toBeUndefined();
  });
});

describe('countBaseKey', () => {
  const human = organism(['Human']);
  const len = length(70, 250, 'AND');
  const query: FilterQuery = [human, len];

  it("is the same when only the card's own values change", () => {
    const ticked: FilterQuery = [{ ...human, values: ['Human', 'Mouse'] }, len];
    expect(sameQuery(countBaseKey(query, human.id), countBaseKey(ticked, human.id))).toBe(true);
    // ... and so is "is none of", which the card's own base does not read.
    const noneOf = setOperator(query, human.id, 'none-of');
    expect(sameQuery(countBaseKey(query, human.id), countBaseKey(noneOf, human.id))).toBe(true);
  });

  it('differs when another card changes', () => {
    const other: FilterQuery = [human, { ...len, min: 100 }];
    expect(sameQuery(countBaseKey(query, human.id), countBaseKey(other, human.id))).toBe(false);
  });

  it('differs when the card moves between "and" and "or", not between "and" and "and not"', () => {
    const or = setJoiner(query, len.id, 'OR');
    const not = setJoiner(query, len.id, 'NOT');
    expect(sameQuery(countBaseKey(query, len.id), countBaseKey(or, len.id))).toBe(false);
    expect(sameQuery(countBaseKey(query, len.id), countBaseKey(not, len.id))).toBe(true);
  });
});
