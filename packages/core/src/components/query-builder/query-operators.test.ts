import { describe, expect, it } from 'vitest';
import { createCondition, createGroup, type FilterQuery } from './query-types';
import { ungroup, ungroupChangesResult } from './query-operators';
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
