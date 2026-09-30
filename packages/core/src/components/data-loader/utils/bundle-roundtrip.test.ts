import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  BUNDLE_DELIMITER_BYTES,
  concatenateBuffers,
  createParquetBundle,
  getProteinAnnotationIndices,
  getProteinEvidence,
  getProteinScores,
  isNAValue,
  materializeEatOverlay,
  materializeVisualizationData,
  type Annotation,
  type BundleSettings,
  type VisualizationData,
} from '@protspace/utils';
import { decodeParquetBundle, extractRowsFromParquetBundle } from './bundle';
import { splitBundleParts } from './bundle-parts';
import { convertParquetToVisualizationData } from './conversion';

const repoFile = (path: string): ArrayBuffer => {
  const file = readFileSync(resolve(__dirname, '../../../../../..', path));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, '__fixtures__', name)));

/** Write `data` as a bundle and read it back through the one public entry point. */
async function exportAndDecode(data: VisualizationData, settings?: BundleSettings) {
  const decoded = await decodeParquetBundle(
    createParquetBundle(data, { includeSettings: settings !== undefined, settings }),
  );
  expect(decoded.formatVersion).toBe(3);
  return decoded;
}

/**
 * What a dataset means, independent of how it is stored: per protein, the hits of every
 * categorical annotation with their scores and evidence, and the values of every numeric
 * one. Missing cells read as no hits, whichever NA representation the reader chose (a v2
 * load keeps no hit for them, a CSR load a synthetic `__NA__` hit), and the runtime-only
 * EAT confidence view is left out because every reader rebuilds it.
 */
function meaning(data: VisualizationData) {
  const annotations: Record<string, unknown> = {};
  for (const [key, annotation] of Object.entries(data.annotations)) {
    if (annotation.runtime) continue;
    if (annotation.kind === 'numeric') {
      annotations[key] = {
        numericType: annotation.numericType,
        values: Array.from(data.numeric_annotation_data?.[key] ?? []),
      };
      continue;
    }
    annotations[key] = data.protein_ids.map((_, row) => {
      const scores = getProteinScores(data, row, key);
      const evidence = getProteinEvidence(data, row, key);
      return getProteinAnnotationIndices(data.annotation_data[key], row).flatMap((code, k) => {
        const label = annotation.values[code];
        if (label == null || isNAValue(label)) return [];
        return [{ label, scores: scores[k] ?? null, evidence: evidence[k] ?? null }];
      });
    });
  }
  return {
    protein_ids: data.protein_ids,
    projections: data.projections.map(({ name, dimension, data: coordinates, metadata }) => ({
      name,
      dimension,
      coordinates: Array.from(coordinates),
      metadata,
    })),
    annotations,
    predicted: data.annotation_predicted ?? {},
  };
}

const categorical = (values: (string | null)[]): Annotation => ({
  kind: 'categorical',
  values,
  colors: values.map(() => '#000000'),
  shapes: values.map(() => 'circle'),
});
const numeric = (numericType: 'int' | 'float'): Annotation => ({
  kind: 'numeric',
  numericType,
  values: [],
  colors: [],
  shapes: [],
});

/**
 * Every storage shape the writer reads from: dense codes (with an unused label, labels out
 * of frequency order and a missing cell), nested multi-valued hits with scores and
 * evidence as a v1/v2 load holds them, CSR hits as a v3 load holds them, numerics with a
 * missing value, and a 2D and a 3D projection, one of which does not place P3.
 */
