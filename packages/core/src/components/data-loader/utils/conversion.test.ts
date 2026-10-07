import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createParquetBundle,
  getProteinAnnotationIndices,
  getProteinEvidence,
  getProteinScores,
  isCsrAnnotationData,
  materializeEatOverlay,
  materializeVisualizationData,
} from '@protspace/utils';
import type { CsrAnnotationData, VisualizationData } from '@protspace/utils';
import {
  convertParquetToVisualizationData,
  convertParquetToVisualizationDataOptimized,
  normalizeEatCompanionColumns,
  parseAnnotationValue,
  splitCategoricalAnnotationValues,
} from './conversion';
import {
  decodeParquetBundle,
  extractRowsFromParquetBundle,
  type BundleExtractionResult,
} from './bundle';

/** Export `data` and read it back, as a user re-importing their own export would. */
const reimport = async (data: VisualizationData): Promise<VisualizationData> =>
  (await decodeParquetBundle(createParquetBundle(data))).data;

function makeCollisionExtraction(
  formatVersion: number,
  options: { withEat: boolean },
): BundleExtractionResult {
  const eatP1 = options.withEat
    ? {
        ec: '1.1.1.1',
        ec__pred_value: null,
        ec__pred_confidence: null,
        ec__pred_source: null,
      }
    : {};
  const eatP2 = options.withEat
    ? {
        ec: null,
        ec__pred_value: '2.2.2.2',
        ec__pred_confidence: 0.8,
        ec__pred_source: 'P1',
      }
    : {};
  const annotationsById = new Map([
    [
      'P1',
      {
        identifier: 'P1',
        ec__eat_confidence: 0.125,
        ...eatP1,
      },
    ],
    [
      'P2',
      {
        identifier: 'P2',
        ec__eat_confidence: 0.875,
        ...eatP2,
      },
    ],
  ]);
  return {
    projections: [
      { identifier: 'P1', projection_name: 'umap', x: 0, y: 0 },
      { identifier: 'P2', projection_name: 'umap', x: 1, y: 1 },
    ],
    annotationsById,
    projectionIdColumn: 'identifier',
    annotationIdColumn: 'identifier',
    projectionsMetadata: [],
    settings: null,
    formatVersion,
  };
}

describe('parseAnnotationValue', () => {
  it.each([
    [
      'label without pipe is the full string with empty scores',
      'taxonomy_value',
      'taxonomy_value',
      [],
      null,
    ],
    [
      'label|score with a single numeric score',
      'PF00001 (7tm_1)|1.5e-10',
      'PF00001 (7tm_1)',
      [1.5e-10],
      null,
    ],
    [
      'label|score1,score2 with comma-separated scores',
      'PF00001|1.5e-10,2.3e-5',
      'PF00001',
      [1.5e-10, 2.3e-5],
      null,
    ],
    [
      'non-numeric text after the pipe stays in the label',
      'GO:0005524|ATP binding',
      'GO:0005524|ATP binding',
      [],
      null,
    ],
    ['empty string', '', '', [], null],
    ['whitespace-only string', '   ', '', [], null],
    ['pipe at end of string', 'label|', 'label|', [], null],
    ['negative numeric score', 'domain|-3.5', 'domain', [-3.5], null],
    ['zero score', 'domain|0', 'domain', [0], null],
    ['any non-numeric part keeps the whole label', 'label|1.5,abc', 'label|1.5,abc', [], null],
    [
      'multiple pipes: the last pipe wins',
      'GO:123|description|1.5e-3',
      'GO:123|description',
      [1.5e-3],
      null,
    ],
    ['Cytoplasm|EXP has EXP evidence', 'Cytoplasm|EXP', 'Cytoplasm', [], 'EXP'],
    [
      'apoptotic process|IDA has IDA evidence',
      'apoptotic process|IDA',
      'apoptotic process',
      [],
      'IDA',
    ],
    ['a long unknown code is not evidence', 'value|TOOLONG123', 'value|TOOLONG123', [], null],
    ['a single uppercase letter is not evidence', 'value|A', 'value|A', [], null],
    ['a raw ECO id is evidence', 'Cytoplasm|ECO:0000269', 'Cytoplasm', [], 'ECO:0000269'],
    ['a numeric suffix is a score, not evidence', 'PF00001|162.3', 'PF00001', [162.3], null],
  ] as const)('%s', (_, raw, label, scores, evidence) => {
    expect(parseAnnotationValue(raw)).toEqual({ label, scores, evidence });
  });

  it.each([
    // Original 11
    'EXP',
    'HDA',
    'IDA',
    'TAS',
    'NAS',
    'IC',
    'ISS',
    'SAM',
    'COMB',
    'IMP',
    'IEA',
    // Additional GO evidence codes
    'IPI',
    'IGI',
    'IEP',
    'HTP',
    'HMP',
    'HGI',
    'HEP',
    'IBA',
    'IBD',
    'IKR',
    'IRD',
    'ISA',
    'ISO',
    'ISM',
    'RCA',
    'ND',
  ])('parses the GO evidence code %s', (code) => {
    expect(parseAnnotationValue(`some label|${code}`)).toEqual({
      label: 'some label',
      scores: [],
      evidence: code,
    });
  });
});

