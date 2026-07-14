import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NA_VALUE, NA_DEFAULT_COLOR } from '@protspace/utils';
import {
  convertParquetToVisualizationData,
  convertParquetToVisualizationDataOptimized,
} from './conversion';
import { extractRowsFromParquetBundle, type BundleExtractionResult } from './bundle';
import type { GenericRow, Rows } from './types';

async function loadFixtureVisualizationData(fixtureName: string) {
  const filePath = resolve(__dirname, '../../../../../../apps/web/tests/fixtures', fixtureName);
  const fileBuffer = readFileSync(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength,
  );

  const extraction = await extractRowsFromParquetBundle(arrayBuffer);
  return convertParquetToVisualizationData(extraction);
}

describe('convertParquetToVisualizationData numeric annotations', () => {
  it('detects scalar numeric annotations and preserves raw values', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: 100, family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: 200, family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: null, family: 'A' },
    ]);

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('int');
    expect(result.numeric_annotation_data?.length).toEqual([100, 200, null]);
    expect(result.annotation_data.length).toBeUndefined();
    expect(result.annotations.family.kind).toBe('categorical');
  });

  it('keeps multi-value and scored annotations categorical', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, keyword: 'A;B', score: 'GO:1|0.5' },
      { identifier: 'P2', x: 1, y: 1, keyword: 'B', score: 'GO:2|0.1' },
    ]);

    expect(result.annotations.keyword.kind).toBe('categorical');
    expect(result.annotations.score.kind).toBe('categorical');
    expect(result.numeric_annotation_data?.keyword).toBeUndefined();
    expect(result.numeric_annotation_data?.score).toBeUndefined();
  });

  it('detects integer strings as int numeric annotations', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, cluster_id: '101', family: 'A' },
      { identifier: 'P2', x: 1, y: 1, cluster_id: '203', family: 'B' },
      { identifier: 'P3', x: 2, y: 2, cluster_id: '101', family: 'A' },
    ]);

    expect(result.annotations.cluster_id.kind).toBe('numeric');
    expect(result.annotations.cluster_id.numericType).toBe('int');
    expect(result.numeric_annotation_data?.cluster_id).toEqual([101, 203, 101]);
    expect(result.annotation_data.cluster_id).toBeUndefined();
  });

  it('detects fractional strings as float numeric annotations', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: '1.1', family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: '2.2', family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: '3.3', family: 'A' },
    ]);

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('float');
    expect(result.numeric_annotation_data?.length).toEqual([1.1, 2.2, 3.3]);
    expect(result.annotation_data.length).toBeUndefined();
  });

  it('detects mixed integer and fractional values as float numeric annotations', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: '1', family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: 2, family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: '3.5', family: 'A' },
    ]);

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('float');
    expect(result.numeric_annotation_data?.length).toEqual([1, 2, 3.5]);
    expect(result.annotation_data.length).toBeUndefined();
  });

  it('ignores null, undefined, and trimmed empty strings during inference', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: null, family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: undefined, family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: '   ', family: 'A' },
      { identifier: 'P4', x: 3, y: 3, length: '4', family: 'B' },
    ]);

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('int');
    expect(result.numeric_annotation_data?.length).toEqual([null, null, null, 4]);
    expect(result.annotation_data.length).toBeUndefined();
  });

  it('falls back to a synthetic NA category when every value is null, undefined, or empty', async () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: null, family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: undefined, family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: '   ', family: 'A' },
    ]);

    expect(result.annotations.length.kind).toBe('categorical');
    expect(result.annotations.length.numericType).toBeUndefined();
    expect(result.numeric_annotation_data?.length).toBeUndefined();
    expect(result.annotation_data.length).toBeDefined();
    expect(result.annotations.length.values).toEqual([NA_VALUE]);
    expect(result.annotation_data.length).toEqual([[0], [0], [0]]);

    const bundleResult = convertParquetToVisualizationData(
      [
        { projection_name: 'UMAP', identifier: 'P1', x: 0, y: 0, length: null },
        { projection_name: 'UMAP', identifier: 'P2', x: 1, y: 1, length: undefined },
        { projection_name: 'UMAP', identifier: 'P3', x: 2, y: 2, length: '   ' },
      ],
      [{ projection_name: 'UMAP', dimensions: 2 }],
    );

    expect(bundleResult.annotations.length.kind).toBe('categorical');
    expect(bundleResult.numeric_annotation_data?.length).toBeUndefined();
    expect(bundleResult.annotations.length.values).toEqual([NA_VALUE]);
    expect(bundleResult.annotation_data.length).toEqual([[0], [0], [0]]);

    const optimizedRows = Array.from({ length: 10000 }, (_, index) => {
      const proteinIndex = index % 3;
      const values = [null, undefined, '   '];
      return {
        projection_name: 'UMAP',
        identifier: `P${proteinIndex + 1}`,
        x: index,
        y: index,
        length: values[proteinIndex],
      };
    });
    const optimizedResult = await convertParquetToVisualizationDataOptimized(optimizedRows, [
      { projection_name: 'UMAP', dimensions: 2 },
    ]);

    expect(optimizedResult.annotations.length.kind).toBe('categorical');
    expect(optimizedResult.numeric_annotation_data?.length).toBeUndefined();
    expect(optimizedResult.annotations.length.values).toEqual([NA_VALUE]);
    // Optimized path emits Int32Array for strictly single-valued columns
    expect(optimizedResult.annotation_data.length).toBeInstanceOf(Int32Array);
    expect(Array.from(optimizedResult.annotation_data.length as Int32Array)).toEqual([0, 0, 0]);
  });

  it("treats 'NaN' strings as missing while 'Infinity' strings demote the column to categorical", () => {
    // 'NaN' is in the missing-value token set; 'Infinity' is not.
    // A column mixing numeric ints with 'NaN' stays numeric.
    const numericResult = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: '1', family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: 'NaN', family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: 2, family: 'A' },
    ]);

    expect(numericResult.annotations.length.kind).toBe('numeric');
    expect(numericResult.annotations.length.numericType).toBe('int');
    expect(numericResult.numeric_annotation_data?.length).toEqual([1, null, 2]);
    expect(numericResult.annotation_data.length).toBeUndefined();

    // 'Infinity' is no longer treated as missing — it forces categorical fallback.
    const categoricalResult = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: '1', family: 'A' },
      { identifier: 'P2', x: 1, y: 1, length: 'NaN', family: 'B' },
      { identifier: 'P3', x: 2, y: 2, length: 'Infinity', family: 'A' },
    ]);

    expect(categoricalResult.annotations.length.kind).toBe('categorical');
  });

  it('falls back to categorical for semicolon and pipe-delimited strings', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, semicolon_values: '1;2', pipe_values: '1|2' },
      { identifier: 'P2', x: 1, y: 1, semicolon_values: '3', pipe_values: '4' },
    ]);

    expect(result.annotations.semicolon_values.kind).toBe('categorical');
    expect(result.annotations.pipe_values.kind).toBe('categorical');
    expect(result.numeric_annotation_data?.semicolon_values).toBeUndefined();
    expect(result.numeric_annotation_data?.pipe_values).toBeUndefined();
    expect(result.annotation_data.semicolon_values).toBeDefined();
    expect(result.annotation_data.pipe_values).toBeDefined();
  });

  it('detects raw numeric annotations in bundle-format rows', () => {
    const result = convertParquetToVisualizationData(
      [
        { projection_name: 'UMAP', identifier: 'P1', x: 0, y: 0, length: 100, family: 'A' },
        { projection_name: 'UMAP', identifier: 'P2', x: 1, y: 1, length: 200, family: 'B' },
        { projection_name: 'UMAP', identifier: 'P3', x: 2, y: 2, length: null, family: 'A' },
      ],
      [{ projection_name: 'UMAP', dimensions: 2 }],
    );

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('int');
    expect(result.numeric_annotation_data?.length).toEqual([100, 200, null]);
    expect(result.annotation_data.length).toBeUndefined();
    expect(result.annotations.family.kind).toBe('categorical');
    expect(result.projections).toHaveLength(1);
  });

  it('preserves numeric annotations in the optimized large-dataset path', async () => {
    const rows = Array.from({ length: 10001 }, (_, index) => ({
      projection_name: 'UMAP',
      identifier: `P${index}`,
      x: index,
      y: index / 2,
      length: index + 1,
      family: index % 2 === 0 ? 'A' : 'B',
    }));

    const result = await convertParquetToVisualizationDataOptimized(rows, [
      { projection_name: 'UMAP', dimensions: 2 },
    ]);

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('int');
    expect(result.numeric_annotation_data?.length?.[0]).toBe(1);
    expect(result.numeric_annotation_data?.length?.[10000]).toBe(10001);
    expect(result.annotation_data.length).toBeUndefined();
    expect(result.protein_ids).toHaveLength(10001);
  });

  it('classifies all annotated data_custom edge cases deterministically', async () => {
    const result = await loadFixtureVisualizationData('data_custom.parquetbundle');
    const expectedIntAnnotations = [
      'num_sequential',
      'num_negative_mixed',
      'num_8_distinct_dense',
      'num_zero_padded',
      'num_all_negative',
      'cat_5_distinct_int',
      'cat_7_distinct_int',
      'cat_binary_01',
      'cat_sparse_int',
      'cat_all_same_number',
      'cat_large_ints',
      'edge_all_zeros',
      'edge_density_boundary',
      'edge_density_below',
    ];
    const expectedFloatAnnotations = [
      'num_random_float',
      'num_mixed_int_float',
      'num_narrow_float',
      'cat_high_precision_float',
      'cat_wide_range_float',
      'edge_single_float',
      'cat_with_nan_strings',
      'edge_few_nan_many_numbers',
    ];
    const expectedStringAnnotations = [
      'cat_mixed_str_num',
      'cat_numbers_with_units',
      'cat_percentages',
      'cat_comma_thousands',
      'cat_pipe_delimited',
      'cat_semicolon_delimited',
      'edge_all_nan',
      // 'Infinity' strings are no longer treated as missing markers; this column
      // (which mixes ints with NaN and Infinity strings) now demotes to categorical.
      'cat_nan_inf_strings',
    ];
    const expectedAnnotationNames = [
      ...expectedIntAnnotations,
      ...expectedFloatAnnotations,
      ...expectedStringAnnotations,
    ].sort();

    expect(Object.keys(result.annotations).sort()).toEqual(expectedAnnotationNames);

    for (const columnName of expectedIntAnnotations) {
      const annotation = result.annotations[columnName];

      expect(annotation).toBeDefined();
      expect(annotation.kind).toBe('numeric');
      expect(annotation.numericType).toBe('int');
      expect(result.numeric_annotation_data).toBeDefined();
      expect(result.numeric_annotation_data?.[columnName]).toBeDefined();
      expect(result.numeric_annotation_data?.[columnName]).toHaveLength(result.protein_ids.length);
      expect(result.annotation_data[columnName]).toBeUndefined();
    }

    for (const columnName of expectedFloatAnnotations) {
      const annotation = result.annotations[columnName];

      expect(annotation).toBeDefined();
      expect(annotation.kind).toBe('numeric');
      expect(annotation.numericType).toBe('float');
      expect(result.numeric_annotation_data).toBeDefined();
      expect(result.numeric_annotation_data?.[columnName]).toBeDefined();
      expect(result.numeric_annotation_data?.[columnName]).toHaveLength(result.protein_ids.length);
      expect(result.annotation_data[columnName]).toBeUndefined();
    }

    expect(result.numeric_annotation_data?.num_sequential?.slice(0, 8)).toEqual([
      1, 2, 714, 3, 4, 1321, 1322, 1323,
    ]);
    expect(result.numeric_annotation_data?.num_random_float?.[0]).toBeCloseTo(63.94);
    expect(result.numeric_annotation_data?.num_random_float?.[1]).toBeCloseTo(2.5);
    expect(result.numeric_annotation_data?.num_random_float?.[2]).toBeCloseTo(50.05);

    for (const columnName of expectedStringAnnotations) {
      const annotation = result.annotations[columnName];

      expect(annotation).toBeDefined();
      expect(annotation.kind).toBe('categorical');
      expect(annotation.numericType).toBeUndefined();
      expect(result.numeric_annotation_data?.[columnName]).toBeUndefined();
      expect(result.annotation_data[columnName]).toBeDefined();
    }
  });

  it('detects length as numeric in the raw phosphatase fixture', async () => {
    const result = await loadFixtureVisualizationData('phosphatase_no_binning.parquetbundle');

    expect(result.annotations.length.kind).toBe('numeric');
    expect(result.annotations.length.numericType).toBe('int');
    expect(result.numeric_annotation_data?.length?.some((value) => typeof value === 'number')).toBe(
      true,
    );
  });

  it('treats NA, N/A, null, and none strings as missing values in numeric columns', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, score: 1.5 },
      { identifier: 'P2', x: 1, y: 1, score: 'NA' },
      { identifier: 'P3', x: 2, y: 2, score: 2.5 },
      { identifier: 'P4', x: 3, y: 3, score: 'N/A' },
      { identifier: 'P5', x: 4, y: 4, score: 'null' },
      { identifier: 'P6', x: 5, y: 5, score: 'none' },
    ]);

    expect(result.annotations.score.kind).toBe('numeric');
    expect(result.annotations.score.numericType).toBe('float');
    expect(result.numeric_annotation_data?.score).toEqual([1.5, null, 2.5, null, null, null]);
  });

  it("does NOT treat '-' or '.' as missing — they demote a numeric column to categorical", () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, length: 100 },
      { identifier: 'P2', x: 1, y: 1, length: '-' },
      { identifier: 'P3', x: 2, y: 2, length: '.' },
      { identifier: 'P4', x: 3, y: 3, length: 200 },
    ]);

    // With '-' and '.' no longer in the missing set, the column is no longer
    // unambiguously numeric. It falls back to categorical with all four values present.
    expect(result.annotations.length.kind).toBe('categorical');
    expect(result.annotations.length.values).toEqual(
      expect.arrayContaining(['100', '-', '.', '200']),
    );
  });

  it('treats numeric NaN and Infinity values as missing', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, val: 10 },
      { identifier: 'P2', x: 1, y: 1, val: NaN },
      { identifier: 'P3', x: 2, y: 2, val: Infinity },
      { identifier: 'P4', x: 3, y: 3, val: 20 },
    ]);

    expect(result.annotations.val.kind).toBe('numeric');
    expect(result.annotations.val.numericType).toBe('int');
    expect(result.numeric_annotation_data?.val).toEqual([10, null, null, 20]);
  });

  it('falls back to categorical when ALL values are missing markers', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, score: 'NaN' },
      { identifier: 'P2', x: 1, y: 1, score: 'NA' },
      { identifier: 'P3', x: 2, y: 2, score: null },
    ]);

    expect(result.annotations.score.kind).toBe('categorical');
  });

  it('still falls back to categorical for non-missing non-numeric strings', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, label: '1' },
      { identifier: 'P2', x: 1, y: 1, label: 'alpha' },
      { identifier: 'P3', x: 2, y: 2, label: '3' },
    ]);

    expect(result.annotations.label.kind).toBe('categorical');
  });

  it('handles case-insensitive missing value markers', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, val: 5 },
      { identifier: 'P2', x: 1, y: 1, val: 'nan' },
      { identifier: 'P3', x: 2, y: 2, val: 'NAN' },
      { identifier: 'P4', x: 3, y: 3, val: 'None' },
      { identifier: 'P5', x: 4, y: 4, val: 'NONE' },
      { identifier: 'P6', x: 5, y: 5, val: 10 },
    ]);

    expect(result.annotations.val.kind).toBe('numeric');
    expect(result.annotations.val.numericType).toBe('int');
    expect(result.numeric_annotation_data?.val).toEqual([5, null, null, null, null, 10]);
  });
});

