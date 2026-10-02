import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  BUNDLE_DELIMITER_BYTES,
  concatenateBuffers,
  DataProcessor,
  generateDatasetHash,
  getProteinAnnotationIndices,
  type VisualizationData,
} from '@protspace/utils';
import { decodeParquetBundle } from './bundle';

/**
 * Missing coordinates, in both bundle readers.
 *
 * Each bundle has a protein one projection does not cover (P1) and a protein with
 * annotations but no coordinates at all (Q). P1 must read as NaN in the projection that
 * misses it, not 0, and must not be plotted there. Q must not be in the protein set,
 * which is what the v2 reader always gave (it built the set from projection rows).
 */

type Column = { name: string; data: unknown[] | Int32Array | Float64Array | Float32Array };

function part(columns: Column[], kv?: Record<string, string>): Uint8Array {
  return new Uint8Array(
    parquetWriteBuffer({
      columnData: columns.map((column) => ({ ...column, nullable: false })) as never,
      statistics: false,
      ...(kv ? { kvMetadata: Object.entries(kv).map(([key, value]) => ({ key, value })) } : {}),
    }),
  );
}

const bundle = (parts: Uint8Array[]): ArrayBuffer =>
  concatenateBuffers(
    parts.map((p) => p.slice().buffer as ArrayBuffer),
    BUNDLE_DELIMITER_BYTES,
  );

const EMPTY = new Uint8Array(0);
const STATISTICS = new Uint8Array(
  readFileSync(new URL('./__fixtures__/stats-sample-statistics.parquet', import.meta.url)),
);

const enc = new TextEncoder();
const i32 = (...values: number[]) => new Uint8Array(new Int32Array(values).buffer);

const organismOf = (data: VisualizationData, protein: string) =>
  getProteinAnnotationIndices(data.annotation_data.organism, data.protein_ids.indexOf(protein)).map(
    (index) => data.annotations.organism.values[index],
  );

const coordinatesOf = (data: VisualizationData, projection: string, protein: string) => {
  const { data: coords, dimension } = data.projections.find((p) => p.name === projection)!;
  const at = data.protein_ids.indexOf(protein) * dimension;
  return Array.from(coords.slice(at, at + dimension));
};

const plottedIds = (data: VisualizationData, projection: string) => {
  const pd = DataProcessor.processVisualizationData(
    data,
    data.projections.findIndex((p) => p.name === projection),
  );
  return Array.from({ length: pd.length }, (_, slot) =>
    pd.originalIndices ? pd.proteinIds[pd.originalIndices[slot]] : pd.proteinIds[slot],
  );
};

// ── v3 ───────────────────────────────────────────────────────────────────────────
//
// Part 1 keeps Q (the file is lossless); part 3 holds NaN wherever a projection does
// not cover a protein, which is what the encoder writes. P1 is missing from A.

function v3Bundle(): ArrayBuffer {
  const manifest = {
    idColumn: 'protein_id',
    columns: {
      organism: { kind: 'categorical' },
      length: { kind: 'numeric', numericType: 'int' },
    },
    projections: [
      { name: 'A', dimension: 2 },
      { name: 'B', dimension: 2 },
    ],
  };
  const annotations = part(
    [
      { name: 'protein_id', data: ['P0', 'P1', 'Q', 'P2'] },
      { name: 'organism', data: new Int32Array([0, 1, 2, 0]) },
      { name: 'length', data: new Float64Array([100, 200, 300, 400]) },
    ],
    { protspace_container_version: '3', protspace_v3_manifest: JSON.stringify(manifest) },
  );
  const metadata = part([
    { name: 'projection_name', data: ['A', 'B'] },
    { name: 'dimensions', data: new Int32Array([2, 2]) },
    { name: 'info_json', data: ['{}', '{}'] },
  ]);
  const projections = part([
    { name: 'A__x', data: new Float32Array([10, NaN, NaN, 30]) },
    { name: 'A__y', data: new Float32Array([11, NaN, NaN, 31]) },
    { name: 'B__x', data: new Float32Array([40, 50, NaN, 60]) },
    { name: 'B__y', data: new Float32Array([41, 51, NaN, 61]) },
  ]);
  const payloads = part([
    { name: 'name', data: ['dict:organism', 'dict:organism:len'] },
    { name: 'data', data: [enc.encode('HumanMouseWorm'), i32(5, 5, 4)] },
  ]);
  return bundle([annotations, metadata, projections, EMPTY, STATISTICS, payloads]);
}

// ── v2 ───────────────────────────────────────────────────────────────────────────
//
// Long-format projection rows: P1 has no row in A, the FIRST projection, and Q has no
// row anywhere. `filler` pads the protein count so the same bundle can be pushed past
// the 10 000-row threshold onto the optimized conversion path.

