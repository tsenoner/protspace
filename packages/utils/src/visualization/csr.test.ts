import { describe, it, expect } from 'vitest';
import { gatherCsr, remapCsr, syntheticHit } from './csr';
import type { CsrAnnotationData } from '../types';

// rows: 0 -> [0, 1], 1 -> [], 2 -> [2], 3 -> [1, 0]
// Every hit carries a distinct score run and evidence code, so any misalignment shows.
const source = (): CsrAnnotationData => ({
  kind: 'csr',
  offsets: Int32Array.of(0, 2, 2, 3, 5),
  codes: Int32Array.of(0, 1, 2, 1, 0),
  length: 4,
  // hit 0 -> [10], hit 1 -> [], hit 2 -> [20, 21], hit 3 -> [30], hit 4 -> [40]
  scores: {
    offsets: Int32Array.of(0, 1, 1, 3, 4, 5),
    values: Float64Array.of(10, 20, 21, 30, 40),
  },
  evidence: { codes: Int32Array.of(0, 1, -1, 2, 0), dict: ['IDA', 'IEA', 'ISS'] },
});

/** Every hit of a column as `[code, scores, evidence]`, row by row. */
function rowsOf(column: CsrAnnotationData) {
  const rows = [];
  for (let row = 0; row < column.length; row++) {
    const hits = [];
    for (let hit = column.offsets[row]; hit < column.offsets[row + 1]; hit++) {
      const scores = column.scores
        ? Array.from(
            column.scores.values.subarray(
              column.scores.offsets[hit],
              column.scores.offsets[hit + 1],
            ),
          )
        : null;
      const evidence = column.evidence
        ? (column.evidence.dict[column.evidence.codes[hit]] ?? null)
        : null;
      hits.push([column.codes[hit], scores, evidence]);
    }
    rows.push(hits);
  }
  return rows;
}

describe('gatherCsr', () => {
  it('carries each copied hit with its own score run and evidence', () => {
    // Row order reversed, row 0 kept only for its second hit.
    const out = gatherCsr(source(), {
      offsets: Int32Array.of(0, 2, 3, 3),
      hits: Int32Array.of(3, 4, 2),
    });
    expect(out.length).toBe(3);
    expect(rowsOf(out)).toEqual([
      [
        [1, [30], 'ISS'],
        [0, [40], 'IDA'],
      ],
      [[2, [20, 21], null]],
      [],
    ]);
    expect(Array.from(out.scores!.offsets)).toEqual([0, 1, 2, 4]);
  });

  it('gives a synthetic hit its code and neither score nor evidence', () => {
    const out = gatherCsr(source(), {
      offsets: Int32Array.of(0, 1, 3),
      hits: Int32Array.of(syntheticHit(7), 0, syntheticHit(0)),
    });
    expect(rowsOf(out)).toEqual([
      [[7, [], null]],
      [
        [0, [10], 'IDA'],
        [0, [], null],
      ],
    ]);
    expect(Array.from(out.evidence!.codes)).toEqual([-1, 0, -1]);
  });

  it('renumbers copied codes through remap but not synthetic ones', () => {
    const out = gatherCsr(
      source(),
      { offsets: Int32Array.of(0, 2), hits: Int32Array.of(2, syntheticHit(2)) },
      Int32Array.of(5, 6, 7),
    );
    expect(Array.from(out.codes)).toEqual([7, 2]);
  });

  it('adds no payloads the source does not carry', () => {
    const { offsets, codes, length } = source();
    const bare: CsrAnnotationData = { kind: 'csr', offsets, codes, length };
    const out = gatherCsr(bare, { offsets: Int32Array.of(0, 1), hits: Int32Array.of(1) });
    expect('scores' in out).toBe(false);
    expect('evidence' in out).toBe(false);
  });

  it('writes fresh buffers', () => {
    const src = source();
    const out = gatherCsr(src, { offsets: Int32Array.of(0, 1), hits: Int32Array.of(0) });
    expect(out.codes.buffer).not.toBe(src.codes.buffer);
    expect(out.scores!.values.buffer).not.toBe(src.scores!.values.buffer);
  });

  it('rejects a plan whose offsets do not span its hits', () => {
    expect(() =>
      gatherCsr(source(), { offsets: Int32Array.of(0, 1), hits: Int32Array.of(0, 1) }),
    ).toThrow(/offsets/);
  });
});

describe('remapCsr', () => {
  it('returns the source itself when there is nothing to change', () => {
    const src = source();
    expect(remapCsr(src, null)).toEqual({ column: src, filledRows: 0 });
    expect(remapCsr(src, null).column).toBe(src);
  });

  it('drops hits with their payloads and keeps the rest aligned', () => {
    // Code 1 goes; 0 and 2 swap numbers.
    const { column, filledRows } = remapCsr(source(), Int32Array.of(2, -1, 0));
    expect(filledRows).toBe(0);
    expect(rowsOf(column)).toEqual([
      [[2, [10], 'IDA']],
      [],
      [[0, [20, 21], null]],
      [[2, [40], 'IDA']],
    ]);
    expect(Array.from(column.scores!.values)).toEqual([10, 20, 21, 40]);
  });

  it('fills every row left without a hit, whether it lost its hits or never had one', () => {
    // Codes 0 and 1 go: rows 0 and 3 lose everything, row 1 was empty to begin with.
    const { column, filledRows } = remapCsr(source(), Int32Array.of(-1, -1, 0), 9);
    expect(filledRows).toBe(3);
    expect(rowsOf(column)).toEqual([
      [[9, [], null]],
      [[9, [], null]],
      [[0, [20, 21], null]],
      [[9, [], null]],
    ]);
  });

  it('fills empty rows without a remap', () => {
    const { column, filledRows } = remapCsr(source(), null, 3);
    expect(filledRows).toBe(1);
    expect(rowsOf(column)[1]).toEqual([[3, [], null]]);
    expect(rowsOf(column)[3]).toEqual([
      [1, [30], 'ISS'],
      [0, [40], 'IDA'],
    ]);
  });
});