describe('categorical NA normalization', () => {
  it('collapses null, empty, NA, N/A, NaN, None, null into a single NA category', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, species: 'human' },
      { identifier: 'P2', x: 1, y: 1, species: null },
      { identifier: 'P3', x: 2, y: 2, species: 'NA' },
      { identifier: 'P4', x: 3, y: 3, species: 'N/A' },
      { identifier: 'P5', x: 4, y: 4, species: 'NaN' },
      { identifier: 'P6', x: 5, y: 5, species: 'None' },
      { identifier: 'P7', x: 6, y: 6, species: 'null' },
      { identifier: 'P8', x: 7, y: 7, species: '' },
      { identifier: 'P9', x: 8, y: 8, species: 'mouse' },
    ]);

    expect(result.annotations.species.kind).toBe('categorical');
    expect(result.annotations.species.values).toEqual(
      expect.arrayContaining(['human', 'mouse', NA_VALUE]),
    );
    expect(result.annotations.species.values).toHaveLength(3);

    const data = result.annotation_data?.species;
    expect(data).toBeDefined();
    expect(data!).toHaveLength(9);

    const humanIdx = result.annotations.species.values.indexOf('human');
    const mouseIdx = result.annotations.species.values.indexOf('mouse');
    const naIdx = result.annotations.species.values.indexOf(NA_VALUE);

    // P1 = human, P9 = mouse, all middle entries point to the synthetic NA
    expect(data![0]).toEqual([humanIdx]);
    expect(data![8]).toEqual([mouseIdx]);
    for (let i = 1; i <= 7; i++) {
      expect(data![i]).toEqual([naIdx]);
    }
  });

  it('matches NA spellings case-insensitively', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, status: 'na' },
      { identifier: 'P2', x: 1, y: 1, status: 'NA' },
      { identifier: 'P3', x: 2, y: 2, status: 'Na' },
      { identifier: 'P4', x: 3, y: 3, status: 'nA' },
      { identifier: 'P5', x: 4, y: 4, status: 'real' },
    ]);

    expect(result.annotations.status.values).toEqual(expect.arrayContaining(['real', NA_VALUE]));
    expect(result.annotations.status.values).toHaveLength(2);

    const data = result.annotation_data?.status;
    expect(data).toBeDefined();
    const realIdx = result.annotations.status.values.indexOf('real');
    const naIdx = result.annotations.status.values.indexOf(NA_VALUE);
    expect(data![0]).toEqual([naIdx]);
    expect(data![1]).toEqual([naIdx]);
    expect(data![2]).toEqual([naIdx]);
    expect(data![3]).toEqual([naIdx]);
    expect(data![4]).toEqual([realIdx]);
  });

  it('keeps - and . as real categorical values (regression for the strict contract)', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, gap: '-' },
      { identifier: 'P2', x: 1, y: 1, gap: '.' },
      { identifier: 'P3', x: 2, y: 2, gap: 'A' },
      { identifier: 'P4', x: 3, y: 3, gap: 'B' },
    ]);

    expect(result.annotations.gap.kind).toBe('categorical');
    expect(result.annotations.gap.values).toEqual(expect.arrayContaining(['-', '.', 'A', 'B']));
    expect(result.annotations.gap.values).toHaveLength(4);
  });

  it('drops NA tokens within multi-valued categorical cells', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, tags: 'BRCA1;NA;TP53' },
      { identifier: 'P2', x: 1, y: 1, tags: 'BRCA1' },
      { identifier: 'P3', x: 2, y: 2, tags: 'NA;TP53' },
    ]);

    expect(result.annotations.tags.values).toEqual(expect.arrayContaining(['BRCA1', 'TP53']));
    expect(result.annotations.tags.values).toHaveLength(2);

    const data = result.annotation_data?.tags;
    expect(data).toBeDefined();
    const brca1Idx = result.annotations.tags.values.indexOf('BRCA1');
    const tp53Idx = result.annotations.tags.values.indexOf('TP53');
    // P1: ['BRCA1', 'TP53'] (NA dropped)
    expect(data![0].sort()).toEqual([brca1Idx, tp53Idx].sort());
    // P2: ['BRCA1']
    expect(data![1]).toEqual([brca1Idx]);
    // P3: ['TP53'] (NA dropped)
    expect(data![2]).toEqual([tp53Idx]);
  });

  it('adds synthetic NA category when a multi-valued cell is fully missing', () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, tags: 'BRCA1;NA;TP53' }, // mixed — NA dropped
      { identifier: 'P2', x: 1, y: 1, tags: 'NA' }, // fully missing → synthetic NA
      { identifier: 'P3', x: 2, y: 2, tags: 'BRCA1' },
    ]);

    expect(result.annotations.tags.values).toEqual(
      expect.arrayContaining(['BRCA1', 'TP53', NA_VALUE]),
    );
    expect(result.annotations.tags.values).toHaveLength(3);

    const data = result.annotation_data?.tags;
    expect(data).toBeDefined();
    const naIdx = result.annotations.tags.values.indexOf(NA_VALUE);
    expect(data![1]).toEqual([naIdx]); // fully-missing cell points to synthetic NA
  });

  it("seeds the synthetic NA category with NA_DEFAULT_COLOR and 'circle'", () => {
    const result = convertParquetToVisualizationData([
      { identifier: 'P1', x: 0, y: 0, kind: 'A' },
      { identifier: 'P2', x: 1, y: 1, kind: null },
    ]);

    const naIdx = result.annotations.kind.values.indexOf(NA_VALUE);
    expect(naIdx).toBeGreaterThanOrEqual(0);
    expect(result.annotations.kind.colors[naIdx]).toBe(NA_DEFAULT_COLOR);
    expect(result.annotations.kind.shapes[naIdx]).toBe('circle');
  });
});