const handBuilt = (): VisualizationData => ({
  protein_ids: ['P1', 'P2', 'P3', 'P4'],
  projections: [
    {
      name: 'pca2',
      dimension: 2,
      data: Float32Array.of(0, 0, 1.5, -2, 3, 4, -5, 6.25),
      metadata: { dimension: 2, dimensions: 2, method: 'pca' },
    },
    {
      name: 'umap3',
      dimension: 3,
      data: Float32Array.of(1, 2, 3, 4, 5, 6, NaN, NaN, NaN, 7, 8, 9),
      metadata: { dimension: 3, dimensions: 3, n_neighbors: 15 },
    },
  ],
  annotations: {
    organism: categorical(['Mouse', 'unused', 'Human', null]),
    go: categorical(['binding', 'transport; active', 'folding|x']),
    pfam: categorical(['PF00001', 'PF00002', '__NA__']),
    length: numeric('int'),
    ratio: numeric('float'),
  },
  annotation_data: {
    organism: Int32Array.of(2, 0, 2, -1),
    go: [[0, 1], [], [2], [1]],
    pfam: {
      kind: 'csr',
      offsets: Int32Array.of(0, 2, 3, 4, 5),
      codes: Int32Array.of(1, 0, 2, 0, 1),
      length: 4,
      scores: {
        offsets: Int32Array.of(0, 2, 3, 3, 3, 3),
        values: Float64Array.of(1e-200, 2.5, 0.25),
      },
      evidence: { codes: Int32Array.of(-1, 0, -1, 1, -1), dict: ['IDA', 'ECO:0000269'] },
    },
  },
  numeric_annotation_data: {
    length: Float64Array.of(100, NaN, 250, 7),
    ratio: Float64Array.of(0.5, 1.25, NaN, -3),
  },
  annotation_scores: { go: [[[0.5], null], [], [null], [[1e40, 2]]] },
  annotation_evidence: { go: [[null, 'EXP'], [], ['IDA'], [null]] },
});

/** Part `index` (0-based) of a bundle, `null` for a zero-byte slot. */
const partOf = (buffer: ArrayBuffer, index: number) => splitBundleParts(buffer)[index] ?? null;

/** The v3 manifest in part 1's footer. */
const manifestOf = (buffer: ArrayBuffer) =>
  JSON.parse(
    parquetMetadata(partOf(buffer, 0)!).key_value_metadata!.find(
      ({ key }) => key === 'protspace_v3_manifest',
    )!.value!,
  ) as { columns: Record<string, { kind: string; sourceType: string }> };

describe('v3 export: the container', () => {
  it('writes the six-part layout the reader validates, every column REQUIRED and PLAIN', () => {
    const buffer = createParquetBundle(handBuilt());
    const parts = splitBundleParts(buffer);
    expect(parts).toHaveLength(6);
    expect(parts[3]).toBeNull();
    expect(parts[4]).toBeNull();

    for (const index of [0, 2, 5]) {
      const metadata = parquetMetadata(parts[index]!);
      expect(metadata.row_groups).toHaveLength(1);
      for (const field of metadata.schema.slice(1)) {
        expect(field.repetition_type, field.name).toBe('REQUIRED');
      }
      for (const chunk of metadata.row_groups[0].columns) {
        expect(chunk.meta_data?.encodings, chunk.meta_data?.path_in_schema.join('.')).toEqual([
          'PLAIN',
        ]);
      }
    }

    const part1 = parquetMetadata(parts[0]!);
    const kv = Object.fromEntries(part1.key_value_metadata!.map(({ key, value }) => [key, value]));
    expect(kv.protspace_container_version).toBe('3');
    // No cell-grammar key: a v3 part 1 stores decoded labels, not cells.
    expect(kv.protspace_format_version).toBeUndefined();
    expect(JSON.parse(kv.protspace_v3_manifest!)).toEqual({
      idColumn: 'identifier',
      columns: {
        organism: { kind: 'categorical', sourceType: 'string' },
        go: { kind: 'multi', sourceType: 'string', scores: true, evidence: true },
        pfam: { kind: 'multi', sourceType: 'string', scores: true, evidence: true },
        length: { kind: 'numeric', numericType: 'int', sourceType: 'int64' },
        ratio: { kind: 'numeric', numericType: 'float', sourceType: 'double' },
      },
      projections: [
        { name: 'pca2', dimension: 2 },
        { name: 'umap3', dimension: 3 },
      ],
    });
    expect(part1.schema.slice(1).map(({ name, type }) => [name, type])).toEqual([
      ['identifier', 'BYTE_ARRAY'],
      ['organism', 'INT32'],
      ['go__count', 'INT32'],
      ['pfam__count', 'INT32'],
      ['length', 'DOUBLE'],
      ['ratio', 'DOUBLE'],
    ]);
    expect(
      parquetMetadata(parts[2]!)
        .schema.slice(1)
        .map(({ name, type }) => [name, type]),
    ).toEqual([
      ['pca2__x', 'FLOAT'],
      ['pca2__y', 'FLOAT'],
      ['umap3__x', 'FLOAT'],
      ['umap3__y', 'FLOAT'],
      ['umap3__z', 'FLOAT'],
    ]);
  });

  it('writes NaN, never 0, for a protein a projection does not place', async () => {
    const buffer = createParquetBundle(handBuilt());
    const rows = await parquetReadObjects({ file: partOf(buffer, 2)! });
    expect(rows[2]).toMatchObject({ pca2__x: 3, pca2__y: 4 });
    expect([rows[2].umap3__x, rows[2].umap3__y, rows[2].umap3__z]).toEqual([NaN, NaN, NaN]);

    const { data } = await exportAndDecode(handBuilt());
    expect(Array.from(data.projections[1].data.subarray(6, 9))).toEqual([NaN, NaN, NaN]);
  });

  it('stores labels decoded, one dictionary per column, evidence in one shared dictionary', async () => {
    const payloads = await parquetReadObjects({
      file: partOf(createParquetBundle(handBuilt()), 5)!,
      utf8: false,
    });
    const byName = new Map(
      payloads.map(({ name, data }) => [String(name), new Uint8Array(data as Uint8Array)]),
    );
    const text = (name: string) => new TextDecoder().decode(byName.get(name));
    expect(text('dict:go')).toBe('transport; activebindingfolding|x');
    // First use across columns in part 1 order: go's EXP and IDA, then pfam's ECO code.
    expect(text('dict:__evidence')).toBe('EXPIDAECO:0000269');
    expect([...byName.keys()].filter((name) => name.startsWith('dict:__evidence'))).toHaveLength(2);
    // float64, so the E-value survives; the NA hit of P2 owned no score and is gone.
    expect(Array.from(new Float64Array(byName.get('scores:pfam')!.slice().buffer))).toEqual([
      1e-200, 2.5, 0.25,
    ]);
  });
});

