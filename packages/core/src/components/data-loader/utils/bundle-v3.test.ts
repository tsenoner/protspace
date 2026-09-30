import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { parquetMetadata } from 'hyparquet';
import {
  BUNDLE_DELIMITER_BYTES,
  concatenateBuffers,
  getProteinAnnotationIndices,
  getProteinEvidence,
  getProteinScores,
  isCsrAnnotationData,
  NA_DEFAULT_COLOR,
  NA_VALUE,
  type CsrAnnotationData,
  type VisualizationData,
} from '@protspace/utils';
import { decodeParquetBundle, extractRowsFromParquetBundle } from './bundle';
import { readV3Bundle } from './bundle-v3';
import { splitBundleParts } from './bundle-parts';
import { collectTransferables } from '../decode-transferables';
import { bulkViews } from '../bulk-views.test-support';

/**
 * Format v3 reader tests.
 *
 * The fixtures are synthesised here rather than produced by the Python encoder, so the
 * cases the encoder cannot easily be talked into (a corrupt manifest, a hit count that
 * disagrees with its payload) are reachable. Everything they assert was first checked
 * against real `encode_v3` output — see the equivalence suite for the producer-written
 * side of the contract.
 *
 * Byte layout notes that the fixtures depend on:
 *  - lengths on the wire are PER-ROW / PER-HIT COUNTS, prefix-summed by the reader;
 *  - every part 1/3/6 column is REQUIRED, so hyparquet hands back typed arrays;
 *  - payload buffers are little-endian, matching every platform the app runs on.
 */

const enc = new TextEncoder();
const utf8 = (text: string) => enc.encode(text);
const i32 = (...values: number[]) => new Uint8Array(new Int32Array(values).buffer);
const f32 = (...values: number[]) => new Uint8Array(new Float32Array(values).buffer);
const f64 = (...values: number[]) => new Uint8Array(new Float64Array(values).buffer);

type Column = {
  name: string;
  data: unknown[] | Int32Array | Float64Array | Float32Array;
  /** Forces PLAIN where hyparquet-writer would dictionary-encode repeated values. */
  encoding?: 'PLAIN';
};

function part(columns: Column[], kv?: Record<string, string>): Uint8Array {
  return new Uint8Array(
    parquetWriteBuffer({
      columnData: columns.map((column) => ({ ...column, nullable: false })) as never,
      statistics: false,
      ...(kv ? { kvMetadata: Object.entries(kv).map(([key, value]) => ({ key, value })) } : {}),
    }),
  );
}

const payloadPart = (payloads: Record<string, Uint8Array>): Uint8Array =>
  part([
    { name: 'name', data: Object.keys(payloads) },
    { name: 'data', data: Object.values(payloads) },
  ]);

const bundle = (parts: Uint8Array[]): ArrayBuffer =>
  concatenateBuffers(
    parts.map((p) => p.slice().buffer as ArrayBuffer),
    BUNDLE_DELIMITER_BYTES,
  );

// ── the shared fixture ──────────────────────────────────────────────────────────
//
// 8 proteins. `go_bp` is the interesting column: multi-valued, scored, evidenced, and
// with no hits at all on the FIRST row (P1), an INTERIOR one (P4) and the LAST (P8) —
// the three positions the synthetic-NA insertion has to get right.

const PROTEIN_IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

const MANIFEST = {
  idColumn: 'protein_id',
  columns: {
    organism: { kind: 'categorical' },
    go_bp: { kind: 'multi', scores: true, evidence: true },
    keyword: { kind: 'multi' },
    length: { kind: 'numeric', numericType: 'int' },
    score: { kind: 'numeric', numericType: 'float' },
  },
  projections: [
    { name: 'pca2', dimension: 2 },
    { name: 'umap3', dimension: 3 },
  ],
};

/**
 * `null` writes no manifest at all; anything else is stamped verbatim. `versionKv` replaces
 * the container-version entry, so a test can drop it or swap in another key.
 */
const annotationsPart = (
  manifest: unknown = MANIFEST,
  versionKv: Record<string, string> = { protspace_container_version: '3' },
) =>
  part(
    [
      { name: 'protein_id', data: PROTEIN_IDS },
      // -1 at P4: the only row with no organism, so a `__NA__` category is appended.
      { name: 'organism', data: new Int32Array([0, 1, 2, -1, 0, 1, 2, 3]) },
      { name: 'go_bp__count', data: new Int32Array([0, 2, 1, 0, 3, 1, 2, 0]) },
      { name: 'keyword__count', data: new Int32Array([1, 3, 2, 1, 0, 4, 1, 2]) },
      { name: 'length', data: new Float64Array([100, 200, NaN, 300, 400, 500, 600, 700]) },
      { name: 'score', data: new Float64Array([0.5, 1.5, 2.5, NaN, 4.5, 5.5, 6.5, 7.5]) },
    ],
    {
      ...versionKv,
      ...(manifest === null ? {} : { protspace_v3_manifest: JSON.stringify(manifest) }),
    },
  );

const PROJECTIONS_METADATA = part([
  { name: 'projection_name', data: ['pca2', 'umap3'] },
  { name: 'dimensions', data: new Int32Array([2, 3]) },
  { name: 'info_json', data: ['{"note":"flat"}', '{}'] },
]);