describe('annotation_data storage shape', () => {
  it('emits Int32Array for strictly single-valued categorical columns', async () => {
    const kingdoms = ['Bacillati', 'Pseudomonadati', '', 'Bacillati'];
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      projection_name: 'UMAP',
      identifier: `P${i + 1}`,
      x: i,
      y: i,
      kingdom: kingdoms[i % kingdoms.length],
    }));

    const result = await convertParquetToVisualizationDataOptimized(rows, [
      { projection_name: 'UMAP', dimensions: 2 },
    ]);

    expect(result.annotation_data.kingdom).toBeInstanceOf(Int32Array);
    expect(result.annotations.kingdom.kind).toBe('categorical');
    // Every protein gets exactly one index (the column is single-valued)
    const data = result.annotation_data.kingdom as Int32Array;
    expect(data.length).toBe(result.protein_ids.length);
    // All indices are valid (no -1 sentinel left: missing proteins mapped to NA)
    expect(Array.from(data).every((v) => v >= 0)).toBe(true);

    // Content assertions: verify protein → label round-trips correctly.
    // rows cycle: i%4=0→'Bacillati', i%4=1→'Pseudomonadati', i%4=2→''→NA, i%4=3→'Bacillati'
    const values = result.annotations.kingdom.values;
    const p1Idx = result.protein_ids.indexOf('P1'); // i=0, kingdom='Bacillati'
    const p2Idx = result.protein_ids.indexOf('P2'); // i=1, kingdom='Pseudomonadati'
    const p3Idx = result.protein_ids.indexOf('P3'); // i=2, kingdom='' → NA_VALUE
    expect(values[data[p1Idx]]).toBe('Bacillati');
    expect(values[data[p2Idx]]).toBe('Pseudomonadati');
    expect(values[data[p3Idx]]).toBe(NA_VALUE);
  });

  it('keeps number[][] storage for multi-valued columns', async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      projection_name: 'UMAP',
      identifier: `P${i + 1}`,
      x: i,
      y: i,
      pfam: i % 3 === 0 ? 'PF01;PF02' : 'PF03',
    }));

    const result = await convertParquetToVisualizationDataOptimized(rows, [
      { projection_name: 'UMAP', dimensions: 2 },
    ]);

    // Multi-valued column must stay as a regular array
    expect(Array.isArray(result.annotation_data.pfam)).toBe(true);
    expect(result.annotation_data.pfam).not.toBeInstanceOf(Int32Array);
    // Multi-valued proteins get two indices
    const pfamData = result.annotation_data.pfam as readonly (readonly number[])[];
    const multiValuedEntry = pfamData.find((row) => row.length === 2);
    expect(multiValuedEntry).toBeDefined();

    // Content assertions: verify index → label round-trips correctly.
    // rows: i%3=0→'PF01;PF02', otherwise→'PF03'
    const values = result.annotations.pfam.values;
    const p1Idx = result.protein_ids.indexOf('P1'); // i=0, pfam='PF01;PF02'
    const p2Idx = result.protein_ids.indexOf('P2'); // i=1, pfam='PF03'
    // P1: two indices, both resolve to 'PF01' and 'PF02'
    expect(pfamData[p1Idx]).toHaveLength(2);
    expect(pfamData[p1Idx].every((i) => i >= 0)).toBe(true);
    expect(pfamData[p1Idx].map((i) => values[i]).sort()).toEqual(['PF01', 'PF02']);
    // P2: single index, resolves to 'PF03'
    expect(pfamData[p2Idx]).toHaveLength(1);
    expect(values[pfamData[p2Idx][0]]).toBe('PF03');
  });

  it('round-trips heterogeneous per-value scores and evidence through the optimized path', async () => {
    // Each protein's cell mixes a scored value, an evidence-coded value, and a
    // plain value — exercises the single-parse cache reconstruction in Pass 2.
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      projection_name: 'UMAP',
      identifier: `P${i + 1}`,
      x: i,
      y: i,
      // value 0: scored, value 1: evidence code, value 2: plain
      site: 'Active|1.5e-10;Bind|ECO:0000269;Other',
    }));

    const result = await convertParquetToVisualizationDataOptimized(rows, [
      { projection_name: 'UMAP', dimensions: 2 },
    ]);

    expect(Array.isArray(result.annotation_data.site)).toBe(true);
    const siteData = result.annotation_data.site as readonly (readonly number[])[];
    const values = result.annotations.site.values;

    const p1 = result.protein_ids.indexOf('P1');
    // Three labels resolved
    expect(siteData[p1]).toHaveLength(3);
    expect(siteData[p1].map((i) => values[i])).toEqual(['Active', 'Bind', 'Other']);

    // Scores: value 0 has [1.5e-10], values 1 and 2 are null
    const scores = result.annotation_scores?.site;
    expect(scores).toBeDefined();
    expect(scores![p1]).toEqual([[1.5e-10], null, null]);

    // Evidence: value 1 has 'ECO:0000269', values 0 and 2 are null
    const evidence = result.annotation_evidence?.site;
    expect(evidence).toBeDefined();
    expect(evidence![p1]).toEqual([null, 'ECO:0000269', null]);
  });

  it('memoizes repeated cells without cross-contaminating per-protein output', async () => {
    // Many proteins share the SAME multi-valued scored+evidence cell (cache hits),
    // interleaved with a distinct plain cell — guards the parse memoization.
    const shared = 'Active|1.5e-10;Bind|ECO:0000269';
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      projection_name: 'UMAP',
      identifier: `P${i + 1}`,
      x: i,
      y: i,
      site: i % 4 === 0 ? 'Solo' : shared,
    }));

    const result = await convertParquetToVisualizationDataOptimized(rows, [
      { projection_name: 'UMAP', dimensions: 2 },
    ]);

    const siteData = result.annotation_data.site as readonly (readonly number[])[];
    const values = result.annotations.site.values;
    const scores = result.annotation_scores?.site;
    const evidence = result.annotation_evidence?.site;
    expect(scores).toBeDefined();
    expect(evidence).toBeDefined();

    // Every shared-cell protein resolves to ['Active','Bind'] with the right score/evidence,
    // and the distinct 'Solo' proteins are unaffected (no cross-contamination).
    const pShared = result.protein_ids.indexOf('P2'); // i=1 -> shared
    const pSolo = result.protein_ids.indexOf('P1'); // i=0 -> 'Solo'
    expect(siteData[pShared].map((ix) => values[ix])).toEqual(['Active', 'Bind']);
    expect(scores![pShared]).toEqual([[1.5e-10], null]);
    expect(evidence![pShared]).toEqual([null, 'ECO:0000269']);
    expect(siteData[pSolo].map((ix) => values[ix])).toEqual(['Solo']);
    expect(scores![pSolo]).toEqual([null]);
    expect(evidence![pSolo]).toEqual([null]);

    // Frequency-based ordering is unaffected by memoization: 'Active' and 'Bind'
    // each occur 7500 times (3/4 of 10000), 'Solo' 2500 — so Solo sorts last.
    expect(values.indexOf('Solo')).toBeGreaterThan(values.indexOf('Active'));
  });

  it('threads formatVersion 2 from BundleExtractionResult through the optimized separated path (Task H2)', async () => {
    // v2 bundles percent-encode structural characters inside names at the source, so a
    // name that legitimately contains ';' round-trips as e.g. 'Foo%3B bar' instead of the
    // raw (unsafe-to-split-on) 'Foo; bar'. Decoding must happen AFTER splitting the cell on
    // ';' (never before — decoding first would reintroduce a literal ';' that then gets
    // mis-split), which is exactly what parseAnnotationValueV2/splitCategoricalAnnotationValues
    // (formatVersion >= 2) already implement. This test only exercises the THREADING: does a
    // real BundleExtractionResult's `formatVersion: 2` actually reach those functions through
    // the optimized (>=10000 rows) conversion path, the same path the worker and main-thread
    // bundle loaders use in production (data-loader.ts / decode.worker.ts pass the whole
    // `extraction` object straight into `convertParquetToVisualizationDataOptimized`).
    const numProteins = 10000;
    const projections: Rows = Array.from({ length: numProteins }, (_, i) => ({
      projection_name: 'UMAP',
      identifier: `P${i + 1}`,
      x: i,
      y: i,
    }));
    const annotationsById = new Map<string, GenericRow>();
    for (let i = 0; i < numProteins; i++) {
      annotationsById.set(`P${i + 1}`, {
        identifier: `P${i + 1}`,
        cath: 'X (Foo%3B bar)|1.0',
      });
    }

    const extraction: BundleExtractionResult = {
      projections,
      annotationsById,
      projectionIdColumn: 'identifier',
      annotationIdColumn: 'identifier',
      projectionsMetadata: [{ projection_name: 'UMAP', dimensions: 2 }],
      settings: null,
      formatVersion: 2,
    };

    const result = await convertParquetToVisualizationDataOptimized(extraction);

    const values = result.annotations.cath.values;
    // Decoded, single category — the percent-encoded ';' is restored as a literal ';'.
    expect(values).toContain('X (Foo; bar)');
    // Must not be shattered into fragments (would happen if decode ran before split).
    expect(values).not.toContain('X (Foo');
    // Must not still carry the raw percent-encoding (would happen if v1 defaulted silently).
    expect(values).not.toContain('X (Foo%3B bar)');
  });
});

