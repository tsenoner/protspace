import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractRowsFromParquetBundle } from './bundle';
import {
  convertParquetToVisualizationData,
  convertParquetToVisualizationDataOptimized,
} from './conversion';
import {
  createParquetBundle,
  countBundleDelimiters,
  findBundleDelimiterPositions,
  isParquetBundle,
  type Annotation,
  type VisualizationData,
} from '@protspace/utils';
import { parquetMetadata } from 'hyparquet';

function loadArrayBuffer(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Round-trip integration tests for parquetbundle files.
 * These tests verify that we can:
 * 1. Read existing parquetbundle files
 * 2. Convert them to VisualizationData
 * 3. Export them back to parquetbundle format without errors
 *
 * This specifically tests that BigInt values from parquet parsing
 * are properly handled and don't cause JSON serialization errors.
 */
describe('round-trip with real data files', () => {
  it('should successfully export 5K.parquetbundle after loading', async () => {
    const filePath = resolve(__dirname, '../../../../../../apps/web/public/data/5K.parquetbundle');
    const arrayBuffer = loadArrayBuffer(filePath);

    // Extract from the bundle
    const extraction = await extractRowsFromParquetBundle(arrayBuffer);

    // Convert to VisualizationData
    const data = convertParquetToVisualizationData(extraction);

    // Verify data was loaded correctly
    expect(data.protein_ids.length).toBeGreaterThan(0);
    expect(data.projections.length).toBeGreaterThan(0);

    // This should not throw "Do not know how to serialize a BigInt"
    const exportedBuffer = createParquetBundle(data);
    expect(exportedBuffer).toBeInstanceOf(ArrayBuffer);
    expect(exportedBuffer.byteLength).toBeGreaterThan(0);
    expect(isParquetBundle(exportedBuffer)).toBe(true);
  });

  it('should successfully export with settings after loading 5K.parquetbundle', async () => {
    const filePath = resolve(__dirname, '../../../../../../apps/web/public/data/5K.parquetbundle');
    const arrayBuffer = loadArrayBuffer(filePath);

    // Extract from the bundle
    const extraction = await extractRowsFromParquetBundle(arrayBuffer);

    // Convert to VisualizationData
    const data = convertParquetToVisualizationData(extraction);

    // Create mock settings
    const mockSettings = {
      legendSettings: {
        testAnnotation: {
          maxVisibleValues: 10,
          shapeSize: 24,
          sortMode: 'size-desc' as const,
          hiddenValues: [],
          categories: {
            category1: { zOrder: 0, color: '#ff0000', shape: 'circle' },
          },
          enableDuplicateStackUI: false,
          selectedPaletteId: 'kellys',
        },
      },
      exportOptions: {
        testAnnotation: {
          imageWidth: 2048,
          imageHeight: 1024,
          lockAspectRatio: true,
          legendWidthPercent: 25,
          legendFontSizePx: 24,
          includeLegendSettings: true,
          includeExportOptions: true,
        },
      },
    };

    // Export with settings - should not throw
    const exportedBuffer = createParquetBundle(data, {
      includeSettings: true,
      settings: mockSettings,
    });

    expect(exportedBuffer).toBeInstanceOf(ArrayBuffer);
    expect(exportedBuffer.byteLength).toBeGreaterThan(0);
    expect(isParquetBundle(exportedBuffer)).toBe(true);

    // Count delimiters - should be 3 for 4-part bundle with settings
    const uint8Array = new Uint8Array(exportedBuffer);
    const delimiterCount = countBundleDelimiters(uint8Array);
    expect(delimiterCount).toBe(3);
  });

  it('re-emits a statistics part behind the zero-byte settings sentinel', async () => {
    const filePath = resolve(__dirname, '../../../../../../apps/web/public/data/5K.parquetbundle');
    const extraction = await extractRowsFromParquetBundle(loadArrayBuffer(filePath));
    const data = convertParquetToVisualizationData(extraction);

    // Stand-in bytes: the writer must carry the part through, never parse it.
    data.statistics = new TextEncoder().encode('PAR1-statistics').buffer as ArrayBuffer;

    const exported = new Uint8Array(createParquetBundle(data));

    // 5 parts even without settings, so statistics stays at position five.
    expect(countBundleDelimiters(exported)).toBe(4);
    expect(new TextDecoder().decode(exported.slice(-15))).toBe('PAR1-statistics');
  });

  it('should preserve raw numeric annotations through export/import', async () => {
    const filePath = resolve(
      __dirname,
      '../../../../../../apps/web/tests/fixtures/phosphatase_no_binning.parquetbundle',
    );
    const arrayBuffer = loadArrayBuffer(filePath);

    const extraction = await extractRowsFromParquetBundle(arrayBuffer);
    const original = convertParquetToVisualizationData(extraction);

    expect(original.annotations.length?.kind).toBe('numeric');
    expect(original.numeric_annotation_data?.length).toBeDefined();

    const exportedBuffer = createParquetBundle(original);
    const reimportedExtraction = await extractRowsFromParquetBundle(exportedBuffer);
    const reimported = convertParquetToVisualizationData(reimportedExtraction);

    expect(reimported.annotations.length?.kind).toBe('numeric');
    expect(reimported.numeric_annotation_data?.length).toEqual(
      original.numeric_annotation_data?.length,
    );
  });

  it('normalizes and losslessly round-trips the supplied phosphatase EAT fixture', async () => {
    const filePath = resolve(
      __dirname,
      '../../../../../../apps/web/tests/fixtures/phosphatase_eat.parquetbundle',
    );
    const original = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(loadArrayBuffer(filePath)),
    );

    expect(original.protein_ids).toHaveLength(832);
    expect(Object.keys(original.annotation_predicted ?? {})).toEqual(['ec', 'protein_families']);
    expect(original.annotation_predicted?.ec.filter(Boolean)).toHaveLength(213);
    expect(original.annotation_predicted?.protein_families.filter(Boolean)).toHaveLength(213);
    expect(Object.keys(original.annotations).some((key) => key.includes('__pred_'))).toBe(false);
    expect(original.annotations).toHaveProperty('ec__eat_confidence');
    const ecCells = original.annotation_predicted?.ec.filter((cell) => cell !== null);
    expect(Math.min(...(ecCells ?? []).map((cell) => cell.confidence))).toBeCloseTo(
      0.3018029332,
      6,
    );
    expect(Math.max(...(ecCells ?? []).map((cell) => cell.confidence))).toBe(1);
    expect(ecCells?.some((cell) => cell.value.includes(';'))).toBe(true);
    expect(ecCells?.every((cell) => cell.source.length > 0)).toBe(true);

    const reloaded = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(createParquetBundle(original)),
    );
    for (const base of ['ec', 'protein_families']) {
      const before = original.annotation_predicted?.[base] ?? [];
      const after = reloaded.annotation_predicted?.[base] ?? [];
      expect(after).toHaveLength(before.length);
      for (let index = 0; index < before.length; index++) {
        expect(after[index]?.value ?? null).toBe(before[index]?.value ?? null);
        expect(after[index]?.source ?? null).toBe(before[index]?.source ?? null);
        if (before[index]) {
          expect(after[index]?.confidence).toBeCloseTo(before[index]!.confidence, 6);
        }
      }
    }
  });

  it('round-trips numeric legend settings through bundle settings', async () => {
    const original = {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1, 2, 2),
          dimension: 2 as const,
        },
      ],
      annotations: {
        length: { kind: 'numeric' as const, values: [], colors: [], shapes: [] },
      },
      annotation_data: {},
      numeric_annotation_data: {
        length: [10, 50, 100],
      },
      annotation_scores: {},
      annotation_evidence: {},
    };

    const settings = {
      legendSettings: {
        length: {
          maxVisibleValues: 5,
          shapeSize: 24,
          sortMode: 'alpha-asc' as const,
          hiddenValues: ['10 - <28'],
          categories: {},
          enableDuplicateStackUI: false,
          selectedPaletteId: 'cividis',
          numericSettings: {
            strategy: 'logarithmic' as const,
            signature: 'abc12345',
            topologySignature: 'def67890',
            reverseGradient: false,
          },
        },
      },
      exportOptions: {},
    };

    const exportedBuffer = createParquetBundle(original, {
      includeSettings: true,
      settings,
    });
    const extracted = await extractRowsFromParquetBundle(exportedBuffer);

    expect(extracted.settings).toEqual(settings);
  });

  it('drops the legacy includeShapes field when extracting a bundle', async () => {
    const original = {
      protein_ids: ['P1', 'P2'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1),
          dimension: 2 as const,
        },
      ],
      annotations: {
        family: {
          kind: 'categorical' as const,
          values: ['A', 'B'],
          colors: ['#1F77B4', '#FF7F0E'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        family: [[0], [1]],
      },
      annotation_scores: {},
      annotation_evidence: {},
    };

    // Simulate a bundle authored before issue #252: legendSettings carries the
    // removed `includeShapes` flag. The extraction path must accept it and
    // strip it via normalizeBundleSettings, never surfacing it to callers.
    const legacySettings = {
      legendSettings: {
        family: {
          maxVisibleValues: 10,
          shapeSize: 24,
          sortMode: 'size-desc' as const,
          hiddenValues: [],
          categories: {
            A: { zOrder: 0, color: '#1F77B4', shape: 'circle' },
          },
          enableDuplicateStackUI: false,
          selectedPaletteId: 'kellys',
          includeShapes: true,
        },
      },
      exportOptions: {},
    };

    const exportedBuffer = createParquetBundle(original, {
      includeSettings: true,
      settings: legacySettings,
    });
    const extracted = await extractRowsFromParquetBundle(exportedBuffer);

    const familySettings = extracted.settings?.legendSettings?.family;
    expect(familySettings).toBeDefined();
    expect(familySettings).not.toHaveProperty('includeShapes');
    // The rest of the legacy settings survive normalization untouched.
    expect(familySettings?.selectedPaletteId).toBe('kellys');
    expect(familySettings?.categories.A).toEqual({
      zOrder: 0,
      color: '#1F77B4',
      shape: 'circle',
    });
  });
});