describe('v3 export: round trip through decodeParquetBundle', () => {
  it('decodes back to the proteins, hits, scores, evidence, numerics and projections written', async () => {
    const original = handBuilt();
    const { data } = await exportAndDecode(original);

    expect(meaning(data)).toEqual(meaning(original));
  });

  it('orders every dictionary by descending hit count, ties by first occurrence', async () => {
    const { data } = await exportAndDecode(handBuilt());

    // The unused label is dropped and the NA the reader appends goes last.
    expect(data.annotations.organism.values).toEqual(['Human', 'Mouse', '__NA__']);
    expect(data.annotations.go.values).toEqual([
      'transport; active',
      'binding',
      'folding|x',
      '__NA__',
    ]);
    // Two hits each: P1 lists PF00002 first. The in-memory `__NA__` sentinel of P2 is not
    // written as a label; the reader appends its own for the empty row.
    expect(data.annotations.pfam.values).toEqual(['PF00002', 'PF00001', '__NA__']);
  });

  it('is idempotent: re-exporting a decoded export decodes to an equal dataset', async () => {
    const once = (await exportAndDecode(handBuilt())).data;
    const twice = (await exportAndDecode(once)).data;

    expect(twice).toEqual(once);
  });

  it('keeps an all-missing numeric column numeric, with its numeric type', async () => {
    const original = handBuilt();
    original.numeric_annotation_data!.length.fill(NaN);

    const { data } = await exportAndDecode(original);

    expect(data.annotations.length).toMatchObject({ kind: 'numeric', numericType: 'int' });
    expect(Array.from(data.numeric_annotation_data!.length)).toEqual([NaN, NaN, NaN, NaN]);
  });

  it('declares an integer column past 2^53 to Python as float64', () => {
    const original = handBuilt();
    original.numeric_annotation_data!.length[0] = 2 ** 60;

    expect(manifestOf(createParquetBundle(original)).columns.length).toEqual({
      kind: 'numeric',
      numericType: 'int',
      sourceType: 'double',
    });
  });

  it('echoes a carried sourceType for a column that still fits it', () => {
    const original = handBuilt();
    original.annotations.reviewed = {
      ...categorical(['true', 'false', '__NA__']),
      sourceType: 'bool',
    };
    original.annotation_data.reviewed = Int32Array.of(0, 1, 2, 0);
    original.annotations.length.sourceType = 'int32';
    original.annotations.ratio.sourceType = 'float';
    original.annotations.organism.sourceType = 'large_string';

    const columns = manifestOf(createParquetBundle(original)).columns;
    expect(columns.reviewed.sourceType).toBe('bool');
    expect(columns.length.sourceType).toBe('int32');
    expect(columns.ratio.sourceType).toBe('float');
    expect(columns.organism.sourceType).toBe('large_string');
    expect(columns.go.sourceType).toBe('string'); // nothing carried, the writer's default
  });

  it('falls back to the inferred sourceType for a column that no longer fits', () => {
    const original = handBuilt();
    original.annotations.organism.sourceType = 'bool'; // labels are not true / false
    original.annotations.length.sourceType = 'int32';
    original.numeric_annotation_data!.length[0] = 2 ** 40; // past int32
    original.annotations.ratio.sourceType = 'int8'; // ratio holds fractions

    const columns = manifestOf(createParquetBundle(original)).columns;
    expect(columns.organism.sourceType).toBe('string');
    expect(columns.length.sourceType).toBe('int64');
    expect(columns.ratio.sourceType).toBe('double');
  });

  it('writes an empty dictionary for a categorical column with no values at all', async () => {
    const original = handBuilt();
    original.annotation_data.organism = Int32Array.of(-1, -1, -1, -1);

    const { data } = await exportAndDecode(original);

    expect(data.annotations.organism.values).toEqual(['__NA__']);
    expect(Array.from(data.annotation_data.organism as Int32Array)).toEqual([0, 0, 0, 0]);
  });

  it('carries settings and a statistics part byte for byte', async () => {
    const statistics = fixture('stats-sample-statistics.parquet');
    const settings: BundleSettings = {
      legendSettings: {},
      exportOptions: {},
      eatConfidenceThreshold: 0.75,
      shapeSize: 12,
    };
    const original = { ...handBuilt(), statistics: statistics.slice().buffer as ArrayBuffer };

    const decoded = await exportAndDecode(original, settings);

    expect(decoded.settings).toEqual(settings);
    expect(new Uint8Array(decoded.data.statistics!)).toEqual(statistics);
    expect(decoded.data.statisticsRows!.length).toBeGreaterThan(0);
  });
});