function v2Bundle(filler: number): ArrayBuffer {
  const fillerIds = Array.from({ length: filler }, (_, i) => `F${i}`);
  const ids = ['P0', 'P1', 'Q', 'P2', ...fillerIds];
  const organisms = ['Human', 'Mouse', 'Worm', 'Human', ...fillerIds.map(() => 'Human')];
  const annotations = part(
    [
      { name: 'protein_id', data: ids },
      { name: 'organism', data: organisms },
    ],
    { protspace_format_version: '2' },
  );
  const metadata = part([
    { name: 'projection_name', data: ['A', 'B'] },
    { name: 'dimensions', data: new Int32Array([2, 2]) },
    { name: 'info_json', data: ['{}', '{}'] },
  ]);

  const rows: { projection: string; id: string; x: number; y: number }[] = [
    { projection: 'A', id: 'P0', x: 10, y: 11 },
    { projection: 'A', id: 'P2', x: 30, y: 31 },
    ...fillerIds.map((id, i) => ({ projection: 'A', id, x: 100 + i, y: 100 + i })),
    { projection: 'B', id: 'P0', x: 40, y: 41 },
    { projection: 'B', id: 'P1', x: 50, y: 51 },
    { projection: 'B', id: 'P2', x: 60, y: 61 },
    ...fillerIds.map((id, i) => ({ projection: 'B', id, x: 100 + i, y: 100 + i })),
  ];
  const projections = part([
    { name: 'projection_name', data: rows.map((row) => row.projection) },
    { name: 'identifier', data: rows.map((row) => row.id) },
    { name: 'x', data: new Float32Array(rows.map((row) => row.x)) },
    { name: 'y', data: new Float32Array(rows.map((row) => row.y)) },
  ]);
  return bundle([annotations, metadata, projections, EMPTY, STATISTICS]);
}

const cases: [string, () => ArrayBuffer][] = [
  ['v3', v3Bundle],
  ['v2', () => v2Bundle(0)],
  ['v2 past the optimized-path threshold', () => v2Bundle(5000)],
];

describe.each(cases)('missing coordinates in a %s bundle', (_label, build) => {
  it('reads a protein a projection does not cover as NaN there, not 0', async () => {
    const { data } = await decodeParquetBundle(build());
    expect(coordinatesOf(data, 'A', 'P1').every(Number.isNaN)).toBe(true);
    expect(coordinatesOf(data, 'B', 'P1')).toEqual([50, 51]);
  });

  it('keeps that protein, with its annotations, in the protein set', async () => {
    const { data } = await decodeParquetBundle(build());
    expect(data.protein_ids).toContain('P1');
    expect(organismOf(data, 'P1')).toEqual(['Mouse']);
    expect(organismOf(data, 'P2')).toEqual(['Human']);
  });

  it('does not plot it in the projection that misses it, and does in the other', async () => {
    const { data } = await decodeParquetBundle(build());
    expect(plottedIds(data, 'A')).not.toContain('P1');
    expect(plottedIds(data, 'B')).toContain('P1');
    const pd = DataProcessor.processVisualizationData(data, 0);
    expect(Array.from(pd.xs).every(Number.isFinite)).toBe(true);
    expect(Array.from(pd.ys).every(Number.isFinite)).toBe(true);
  });

  it('leaves a protein with no coordinates anywhere out of the protein set', async () => {
    const { data } = await decodeParquetBundle(build());
    expect(data.protein_ids).not.toContain('Q');
    expect(data.protein_ids.filter((id) => !id.startsWith('F')).sort()).toEqual(['P0', 'P1', 'P2']);
    // Nothing counts it: no protein carries the label only Q had.
    expect(data.protein_ids.flatMap((id) => organismOf(data, id))).not.toContain('Worm');
    for (const { data: coords, dimension } of data.projections) {
      expect(coords.length).toBe(data.protein_ids.length * dimension);
    }
  });

  it('counts the protein it leaves out, which an export of the dataset cannot carry', async () => {
    expect((await decodeParquetBundle(build())).unplacedProteinCount).toBe(1);
  });

  it('carries the statistics part across the protein-set cut', async () => {
    const { data } = await decodeParquetBundle(build());
    expect(new Uint8Array(data.statistics!)).toEqual(STATISTICS);
    expect(data.statisticsRows!.length).toBeGreaterThan(0);
  });
});

// ── a column's kind, decided by the unplaced protein ──────────────────────────────
//
// v2 inferred a column's kind over the proteins it placed. `size` is numeric there
// (`unknown` is Q's), and `gap` is missing on every placed protein (the `7` is Q's). The
// v3 encoder keeps Q's labels, so `size` is stored as labels marked `placedNumeric`
// and `gap` as labels, which is what `protspace convert` writes for the same cells.