describe('metadata preservation through round-trip', () => {
  /**
   * Helper to normalize metadata for comparison.
   * Removes internal fields that are expected to differ (dimensions vs dimension).
   */
  function normalizeMetadata(metadata: Record<string, unknown> | undefined) {
    if (!metadata) return {};
    const { dimension, dimensions, ...rest } = metadata;
    return rest;
  }

  it('should preserve projection metadata fields through export/import cycle (5K)', async () => {
    const filePath = resolve(__dirname, '../../../../../../apps/web/public/data/5K.parquetbundle');
    const arrayBuffer = loadArrayBuffer(filePath);

    // Load original
    const extraction = await extractRowsFromParquetBundle(arrayBuffer);
    const original = convertParquetToVisualizationData(extraction);

    // Export (without settings)
    const exportedBuffer = createParquetBundle(original);

    // Re-import
    const extraction2 = await extractRowsFromParquetBundle(exportedBuffer);
    const reimported = convertParquetToVisualizationData(extraction2);

    // 1. Protein IDs must be identical
    expect(reimported.protein_ids).toEqual(original.protein_ids);

    // 2. Projections count must match
    expect(reimported.projections.length).toBe(original.projections.length);

    // 3. Each projection must match
    for (let i = 0; i < original.projections.length; i++) {
      const origProj = original.projections[i];
      const reimportedProj = reimported.projections[i];

      // Name must match
      expect(reimportedProj.name).toBe(origProj.name);

      // Coordinates must be identical
      expect(reimportedProj.data).toEqual(origProj.data);

      // Metadata fields must match (excluding dimension/dimensions)
      const origMeta = normalizeMetadata(origProj.metadata);
      const reimportedMeta = normalizeMetadata(reimportedProj.metadata);
      expect(reimportedMeta).toEqual(origMeta);
    }

    // 4. Annotation names must be identical
    expect(Object.keys(reimported.annotations).sort()).toEqual(
      Object.keys(original.annotations).sort(),
    );
  });

  it('should preserve projection metadata fields (n_components, svd_solver, etc.)', async () => {
    const filePath = resolve(__dirname, '../../../../../../apps/web/public/data/5K.parquetbundle');
    const arrayBuffer = loadArrayBuffer(filePath);

    // Load original
    const extraction = await extractRowsFromParquetBundle(arrayBuffer);
    const original = convertParquetToVisualizationData(extraction);

    // Get first projection's metadata
    const origMeta = original.projections[0]?.metadata || {};

    // Should have actual metadata fields, not info_json
    expect(origMeta).not.toHaveProperty('info_json');

    // Common PCA metadata fields should exist at top level
    if (origMeta.n_components !== undefined) {
      expect(typeof origMeta.n_components).toBe('number');
    }
    if (origMeta.svd_solver !== undefined) {
      expect(typeof origMeta.svd_solver).toBe('string');
    }
    if (origMeta.explained_variance_ratio !== undefined) {
      expect(Array.isArray(origMeta.explained_variance_ratio)).toBe(true);
    }

    // Export and re-import
    const exportedBuffer = createParquetBundle(original);
    const extraction2 = await extractRowsFromParquetBundle(exportedBuffer);
    const reimported = convertParquetToVisualizationData(extraction2);

    // Re-imported should NOT have info_json at top level
    const reimportedMeta = reimported.projections[0]?.metadata || {};
    expect(reimportedMeta).not.toHaveProperty('info_json');

    // All original metadata fields should be preserved
    for (const [key, value] of Object.entries(origMeta)) {
      if (key !== 'dimension' && key !== 'dimensions') {
        expect(reimportedMeta[key]).toEqual(value);
      }
    }
  });
});