describe('splitCategoricalAnnotationValues', () => {
  it('splits distinct hits on the top-level ; separator', () => {
    expect(splitCategoricalAnnotationValues('PF00001 (7tm_1)|1.5e-10;PF00002 (Foo)|30.0')).toEqual([
      'PF00001 (7tm_1)|1.5e-10',
      'PF00002 (Foo)|30.0',
    ]);
  });

  it('keeps a CATH-Gene3D name containing ";" intact as a single category', () => {
    // Real-world shape: the name itself contains semicolons inside the parentheses.
    expect(
      splitCategoricalAnnotationValues(
        'G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2',
      ),
    ).toEqual(['G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2']);
  });

  it('splits two CATH hits whose names both contain ";"', () => {
    expect(
      splitCategoricalAnnotationValues(
        'G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2;' +
          'G3DSA:2.40 (Acid Proteases; Chain A)|30.0',
      ),
    ).toEqual([
      'G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2',
      'G3DSA:2.40 (Acid Proteases; Chain A)|30.0',
    ]);
  });

  it('handles nested balanced parentheses in a name', () => {
    expect(
      splitCategoricalAnnotationValues('G3DSA:2.60 (3-Layer(aba) Sandwich; domain 1)|12.0'),
    ).toEqual(['G3DSA:2.60 (3-Layer(aba) Sandwich; domain 1)|12.0']);
  });

  it('still splits plain multi-value cells without parentheses', () => {
    expect(splitCategoricalAnnotationValues('Cytoplasm;Nucleus;Membrane')).toEqual([
      'Cytoplasm',
      'Nucleus',
      'Membrane',
    ]);
  });

  it('falls back to a plain split when a name has an unbalanced "(" so distinct hits are not merged', () => {
    // The name "YojJ-like (1" never closes its paren; depth never returns to 0, so the
    // paren-aware scan would swallow the inter-hit ";". The fallback keeps the two hits apart.
    expect(
      splitCategoricalAnnotationValues('G3DSA:1.10 (YojJ-like (1)|9.0;G3DSA:3.40 (Bar)|8.0'),
    ).toEqual(['G3DSA:1.10 (YojJ-like (1)|9.0', 'G3DSA:3.40 (Bar)|8.0']);
  });

  it('returns an empty array for missing cells', () => {
    expect(splitCategoricalAnnotationValues(null)).toEqual([]);
    expect(splitCategoricalAnnotationValues('')).toEqual([]);
  });
});

