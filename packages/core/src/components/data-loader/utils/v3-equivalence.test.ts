import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createParquetBundle,
  getProteinAnnotationIndices,
  getProteinEvidence,
  getProteinScores,
  isCsrAnnotationData,
  isMultilabelAnnotationData,
  isNAValue,
  materializeEatOverlay,
  NA_DEFAULT_COLOR,
  NA_VALUE,
  type VisualizationData,
} from '@protspace/utils';
import { decodeParquetBundle, extractRowsFromParquetBundle } from './bundle';
import { convertParquetToVisualizationDataOptimized } from './conversion';

/**
 * The cross-language contract for parquetbundle v3.
 *
 * `__fixtures__/v3-sample.parquetbundle` is written by the real Python encoder
 * (`apps/protspace/scripts/generate_v3_fixture.py` -> `bundle_v3.encode_v3`) and read
 * here by the real browser reader. `bundle-v3.test.ts` covers the reader against
 * hand-synthesised parts, where a corrupt manifest or a lying hit count is reachable;
 * this suite covers the half that no synthesised part can: that the two independently
 * written implementations agree on the same bytes, and that a v3-loaded dataset behaves
 * like a v2-loaded one everywhere downstream.
 *
 * The fixture is a deliberate SUPERSET of `v2-sample.parquetbundle` (2 rows, 2 columns,
 * which cannot carry an interior zero-hit row, a numeric column or a 3D projection), so
 * the two are compared only on the values they genuinely share: `protein_ids[0..1]`,
 * P1/P2's `cath` and `go_bp`, and the `pca2` coordinates.
 *
 * The Python side asserts on the same bytes from the other end
 * (`apps/protspace/tests/test_bundle_v3_fixture.py`), including the encoded part 1 and
 * part 6 the decoder would otherwise hide. Change the fixture in the generator only,
 * never by hand, and re-run both suites.
 */

const PROTEIN_IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;

/** Every categorical column of the fixture, in part-1 order. */
const CATEGORICAL = ['cath', 'go_bp', 'pfam', 'kingdom', 'reviewed', 'predicted_tm'] as const;

/**
 * The label whose own text contains the `;` the v2 cell grammar reserves as the hit
 * separator, so it travels percent-encoded and must come back decoded. Byte-identical
 * to the one in `v2-sample.parquetbundle`.
 */
const CATH_ENCODED_SEMICOLON = 'G3DSA:1.10.10.10 (Ribosomal Protein L15; Chain: K; domain 2)';

/**
 * The fixture's one label outside ASCII. `readLabels` decodes a dictionary blob in one
 * pass and slices it by character offset only while the blob is pure ASCII; this label
 * is what forces the other branch, where each label is decoded from its own UTF-8 byte
 * range. Python measures those lengths in bytes, so the two sides have to agree on them.
 */
const PFAM_NON_ASCII = 'PF00004 (β-lactamase, Nébuline)';

/**
 * Which flat per-hit payload families each multi column actually carries. This is what
 * an inserted-`__NA__` hit reports `null` for (see the round-trip suite below); a column
 * that carries neither reports an empty array on every row.
 */
const PAYLOADS: Readonly<Record<string, { scores: boolean; evidence: boolean }>> = {
  cath: { scores: true, evidence: false },
  go_bp: { scores: false, evidence: true },
  pfam: { scores: true, evidence: true },
  kingdom: { scores: false, evidence: false },
  reviewed: { scores: false, evidence: false },
  predicted_tm: { scores: false, evidence: false },
};

/**
 * Rows whose only "hit" is the synthetic `__NA__` the reader inserts for an empty CSR
 * row. These are exactly the rows where CSR and nested storage legitimately disagree
 * (see the round-trip suite).
 */
const NA_ONLY_ROWS: Readonly<Record<string, readonly string[]>> = {
  cath: ['P4'],
  go_bp: ['P2', 'P5'],
  pfam: ['P1', 'P3', 'P6'],
};