describe('numeric annotation round-trip', () => {
  it('preserves raw numeric annotations through bundle export and import', async () => {
    const original = {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1, 2, 2),
          dimension: 2 as const,
        },
      ],
      annotations: {
        length: { kind: 'numeric' as const, values: [], colors: [], shapes: [] },
        family: {
          kind: 'categorical' as const,
          values: ['A', 'B'],
          colors: ['#1F77B4', '#FF7F0E'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        family: [[0], [1], [0]],
      },
      numeric_annotation_data: {
        length: [100, 250, null],
      },
      annotation_scores: {},
      annotation_evidence: {},
    };

    const exportedBuffer = createParquetBundle(original);
    const reimportedExtraction = await extractRowsFromParquetBundle(exportedBuffer);
    const reimported = convertParquetToVisualizationData(reimportedExtraction);

    expect(reimported.annotations.length.kind).toBe('numeric');
    expect(reimported.numeric_annotation_data?.length).toEqual([100, 250, null]);
    expect(reimported.annotation_data.length).toBeUndefined();
    expect(reimported.annotations.family.kind).toBe('categorical');
    expect(reimported.annotation_data.family).toEqual([[0], [1], [0]]);
  });
});

/**
 * tsenoner/protspace#303 follow-ups: the numeric half of the export contract.
 *
 * Parquet stores values, not intent. Two things the writer previously threw
 * away — the physical integer type, and the numeric kind of a column with no
 * surviving values — are re-asserted here.
 */
