import { describe, expect, it } from 'vitest';
import {
  createCondition,
  createGroup,
  createNumericCondition,
  type FilterGroup,
  type FilterQuery,
} from './query-types';
import {
  cardOf,
  duplicateCard,
  groupRun,
  isMixed,
  joinerWouldMix,
  nextJoiner,
  operatorOf,
  removeCard,
  replaceCondition,
  setJoiner,
  setJoinerForAll,
  setOperator,
  shownJoiner,
  ungroup,
  ungroupChangesResult,
} from './query-operators';
import { evaluateQuery } from './query-evaluate';
import type { ProtspaceData } from './types';

// P1 = Human/a, P2 = Mouse/b, P3 = Human/b, P4 = Mouse/a
const data: ProtspaceData = {
  protein_ids: ['P1', 'P2', 'P3', 'P4'],
  annotations: { organism: { values: ['Human', 'Mouse'] }, family: { values: ['a', 'b'] } },
  annotation_data: {
    organism: [[0], [1], [0], [1]],
    family: [[0], [1], [1], [0]],
  },
};

const card = (annotation: string, value: string, logicalOp?: 'AND' | 'OR') =>
  createCondition({ annotation, values: [value], logicalOp });

describe('ungroup', () => {
  it('leaves a group whose items join differently from it, so the result holds', () => {
    // Human or (Mouse and a): ungrouped it would read (Human or Mouse) and a.
    const group = createGroup({
      logicalOp: 'OR',
      conditions: [card('organism', 'Mouse'), card('family', 'a', 'AND')],
    });
    const query: FilterQuery = [card('organism', 'Human'), group];
    expect(ungroupChangesResult(query, group.id)).toBe(true);
    const after = ungroup(query, group.id);
    expect(evaluateQuery(after, data)).toEqual(evaluateQuery(query, data));
    expect(after).toBe(query);
  });

  it('flattens a group joined the same way inside and out, with the same result', () => {
    const group = createGroup({
      logicalOp: 'OR',
      conditions: [card('organism', 'Mouse'), card('family', 'a', 'OR')],
    });
    const query: FilterQuery = [card('organism', 'Human'), group];
    expect(ungroupChangesResult(query, group.id)).toBe(false);
    const after = ungroup(query, group.id);
    expect(after).toHaveLength(3);
    expect(evaluateQuery(after, data)).toEqual(evaluateQuery(query, data));
  });

  it('flattens a first group whatever its items are joined by', () => {
    const group = createGroup({
      conditions: [card('organism', 'Mouse'), card('family', 'a', 'OR')],
    });
    const query: FilterQuery = [group, card('organism', 'Human', 'AND')];
    expect(ungroupChangesResult(query, group.id)).toBe(false);
    const after = ungroup(query, group.id);
    expect(after).toHaveLength(3);
    expect(evaluateQuery(after, data)).toEqual(evaluateQuery(query, data));
  });
});