describe('v3 export: EAT predictions', () => {
  const withPrediction = (): VisualizationData => {
    const data = handBuilt();
    data.annotation_predicted = {
      organism: [
        null,
        null,
        null,
        {
          value: 'Rat;Human',
          values: ['Rat', 'Human'],
          scores: [[0.91], null],
          evidence: [null, 'EXP'],
          confidence: 0.83,
          source: 'P1|reference;literal%',
        },
      ],
    };
    return data;
  };

  it('writes the companion trio and rebuilds the prediction from it', async () => {
    const original = withPrediction();
    const { data } = await exportAndDecode(original);

    expect(data.annotation_predicted?.organism).toEqual(original.annotation_predicted?.organism);
    expect(Object.keys(data.annotations).filter((key) => key.includes('__pred_'))).toEqual([]);
    // The prediction-only label is back in the legend, after the observed ones.
    expect(data.annotations.organism.values).toEqual(['Human', 'Mouse', 'Rat', '__NA__']);
  });

  it('writes a predicted row as missing in the curated column, even from a materialized overlay', async () => {
    const original = withPrediction();
    const displayed = materializeEatOverlay(original, 'organism', true);

    const { data } = await exportAndDecode(displayed);

    expect(meaning(data)).toEqual(meaning(original));
  });

  it('never writes the runtime confidence view, even materialized as a legend column', async () => {
    const { data: loaded } = await exportAndDecode(withPrediction());
    const [confidenceKey] = Object.entries(loaded.annotations).find(
      ([, annotation]) => annotation.runtime?.role === 'eat-confidence',
    )!;
    const selectedView = materializeVisualizationData(loaded, {}, 10, confidenceKey);

    const manifest = JSON.parse(
      parquetMetadata(partOf(createParquetBundle(selectedView), 0)!).key_value_metadata!.find(
        ({ key }) => key === 'protspace_v3_manifest',
      )!.value!,
    );

    expect(Object.keys(manifest.columns)).not.toContain(confidenceKey);
    expect(manifest.columns.organism__pred_confidence).toEqual({
      kind: 'numeric',
      numericType: 'float',
      sourceType: 'double',
    });
    const { data } = await exportAndDecode(selectedView);
    expect(data.annotation_predicted?.organism[3]?.confidence).toBe(0.83);
  });
});

/**
 * Loading a legacy bundle and exporting it is the browser's converter: it must come out v3
 * and mean exactly what the legacy file meant.
 */