describe('numeric annotation type fidelity', () => {
  const numeric = (numericType: 'int' | 'float'): Annotation => ({
    kind: 'numeric',
    numericType,
    values: [],
    colors: [],
    shapes: [],
  });

  const baseData = (
    annotations: VisualizationData['annotations'],
    numericData: Record<string, (number | null)[]>,
  ): VisualizationData => ({
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'UMAP', data: Float32Array.of(0, 0, 1, 1, 2, 2), dimension: 2 as const }],
    annotations,
    annotation_data: {},
    numeric_annotation_data: numericData,
    annotation_scores: {},
    annotation_evidence: {},
  });

  function physicalType(buffer: ArrayBuffer, column: string): string | undefined {
    // Part 1 ends at the first delimiter; parquetMetadata needs exactly that slice.
    const bytes = new Uint8Array(buffer);
    const end = findBundleDelimiterPositions(bytes)[0];
    const part1 = bytes.subarray(0, end).slice().buffer;
    return parquetMetadata(part1).schema.find((field) => field.name === column)?.type;
  }

  it('writes an integer annotation as INT32, not a widened DOUBLE', async () => {
    // Python keys legends/styles off str(value), so a DOUBLE round trip turns the
    // style key '100' into '100.0' and breaks a previously valid style template.
    // INT32 covers every realistic protein annotation and passes values through
    // untouched — no per-protein bigint array.
    const original = baseData({ residues: numeric('int') }, { residues: [100, 250, null] });

    const exported = createParquetBundle(original);
    expect(physicalType(exported, 'residues')).toBe('INT32');

    const reimported = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(exported),
    );
    expect(reimported.annotations.residues.kind).toBe('numeric');
    expect(reimported.annotations.residues.numericType).toBe('int');
    expect(reimported.numeric_annotation_data?.residues).toEqual([100, 250, null]);
  });

  it('widens to INT64 for an integer beyond the int32 range', async () => {
    const original = baseData({ big: numeric('int') }, { big: [2 ** 40, 1, null] });

    const exported = createParquetBundle(original);
    expect(physicalType(exported, 'big')).toBe('INT64');

    const reimported = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(exported),
    );
    expect(reimported.annotations.big.numericType).toBe('int');
    expect(reimported.numeric_annotation_data?.big).toEqual([2 ** 40, 1, null]);
  });

  it('keeps a fractional annotation on DOUBLE', async () => {
    const original = baseData({ score: numeric('float') }, { score: [0.5, 1.25, null] });

    const exported = createParquetBundle(original);
    expect(physicalType(exported, 'score')).toBe('DOUBLE');
    const reimported = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(exported),
    );
    expect(reimported.numeric_annotation_data?.score).toEqual([0.5, 1.25, null]);
  });

  it('falls back to DOUBLE for an integral value too large to encode as INT64', async () => {
    const original = baseData(
      { huge: numeric('int') },
      { huge: [Number.MAX_SAFE_INTEGER * 4, 1, null] },
    );
    const exported = createParquetBundle(original);
    expect(physicalType(exported, 'huge')).toBe('DOUBLE');
  });

  it('keeps an all-missing numeric column numeric instead of flipping it categorical', async () => {
    // Reachable from a real export: isolation mode / an active query filter can
    // leave a numeric column with no surviving values (sliceVisualizationDataByIndices).
    const original = baseData({ length: numeric('int') }, { length: [null, null, null] });

    const reimported = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(createParquetBundle(original)),
    );

    expect(reimported.annotations.length.kind).toBe('numeric');
    expect(reimported.annotations.length.numericType).toBe('int');
    expect(reimported.numeric_annotation_data?.length).toEqual([null, null, null]);
    expect(reimported.annotation_data.length).toBeUndefined();
  });

  it('lets inference decide int/float for a DOUBLE column, rather than re-labelling it', async () => {
    // Bundles exported before this writer stored EVERY numeric column as DOUBLE,
    // so DOUBLE carries no int/float information. Treating it as a declaration
    // would re-label their integer annotations as float and change bin labels.
    const original = baseData({ ratio: numeric('float') }, { ratio: [1, 2, null] });
    const exported = createParquetBundle(original);
    expect(physicalType(exported, 'ratio')).toBe('DOUBLE');

    const reimported = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(exported),
    );
    // Integral values in a DOUBLE column ⇒ inference wins, exactly as before this PR.
    expect(reimported.annotations.ratio.numericType).toBe('int');
  });

  it('treats an integer physical type as authoritative over inference', async () => {
    // The inverse: only this writer emits INT32/INT64, and only for a declared
    // integer column, so it may override a fractional inference.
    const original = baseData({ residues: numeric('int') }, { residues: [7, 8, null] });
    const exported = createParquetBundle(original);
    expect(physicalType(exported, 'residues')).toBe('INT32');

    const reimported = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(exported),
    );
    expect(reimported.annotations.residues.numericType).toBe('int');
  });

  it('leaves a column carrying real categories alone even when a numeric type is declared', async () => {
    // Guard against the restore pass hijacking a column that carries real values:
    // a STRING column is never in numericColumnTypes, so it must stay categorical.
    const original: VisualizationData = {
      ...baseData({}, {}),
      annotations: {
        family: {
          kind: 'categorical',
          values: ['A', 'B'],
          colors: ['#1F77B4', '#FF7F0E'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: { family: [[0], [1], [0]] },
    };

    const extraction = await extractRowsFromParquetBundle(createParquetBundle(original));
    expect(extraction.numericColumnTypes).not.toHaveProperty('family');

    const reimported = convertParquetToVisualizationData(extraction);
    expect(reimported.annotations.family.kind).toBe('categorical');
    expect(reimported.annotation_data.family).toEqual([[0], [1], [0]]);
  });

  it('derives the declared types from the parquet schema, with no bespoke metadata key', async () => {
    const original = baseData(
      { residues: numeric('int'), score: numeric('float') },
      {
        residues: [1, 2, 3],
        score: [0.5, 1.5, 2.5],
      },
    );

    const extraction = await extractRowsFromParquetBundle(createParquetBundle(original));
    expect(extraction.numericColumnTypes).toMatchObject({ residues: 'int', score: 'float' });
  });

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

  it('restores the numeric kind on the >=10k optimized path production uses at scale', async () => {
    // convertParquetToVisualizationDataOptimized branches on projection-row count:
    // below 10k it delegates to the small-dataset converter (covered above), at or
    // above it takes convertLargeDatasetOptimized. Swiss-Prot-scale bundles only
    // ever take the second branch, so the restore pass must be wired into both.
    const count = 10_001;
    const proteinIds = Array.from({ length: count }, (_, i) => `P${i}`);
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2] = i;
      coords[i * 2 + 1] = i;
    }

    const original: VisualizationData = {
      protein_ids: proteinIds,
      projections: [{ name: 'UMAP', data: coords, dimension: 2 }],
      annotations: { length: numeric('int') },
      annotation_data: {},
      numeric_annotation_data: { length: new Array<number | null>(count).fill(null) },
      annotation_scores: {},
      annotation_evidence: {},
    };

    const extraction = await extractRowsFromParquetBundle(createParquetBundle(original));
    expect(extraction.projections.length).toBeGreaterThanOrEqual(10_000);

    const reimported = await convertParquetToVisualizationDataOptimized(extraction);
    expect(reimported.annotations.length.kind).toBe('numeric');
    expect(reimported.annotations.length.numericType).toBe('int');
    expect(reimported.annotation_data.length).toBeUndefined();
  });
});
