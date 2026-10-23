import { describe, expect, it } from 'vitest';
import { queryChanges, sameQuery } from './query-equal';
import type { FilterQuery } from './query-types';

const organism = (values: string[], id = 'a'): FilterQuery[number] => ({
  id,
  kind: 'categorical',
  annotation: 'organism',
  values,
});
const length = (min: number | null, id = 'n'): FilterQuery[number] => ({
  id,
  kind: 'numeric',
  annotation: 'length',
  operator: 'gt',
  min,
  max: null,
  presence: [],
});

describe('sameQuery', () => {
  it('is true for equal trees built separately', () => {
    const a: FilterQuery = [organism(['Human']), { id: 'g', conditions: [length(5)] }];
    const b: FilterQuery = [organism(['Human']), { id: 'g', conditions: [length(5)] }];
    expect(sameQuery(a, b)).toBe(true);
    expect(sameQuery([], [])).toBe(true);
  });

  it('sees a changed value, bound or presence, and reads an older operator as its range', () => {
    expect(sameQuery([organism(['Human'])], [organism(['Mouse'])])).toBe(false);
    expect(sameQuery([length(5)], [length(6)])).toBe(false);
    expect(
      sameQuery(
        [length(5)],
        [{ ...(length(5) as object), presence: ['__NA__'] } as FilterQuery[number]],
      ),
    ).toBe(false);
    expect(
      sameQuery(
        [length(5)],
        [{ ...(length(5) as object), operator: 'gte' } as FilterQuery[number]],
      ),
    ).toBe(true);
  });

  it('sees a changed id or logical operator', () => {
    expect(sameQuery([organism(['Human'], 'a')], [organism(['Human'], 'b')])).toBe(false);
    expect(
      sameQuery(
        [organism(['Human'])],
        [{ ...(organism(['Human']) as object), logicalOp: 'NOT' } as FilterQuery[number]],
      ),
    ).toBe(false);
  });

  it('compares group nesting', () => {
    const grouped: FilterQuery = [{ id: 'g', conditions: [organism(['Human'])] }];
    expect(sameQuery(grouped, [organism(['Human'])])).toBe(false);
    expect(sameQuery(grouped, [{ id: 'g', conditions: [organism(['Mouse'])] }])).toBe(false);
  });

  it('treats item order as meaningful', () => {
    expect(
      sameQuery([organism(['Human'], 'a'), length(5)], [length(5), organism(['Human'], 'a')]),
    ).toBe(false);
  });

  it('ignores the order of a condition’s values and presence chips', () => {
    expect(sameQuery([organism(['Human', 'Mouse'])], [organism(['Mouse', 'Human'])])).toBe(true);
    expect(sameQuery([organism(['Human', 'Human'])], [organism(['Human', 'Mouse'])])).toBe(false);
    const withPresence = (presence: string[]) =>
      ({ ...(length(5) as object), presence }) as FilterQuery[number];
    expect(
      sameQuery([withPresence(['__NA__', '__ANY__'])], [withPresence(['__ANY__', '__NA__'])]),
    ).toBe(true);
  });

  it('counts no change after a value is unticked and ticked again', () => {
    expect(queryChanges([organism(['Mouse', 'Human'])], [organism(['Human', 'Mouse'])]).count).toBe(
      0,
    );
  });
});