describe('legacy import, v3 export', () => {
  const statsBundle = () =>
    concatenateBuffers(
      [
        fixture('v2-sample.parquetbundle'),
        fixture('stats-sample-settings.parquet'),
        fixture('stats-sample-statistics.parquet'),
      ].map((part) => part.slice().buffer as ArrayBuffer),
      BUNDLE_DELIMITER_BYTES,
    );

  it.each([
    ['v1', () => repoFile('apps/web/tests/fixtures/data_custom.parquetbundle'), 1],
    [
      'v1, raw numerics',
      () => repoFile('apps/web/tests/fixtures/phosphatase_no_binning.parquetbundle'),
      1,
    ],
    [
      'v1, EAT companions',
      () => repoFile('apps/web/tests/fixtures/phosphatase_eat.parquetbundle'),
      1,
    ],
    ['v2', () => fixture('v2-sample.parquetbundle').slice().buffer as ArrayBuffer, 2],
    ['v2 with settings and statistics', statsBundle, 2],
  ])(
    '%s: exports as v3 with the same data, legend, settings and statistics',
    async (_, file, version) => {
      const legacy = await decodeParquetBundle(file());
      expect(legacy.formatVersion).toBe(version);

      const exported = await exportAndDecode(legacy.data, legacy.settings ?? undefined);

      expect(meaning(exported.data)).toEqual(meaning(legacy.data));
      // Same dictionary order, so the same palette lands on the same categories.
      for (const [key, annotation] of Object.entries(legacy.data.annotations)) {
        expect(exported.data.annotations[key]?.values, key).toEqual(annotation.values);
      }
      expect(exported.settings).toEqual(legacy.settings);
      expect(exported.data.statistics).toEqual(legacy.data.statistics);
    },
  );

  it('keeps a BOOLEAN column as the labels true and false', async () => {
    const part = (columnData: Parameters<typeof parquetWriteBuffer>[0]['columnData']) =>
      parquetWriteBuffer({ columnData });
    const v2 = concatenateBuffers(
      [
        part([
          { name: 'identifier', data: ['P1', 'P2', 'P3'], type: 'STRING' },
          { name: 'reviewed', data: [true, false, true], type: 'BOOLEAN' },
        ]),
        part([
          { name: 'projection_name', data: ['pca2'], type: 'STRING' },
          { name: 'dimensions', data: [2], type: 'INT32' },
          { name: 'info_json', data: ['{}'], type: 'STRING' },
        ]),
        part([
          { name: 'projection_name', data: ['pca2', 'pca2', 'pca2'], type: 'STRING' },
          { name: 'identifier', data: ['P1', 'P2', 'P3'], type: 'STRING' },
          { name: 'x', data: [0, 1, 2], type: 'DOUBLE' },
          { name: 'y', data: [0, 1, 2], type: 'DOUBLE' },
        ]),
      ],
      BUNDLE_DELIMITER_BYTES,
    );
    const legacy = await decodeParquetBundle(v2);
    expect(legacy.data.annotations.reviewed.values).toEqual(['true', 'false']);

    const { data } = await exportAndDecode(legacy.data);

    expect(data.annotations.reviewed.values).toEqual(['true', 'false']);
    expect(Array.from(data.annotation_data.reviewed as Int32Array)).toEqual([0, 1, 0]);
  });

  it('re-exports a shipped v3 dataset (5K proteins) to an equal dataset', async () => {
    const shipped = await decodeParquetBundle(repoFile('apps/web/public/data/5K.parquetbundle'));
    expect(shipped.formatVersion).toBe(3);

    const exported = await exportAndDecode(shipped.data, shipped.settings ?? undefined);

    expect(meaning(exported.data)).toEqual(meaning(shipped.data));
    expect(exported.data.annotations).toEqual(shipped.data.annotations);
    expect(exported.settings).toEqual(shipped.settings);
  });

  it('re-exports the golden v3 fixture to an equal dataset', async () => {
    const { data: original } = await decodeParquetBundle(
      fixture('v3-sample.parquetbundle').slice().buffer as ArrayBuffer,
    );

    const { data } = await exportAndDecode(original);

    expect(meaning(data)).toEqual(meaning(original));
    expect(data.annotations).toEqual(original.annotations);
  });

  it("carries the golden fixture's sourceType through a re-export", async () => {
    const file = fixture('v3-sample.parquetbundle').slice().buffer as ArrayBuffer;
    const written = manifestOf(file).columns;
    const { data } = await decodeParquetBundle(file);

    // A Python string column the reader sees as numbers stays a string column for Python.
    expect(written.length).toMatchObject({ kind: 'numeric', sourceType: 'string' });
    expect(data.annotations.length.sourceType).toBe('string');

    const echoed = manifestOf(createParquetBundle(data)).columns;
    for (const [name, annotation] of Object.entries(data.annotations)) {
      if (annotation.runtime) continue;
      expect(echoed[name]?.sourceType, name).toBe(written[name].sourceType);
    }
  });
});