const PROJECTIONS = part([
  { name: 'pca2__x', data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]) },
  { name: 'pca2__y', data: new Float32Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]) },
  // P7 and P8 are absent from umap3, so the encoder wrote NaN for them.
  { name: 'umap3__x', data: new Float32Array([10, 20, 30, 40, 50, 60, NaN, NaN]) },
  { name: 'umap3__y', data: new Float32Array([11, 21, 31, 41, 51, 61, NaN, NaN]) },
  { name: 'umap3__z', data: new Float32Array([0.25, 0.5, 0.75, 1, 1.25, 1.5, NaN, NaN]) },
]);

const PAYLOADS: Record<string, Uint8Array> = {
  'dict:organism': utf8('HumanMouseYeastFly'),
  'dict:organism:len': i32(5, 5, 5, 3),
  'dict:go_bp': utf8('bindingapoptosistransport'),
  'dict:go_bp:len': i32(7, 9, 9),
  'csr:go_bp': i32(0, 1, 2, 0, 1, 2, 1, 0, 2),
  // Hit 3 is the first hit of P5, immediately after the empty interior row P4: its
  // score is what an off-by-one in the inserted-NA score offsets would steal.
  'score_count:go_bp': i32(2, 0, 1, 1, 0, 0, 0, 3, 0),
  'scores:go_bp': f64(1.5, 2.5, 9.75, 4, 0.5, 0.25, 0.125),
  'evidence:go_bp': i32(-1, 0, 1, -1, -1, -1, 0, -1, -1),
  'dict:__evidence': utf8('IDAECO:0000269'),
  'dict:__evidence:len': i32(3, 11),
  'dict:keyword': utf8('alphabetagamma'),
  'dict:keyword:len': i32(5, 4, 5),
  'csr:keyword': i32(0, 0, 1, 2, 1, 2, 2, 0, 1, 2, 0, 1, 2, 0),
};

const EMPTY = new Uint8Array(0);

/** Six parts, with the zero-byte settings and statistics slots the writer emits. */
const v3Bundle = (overrides: Record<number, Uint8Array> = {}) =>
  bundle(
    [annotationsPart(), PROJECTIONS_METADATA, PROJECTIONS, EMPTY, EMPTY, payloadPart(PAYLOADS)].map(
      (fallback, index) => overrides[index] ?? fallback,
    ),
  );

const labelsOf = (data: VisualizationData, key: string, protein: number) =>
  getProteinAnnotationIndices(data.annotation_data[key], protein).map(
    (index) => data.annotations[key].values[index],
  );