describe('EAT companion normalization', () => {
  it('preserves every exact-fixture EC hit for O88488 transferred from P0C5E4', async () => {
    const file = readFileSync(
      new URL(
        '../../../../../../apps/web/tests/fixtures/phosphatase_eat.parquetbundle',
        import.meta.url,
      ),
    );
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const extraction = await extractRowsFromParquetBundle(buffer);
    const data = await convertParquetToVisualizationDataOptimized(extraction);
    const proteinIndex = data.protein_ids.indexOf('O88488');
    const prediction = data.annotation_predicted?.ec?.[proteinIndex];
    const expectedLabels = [
      '3.1.3.36 (phosphoinositide 5-phosphatase)',
      '3.1.3.67 (phosphatidylinositol-3,4,5-trisphosphate 3-phosphatase)',
      '3.1.3.86 (phosphatidylinositol-3,4,5-trisphosphate 5-phosphatase)',
      '3.1.3.95 (phosphatidylinositol-3,5-bisphosphate 3-phosphatase)',
    ];

    expect(extraction.annotationsById.get('O88488')?.ec__pred_source).toBe('P0C5E4');
    expect(extraction.annotationsById.get('O88488')?.ec__pred_value).toBe(expectedLabels.join(';'));
    expect(prediction).toMatchObject({ source: 'P0C5E4' });
    expect(prediction?.values).toEqual(expectedLabels);
    const materialized = materializeEatOverlay(data, 'ec', true);
    expect(
      getProteinAnnotationIndices(materialized.annotation_data.ec, proteinIndex).map(
        (valueIndex) => materialized.annotations.ec.values[valueIndex],
      ),
    ).toEqual(expectedLabels);
  });

  it('normalizes valid transfers, preserves curated precedence, and hides storage columns', () => {
    const data = convertParquetToVisualizationData([
      {
        identifier: 'P1',
        projection_name: 'umap',
        x: 0,
        y: 0,
        ec: '1.1.1.1;2.2.2.2',
        ec__pred_value: '9.9.9.9',
        ec__pred_confidence: 0.99,
        ec__pred_source: 'REF0',
      },
      {
        identifier: 'P2',
        projection_name: 'umap',
        x: 1,
        y: 1,
        ec: null,
        ec__pred_value: '1.1.1.1',
        ec__pred_confidence: 0.8,
        ec__pred_source: 'P1',
      },
      {
        identifier: 'P3',
        projection_name: 'umap',
        x: 2,
        y: 2,
        ec: null,
        ec__pred_value: '2.2.2.2',
        ec__pred_confidence: 0.35,
        ec__pred_source: 'P1',
      },
      {
        identifier: 'P4',
        projection_name: 'umap',
        x: 3,
        y: 3,
        ec: null,
        ec__pred_value: '3.3.3.3',
        ec__pred_confidence: 1.1,
        ec__pred_source: 'P1',
      },
    ]);

    expect(Object.keys(data.annotations)).not.toContain('ec__pred_value');
    expect(Object.keys(data.annotations)).not.toContain('ec__pred_confidence');
    expect(Object.keys(data.annotations)).not.toContain('ec__pred_source');
    expect(data.annotation_predicted?.ec).toEqual([
      null,
      { value: '1.1.1.1', confidence: 0.8, source: 'P1' },
      { value: '2.2.2.2', confidence: 0.35, source: 'P1' },
      null,
    ]);
    expect(data.annotations.ec.values).toEqual(['1.1.1.1', '2.2.2.2', '__NA__']);
    expect(data.numeric_annotation_data?.ec__eat_confidence).toEqual(
      new Float64Array([NaN, 0.8, 0.35, NaN]),
    );
  });

  it('retains ordered multi-valued transfers with aligned score and evidence metadata', () => {
    const data = convertParquetToVisualizationData([
      {
        identifier: 'REF',
        projection_name: 'umap',
        x: 0,
        y: 0,
        ec: '1.1.1.1',
        ec__pred_value: null,
        ec__pred_confidence: null,
        ec__pred_source: null,
      },
      {
        identifier: 'QUERY',
        projection_name: 'umap',
        x: 1,
        y: 1,
        ec: null,
        ec__pred_value: '2.2.2.2|0.91;3.3.3.3|EXP',
        ec__pred_confidence: 0.84,
        ec__pred_source: 'REF',
      },
    ]);

    expect(data.annotation_predicted?.ec[1]).toMatchObject({
      value: '2.2.2.2;3.3.3.3',
      values: ['2.2.2.2', '3.3.3.3'],
      scores: [[0.91], null],
      evidence: [null, 'EXP'],
      confidence: 0.84,
      source: 'REF',
    });
    expect(data.annotations.ec.values).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3', '__NA__']);
    expect(
      getProteinAnnotationIndices(materializeEatOverlay(data, 'ec', true).annotation_data.ec, 1),
    ).toEqual([1, 2]);
  });

  it('loads migrated CLI v2 cells and opaque reserved-character source ids losslessly', async () => {
    const sourceId = 'P0|ref;literal%3B';
    const data = await convertParquetToVisualizationDataOptimized({
      projections: [
        { identifier: sourceId, projection_name: 'umap', x: 0, y: 0 },
        { identifier: 'QUERY', projection_name: 'umap', x: 1, y: 1 },
      ],
      annotationsById: new Map([
        [
          sourceId,
          {
            identifier: sourceId,
            ec: 'ACC (Name%3B part)|EXP',
            literal_percent: 'plain',
            ec__pred_value: null,
            ec__pred_confidence: null,
            ec__pred_source: null,
          },
        ],
        [
          'QUERY',
          {
            identifier: 'QUERY',
            ec: null,
            literal_percent: 'name%253Bpart',
            ec__pred_value: 'ACC (Name%3B part)|EXP',
            ec__pred_confidence: 0.88,
            ec__pred_source: 'P0%7Cref%3Bliteral%253B',
          },
        ],
      ]),
      projectionIdColumn: 'identifier',
      annotationIdColumn: 'identifier',
      projectionsMetadata: [],
      settings: null,
      statistics: null,
      formatVersion: 2,
    });

    expect(data.annotations.ec.values).toContain('ACC (Name; part)');
    expect(data.annotations.literal_percent.values).toContain('name%3Bpart');
    expect(data.annotation_predicted?.ec[1]).toMatchObject({
      value: 'ACC (Name; part)',
      evidence: ['EXP'],
      source: sourceId,
      confidence: 0.88,
    });
    expect(data.annotation_predicted?.ec[1]?.sourceIndex).toBe(0);
  });

  it('removes incomplete reserved companions without creating ambiguous predictions', () => {
    const data = convertParquetToVisualizationData([
      {
        identifier: 'P1',
        projection_name: 'umap',
        x: 0,
        y: 0,
        ec: null,
        ec__pred_value: '1.1.1.1',
      },
    ]);

    expect(data.annotations).toHaveProperty('ec');
    expect(data.annotations).not.toHaveProperty('ec__pred_value');
    expect(data.annotation_predicted).toBeUndefined();
  });

  it.each([1, 2])(
    'round-trips a non-EAT v%s user annotation ending in the reserved-looking suffix',
    async (formatVersion) => {
      const original = convertParquetToVisualizationData(
        makeCollisionExtraction(formatVersion, { withEat: false }),
      );
      const reloaded = await reimport(original);

      expect(original.annotations.ec__eat_confidence.runtime).toBeUndefined();
      expect(reloaded.annotations.ec__eat_confidence.runtime).toBeUndefined();
      expect(reloaded.numeric_annotation_data?.ec__eat_confidence).toEqual(
        new Float64Array([0.125, 0.875]),
      );
    },
  );

  it.each([1, 2])(
    'round-trips EAT v%s without overwriting a user confidence-suffix annotation',
    async (formatVersion) => {
      const original = convertParquetToVisualizationData(
        makeCollisionExtraction(formatVersion, { withEat: true }),
      );
      const runtimeConfidence = Object.entries(original.annotations).find(
        ([, annotation]) => annotation.runtime?.role === 'eat-confidence',
      );

      expect(original.numeric_annotation_data?.ec__eat_confidence).toEqual(
        new Float64Array([0.125, 0.875]),
      );
      expect(runtimeConfidence?.[0]).toBe('ec__eat_confidence__runtime_2');
      expect(runtimeConfidence?.[1].runtime?.baseAnnotation).toBe('ec');

      const reloaded = await reimport(original);
      const reloadedRuntime = Object.entries(reloaded.annotations).filter(
        ([, annotation]) => annotation.runtime?.role === 'eat-confidence',
      );

      expect(reloaded.numeric_annotation_data?.ec__eat_confidence).toEqual(
        new Float64Array([0.125, 0.875]),
      );
      expect(reloaded.annotation_predicted?.ec).toEqual([
        null,
        { value: '2.2.2.2', confidence: expect.closeTo(0.8, 5), source: 'P1' },
      ]);
      expect(reloadedRuntime).toHaveLength(1);
      expect(reloadedRuntime[0]?.[1].runtime?.baseAnnotation).toBe('ec');
    },
  );

  it('omits selected materialized confidence from wire data and reconstructs one runtime view', async () => {
    const original = convertParquetToVisualizationData([
      {
        identifier: 'P1',
        projection_name: 'umap',
        x: 0,
        y: 0,
        ec: '1.1.1.1',
        ec__pred_value: null,
        ec__pred_confidence: null,
        ec__pred_source: null,
      },
      {
        identifier: 'P2',
        projection_name: 'umap',
        x: 1,
        y: 1,
        ec: null,
        ec__pred_value: '2.2.2.2',
        ec__pred_confidence: 0.8,
        ec__pred_source: 'P1',
      },
    ]);
    const confidenceEntry = Object.entries(original.annotations).find(
      ([, annotation]) => annotation.runtime?.role === 'eat-confidence',
    );
    expect(confidenceEntry).toBeDefined();
    const [confidenceKey, confidenceAnnotation] = confidenceEntry!;

    const selectedView = materializeVisualizationData(original, {}, 10, confidenceKey);
    expect(selectedView.annotations[confidenceKey].kind).toBe('categorical');
    expect(selectedView.annotations[confidenceKey].runtime).toEqual(confidenceAnnotation.runtime);

    const reloaded = await reimport(selectedView);
    const reloadedRuntime = Object.entries(reloaded.annotations).filter(
      ([, annotation]) => annotation.runtime?.role === 'eat-confidence',
    );
    expect(Object.keys(reloaded.annotations).sort()).toEqual(['ec', confidenceKey].sort());
    expect(reloadedRuntime).toHaveLength(1);
    expect(reloadedRuntime[0]?.[1].runtime).toEqual(confidenceAnnotation.runtime);
    expect(reloaded.annotation_predicted?.ec[1]).toMatchObject({
      value: '2.2.2.2',
      source: 'P1',
    });
    expect(reloaded.annotation_predicted?.ec[1]?.confidence).toBeCloseTo(0.8, 5);
  });

  it('round-trips curated missing cells and companions from a materialized overlay', async () => {
    const original = convertParquetToVisualizationData([
      {
        identifier: 'P1',
        projection_name: 'umap',
        x: 0,
        y: 0,
        ec: '1.1.1.1;2.2.2.2',
        ec__pred_value: null,
        ec__pred_confidence: null,
        ec__pred_source: null,
      },
      {
        identifier: 'P2',
        projection_name: 'umap',
        x: 1,
        y: 1,
        ec: null,
        ec__pred_value: '1.1.1.1',
        ec__pred_confidence: 0.8,
        ec__pred_source: 'P1',
      },
    ]);
    expect(
      getProteinAnnotationIndices(original.annotation_data.ec, 0).map(
        (index) => original.annotations.ec.values[index],
      ),
    ).toEqual(['1.1.1.1', '2.2.2.2']);
    const displayed = materializeEatOverlay(original, 'ec', true);
    expect(
      getProteinAnnotationIndices(displayed.annotation_data.ec, 0).map(
        (index) => displayed.annotations.ec.values[index],
      ),
    ).toEqual(['1.1.1.1', '2.2.2.2']);
    const reloaded = await reimport(displayed);

    expect(reloaded.annotation_predicted?.ec[1]).toMatchObject({
      value: '1.1.1.1',
      source: 'P1',
    });
    expect(reloaded.annotation_predicted?.ec[1]?.confidence).toBeCloseTo(0.8, 5);
    expect(reloaded.numeric_annotation_data?.ec__eat_confidence?.[1]).toBeCloseTo(0.8, 5);
    expect(reloaded.annotations).not.toHaveProperty('ec__pred_value');
    const ecValues = reloaded.annotations.ec.values;
    expect(
      getProteinAnnotationIndices(reloaded.annotation_data.ec, 0).map((index) => ecValues[index]),
    ).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(
      getProteinAnnotationIndices(reloaded.annotation_data.ec, 1).map((index) => ecValues[index]),
    ).toEqual(['__NA__']);
  });

  it('normalizes EAT in the optimized merged-row path', async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      identifier: `P${index}`,
      projection_name: 'umap',
      x: index,
      y: index,
      ec: index === 1 ? null : '1.1.1.1',
      ec__pred_value: index === 1 ? '2.2.2.2' : null,
      ec__pred_confidence: index === 1 ? 0.7 : null,
      ec__pred_source: index === 1 ? 'P0' : null,
    }));

    const data = await convertParquetToVisualizationDataOptimized(rows);
    expect(data.annotation_predicted?.ec[1]).toEqual({
      value: '2.2.2.2',
      confidence: 0.7,
      source: 'P0',
    });
    expect(data.annotations).not.toHaveProperty('ec__pred_value');
  });

  it('normalizes EAT in the optimized separated-bundle path', async () => {
    const projections = Array.from({ length: 10_000 }, (_, index) => ({
      identifier: `P${index}`,
      projection_name: 'umap',
      x: index,
      y: index,
    }));
    const annotationsById = new Map(
      projections.map((row, index) => [
        row.identifier,
        {
          identifier: row.identifier,
          ec: index === 1 ? null : '1.1.1.1',
          ec__pred_value: index === 1 ? '2.2.2.2' : null,
          ec__pred_confidence: index === 1 ? 0.7 : null,
          ec__pred_source: index === 1 ? 'P0' : null,
        },
      ]),
    );

    const data = await convertParquetToVisualizationDataOptimized({
      projections,
      annotationsById,
      projectionIdColumn: 'identifier',
      annotationIdColumn: 'identifier',
      projectionsMetadata: [],
      settings: null,
    });
    expect(data.annotation_predicted?.ec[1]).toEqual({
      value: '2.2.2.2',
      confidence: 0.7,
      source: 'P0',
    });
    expect(data.annotations).not.toHaveProperty('ec__pred_source');
  });
});