import { generateColorsAndShapes } from './conversion';

describe('generateColorsAndShapes', () => {
  it('returns palette.length × shapeCount distinct (color, shape) pairs', () => {
    const { colors, shapes } = generateColorsAndShapes('kellys', 200);
    expect(colors).toHaveLength(126); // 21 × 6
    expect(shapes).toHaveLength(126);
    const pairs = new Set<string>();
    for (let i = 0; i < colors.length; i++) {
      pairs.add(`${colors[i]}|${shapes[i]}`);
    }
    expect(pairs.size).toBe(126);
  });

  it('caps at the requested count when below the LCM', () => {
    const { colors, shapes } = generateColorsAndShapes('kellys', 10);
    expect(colors).toHaveLength(10);
    expect(shapes).toHaveLength(10);
  });

  it('cycles after palette.length × shapeCount entries', () => {
    // The array is capped at distinctPairs (126 for Kelly's).
    // Consumers index via colors[i % colors.length] to cycle for i >= 126.
    const { colors: c1, shapes: s1 } = generateColorsAndShapes('kellys', 1);
    const { colors: c126, shapes: s126 } = generateColorsAndShapes('kellys', 126);
    // Entry 127 (index 126) wraps to index 0 via consumer-side modular indexing.
    expect(c126[126 % c126.length]).toBe(c1[0]);
    expect(s126[126 % s126.length]).toBe(s1[0]);
  });

  it('falls back to kellys for unknown palette ids', () => {
    const { colors } = generateColorsAndShapes('not-a-real-palette', 5);
    expect(colors).toHaveLength(5);
    // Should be the first 5 entries of the Kelly's palette
  });

  it('handles zero or negative counts as empty arrays', () => {
    expect(generateColorsAndShapes('kellys', 0)).toEqual({ colors: [], shapes: [] });
    expect(generateColorsAndShapes('kellys', -3)).toEqual({ colors: [], shapes: [] });
  });
});