function fixture(name: string): ArrayBuffer {
  const file = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** The v3 fixture through the real version-sniffing entry point. */
const loadV3 = () => decodeParquetBundle(fixture('v3-sample.parquetbundle'));

/** Any v2 container through the legacy row-object path, which is what v3 must match. */
const loadLegacy = async (buffer: ArrayBuffer): Promise<VisualizationData> =>
  convertParquetToVisualizationDataOptimized(await extractRowsFromParquetBundle(buffer));

/** One protein's view of one column, read only through the public accessors. */
interface Hits {
  labels: (string | null)[];
  scores: (number[] | null)[];
  evidence: (string | null)[];
}

function hitsOf(data: VisualizationData, key: string, proteinIndex: number): Hits {
  const annotation = data.annotations[key];
  return {
    labels: getProteinAnnotationIndices(data.annotation_data[key], proteinIndex).map(
      (valueIndex) => annotation.values[valueIndex],
    ),
    scores: getProteinScores(data, proteinIndex, key),
    evidence: getProteinEvidence(data, proteinIndex, key),
  };
}

const hitsByProtein = (data: VisualizationData, key: string): Record<string, Hits> =>
  Object.fromEntries(data.protein_ids.map((id, index) => [id, hitsOf(data, key, index)]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('v3 golden fixture: the Python encoder and the browser reader agree', () => {
  it('reads the six-part container with both empty slots and no settings or statistics', async () => {
    const { data, settings } = await loadV3();

    expect(data.protein_ids).toEqual([...PROTEIN_IDS]);
    // Parts 4 and 5 are the zero-byte slots that keep the payloads part at position six.
    expect(settings).toBeNull();
    expect(data.statistics).toBeUndefined();
  });

  it('decodes every part-1 column straight into a typed array, with no plain-array fallback', async () => {
    // The whole performance premise of v3: hyparquet hands back a typed array only for a
    // REQUIRED, PLAIN, undictionaried column, and the reader logs (once) when it has to
    // fall back to the ~4x slower element loop. Nothing else in the suite would notice:
    // the fallback decodes correctly, so this is the only assertion that proves the
    // Python writer really produced the physical shape the reader is optimised for.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { data } = await loadV3();

    expect(data.protein_ids).toHaveLength(PROTEIN_IDS.length);
    expect(warn).not.toHaveBeenCalled();
  });

  it('exposes exactly the declared annotations, with the EAT companion trio consumed', async () => {
    const { data } = await loadV3();

    // `kingdom__pred_value/__pred_confidence/__pred_source` are declared in the manifest
    // and physically present in part 1; `normalizeEatCompanionColumns` must consume them
    // so they never become three junk legend columns. In their place it synthesises one
    // runtime-only numeric column for the confidence.
    expect(Object.keys(data.annotations)).toEqual([
      'cath',
      'go_bp',
      'pfam',
      'kingdom',
      'reviewed',
      'predicted_tm',
      'length',
      'hydrophobicity',
      'kingdom__eat_confidence',
    ]);
    expect(data.annotations.kingdom__eat_confidence).toEqual({
      kind: 'numeric',
      numericType: 'float',
      values: [],
      colors: [],
      shapes: [],
      runtime: { role: 'eat-confidence', baseAnnotation: 'kingdom' },
    });
  });

  it('keeps only the prediction whose curated cell is missing, as a real predicted cell', async () => {
    const { data } = await loadV3();

    // The fixture carries three predictions. P2 and P5 have a curated `kingdom`, so the
    // overlay must discard them; only P4's cell is blank, so only P4 gets a prediction.
    expect(data.annotation_predicted).toEqual({
      kingdom: [
        null,
        null,
        null,
        { value: 'Viruses', confidence: 0.5, source: 'P0A7B8' },
        null,
        null,
      ],
    });
    // `Viruses` occurs nowhere in the curated column, so the overlay had to grow the
    // legend by one prediction-only value, appended after the observed ones and before
    // the synthetic NA, with a fresh palette colour.
    expect(data.annotations.kingdom.values).toEqual([
      'Bacteria',
      'Archaea',
      'Eukaryota',
      'Viruses',
      NA_VALUE,
    ]);
    expect(data.annotations.kingdom.colors).toEqual([
      '#F3C300',
      '#875692',
      '#F38400',
      '#A1CAF1',
      NA_DEFAULT_COLOR,
    ]);
    // The source is not one of the six proteins, so no `sourceIndex` may be attached.
    expect(data.annotation_predicted!.kingdom[3]).not.toHaveProperty('sourceIndex');

    // Turning the overlay on moves P4 off the NA slot and onto `Viruses`, and leaves
    // every curated row exactly where it was.
    const overlaid = materializeEatOverlay(data, 'kingdom', true);
    expect(Array.from(overlaid.annotation_data.kingdom as Int32Array)).toEqual([1, 0, 0, 3, 0, 2]);
    expect(Array.from(data.annotation_data.kingdom as Int32Array)).toEqual([1, 0, 0, 4, 0, 2]);
  });

  it('stores multi-valued columns as CSR and single-valued ones as flat codes', async () => {
    const { data } = await loadV3();

    for (const key of ['cath', 'go_bp', 'pfam'] as const) {
      const storage = data.annotation_data[key];
      expect(isCsrAnnotationData(storage), key).toBe(true);
      expect(isMultilabelAnnotationData(storage), key).toBe(true);
      expect((storage as { length: number }).length).toBe(PROTEIN_IDS.length);
    }
    for (const key of ['kingdom', 'reviewed', 'predicted_tm'] as const) {
      expect(data.annotation_data[key], key).toBeInstanceOf(Int32Array);
    }
  });

  it('decodes the scored multi column, keeping 1e-200 and 123456789 exact', async () => {
    const { data } = await loadV3();

    // Frequency-sorted, ties by first occurrence; every label appears twice here, so
    // this pins first-occurrence order. `__NA__` is appended last, never sorted in.
    expect(data.annotations.cath).toEqual({
      kind: 'categorical',
      values: [CATH_ENCODED_SEMICOLON, 'G3DSA:6.20.10.10', '6.20.10.10', NA_VALUE],
      colors: ['#F3C300', '#875692', '#F38400', NA_DEFAULT_COLOR],
      shapes: ['circle', 'circle', 'circle', 'circle'],
    });
    // The percent-encoded ';' came back as one label, not three fragments.
    expect(data.annotations.cath.values.some((value) => value?.includes('%3B'))).toBe(false);

    expect(hitsByProtein(data, 'cath')).toEqual({
      P1: {
        labels: [CATH_ENCODED_SEMICOLON, 'G3DSA:6.20.10.10'],
        scores: [[50.2], [60.5]],
        evidence: [],
      },
      P2: { labels: ['6.20.10.10'], scores: [null], evidence: [] },
      P3: { labels: ['G3DSA:6.20.10.10'], scores: [[123456789]], evidence: [] },
      P4: { labels: [NA_VALUE], scores: [null], evidence: [] },
      P5: { labels: [CATH_ENCODED_SEMICOLON], scores: [[1e-200]], evidence: [] },
      P6: { labels: ['6.20.10.10'], scores: [null], evidence: [] },
    });

    // The two values the wire format is float64 for. float32 flushes 1e-200 to zero and
    // re-spells 123456789 as 123456792, so `toEqual` above would already fail - these
    // two say why, and fail loudly if someone widens the comparison instead.
    const [eValue] = getProteinScores(data, PROTEIN_IDS.indexOf('P5'), 'cath')[0]!;
    expect(eValue).toBe(1e-200);
    expect(Math.fround(eValue)).toBe(0);
    const [large] = getProteinScores(data, PROTEIN_IDS.indexOf('P3'), 'cath')[0]!;
    expect(large).toBe(123456789);
    expect(Math.fround(large)).not.toBe(large);
  });

  it('decodes the evidenced multi column against the global evidence dictionary', async () => {
    const { data } = await loadV3();

    expect(data.annotations.go_bp).toEqual({
      kind: 'categorical',
      // 'apoptotic process' has 3 hits, 'protein folding' 2.
      values: ['apoptotic process', 'protein folding', NA_VALUE],
      colors: ['#F3C300', '#875692', NA_DEFAULT_COLOR],
      shapes: ['circle', 'circle', 'circle'],
    });

    expect(hitsByProtein(data, 'go_bp')).toEqual({
      P1: { labels: ['apoptotic process'], scores: [], evidence: ['IDA'] },
      P2: { labels: [NA_VALUE], scores: [], evidence: [null] },
      P3: {
        labels: ['apoptotic process', 'protein folding'],
        scores: [],
        // Both evidence spellings the grammar accepts, on one protein.
        evidence: ['IDA', 'ECO:0000269'],
      },
      P4: { labels: ['protein folding'], scores: [], evidence: ['IEA'] },
      P5: { labels: [NA_VALUE], scores: [], evidence: [null] },
      P6: { labels: ['apoptotic process'], scores: [], evidence: ['EXP'] },
    });
  });

  it('prefix-sums CSR rows correctly with zero hits first, interior and last', async () => {
    const { data } = await loadV3();

    expect(data.annotations.pfam).toEqual({
      kind: 'categorical',
      // The encoded '|' - the grammar's suffix separator - is decoded back into a label.
      values: ['PF00001 (7tm;1)', 'PF00002', PFAM_NON_ASCII, 'PF00003 (a|b)', NA_VALUE],
      colors: ['#F3C300', '#875692', '#F38400', '#A1CAF1', NA_DEFAULT_COLOR],
      shapes: ['circle', 'circle', 'circle', 'circle', 'circle'],
    });

    expect(hitsByProtein(data, 'pfam')).toEqual({
      P1: { labels: [NA_VALUE], scores: [null], evidence: [null] },
      // Two scores on one hit, one on the next: the score_count payload, not a 1:1 map.
      P2: {
        labels: ['PF00001 (7tm;1)', 'PF00002'],
        scores: [[1e-10, 2.5], [0.5]],
        evidence: [null, null],
      },
      P3: { labels: [NA_VALUE], scores: [null], evidence: [null] },
      // P4 immediately follows the interior empty row: its score is what an off-by-one
      // in the inserted-NA `hitEnd` would steal. It is also the one row that crosses a
      // score and an evidence hit inside a single column, and it had a third hit
      // spelled `none` that the reader folded away (see below).
      P4: {
        labels: ['PF00001 (7tm;1)', PFAM_NON_ASCII],
        scores: [[0.25], null],
        evidence: [null, 'IDA'],
      },
      P5: {
        labels: ['PF00003 (a|b)', 'PF00002', 'PF00001 (7tm;1)'],
        // `62.0` and `2.3e-5` on the wire; both are just doubles by the time they land.
        scores: [[3], [62], [2.3e-5]],
        evidence: [null, null, null],
      },
      P6: { labels: [NA_VALUE], scores: [null], evidence: [null] },
    });
  });

  it('folds a missing-value label out of a multi column, dropping its hit entirely', async () => {
    const { data } = await loadV3();

    // Part 6 carries `none` as an ordinary fourth pfam label - the encoder is a faithful
    // container - and the browser drops it from the dictionary AND drops P4's third hit
    // with it, renumbering the codes, the score runs and the evidence codes in lockstep.
    // Without this cell `dropFoldedHits` returns early on every column in the fixture.
    expect(data.annotations.pfam.values).not.toContain('none');
    expect(hitsOf(data, 'pfam', PROTEIN_IDS.indexOf('P4')).labels).toHaveLength(2);
    // Folding must not manufacture a second NA slot, and must not disturb the surviving
    // labels' frequency order.
    expect(data.annotations.pfam.values.filter(isNAValue)).toHaveLength(1);
  });

  it('reads a dictionary whose labels are not pure ASCII', async () => {
    const { data } = await loadV3();

    // Guard on the fixture itself: if this label ever loses its non-ASCII characters the
    // reader silently goes back to slicing the whole blob by character offset, and the
    // byte-range branch stops being covered by real encoder bytes.
    expect(new TextEncoder().encode(PFAM_NON_ASCII).length).toBeGreaterThan(PFAM_NON_ASCII.length);
    // Python measured this label's length in UTF-8 bytes; the browser has to slice the
    // blob by the same measure or every later label in the dictionary shifts.
    expect(data.annotations.pfam.values[2]).toBe(PFAM_NON_ASCII);
    expect(data.annotations.pfam.values[3]).toBe('PF00003 (a|b)');
  });

  it('orders a categorical dictionary by descending frequency, not first occurrence', async () => {
    const { data } = await loadV3();

    // `reviewed` is False, True, True, False, True, True: first occurrence would put
    // `False` first, descending frequency puts `True` first. Dictionary order IS legend
    // order and therefore colour assignment, so this is the assertion that fails if the
    // encoder ever stops sorting.
    expect(data.annotations.reviewed).toEqual({
      kind: 'categorical',
      values: ['True', 'False'],
      colors: ['#F3C300', '#875692'],
      shapes: ['circle', 'circle'],
    });
    expect(Array.from(data.annotation_data.reviewed as Int32Array)).toEqual([1, 0, 0, 1, 0, 0]);
    // Every row has a value, so no synthetic category may be appended.
    expect(data.annotations.reviewed.values.some(isNAValue)).toBe(false);

    // Same divergence on `kingdom`, whose curated values are Archaea, Bacteria,
    // Bacteria, <blank>, Bacteria, Eukaryota.
    expect(data.annotations.kingdom.values.slice(0, 3)).toEqual([
      'Bacteria',
      'Archaea',
      'Eukaryota',
    ]);
  });

  it('folds every missing-value spelling in one dictionary into a single NA slot', async () => {
    const { data } = await loadV3();

    // The encoder is faithful: part 6 carries `none` (3 rows) and `NA` (1 row) as two
    // ordinary labels, because collapsing them corrupts the Python side. The browser
    // makes the display decision, and must land them in ONE bucket, not two.
    expect(data.annotations.predicted_tm).toEqual({
      kind: 'categorical',
      values: ['TM helix', NA_VALUE],
      colors: ['#F3C300', NA_DEFAULT_COLOR],
      shapes: ['circle', 'circle'],
    });
    expect(data.annotations.predicted_tm.values.filter(isNAValue)).toHaveLength(1);

    const naIndex = data.annotations.predicted_tm.values.findIndex(isNAValue);
    const codes = Array.from(data.annotation_data.predicted_tm as Int32Array);
    expect(codes.filter((code) => code === naIndex)).toHaveLength(4);
    // All three `none` rows plus the single `NA` row, and nothing else.
    expect(codes).toEqual([naIndex, naIndex, 0, naIndex, naIndex, 0]);
  });

  it('reads numeric columns with their declared int/float type and null for blanks', async () => {
    const { data } = await loadV3();

    expect(data.annotations.length).toEqual({
      kind: 'numeric',
      numericType: 'int',
      values: [],
      colors: [],
      shapes: [],
    });
    expect(data.annotations.hydrophobicity).toEqual({
      kind: 'numeric',
      numericType: 'float',
      values: [],
      colors: [],
      shapes: [],
    });
    expect(data.numeric_annotation_data).toEqual({
      length: [120, null, 340, 0, -15, 1024],
      hydrophobicity: [0.5, -1.25, null, 3, 0.001, 42],
      // Not a wire column: synthesised from the EAT confidence companion.
      kingdom__eat_confidence: [null, null, null, 0.5, null, null],
    });
    // A numeric column carries no categorical storage to bin by code. Spelled as the
    // whole key set so `annotation_data['length']` cannot be mistaken for an array length.
    expect(Object.keys(data.annotation_data)).toEqual([...CATEGORICAL]);
  });

  it('interleaves the wide axis columns into a 2D and a 3D projection', async () => {
    const { data } = await loadV3();

    expect(data.projections.map((projection) => projection.name)).toEqual(['pca2', 'umap3']);
    const [pca2, umap3] = data.projections;

    expect(pca2.dimension).toBe(2);
    expect(Array.from(pca2.data)).toEqual([0, 0, 1, 1, 2.5, -3.5, -4, 0.25, 5, 5, -1.5, 2]);
    expect(pca2.metadata).toEqual({ components: 2, dimension: 2, dimensions: 2, source: '' });

    expect(umap3.dimension).toBe(3);
    expect(Array.from(umap3.data)).toEqual([
      ...Array.from({ length: 15 }, (_, index) => index / 4),
      // P6 has no umap3 row at all. The encoder writes 0.0 for it and the browser leaves
      // its zero-initialised slot untouched, so both put it at the origin.
      0,
      0,
      0,
    ]);
    expect(umap3.metadata).toEqual({ n_neighbors: 15, dimension: 3, dimensions: 3, source: '' });
  });
});

describe('v3 -> v2 export round trip: CSR storage is interchangeable with nested', () => {
  it('re-exports every categorical cell the encoder wrote, NA spellings excepted', async () => {
    const { data } = await loadV3();
    const extraction = await extractRowsFromParquetBundle(createParquetBundle(data));

    // The writer still stamps v2, so this proves the v2 cell grammar can be rebuilt from
    // CSR storage: the reserved ';' and '|' inside labels go back out percent-encoded,
    // scores rejoin with ',', evidence with '|'.
    expect(extraction.formatVersion).toBe(2);
    const cells = Object.fromEntries(
      [...extraction.annotationsById].map(([id, row]) => [
        id,
        Object.fromEntries(CATEGORICAL.map((key) => [key, row[key] ?? null])),
      ]),
    );
    const cathSemicolon = 'G3DSA:1.10.10.10 (Ribosomal Protein L15%3B Chain: K%3B domain 2)';
    expect(cells).toEqual({
      P1: {
        cath: `${cathSemicolon}|50.2;G3DSA:6.20.10.10|60.5`,
        go_bp: 'apoptotic process|IDA',
        pfam: null,
        kingdom: 'Archaea',
        reviewed: 'False',
        // Documented non-identity: `none` is a MISSING_VALUE_TOKEN, so it was folded to
        // `__NA__` on read and goes back out as NULL, not as the literal word.
        predicted_tm: null,
      },
      P2: {
        cath: '6.20.10.10',
        go_bp: null,
        pfam: 'PF00001 (7tm%3B1)|1e-10,2.5;PF00002|0.5',
        kingdom: 'Bacteria',
        reviewed: 'True',
        predicted_tm: null,
      },
      P3: {
        cath: 'G3DSA:6.20.10.10|123456789',
        go_bp: 'apoptotic process|IDA;protein folding|ECO:0000269',
        pfam: null,
        kingdom: 'Bacteria',
        reviewed: 'True',
        predicted_tm: 'TM helix',
      },
      P4: {
        cath: null,
        go_bp: 'protein folding|IEA',
        // A score and an evidence code side by side in one cell, and the third hit -
        // the one spelled `none` - gone, the same way the browser drops a folded label
        // out of a v2 cell.
        pfam: `PF00001 (7tm%3B1)|0.25;${PFAM_NON_ASCII}|IDA`,
        // P4's curated cell was blank and now carries a prediction, so the base column
        // goes back out NULL and the label rides in the companion trio instead.
        kingdom: null,
        reviewed: 'False',
        predicted_tm: null,
      },
      P5: {
        cath: `${cathSemicolon}|1e-200`,
        go_bp: null,
        // Both documented score re-spellings. `62.0` loses its trailing `.0` on both
        // sides; `2.3e-5` is where the two languages genuinely differ - Python's
        // `read_tables` writes `2.3e-05`, `String(2.3e-5)` here writes `0.000023`. The
        // double is identical, only the spelling is not.
        pfam: 'PF00003 (a%7Cb)|3;PF00002|62;PF00001 (7tm%3B1)|0.000023',
        kingdom: 'Bacteria',
        reviewed: 'True',
        // The other missing-value spelling in the same column, same treatment.
        predicted_tm: null,
      },
      P6: {
        cath: '6.20.10.10',
        go_bp: 'apoptotic process|EXP',
        pfam: null,
        kingdom: 'Eukaryota',
        reviewed: 'True',
        predicted_tm: 'TM helix',
      },
    });
    // The prediction survives the export as the companion trio it arrived in.
    expect([...extraction.annotationsById.values()].map((row) => row.kingdom__pred_value)).toEqual([
      null,
      null,
      null,
      'Viruses',
      null,
      null,
    ]);
    // The in-memory sentinel is never written as a literal 6-char category.
    for (const row of extraction.annotationsById.values()) {
      expect(Object.values(row)).not.toContain(NA_VALUE);
    }
  });

  it('reloads into the same legend, the same numerics and the same projections', async () => {
    const { data: v3 } = await loadV3();
    const reloaded = await loadLegacy(createParquetBundle(v3));

    expect(reloaded.protein_ids).toEqual(v3.protein_ids);
    // Values, colours and shapes are what the legend and the palette are built from, so
    // they have to survive a shape change that reorders nothing.
    expect(reloaded.annotations).toEqual(v3.annotations);
    expect(reloaded.numeric_annotation_data).toEqual(v3.numeric_annotation_data);
    expect(reloaded.annotation_predicted).toEqual(v3.annotation_predicted);
    expect(
      reloaded.projections.map(({ name, dimension, data }) => ({
        name,
        dimension,
        data: Array.from(data),
      })),
    ).toEqual(
      v3.projections.map(({ name, dimension, data }) => ({
        name,
        dimension,
        data: Array.from(data),
      })),
    );
  });

  it('reloads into nested storage that reads back identically through the accessors', async () => {
    const { data: v3 } = await loadV3();
    const reloaded = await loadLegacy(createParquetBundle(v3));

    // Precondition: the two datasets really are stored differently, otherwise the
    // comparison below proves nothing about CSR at all.
    expect(isCsrAnnotationData(v3.annotation_data.cath)).toBe(true);
    expect(isCsrAnnotationData(reloaded.annotation_data.cath)).toBe(false);
    expect(v3.annotation_data.kingdom).toBeInstanceOf(Int32Array);
    expect(reloaded.annotation_data.kingdom).not.toBeInstanceOf(Int32Array);

    for (const key of CATEGORICAL) {
      for (const [index, id] of v3.protein_ids.entries()) {
        const from3 = hitsOf(v3, key, index);
        const from2 = hitsOf(reloaded, key, index);
        const where = `${key}/${id}`;

        expect(from2.labels, where).toEqual(from3.labels);

        // The documented non-identity, and it applies to BOTH payload families. An empty
        // CSR row owns no hit slot, so the reader inserts a synthetic `__NA__` hit for it
        // - and the flat score and evidence payloads are numbered by hit, so that
        // inserted hit reports itself as `null` in whichever families the column carries.
        // Nested storage has no hit there at all and reports nothing. Left as it is on
        // purpose: none of the four consumers (tooltip, export, legend, statistics
        // popover) distinguishes `[null]` from `[]`, and the flat shape is what keeps the
        // score and evidence indices aligned with `getProteinAnnotationIndices`. Asserted
        // as the exact rows it applies to rather than by relaxing the comparison.
        if (NA_ONLY_ROWS[key]?.includes(id)) {
          const { scores, evidence } = PAYLOADS[key];
          expect(from3.labels, where).toEqual([NA_VALUE]);
          expect(from3.scores, where).toEqual(scores ? [null] : []);
          expect(from3.evidence, where).toEqual(evidence ? [null] : []);
          expect(from2.scores, where).toEqual([]);
          expect(from2.evidence, where).toEqual([]);
          continue;
        }

        expect(from2.scores, where).toEqual(from3.scores);
        expect(from2.evidence, where).toEqual(from3.evidence);
      }
    }
  });
});

describe('v2 and v3 fixtures agree on the values they share', () => {
  it('gives P1 and P2 the same ids, cath/go_bp hits and pca2 coordinates', async () => {
    const { data: v3 } = await loadV3();
    const v2 = await loadLegacy(fixture('v2-sample.parquetbundle'));

    // The v3 fixture is a superset: 6 proteins to the v2 sample's 2, and 8 columns to
    // its 2. Only the shared prefix is comparable.
    expect(v2.protein_ids).toEqual(v3.protein_ids.slice(0, 2));

    for (const [index, id] of v2.protein_ids.entries()) {
      const cath3 = hitsOf(v3, 'cath', index);
      expect(hitsOf(v2, 'cath', index), `cath/${id}`).toEqual(cath3);

      const go2 = hitsOf(v2, 'go_bp', index);
      const go3 = hitsOf(v3, 'go_bp', index);
      expect(go2.labels, `go_bp/${id}`).toEqual(go3.labels);
      expect(go2.scores, `go_bp/${id}`).toEqual(go3.scores);
      // P2's go_bp cell is empty in both fixtures, which is the same nested-vs-CSR
      // non-identity the round trip above documents.
      expect(go2.evidence, `go_bp/${id}`).toEqual(id === 'P2' ? [] : go3.evidence);
    }
    expect(hitsOf(v2, 'go_bp', 0).evidence).toEqual(['IDA']);

    const pca2v2 = v2.projections.find((projection) => projection.name === 'pca2')!;
    const pca2v3 = v3.projections.find((projection) => projection.name === 'pca2')!;
    expect(pca2v2.dimension).toBe(pca2v3.dimension);
    expect(Array.from(pca2v2.data)).toEqual(Array.from(pca2v3.data.subarray(0, 4)));
  });
});