function v2KindBundle(): ArrayBuffer {
  const annotations = part(
    [
      { name: 'protein_id', data: ['P0', 'P1', 'Q', 'P2'] },
      { name: 'size', data: ['10', 'NA', 'unknown', '30'] },
      { name: 'gap', data: ['', '', '7', ''] },
    ],
    { protspace_format_version: '2' },
  );
  const metadata = part([
    { name: 'projection_name', data: ['A'] },
    { name: 'dimensions', data: new Int32Array([2]) },
    { name: 'info_json', data: ['{}'] },
  ]);
  const projections = part([
    { name: 'projection_name', data: ['A', 'A', 'A'] },
    { name: 'identifier', data: ['P0', 'P1', 'P2'] },
    { name: 'x', data: new Float32Array([1, 2, 3]) },
    { name: 'y', data: new Float32Array([4, 5, 6]) },
  ]);
  return bundle([annotations, metadata, projections]);
}

function v3KindBundle(placedNumeric: boolean): ArrayBuffer {
  const manifest = {
    idColumn: 'protein_id',
    columns: {
      size: { kind: 'categorical', sourceType: 'string', ...(placedNumeric && { placedNumeric }) },
      gap: { kind: 'categorical', sourceType: 'string' },
    },
    projections: [{ name: 'A', dimension: 2 }],
  };
  const annotations = part(
    [
      { name: 'protein_id', data: ['P0', 'P1', 'P2', 'Q'] },
      // Labels ranked by the encoder over every row: 10, NA, 30, unknown.
      { name: 'size', data: new Int32Array([0, 1, 2, 3]) },
      { name: 'gap', data: new Int32Array([-1, -1, -1, 0]) },
    ],
    { protspace_container_version: '3', protspace_v3_manifest: JSON.stringify(manifest) },
  );
  const metadata = part([
    { name: 'projection_name', data: ['A'] },
    { name: 'dimensions', data: new Int32Array([2]) },
    { name: 'info_json', data: ['{}'] },
  ]);
  const projections = part([
    { name: 'A__x', data: new Float32Array([1, 2, 3, NaN]) },
    { name: 'A__y', data: new Float32Array([4, 5, 6, NaN]) },
  ]);
  const payloads = part([
    { name: 'name', data: ['dict:size', 'dict:size:len', 'dict:gap', 'dict:gap:len'] },
    {
      name: 'data',
      data: [enc.encode('10NA30unknown'), i32(2, 2, 2, 7), enc.encode('7'), i32(1)],
    },
  ]);
  return bundle([annotations, metadata, projections, EMPTY, EMPTY, payloads]);
}

describe('a column whose kind only an unplaced protein decides', () => {
  it('reads a placedNumeric column as the numbers v2 inferred over the placed proteins', async () => {
    const { data } = await decodeParquetBundle(v3KindBundle(true));
    expect(data.annotations.size).toMatchObject({ kind: 'numeric', numericType: 'int' });
    expect(data.annotations.size.sourceType).toBe('string');
    expect(data.numeric_annotation_data?.size).toEqual(new Float64Array([10, NaN, 30]));
    expect(data.annotation_data.size).toBeUndefined();
  });

  it('gives the dataset, and the hash saved legend settings key on, that v2 gave', async () => {
    const legacy = (await decodeParquetBundle(v2KindBundle())).data;
    const v3 = (await decodeParquetBundle(v3KindBundle(true))).data;

    expect(v3.protein_ids).toEqual(legacy.protein_ids);
    expect(v3.annotations.size.kind).toBe(legacy.annotations.size.kind);
    expect(v3.numeric_annotation_data?.size).toEqual(legacy.numeric_annotation_data?.size);
    expect(v3.annotations.gap).toMatchObject({ kind: 'categorical', values: ['__NA__'] });
    expect(legacy.annotations.gap).toMatchObject({ kind: 'categorical', values: ['__NA__'] });
    expect(generateDatasetHash(v3)).toBe(generateDatasetHash(legacy));
  });

  it('keeps an unmarked column of number labels categorical, as it is stored', async () => {
    const { data } = await decodeParquetBundle(v3KindBundle(false));
    expect(data.annotations.size).toMatchObject({ kind: 'categorical' });
    expect(data.annotations.size.values).toEqual(['10', '30', '__NA__']);
  });
});

describe('the v3 protein-set cut', () => {
  it('slices numeric annotations and projections in step with the protein ids', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());
    expect(data.protein_ids).toEqual(['P0', 'P1', 'P2']);
    expect(data.numeric_annotation_data?.length).toEqual(new Float64Array([100, 200, 400]));
    expect(coordinatesOf(data, 'A', 'P2')).toEqual([30, 31]);
    expect(coordinatesOf(data, 'B', 'P2')).toEqual([60, 61]);
  });
});