describe('parseAnnotationValue v2', () => {
  it('decodes an encoded name and keeps the score', () => {
    const raw = 'G3DSA:1.10 (Ribosomal Protein L15%3B Chain: K)|50.2';
    const r = parseAnnotationValue(raw, 2);
    expect(r.label).toBe('G3DSA:1.10 (Ribosomal Protein L15; Chain: K)');
    expect(r.scores).toEqual([50.2]);
    expect(r.evidence).toBeNull();
  });
  it('decodes evidence-coded value', () => {
    expect(parseAnnotationValue('Cytoplasm|EXP', 2)).toEqual({
      label: 'Cytoplasm',
      scores: [],
      evidence: 'EXP',
    });
  });
  it('v2 discriminating test: decodes encoded reserved char in label with evidence code', () => {
    // Under v2, the label 'Cytop%3Blasm' (with encoded semicolon) should be decoded to 'Cytop;lasm'
    const v2Result = parseAnnotationValue('Cytop%3Blasm|EXP', 2);
    expect(v2Result).toEqual({
      label: 'Cytop;lasm',
      scores: [],
      evidence: 'EXP',
    });
    // Under v1, the label would remain encoded as 'Cytop%3Blasm' (not decoded),
    // but evidence code is still recognized
    const v1Result = parseAnnotationValue('Cytop%3Blasm|EXP', 1);
    expect(v1Result.label).toBe('Cytop%3Blasm');
    expect(v1Result.evidence).toBe('EXP');
  });
});