describe('parquetbundle format v3', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads a six-part bundle with zero-byte settings and statistics slots', async () => {
    const { data, settings } = await decodeParquetBundle(v3Bundle());

    expect(settings).toBeNull();
    expect(data.statistics).toBeUndefined();
    expect(data.protein_ids).toEqual(PROTEIN_IDS);
  });

  it('decodes a categorical column and routes its missing row to __NA__', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    expect(data.annotations.organism).toEqual({
      kind: 'categorical',
      values: ['Human', 'Mouse', 'Yeast', 'Fly', NA_VALUE],
      colors: expect.any(Array),
      shapes: expect.any(Array),
    });
    // Palette assignment must be code-indexed, exactly as the v1/v2 reader does it.
    expect(data.annotations.organism.colors).toHaveLength(5);
    expect(data.annotations.organism.shapes.every((shape) => shape === 'circle')).toBe(true);
    // Plain Int32Array storage for a single-valued column — no CSR, no boxed arrays.
    expect(data.annotation_data.organism).toBeInstanceOf(Int32Array);
    expect(Array.from(data.annotation_data.organism as Int32Array)).toEqual([
      0, 1, 2, 4, 0, 1, 2, 3,
    ]);
  });

  it('prefix-sums per-row hit counts into CSR offsets', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    const csr = data.annotation_data.go_bp as CsrAnnotationData;
    expect(isCsrAnnotationData(csr)).toBe(true);
    expect(csr.length).toBe(8);
    // Counts [0,2,1,0,3,1,2,0] plus one inserted __NA__ hit for each of the three
    // empty rows (first, interior, last).
    expect(Array.from(csr.offsets)).toEqual([0, 1, 3, 4, 5, 8, 9, 11, 12]);
    expect(Array.from(csr.codes)).toEqual([3, 0, 1, 2, 3, 0, 1, 2, 1, 0, 2, 3]);
  });

  it('gives empty rows at the first, interior and last positions the __NA__ category', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    expect(data.annotations.go_bp.values).toEqual(['binding', 'apoptosis', 'transport', NA_VALUE]);
    expect(labelsOf(data, 'go_bp', 0)).toEqual([NA_VALUE]);
    expect(labelsOf(data, 'go_bp', 3)).toEqual([NA_VALUE]);
    expect(labelsOf(data, 'go_bp', 7)).toEqual([NA_VALUE]);
    expect(labelsOf(data, 'go_bp', 1)).toEqual(['binding', 'apoptosis']);
    expect(labelsOf(data, 'go_bp', 4)).toEqual(['binding', 'apoptosis', 'transport']);
  });

  it('keeps scores aligned with their hits across the inserted __NA__ hits', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    expect(getProteinScores(data, 0, 'go_bp')).toEqual([null]);
    expect(getProteinScores(data, 1, 'go_bp')).toEqual([[1.5, 2.5], null]);
    expect(getProteinScores(data, 2, 'go_bp')).toEqual([[9.75]]);
    // P4 is empty and P5's first hit is scored: the inserted __NA__ hit must own no
    // score, and P5's must keep the one it was written with.
    expect(getProteinScores(data, 3, 'go_bp')).toEqual([null]);
    expect(getProteinScores(data, 4, 'go_bp')).toEqual([[4], null, null]);
    expect(getProteinScores(data, 5, 'go_bp')).toEqual([null]);
    expect(getProteinScores(data, 6, 'go_bp')).toEqual([[0.5, 0.25, 0.125], null]);
    expect(getProteinScores(data, 7, 'go_bp')).toEqual([null]);
  });

  it('keeps evidence aligned with its hits and resolves the global evidence dictionary', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    expect(getProteinEvidence(data, 1, 'go_bp')).toEqual([null, 'IDA']);
    expect(getProteinEvidence(data, 2, 'go_bp')).toEqual(['ECO:0000269']);
    expect(getProteinEvidence(data, 5, 'go_bp')).toEqual(['IDA']);
    expect(getProteinEvidence(data, 7, 'go_bp')).toEqual([null]);
  });

  it('keeps an E-value score exact, which float32 cannot', async () => {
    // 1e-200 flushes to 0 and 1e40 saturates to Infinity in float32, and E-values are
    // the canonical Pfam / InterPro score — so this is the whole reason the payload is
    // float64. Reading it as float32 also halves the element count, which trips the
    // score-count check first.
    const payloads = {
      ...PAYLOADS,
      'score_count:go_bp': i32(2, 0, 0, 0, 0, 0, 0, 0, 0),
      'scores:go_bp': f64(1e-200, 1e40),
    };
    const { data } = await decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }));

    expect(getProteinScores(data, 1, 'go_bp')).toEqual([[1e-200, 1e40], null]);
  });

  it('folds every missing-value spelling in a dictionary into ONE __NA__ category', async () => {
    // The 105K dataset's `gene_name` carries `na` and `nan` as separate dictionary
    // entries; they must land in a single legend slot, not two.
    const payloads = {
      ...PAYLOADS,
      'dict:organism': utf8('HumannaMousenan'),
      'dict:organism:len': i32(5, 2, 5, 3),
    };
    const { data } = await decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }));

    expect(data.annotations.organism.values).toEqual(['Human', 'Mouse', NA_VALUE]);
    expect(data.annotations.organism.colors).toHaveLength(3);
    // One NA slot, in the NA swatch — not a category sitting at the palette rank the
    // token happened to have, and not a second slot beside the synthetic one.
    expect(data.annotations.organism.colors.at(-1)).toBe(NA_DEFAULT_COLOR);
    // Rows 1 and 5 spelled `na`, row 7 spelled `nan`, row 3 was already missing: all
    // four end up on code 2.
    expect(Array.from(data.annotation_data.organism as Int32Array)).toEqual([
      0, 2, 1, 2, 0, 2, 1, 2,
    ]);
  });

  it('folds a plain missing-value hit but keeps a scored or evidenced one, as v2 did', async () => {
    // `binding` / `none` / `transport`: `none` is 1383 of 1587 rows of
    // `phosphatase.predicted_transmembrane`, so this is the shipped shape. v2 tested the
    // whole hit for a missing value, so `none|7` and `none|IDA` were ordinary hits there
    // and only a bare `none` folded into N/A.
    const payloads = {
      ...PAYLOADS,
      'dict:go_bp': utf8('bindingnonetransport'),
      'dict:go_bp:len': i32(7, 4, 9),
      // Hit 1 is P2's `none`, scored 7 and evidenced IDA; hit 4 is P5's bare `none`;
      // hit 6 is P6's `none`, evidenced IDA only.
      'score_count:go_bp': i32(2, 1, 1, 1, 0, 0, 0, 3, 0),
      'scores:go_bp': f64(1.5, 2.5, 7, 9.75, 4, 0.5, 0.25, 0.125),
    };
    const { data } = await decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }));

    // `none` counts its two kept hits only, so it ranks after the two labels with three.
    expect(data.annotations.go_bp.values).toEqual(['binding', 'transport', 'none', NA_VALUE]);
    expect(Array.from((data.annotation_data.go_bp as CsrAnnotationData).offsets)).toEqual([
      0, 1, 3, 4, 5, 7, 8, 10, 11,
    ]);
    expect(labelsOf(data, 'go_bp', 1)).toEqual(['binding', 'none']);
    expect(getProteinScores(data, 1, 'go_bp')).toEqual([[1.5, 2.5], [7]]);
    expect(getProteinEvidence(data, 1, 'go_bp')).toEqual([null, 'IDA']);
    // P5's bare `none` is dropped, and every later hit keeps its own score and evidence.
    expect(labelsOf(data, 'go_bp', 4)).toEqual(['binding', 'transport']);
    expect(getProteinScores(data, 4, 'go_bp')).toEqual([[4], null]);
    expect(labelsOf(data, 'go_bp', 5)).toEqual(['none']);
    expect(getProteinEvidence(data, 5, 'go_bp')).toEqual(['IDA']);
    expect(getProteinScores(data, 6, 'go_bp')).toEqual([[0.5, 0.25, 0.125], null]);
    expect(getProteinScores(data, 2, 'go_bp')).toEqual([[9.75]]);
    expect(getProteinEvidence(data, 2, 'go_bp')).toEqual(['ECO:0000269']);
  });

  it('drops a folded CSR hit and empties its row into __NA__ when nothing scores it', async () => {
    const payloads = {
      ...PAYLOADS,
      'dict:go_bp': utf8('bindingnonetransport'),
      'dict:go_bp:len': i32(7, 4, 9),
      // No `none` hit (1, 4, 6) carries a score or an evidence code.
      'evidence:go_bp': i32(-1, -1, 1, -1, -1, -1, -1, -1, -1),
    };
    const { data } = await decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }));

    expect(data.annotations.go_bp.values).toEqual(['binding', 'transport', NA_VALUE]);
    expect(labelsOf(data, 'go_bp', 1)).toEqual(['binding']);
    expect(getProteinScores(data, 1, 'go_bp')).toEqual([[1.5, 2.5]]);
    // P6's only hit was `none`, so the row empties out and takes the same __NA__.
    expect(labelsOf(data, 'go_bp', 5)).toEqual([NA_VALUE]);
    expect(getProteinScores(data, 4, 'go_bp')).toEqual([[4], null]);
    expect(getProteinEvidence(data, 2, 'go_bp')).toEqual(['ECO:0000269']);
  });

  it('leaves a multi column with neither scores nor evidence without those payloads', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    expect(labelsOf(data, 'keyword', 1)).toEqual(['alpha', 'beta', 'gamma']);
    expect(labelsOf(data, 'keyword', 4)).toEqual([NA_VALUE]);
    const keyword = data.annotation_data.keyword as CsrAnnotationData;
    expect(keyword.scores).toBeUndefined();
    expect(keyword.evidence).toBeUndefined();
    expect(getProteinScores(data, 1, 'keyword')).toEqual([]);
  });

  it('reads numeric columns from float64 with NaN meaning missing', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    expect(data.annotations.length).toMatchObject({ kind: 'numeric', numericType: 'int' });
    expect(data.annotations.score).toMatchObject({ kind: 'numeric', numericType: 'float' });
    expect(data.numeric_annotation_data?.length).toEqual(
      new Float64Array([100, 200, NaN, 300, 400, 500, 600, 700]),
    );
    expect(data.numeric_annotation_data?.score).toEqual(
      new Float64Array([0.5, 1.5, 2.5, NaN, 4.5, 5.5, 6.5, 7.5]),
    );
    // The manifest is authoritative: an int32 code column must never be read as numeric.
    expect(data.numeric_annotation_data?.organism).toBeUndefined();
    expect(data.numeric_annotation_data?.go_bp).toBeUndefined();
  });

  it('interleaves the wide axis columns into 2D and 3D projections', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());

    const [pca2, umap3] = data.projections;
    expect(pca2).toMatchObject({ name: 'pca2', dimension: 2 });
    expect(Array.from(pca2.data)).toEqual([
      1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5,
    ]);
    expect(pca2.metadata).toMatchObject({ dimension: 2, dimensions: 2, note: 'flat' });

    expect(umap3).toMatchObject({ name: 'umap3', dimension: 3 });
    expect(Array.from(umap3.data.slice(0, 6))).toEqual([10, 11, 0.25, 20, 21, 0.5]);
    // A protein absent from a projection keeps NaN, never the origin.
    expect(Array.from(umap3.data.slice(18))).toEqual([NaN, NaN, NaN, NaN, NaN, NaN]);
  });

  it('takes the typed-array fast path for every column', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await decodeParquetBundle(v3Bundle());
    expect(warn).not.toHaveBeenCalled();
  });

  it('parses the settings and statistics parts when they are present', async () => {
    const settingsPart = part([
      {
        name: 'settings_json',
        data: [JSON.stringify({ legendSettings: {}, exportOptions: {} })],
      },
    ]);
    const statisticsPart = new Uint8Array(
      readFileSync(new URL('./__fixtures__/stats-sample-statistics.parquet', import.meta.url)),
    );

    const { data, settings } = await decodeParquetBundle(
      v3Bundle({ 3: settingsPart, 4: statisticsPart }),
    );

    expect(settings).toEqual({ legendSettings: {}, exportOptions: {} });
    expect(new Uint8Array(data.statistics!)).toEqual(statisticsPart);
    expect(data.statisticsRows!.length).toBeGreaterThan(0);
  });

  describe('rejects a bundle whose manifest cannot be trusted', () => {
    const cases: [string, unknown, RegExp][] = [
      ['no manifest at all', null, /carries no "protspace_v3_manifest"/],
      [
        'an unknown column kind',
        { ...MANIFEST, columns: { organism: { kind: 'blob' } } },
        /unknown kind "blob"/,
      ],
      [
        'a column that part 1 does not have',
        { ...MANIFEST, columns: { ...MANIFEST.columns, ghost: { kind: 'categorical' } } },
        /declares column "ghost" but part 1 has no "ghost"/,
      ],
      [
        'a multi column named as if it were single-valued',
        { ...MANIFEST, columns: { ...MANIFEST.columns, organism: { kind: 'multi' } } },
        /part 1 has no "organism__count"/,
      ],
      [
        'an id column that is not in the schema',
        { ...MANIFEST, idColumn: 'accession' },
        /idColumn "accession" is not a column of part 1/,
      ],
      [
        'a projection dimension other than 2 or 3',
        { ...MANIFEST, projections: [{ name: 'pca2', dimension: 4 }] },
        /dimension 4, expected 2 or 3/,
      ],
      [
        'a projection column part 3 does not have',
        { ...MANIFEST, projections: [{ name: 'nope', dimension: 2 }] },
        /part 3 has no nope__x/,
      ],
      [
        'a code column the manifest calls numeric',
        { ...MANIFEST, columns: { ...MANIFEST.columns, organism: { kind: 'numeric' } } },
        /is kind "numeric", but part 1 stores "organism" as INT32, not DOUBLE/,
      ],
      [
        'a numeric column the manifest calls categorical',
        { ...MANIFEST, columns: { ...MANIFEST.columns, score: { kind: 'categorical' } } },
        /is kind "categorical", but part 1 stores "score" as DOUBLE, not INT32/,
      ],
      [
        'a hit-count column the manifest calls numeric',
        // go_bp itself is left out: it would read the same column, which is refused first.
        {
          ...MANIFEST,
          columns: { organism: MANIFEST.columns.organism, go_bp__count: { kind: 'numeric' } },
        },
        /is kind "numeric", but part 1 stores "go_bp__count" as INT32, not DOUBLE/,
      ],
      [
        'an annotation column that collides with the id column',
        {
          ...MANIFEST,
          columns: { ...MANIFEST.columns, protein_id: { kind: 'numeric' } },
        },
        /declares idColumn "protein_id" as an annotation column too/,
      ],
      [
        'an id column that is not a string column',
        { ...MANIFEST, idColumn: 'go_bp__count' },
        /idColumn "go_bp__count" is stored as INT32, not a string column/,
      ],
      [
        'a column whose part 1 name another column already stores',
        {
          ...MANIFEST,
          columns: { ...MANIFEST.columns, go_bp__count: { kind: 'categorical' } },
        },
        /column "go_bp__count" reads part 1's "go_bp__count", which column "go_bp" already reads/,
      ],
      [
        'a multi column whose hit counts are the id column',
        { idColumn: 'go_bp__count', columns: { go_bp: { kind: 'multi' } }, projections: [] },
        /idColumn "go_bp__count" is stored as INT32, not a string column/,
      ],
      [
        'an unknown numericType',
        {
          ...MANIFEST,
          columns: { ...MANIFEST.columns, length: { kind: 'numeric', numericType: 'i8' } },
        },
        /unknown numericType "i8"/,
      ],
    ];

    for (const [label, manifest, message] of cases) {
      it(label, async () => {
        await expect(
          decodeParquetBundle(v3Bundle({ 0: annotationsPart(manifest) })),
        ).rejects.toThrow(message);
      });
    }

    it('a manifest that is not JSON', async () => {
      const broken = part([{ name: 'protein_id', data: PROTEIN_IDS }], {
        protspace_container_version: '3',
        protspace_v3_manifest: '{not json',
      });
      await expect(decodeParquetBundle(v3Bundle({ 0: broken }))).rejects.toThrow(
        /manifest is not valid JSON/,
      );
    });
  });

  describe('rejects payloads that disagree with part 1', () => {
    it('hit counts that do not sum to the CSR code count', async () => {
      const payloads = { ...PAYLOADS, 'csr:go_bp': i32(0, 1, 2) };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /hit counts sum to 9 but csr:go_bp holds 3 codes/,
      );
    });

    it('a code outside the column dictionary', async () => {
      const payloads = { ...PAYLOADS, 'csr:go_bp': i32(0, 1, 2, 0, 1, 2, 1, 0, 7) };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /hit 8 has code 7, outside its 3 labels/,
      );
    });

    it('a categorical code outside the column dictionary', async () => {
      const payloads = {
        ...PAYLOADS,
        'dict:organism:len': i32(5, 5, 5),
        'dict:organism': utf8('HumanMouseYeast'),
      };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /row 7 has code 3, outside its 3 labels/,
      );
    });

    it('score counts that do not sum to the score count', async () => {
      const payloads = { ...PAYLOADS, 'scores:go_bp': f64(1.5, 2.5) };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /score counts sum to 7 but scores:go_bp holds 2/,
      );
    });

    it('a dictionary blob shorter than its label lengths', async () => {
      const payloads = { ...PAYLOADS, 'dict:organism': utf8('HumanMouse') };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /declares a label past the end of its blob/,
      );
    });

    it('a payload whose byte length is not a multiple of 4', async () => {
      const payloads = { ...PAYLOADS, 'csr:go_bp': utf8('xyz') };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /is 3 bytes, not a multiple of 4/,
      );
    });

    it('a score payload whose byte length is not a multiple of 8', async () => {
      // 12 bytes clears the int32 alignment the other payloads use, so only a
      // float64-aware check catches it.
      const payloads = { ...PAYLOADS, 'scores:go_bp': f32(1.5, 2.5, 9.75) };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /"scores:go_bp" is 12 bytes, not a multiple of 8/,
      );
    });

    it('an evidence code outside the evidence dictionary', async () => {
      const payloads = { ...PAYLOADS, 'evidence:go_bp': i32(-1, 0, 1, -1, -1, -1, 5, -1, -1) };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /hit 6 has evidence code 5, outside the 2 evidence labels/,
      );
    });

    it('an evidence code below the -1 "no evidence" sentinel', async () => {
      const payloads = { ...PAYLOADS, 'evidence:go_bp': i32(-2, 0, 1, -1, -1, -1, 0, -1, -1) };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /hit 0 has evidence code -2, outside the 2 evidence labels/,
      );
    });

    it('two payloads sharing one name', async () => {
      // `payloadPart` takes a Record, which cannot hold a duplicate key, so the rows
      // are written directly.
      const names = [...Object.keys(PAYLOADS), 'csr:go_bp'];
      const duplicated = part([
        { name: 'name', data: names },
        { name: 'data', data: [...Object.values(PAYLOADS), i32(0, 0, 0, 0, 0, 0, 0, 0, 0)] },
      ]);
      await expect(decodeParquetBundle(v3Bundle({ 5: duplicated }))).rejects.toThrow(
        /payloads part declares "csr:go_bp" twice/,
      );
    });

    // Counts that sum past 2^31 wrapped the int32 offsets back onto the payload length,
    // passed the sum check and then looped ~2^31 times over one row. hyparquet-writer
    // would dictionary-encode the repeated count, so the column is written PLAIN.
    it('hit counts whose sum overflows the int32 offsets', async () => {
      const max = 2 ** 31 - 1;
      const overflowing = part(
        [
          { name: 'protein_id', data: PROTEIN_IDS },
          { name: 'organism', data: new Int32Array([0, 1, 2, -1, 0, 1, 2, 3]) },
          {
            name: 'go_bp__count',
            data: new Int32Array([max, max, 2, 0, 0, 0, 0, 0]),
            encoding: 'PLAIN',
          },
          { name: 'keyword__count', data: new Int32Array([1, 3, 2, 1, 0, 4, 1, 2]) },
          { name: 'length', data: new Float64Array([100, 200, NaN, 300, 400, 500, 600, 700]) },
          { name: 'score', data: new Float64Array([0.5, 1.5, 2.5, NaN, 4.5, 5.5, 6.5, 7.5]) },
        ],
        {
          protspace_container_version: '3',
          protspace_v3_manifest: JSON.stringify({
            ...MANIFEST,
            columns: { ...MANIFEST.columns, go_bp: { kind: 'multi' } },
          }),
        },
      );
      const payloads = { ...PAYLOADS, 'csr:go_bp': i32() };
      const started = performance.now();
      await expect(
        decodeParquetBundle(v3Bundle({ 0: overflowing, 5: payloadPart(payloads) })),
      ).rejects.toThrow(/hit counts sum past the int32 offset range at index 1/);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it('score counts whose sum overflows the int32 offsets', async () => {
      const max = 2 ** 31 - 1;
      const payloads = {
        ...PAYLOADS,
        'score_count:go_bp': i32(max, max, 2, 0, 0, 0, 0, 0, 0),
        'scores:go_bp': f64(),
      };
      await expect(decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }))).rejects.toThrow(
        /score counts sum past the int32 offset range at index 1/,
      );
    });

    it('a missing payloads part', async () => {
      await expect(decodeParquetBundle(v3Bundle({ 5: EMPTY }))).rejects.toThrow(
        /carries no payloads part/,
      );
    });
  });

  // `parquetWriteBuffer` always stamps a truthful `num_rows`, so the lying footer is
  // built by handing `readV3Bundle` a doctored `FileMetaData` — the same object
  // `decodeParquetBundle` reads out of part 1.
  it.each([
    ['above the row cap', 2_000_001n],
    ['negative', -1n],
    ['past the safe-integer range', 9_007_199_254_740_993n],
    ['absent', undefined],
  ])('rejects a footer whose row count is %s before allocating on it', async (_label, rows) => {
    const parts = splitBundleParts(v3Bundle());
    const metadata = parquetMetadata(parts[0]);

    await expect(readV3Bundle(parts, { ...metadata, num_rows: rows as bigint })).rejects.toThrow(
      /rows, outside 0\.\.2000000/,
    );
  });

  // A short part 3 left the unread proteins at the zero a fresh Float32Array holds, so
  // they were drawn at (0,0); a long one silently lost its extra rows.
  it.each([
    ['fewer', 2],
    ['more', 10],
  ])('rejects a part 3 with %s rows than part 1', async (_label, rows) => {
    const axis = (offset: number) => Float32Array.from({ length: rows }, (_, i) => offset + i);
    const misaligned = part([
      { name: 'pca2__x', data: axis(1) },
      { name: 'pca2__y', data: axis(100) },
      { name: 'umap3__x', data: axis(200) },
      { name: 'umap3__y', data: axis(300) },
      { name: 'umap3__z', data: axis(400) },
    ]);

    await expect(decodeParquetBundle(v3Bundle({ 2: misaligned }))).rejects.toThrow(
      new RegExp(`part 3 holds ${rows} rows but part 1 holds 8`),
    );
  });

  describe('a footer row count its data does not back', () => {
    /** Thrift compact i64: a zigzag varint. */
    const zigzag = (value: number): number[] => {
      let rest = BigInt(value) * 2n;
      const bytes: number[] = [];
      while (rest >= 0x80n) {
        bytes.push(Number((rest & 0x7fn) | 0x80n));
        rest >>= 7n;
      }
      return [...bytes, Number(rest)];
    };

    /**
     * `part` with one i64 of its footer rewritten from `from` to `to` (field header `0x16`),
     * at the first place where the rewrite reads back as `lands` says. Only the thrift bytes
     * change: the pages still hold the rows they held.
     */
    const rewriteFooterI64 = (
      part: Uint8Array,
      from: number,
      to: number,
      lands: (metadata: ReturnType<typeof parquetMetadata>) => boolean,
    ): Uint8Array => {
      const end = part.length - 8;
      const footerLength = new DataView(part.buffer, part.byteOffset).getUint32(end, true);
      const footer = Array.from(part.subarray(end - footerLength, end));
      const needle = [0x16, ...zigzag(from)];
      for (let at = 0; at + needle.length <= footer.length; at++) {
        if (needle.some((byte, k) => footer[at + k] !== byte)) continue;
        const patched = [
          ...footer.slice(0, at),
          0x16,
          ...zigzag(to),
          ...footer.slice(at + needle.length),
        ];
        const length = new Uint8Array(4);
        new DataView(length.buffer).setUint32(0, patched.length, true);
        const candidate = Uint8Array.from([
          ...part.subarray(0, end - footerLength),
          ...patched,
          ...length,
          ...utf8('PAR1'),
        ]);
        try {
          if (lands(parquetMetadata(candidate.slice().buffer))) return candidate;
        } catch {
          // Not this occurrence: the rewrite broke the thrift structure.
        }
      }
      throw new Error(`no footer i64 ${from} rewrites as wanted`);
    };

    /** `part` whose footer, and with `rowGroups` its one row group too, declares `rows`. */
    const declaring = (part: Uint8Array, rows: number, rowGroups: boolean): Uint8Array => {
      const was = Number(parquetMetadata(part.slice().buffer).num_rows);
      const fileLevel = rewriteFooterI64(
        part,
        was,
        rows,
        (m) => Number(m.num_rows) === rows && Number(m.row_groups[0].num_rows) === was,
      );
      if (!rowGroups) return fileLevel;
      return rewriteFooterI64(
        fileLevel,
        was,
        rows,
        (m) => Number(m.num_rows) === rows && Number(m.row_groups[0].num_rows) === rows,
      );
    };

    it('rejects a footer claiming more rows than its row groups hold', async () => {
      // Parts 1 and 3 agree with each other, so only the row groups can tell: read as
      // declared, P9 and P10 would be proteins named '' at (0, 0), labelled with code 0.
      const bundle = v3Bundle({
        0: declaring(annotationsPart(), 10, false),
        2: declaring(PROJECTIONS, 10, false),
      });
      await expect(decodeParquetBundle(bundle)).rejects.toThrow(
        /part 1 footer declares 10 rows but its row groups hold 8/,
      );
    });

    it('rejects row groups claiming more rows than their pages hold', async () => {
      const bundle = v3Bundle({
        0: declaring(annotationsPart(), 10, true),
        2: declaring(PROJECTIONS, 10, true),
      });
      await expect(decodeParquetBundle(bundle)).rejects.toThrow(
        /holds 8 rows but its footer declares 10/,
      );
      const { data } = await decodeParquetBundle(v3Bundle());
      expect(data.protein_ids).toEqual(PROTEIN_IDS);
    });

    it('caps the cells a footer can make the reader preallocate', async () => {
      // A few KB claiming 2M rows of 500 float64 columns would preallocate 8 GB before
      // a single row is read.
      const names = Array.from({ length: 500 }, (_, i) => `n${i}`);
      const wide = part(
        [
          { name: 'protein_id', data: PROTEIN_IDS },
          ...names.map((name) => ({ name, data: new Float64Array(8) })),
        ],
        {
          protspace_container_version: '3',
          protspace_v3_manifest: JSON.stringify({
            idColumn: 'protein_id',
            columns: Object.fromEntries(names.map((name) => [name, { kind: 'numeric' }])),
            projections: MANIFEST.projections,
          }),
        },
      );
      const rows = 2_000_000;
      await expect(
        decodeParquetBundle(v3Bundle({ 0: declaring(wide, rows, true) })),
      ).rejects.toThrow(/past the 1000000000 cell limit/);
    });
  });

  it('rejects a projection column that was not written REQUIRED and PLAIN', async () => {
    const nullable = new Uint8Array(
      parquetWriteBuffer({
        columnData: [
          { name: 'pca2__x', data: [1, 2, 3, 4, 5, 6, 7, null], type: 'FLOAT', nullable: true },
          { name: 'pca2__y', data: new Float32Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]) },
          { name: 'umap3__x', data: new Float32Array([10, 20, 30, 40, 50, 60, NaN, NaN]) },
          { name: 'umap3__y', data: new Float32Array([11, 21, 31, 41, 51, 61, NaN, NaN]) },
          { name: 'umap3__z', data: new Float32Array([0.25, 0.5, 0.75, 1, 1.25, 1.5, NaN, NaN]) },
        ] as never,
        statistics: false,
      }),
    );

    await expect(decodeParquetBundle(v3Bundle({ 2: nullable }))).rejects.toThrow(
      /column "pca2__x" did not decode to a typed array/,
    );
  });

  describe('rejects a protein id column the format forbids', () => {
    const withIds = (ids: (string | null)[], nullable: boolean) =>
      new Uint8Array(
        parquetWriteBuffer({
          columnData: [
            { name: 'protein_id', data: ids, type: 'STRING', nullable },
            { name: 'organism', data: new Int32Array([0, 1, 2, -1, 0, 1, 2, 3]) },
            { name: 'go_bp__count', data: new Int32Array([0, 2, 1, 0, 3, 1, 2, 0]) },
            { name: 'keyword__count', data: new Int32Array([1, 3, 2, 1, 0, 4, 1, 2]) },
            { name: 'length', data: new Float64Array([100, 200, NaN, 300, 400, 500, 600, 700]) },
            { name: 'score', data: new Float64Array([0.5, 1.5, 2.5, NaN, 4.5, 5.5, 6.5, 7.5]) },
          ].map((column) => ({ nullable: false, ...column })) as never,
          statistics: false,
          kvMetadata: [
            { key: 'protspace_container_version', value: '3' },
            { key: 'protspace_v3_manifest', value: JSON.stringify(MANIFEST) },
          ],
        }),
      );

    // Identity (selection, isolation, search, export) is keyed by id, so a repeat would
    // make two proteins one, and a null would become a protein named ''.
    it('a repeated id', async () => {
      const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P2', 'P8'];
      await expect(decodeParquetBundle(v3Bundle({ 0: withIds(ids, false) }))).rejects.toThrow(
        /protein id "P2" appears more than once/,
      );
    });

    it('a null id', async () => {
      const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', null, 'P8'];
      await expect(decodeParquetBundle(v3Bundle({ 0: withIds(ids, true) }))).rejects.toThrow(
        /id column "protein_id" holds a null at row 6/,
      );
    });
  });

  it('decodes non-ASCII labels by byte range, not character offset', async () => {
    // 'Mü' is three bytes but two characters, so slicing the decoded blob by byte
    // offsets would shear every later label.
    const payloads = {
      ...PAYLOADS,
      'dict:organism': utf8('HumanMüYeastFly'),
      'dict:organism:len': i32(5, 3, 5, 3),
    };
    const { data } = await decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }));
    expect(data.annotations.organism.values).toEqual(['Human', 'Mü', 'Yeast', 'Fly', NA_VALUE]);
  });

  it('refuses to read a v3 bundle through the legacy row-object extractor', async () => {
    // Widening the delimiter gate to 5 made this reachable: without the version guard
    // it gets as far as part 3 and complains about missing projection columns.
    await expect(extractRowsFromParquetBundle(v3Bundle())).rejects.toThrow(
      /is a format v3 container, which only decodeParquetBundle can read/,
    );
  });

  describe('takes the container version from its own footer key', () => {
    it('reports format 3 from protspace_container_version', async () => {
      expect((await decodeParquetBundle(v3Bundle())).formatVersion).toBe(3);
    });

    it('rejects six parts whose part 1 carries only the cell-grammar key', async () => {
      // What a build from before the two keys were split wrote: the grammar key saying 3.
      // It is not a container version, and the legacy reader must not get the codes either.
      const preSplit = annotationsPart(MANIFEST, { protspace_format_version: '3' });
      await expect(decodeParquetBundle(v3Bundle({ 0: preSplit }))).rejects.toThrow(
        /6 parts but part 1 carries no protspace_container_version/,
      );
    });

    it('rejects a container version it does not know', async () => {
      const future = annotationsPart(MANIFEST, { protspace_container_version: '4' });
      await expect(decodeParquetBundle(v3Bundle({ 0: future }))).rejects.toThrow(
        /declares container version "4"/,
      );
    });

    it('rejects a v3 part 1 in a legacy-sized container', async () => {
      const parts = [annotationsPart(), PROJECTIONS_METADATA, PROJECTIONS];
      await expect(decodeParquetBundle(bundle(parts))).rejects.toThrow(/no payloads part/);
    });
  });

  it('keeps a byte-order mark that belongs to a label', async () => {
    // U+FEFF is three bytes, and a decoder that treats it as an encoding marker rather
    // than a character silently renames the category.
    const payloads = {
      ...PAYLOADS,
      'dict:organism': utf8('\uFEFFHumanMouseYeastFly'),
      'dict:organism:len': i32(8, 5, 5, 3),
    };
    const { data } = await decodeParquetBundle(v3Bundle({ 5: payloadPart(payloads) }));
    expect(data.annotations.organism.values[0]).toBe('\uFEFFHuman');
  });

  it('rejects an annotation column that was written nullable', async () => {
    const nullable = new Uint8Array(
      parquetWriteBuffer({
        columnData: [
          { name: 'protein_id', data: PROTEIN_IDS, nullable: false },
          { name: 'organism', data: [0, 1, 2, -1, 0, 1, 2, 3], type: 'INT32', nullable: true },
          { name: 'go_bp__count', data: new Int32Array([0, 2, 1, 0, 3, 1, 2, 0]), nullable: false },
          {
            name: 'keyword__count',
            data: new Int32Array([1, 3, 2, 1, 0, 4, 1, 2]),
            nullable: false,
          },
          {
            name: 'length',
            data: [100, 200, null, 300, 400, 500, 600, 700],
            type: 'DOUBLE',
            nullable: true,
          },
          {
            name: 'score',
            data: new Float64Array([0.5, 1.5, 2.5, NaN, 4.5, 5.5, 6.5, 7.5]),
            nullable: false,
          },
        ] as never,
        statistics: false,
        kvMetadata: [
          { key: 'protspace_container_version', value: '3' },
          { key: 'protspace_v3_manifest', value: JSON.stringify(MANIFEST) },
        ],
      }),
    );

    // Rejected rather than read with the nulls turned into codes and numbers.
    await expect(decodeParquetBundle(v3Bundle({ 0: nullable }))).rejects.toThrow(
      /column "(organism|length)" did not decode to a typed array/,
    );
  });

  it('collects every bulk buffer exactly once and they all transfer', async () => {
    const { data } = await decodeParquetBundle(v3Bundle());
    const transfer = collectTransferables(data);

    expect(new Set(transfer).size).toBe(transfer.length);
    // 2 projections + 2 numeric columns + organism codes + 2 x 2 CSR (offsets + codes) +
    // scores (offsets + values) + evidence codes.
    expect(transfer).toHaveLength(12);

    const sources = bulkViews(data);
    const before = sources.map((view) => Array.from(view));

    // Each transferred buffer must be owned outright by exactly one view. A view into a
    // slice of someone else's buffer (a hyparquet page, say) would still transfer, but it
    // would carry — and detach — bytes that are not ours.
    for (const buffer of transfer as ArrayBuffer[]) {
      const owners = sources.filter((view) => view.buffer === buffer);
      expect(owners).toHaveLength(1);
      expect(owners[0].byteOffset).toBe(0);
      expect(owners[0].byteLength).toBe(buffer.byteLength);
    }

    const clone = structuredClone(data, { transfer });

    expect(sources.every((view) => view.byteLength === 0)).toBe(true);
    // Reading the clone is the point: asserting only that the sender detached would
    // pass just as happily on a clone holding the wrong bytes.
    expect(bulkViews(clone).map((view) => Array.from(view))).toEqual(before);
    expect(clone.protein_ids).toEqual(PROTEIN_IDS);
    expect(clone.annotations.go_bp.values).toEqual(data.annotations.go_bp.values);
  });
});