/**
 * The legacy reader's numeric typing, read from fixture files. These do not go through
 * the writer, which no longer produces a legacy bundle.
 */
describe('legacy numeric type inference', () => {
  const loadArrayBuffer = (path: string): ArrayBuffer => {
    const buffer = readFileSync(path);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  };

  it('does not re-label a real DOUBLE-stored integer fixture as float', async () => {
    // raw_numeric_test.parquetbundle stores `length`/`weight` as DOUBLE with
    // wholly integral values — the shape every pre-INT32 frontend export has, and
    // what `protspace bundle -a` produces once pandas promotes an int column with
    // a missing value. Honouring DOUBLE as a 'float' declaration would turn the
    // legend labels from "10 - 25" into "10.0 - 25.0".
    const extraction = await extractRowsFromParquetBundle(
      loadArrayBuffer(
        resolve(
          __dirname,
          '../../../../../../apps/web/tests/fixtures/raw_numeric_test.parquetbundle',
        ),
      ),
    );
    expect(extraction.numericColumnTypes).toMatchObject({ length: 'float', weight: 'float' });

    const data = convertParquetToVisualizationData(extraction);
    expect(data.annotations.length.kind).toBe('numeric');
    expect(data.annotations.length.numericType).toBe('int');
    expect(data.annotations.weight.numericType).toBe('int');
  });

  it('does not read a pyarrow all-null column as an integer declaration', async () => {
    // pyarrow stores a wholly-missing pandas column as arrow `null`, which lands in
    // parquet as `optional int32 ec_number (Null)` — physical INT32 carrying a NULL
    // logical type. Taking the physical type at face value would hand the restore
    // pass an 'int' declaration for a *categorical* column that happens to have no
    // values, rewriting it as a numeric annotation with a gradient legend.
    //
    // Fixture (a 3-part bundle written by pyarrow):
    //   annotations = pa.table({"identifier": pa.array(["P1","P2","P3"]),
    //                           "ec_number": pa.nulls(3),
    //                           "family": pa.array(["A","B","A"])})
    //   parts joined by ---PARQUET_DELIMITER---, part 1 stamped format_version=2
    const extraction = await extractRowsFromParquetBundle(
      loadArrayBuffer(
        resolve(
          __dirname,
          '../../../../../../apps/web/tests/fixtures/all_null_column.parquetbundle',
        ),
      ),
    );
    expect(extraction.numericColumnTypes).not.toHaveProperty('ec_number');

    const data = convertParquetToVisualizationData(extraction);
    expect(data.annotations.ec_number.kind).toBe('categorical');
    expect(data.annotations.family.kind).toBe('categorical');
  });

  it('keeps EAT confidence companions out of the user-visible annotations', async () => {
    // The companion column is written FLOAT, so it legitimately appears in
    // numericColumnTypes. What keeps it out of the legend is that
    // normalizeEatCompanionColumns strips it BEFORE the restore pass runs — an
    // ordering this test pins, since reversing it would resurrect the column as a
    // bogus numeric annotation.
    const extraction = await extractRowsFromParquetBundle(
      loadArrayBuffer(
        resolve(
          __dirname,
          '../../../../../../apps/web/tests/fixtures/phosphatase_eat.parquetbundle',
        ),
      ),
    );
    expect(extraction.numericColumnTypes).toMatchObject({ ec__pred_confidence: 'float' });

    const data = convertParquetToVisualizationData(extraction);
    expect(Object.keys(data.annotations).filter((key) => key.includes('__pred_'))).toEqual([]);
    expect(data.numeric_annotation_data?.ec__pred_confidence).toBeUndefined();
  });
});
