import { describe, expect, it } from 'vitest';
import { applyBlock, applyBlockText, leafConditions, type ApplyBlock } from './query-apply-state';
import { createCondition, createGroup, createNumericCondition } from './query-types';
import type { FilterQuery } from './query-types';

const human = () => createCondition({ annotation: 'organism', values: ['Human'] });
const ready = { matched: 2, total: 5, dirty: true };

describe('leafConditions', () => {
  it('numbers group leaves in display order', () => {
    const a = human();
    const b = createCondition({ annotation: 'organism', values: ['Mouse'] });
    const c = createCondition();
    const query: FilterQuery = [a, createGroup({ conditions: [b, c] })];
    expect(leafConditions(query).map((leaf) => leaf.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('applyBlock', () => {
  it('is null for a configured, changed draft that filters some proteins', () => {
    expect(applyBlock({ query: [human()], ...ready })).toBeNull();
  });

  it('says empty when no row is configured', () => {
    expect(applyBlock({ query: [], ...ready })).toEqual({ kind: 'empty' });
    expect(applyBlock({ query: [createCondition()], ...ready })).toEqual({ kind: 'empty' });
  });

  it('ignores an untouched seeded row beside a configured one', () => {
    expect(
      applyBlock({ query: [human(), createCondition({ logicalOp: 'AND' })], ...ready }),
    ).toBeNull();
  });

  it('asks for an annotation on a negated row without one', () => {
    expect(
      applyBlock({ query: [human(), createCondition({ logicalOp: 'NOT' })], ...ready }),
    ).toEqual({ kind: 'annotation', n: 2 });
  });

  it('an annotation without a value blocks with its number', () => {
    const query: FilterQuery = [
      human(),
      createGroup({ conditions: [createCondition({ annotation: 'organism' })] }),
    ];
    expect(applyBlock({ query, ...ready })).toEqual({ kind: 'value', n: 2 });
  });

  it('asks for a number on a numeric row without a bound or a presence chip', () => {
    const numeric = createNumericCondition({ annotation: 'length' });
    expect(applyBlock({ query: [numeric], ...ready })).toEqual({ kind: 'bound', n: 1 });
    const presence = createNumericCondition({ annotation: 'length', presence: ['__NA__'] });
    expect(applyBlock({ query: [presence], ...ready })).toBeNull();
  });

  it('structural reasons win over count reasons and over counting', () => {
    const query: FilterQuery = [createCondition({ annotation: 'organism' })];
    for (const matched of [null, 0, 5]) {
      expect(applyBlock({ query, matched, total: 5, dirty: true })).toEqual({
        kind: 'value',
        n: 1,
      });
    }
    expect(applyBlock({ query, matched: null, total: 5, dirty: false })).toEqual({
      kind: 'value',
      n: 1,
    });
  });

  it('null dirty (a host without a draft) never blocks as unchanged', () => {
    expect(applyBlock({ query: [human()], matched: 2, total: 5, dirty: null })).toBeNull();
    expect(applyBlock({ query: [human()], matched: null, total: 5, dirty: null })).toEqual({
      kind: 'counting',
    });
  });

  it('is unchanged when not dirty, before the count is read', () => {
    expect(applyBlock({ query: [human()], matched: null, total: 5, dirty: false })).toEqual({
      kind: 'unchanged',
    });
    expect(applyBlock({ query: [human()], matched: 2, total: 5, dirty: false })).toEqual({
      kind: 'unchanged',
    });
  });

  it('waits for the count, then refuses no match and every match', () => {
    const query: FilterQuery = [human()];
    expect(applyBlock({ query, matched: null, total: 5, dirty: true })).toEqual({
      kind: 'counting',
    });
    expect(applyBlock({ query, matched: 0, total: 5, dirty: true })).toEqual({
      kind: 'none-match',
    });
    expect(applyBlock({ query, matched: 5, total: 5, dirty: true })).toEqual({
      kind: 'all-match',
    });
  });
});

describe('applyBlockText', () => {
  it.each<[ApplyBlock, string]>([
    [{ kind: 'empty' }, 'Choose an annotation to filter by'],
    [{ kind: 'annotation', n: 3 }, 'Choose an annotation for condition 3'],
    [{ kind: 'value', n: 2 }, 'Choose a value for condition 2'],
    [{ kind: 'bound', n: 1 }, 'Enter a number for condition 1'],
    [{ kind: 'none-match' }, 'No proteins match'],
    [{ kind: 'all-match' }, 'Every protein matches; nothing to filter'],
    [{ kind: 'unchanged' }, 'No changes to apply'],
    [{ kind: 'counting' }, ''],
  ])('%j reads %j', (block, text) => {
    expect(applyBlockText(block)).toBe(text);
  });
});