describe('the joiner "and not"', () => {
  // P1 = Human/a, P2 = Mouse/b, P3 = Human/b, P4 = Mouse/a, P5 = Human with no family.
  const withLength: ProtspaceData = {
    protein_ids: ['P1', 'P2', 'P3', 'P4', 'P5'],
    annotations: {
      organism: { values: ['Human', 'Mouse'] },
      family: { values: ['a', 'b'] },
      length: { kind: 'numeric', values: [] },
    },
    annotation_data: {
      organism: [[0], [1], [0], [1], [0]],
      family: [[0], [1], [1], [0], []],
    },
    numeric_annotation_data: { length: new Float64Array([50, 80, 120, 200, 300]) },
  };
  const ids = (query: FilterQuery) =>
    [...evaluateQuery(query, withLength)].map((i) => withLength.protein_ids![i]).sort();
  const length = (min: number, max: number) =>
    createNumericCondition({ annotation: 'length', min, max, presence: [], logicalOp: 'AND' });
  /** The joiner each item of `items` shows, as its pill reads. */
  const shown = (items: FilterQuery) => items.map((item, i) => shownJoiner(item, i));
  const inner = (item: FilterQuery[number]) => (item as FilterGroup).conditions;

  it("keeps what the cards above match without the card's matches", () => {
    const human = card('organism', 'Human');
    const famA = card('family', 'a', 'AND');
    const query = setJoiner([human, famA], famA.id, 'NOT');
    expect(shown(query)).toEqual([undefined, 'NOT']);
    // Human (P1, P3, P5) without family a (P1). P5 has no family, and NOT keeps only proteins
    // with a value, as "is none of" does.
    expect(ids(query)).toEqual(['P3']);
    // The card shows the same condition, its operator untouched.
    const shownCard = cardOf(query[1], false)!;
    expect(shownCard.joiner).toBe('NOT');
    expect(shownCard.condition).toMatchObject({ id: famA.id, values: ['a'] });
    expect(operatorOf(shownCard.condition)).toBe('any-of');
  });

  it('is not "is none of": the two read differently and can be combined', () => {
    const human = card('organism', 'Human');
    const famA = card('family', 'a', 'AND');
    const noneOf = setOperator([human, famA], famA.id, 'none-of');
    const both = setJoiner(noneOf, famA.id, 'NOT');
    expect(shown(noneOf)).toEqual([undefined, 'AND']);
    expect(shown(both)).toEqual([undefined, 'NOT']);
    expect(operatorOf(cardOf(both[1], false)!.condition)).toBe('none-of');
    // Human and not (family is none of a): the Human proteins of family a.
    expect(ids(both)).toEqual(['P1']);
  });

  it('works on a numeric card', () => {
    const human = card('organism', 'Human');
    const len = length(60, 150);
    const query = setJoiner([human, len], len.id, 'NOT');
    expect(shown(query)).toEqual([undefined, 'NOT']);
    // Human (P1 50, P3 120, P5 300) without the lengths from 60 to 150.
    expect(ids(query)).toEqual(['P1', 'P5']);
  });

  it('works on a group', () => {
    const human = card('organism', 'Human');
    const group = createGroup({
      logicalOp: 'AND',
      conditions: [card('family', 'a'), card('organism', 'Mouse', 'OR')],
    });
    const query = setJoiner([human, group], group.id, 'NOT');
    expect(shown(query)).toEqual([undefined, 'NOT']);
    // Human without (family a or Mouse): P3, and P5, which has an organism.
    expect(ids(query)).toEqual(['P3', 'P5']);
    expect(shown(setJoiner(query, group.id, 'AND'))).toEqual([undefined, 'AND']);
    expect(shown(setJoiner(query, group.id, 'OR'))).toEqual([undefined, 'OR']);
  });

  it('"and" or "or" picked for the card drop it; an operator or value edit keeps it', () => {
    const human = card('organism', 'Human');
    const famA = card('family', 'a', 'AND');
    const query = setJoiner([human, famA], famA.id, 'NOT');
    expect(setJoiner(query, famA.id, 'AND')).toEqual([human, famA]);
    expect(shown(setJoiner(query, famA.id, 'OR'))).toEqual([undefined, 'OR']);
    expect(shown(setOperator(query, famA.id, 'has-any'))).toEqual([undefined, 'NOT']);
    const edited = replaceCondition(query, { ...famA, values: ['a', 'b'] });
    expect(shown(edited)).toEqual([undefined, 'NOT']);
    expect(cardOf(edited[1], false)!.condition).toMatchObject({ values: ['a', 'b'] });
  });

  it('is in the "and" family: it mixes with "or", not with "and"', () => {
    const human = card('organism', 'Human');
    const famA = card('family', 'a', 'AND');
    const famB = card('family', 'b', 'AND');
    expect(joinerWouldMix([human, famA, famB], famA.id, 'NOT')).toBe(false);
    expect(isMixed(setJoiner([human, famA, famB], famA.id, 'NOT'))).toBe(false);
    const orB = card('family', 'b', 'OR');
    expect(joinerWouldMix([human, card('family', 'a', 'OR'), orB], orB.id, 'NOT')).toBe(true);
  });

  it('"Use “and” for all" keeps it on the card it was picked for', () => {
    const len = { ...length(60, 150), logicalOp: 'OR' as const };
    const query: FilterQuery = [card('organism', 'Human'), card('family', 'a', 'OR'), len];
    expect(shown(setJoinerForAll(query, len.id, 'NOT'))).toEqual([undefined, 'AND', 'NOT']);
  });

  it('a card keeps its meaning under "Use “or” for all", in a group of its own', () => {
    const famA = card('family', 'a', 'AND');
    const famB = card('family', 'b', 'AND');
    const query = setJoiner([card('organism', 'Human'), famA, famB], famA.id, 'NOT');
    const all = setJoinerForAll(query, famB.id, 'OR');
    expect(shown(all)).toEqual([undefined, 'OR', 'OR']);
    expect(shown(inner(all[1]))).toEqual(['NOT']);
  });

  it('"Group these" keeps the NOT on its card: "A and not B or C" groups as "A and (not B or C)"', () => {
    const famA = card('family', 'a', 'AND');
    const mouse = card('organism', 'Mouse', 'AND');
    const query = setJoiner([card('organism', 'Human'), famA, mouse], famA.id, 'NOT');
    const grouped = groupRun(query, mouse.id, 'OR');
    expect(shown(grouped)).toEqual([undefined, 'AND']);
    expect(shown(inner(grouped[1]))).toEqual(['NOT', 'OR']);
  });

  it('"Group these" for "and not" picked in an "or" list groups the card with the one above', () => {
    const famA = card('family', 'a', 'OR');
    const mouse = card('organism', 'Mouse', 'OR');
    const grouped = groupRun([card('organism', 'Human'), famA, mouse], mouse.id, 'NOT');
    expect(shown(grouped)).toEqual([undefined, 'OR']);
    expect(shown(inner(grouped[1]))).toEqual([undefined, 'NOT']);
  });

  it('stays on a card that becomes first, which reads "not"; removing it there clears it', () => {
    const human = card('organism', 'Human');
    const famA = card('family', 'a', 'AND');
    const query = removeCard(setJoiner([human, famA], famA.id, 'NOT'), human.id);
    expect(shown(query)).toEqual(['NOT']);
    // Not family a: P2, P3 (P5 has no family).
    expect(ids(query)).toEqual(['P2', 'P3']);
    const cleared = setJoiner(query, famA.id, 'AND');
    expect(shown(cleared)).toEqual([undefined]);
    expect(ids(cleared)).toEqual(['P1', 'P4']);
  });

  it('a copy of a negated card is negated too, first or not', () => {
    const famA = card('family', 'a', 'AND');
    const query = setJoiner([card('organism', 'Human'), famA], famA.id, 'NOT');
    expect(shown(duplicateCard(query, famA.id, 'copy'))).toEqual([undefined, 'NOT', 'NOT']);
    const first = setJoiner([famA], famA.id, 'NOT');
    expect(shown(duplicateCard(first, famA.id, 'copy'))).toEqual(['NOT', 'NOT']);
  });

  it('a new card after it joins with "and"', () => {
    const famA = card('family', 'a', 'AND');
    expect(nextJoiner(setJoiner([card('organism', 'Human'), famA], famA.id, 'NOT'))).toBe('AND');
  });

  it('reads a NOT on a numeric condition, from before "and not" had its own group, as "and not"', () => {
    const human = card('organism', 'Human');
    const len = { ...length(60, 150), logicalOp: 'NOT' as const };
    expect(shown([human, len])).toEqual([undefined, 'NOT']);
    // An edit stores it the current way, with the same result.
    const edited = replaceCondition([human, len], { ...len, min: 60 });
    expect(shown(edited)).toEqual([undefined, 'NOT']);
    expect(ids(edited)).toEqual(ids([human, len]));
  });
});