describe('splitCategoricalAnnotationValues v2', () => {
  it('plain-splits on ; (names carry no raw ;)', () => {
    const raw = 'A (n%3B1)|1;B (n%3B2)|2';
    expect(splitCategoricalAnnotationValues(raw, 2)).toEqual(['A (n%3B1)|1', 'B (n%3B2)|2']);
  });
});

describe('normalizeEatCompanionColumns over CSR storage (bundle format v3)', () => {
  /**
   * Base column `ec` in CSR, values `['A', null, 'B']`. Nothing points at the `null`
   * slot, so every hit survives the remap and only the value INDICES shift (B: 2 → 1):
   *   p0 → []      (curated missing → the EAT companion applies)
   *   p1 → [A]
   *   p2 → [B]
   *   p3 → [A, B]
   * The companion `ec__pred_value` is CSR too, with its scores/evidence in the flat
   * v3 payloads rather than the nested records.
   */
  function csrEatData(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array(8) }],
      annotations: {
        ec: {
          kind: 'categorical',
          values: ['A', null, 'B'],
          colors: ['#f00', '#0f0', '#00f'],
          shapes: ['circle', 'circle', 'circle'],
        },
        ec__pred_value: {
          kind: 'categorical',
          values: ['C'],
          colors: ['#fff'],
          shapes: ['circle'],
        },
        ec__pred_confidence: { kind: 'numeric', numericType: 'float', values: [] },
        ec__pred_source: {
          kind: 'categorical',
          values: ['p1'],
          colors: ['#fff'],
          shapes: ['circle'],
        },
      },
      annotation_data: {
        ec: {
          kind: 'csr',
          offsets: Int32Array.of(0, 0, 1, 2, 4),
          codes: Int32Array.of(0, 2, 0, 2),
          length: 4,
        },
        ec__pred_value: {
          kind: 'csr',
          offsets: Int32Array.of(0, 1, 1, 1, 1),
          codes: Int32Array.of(0),
          length: 4,
          scores: { offsets: Int32Array.of(0, 2), values: Float64Array.of(0.5, 0.25) },
          evidence: { codes: Int32Array.of(0), dict: ['IDA'] },
        },
        ec__pred_source: {
          kind: 'csr',
          offsets: Int32Array.of(0, 1, 1, 1, 1),
          codes: Int32Array.of(0),
          length: 4,
        },
      },
      numeric_annotation_data: { ec__pred_confidence: new Float64Array([0.9, NaN, NaN, NaN]) },
    };
  }

  it('remaps CSR storage into fresh buffers', () => {
    const src = csrEatData();
    const sourceRows = src.annotation_data.ec as CsrAnnotationData;
    const out = normalizeEatCompanionColumns(src);
    const rows = out.annotation_data.ec;
    if (!isCsrAnnotationData(rows)) throw new Error('expected CSR storage');

    // 'A','B' survive, the unreferenced null slot leaves the value list, 'C' is
    // appended by the transfer — so 'B' moves from index 2 to index 1.
    expect(out.annotations.ec.values).toEqual(['A', 'B', 'C']);
    // The transfer itself stays in `annotation_predicted`; only the curated rows
    // are remapped here (materializeEatOverlay applies the prediction later).
    expect(getProteinAnnotationIndices(rows, 0)).toEqual([]);
    expect(getProteinAnnotationIndices(rows, 1)).toEqual([0]); // 'A'
    expect(getProteinAnnotationIndices(rows, 2)).toEqual([1]); // 'B', renumbered
    expect(getProteinAnnotationIndices(rows, 3)).toEqual([0, 1]);
    expect(Array.from(rows.offsets)).toEqual([0, 0, 1, 2, 4]);

    // The source's buffer is not retained: the remap hands back an exactly-sized fresh one.
    expect(rows.codes.buffer.byteLength).toBe(4 * 4);
    expect(rows.codes.buffer).not.toBe(sourceRows.codes.buffer);
    expect(Array.from(sourceRows.codes)).toEqual([0, 2, 0, 2]);
  });

  it('drops a hit with its score and evidence and keeps every later hit aligned', () => {
    const src = csrEatData();
    // p1's hit now points at the null value slot, which the remap drops, renumbering
    // every later hit.
    src.annotation_data.ec = {
      kind: 'csr',
      offsets: Int32Array.of(0, 0, 1, 2, 4),
      codes: Int32Array.of(1, 2, 0, 2),
      length: 4,
      scores: { offsets: Int32Array.of(0, 1, 2, 3, 4), values: Float64Array.of(1, 2, 3, 4) },
      evidence: { codes: Int32Array.of(0, 1, 2, -1), dict: ['IDA', 'IEA', 'ISS'] },
    };
    const out = normalizeEatCompanionColumns(src);

    expect(getProteinAnnotationIndices(out.annotation_data.ec, 1)).toEqual([]);
    expect(getProteinAnnotationIndices(out.annotation_data.ec, 2)).toEqual([1]); // 'B'
    expect(getProteinAnnotationIndices(out.annotation_data.ec, 3)).toEqual([0, 1]);
    expect(getProteinScores(out, 2, 'ec')).toEqual([[2]]);
    expect(getProteinEvidence(out, 2, 'ec')).toEqual(['IEA']);
    expect(getProteinScores(out, 3, 'ec')).toEqual([[3], [4]]);
    expect(getProteinEvidence(out, 3, 'ec')).toEqual(['ISS', null]);
  });

  it('reads the companion column scores/evidence from the CSR payloads', () => {
    const cell = normalizeEatCompanionColumns(csrEatData()).annotation_predicted?.ec?.[0];
    expect(cell).toMatchObject({
      value: 'C',
      confidence: 0.9,
      source: 'p1',
      scores: [[0.5, 0.25]],
      evidence: ['IDA'],
    });
  });

  it('drops the companion columns, payloads included', () => {
    const out = normalizeEatCompanionColumns(csrEatData());
    expect(out.annotation_data.ec__pred_value).toBeUndefined();
    expect(getProteinScores(out, 0, 'ec__pred_value')).toEqual([]);
  });
});
