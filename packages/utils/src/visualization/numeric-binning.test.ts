import { describe, expect, it } from 'vitest';
import {
  materializeNumericAnnotation,
  materializeVisualizationData,
  resolveNumericAnnotationDisplaySettings,
} from './numeric-binning';
import { NA_VALUE, NA_DEFAULT_COLOR } from './missing-values';
import type { Annotation, VisualizationData } from '../types';

describe('numeric-binning', () => {
  it('creates linear bins with distribution-aware gradient colors', () => {
    const result = materializeNumericAnnotation(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      {
        binCount: 5,
        strategy: 'linear',
        paletteId: 'viridis',
      },
      'int',
    );

    expect(result.annotation.sourceKind).toBe('numeric');
    expect(result.annotation.numericMetadata?.strategy).toBe('linear');
    expect(result.annotation.numericMetadata?.binCount).toBe(5);
    expect(result.annotation.values).toEqual(
      result.annotation.numericMetadata?.bins.map((bin) => bin.id),
    );
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '1 - 2',
      '3 - 4',
      '5 - 6',
      '7 - 8',
      '9 - 10',
    ]);
    expect(result.annotation.colors[0]).toBe('#440154');
    expect(result.annotation.colors.at(-1)).toBe('#FDE725');
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.colorPosition)).toEqual([
      0, 0.3, 0.5, 0.7, 1,
    ]);
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.count)).toEqual([
      2, 2, 2, 2, 2,
    ]);
    expect(result.annotationData).toBeInstanceOf(Int32Array);
    expect(Array.from(result.annotationData)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('uses quantile settings when materializing visualization data', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5),
          dimension: 2,
        },
      ],
      annotations: {
        length: { kind: 'numeric', numericType: 'int', values: [], colors: [], shapes: [] },
      },
      annotation_data: {},
      numeric_annotation_data: {
        length: [1, 2, 10, 11, 100, 101],
      },
    };

    const materialized = materializeVisualizationData(
      data,
      { length: { binCount: 3, strategy: 'quantile', paletteId: 'viridis' } },
      10,
      'length',
    );

    expect(materialized.annotations.length.sourceKind).toBe('numeric');
    expect(materialized.annotations.length.numericMetadata?.strategy).toBe('quantile');
    expect(materialized.annotations.length.numericMetadata?.binCount).toBe(3);
    expect(materialized.annotations.length.values).toEqual(
      materialized.annotations.length.numericMetadata?.bins.map((bin) => bin.id),
    );
    expect(materialized.annotations.length.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '1 - 2',
      '10 - 11',
      '100 - 101',
    ]);
    expect(
      materialized.annotations.length.numericMetadata?.bins.map((bin) => bin.colorPosition),
    ).toEqual([0, 0.5, 1]);
    expect(materialized.annotations.length.numericMetadata?.bins.map((bin) => bin.count)).toEqual([
      2, 2, 2,
    ]);
    expect(materialized.annotation_data.length).toBeInstanceOf(Int32Array);
    expect(Array.from(materialized.annotation_data.length as Int32Array)).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
  });

  it('formats int labels without grouping or decimals and preserves numeric type metadata', () => {
    const result = materializeNumericAnnotation(
      [1200, 2500, 3900],
      {
        binCount: 3,
        strategy: 'linear',
        paletteId: 'viridis',
      },
      'int',
    );

    expect(result.annotation.numericType).toBe('int');
    expect(result.annotation.numericMetadata?.numericType).toBe('int');
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '1200',
      '2500',
      '3900',
    ]);
  });

  it('formats float labels with grouping and decimals and preserves numeric type metadata', () => {
    const result = materializeNumericAnnotation(
      [1200.5, 2500.25, 3900.75],
      {
        binCount: 3,
        strategy: 'linear',
        paletteId: 'viridis',
      },
      'float',
    );

    expect(result.annotation.numericType).toBe('float');
    expect(result.annotation.numericMetadata?.numericType).toBe('float');
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '1,200.5',
      '2,500.25',
      '3,900.75',
    ]);
  });

  it('preserves meaningful precision for tiny float labels', () => {
    const result = materializeNumericAnnotation(
      [-1.2e-7, 1.2e-7],
      {
        binCount: 2,
        strategy: 'linear',
        paletteId: 'viridis',
      },
      'float',
    );

    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '-1.2e-7',
      '1.2e-7',
    ]);
  });

  it('infers int labels for omitted numeric subtype when all values are integers', () => {
    const result = materializeNumericAnnotation([1, 2], {
      binCount: 1,
      strategy: 'linear',
      paletteId: 'viridis',
    });

    expect(result.annotation.numericType).toBe('int');
    expect(result.annotation.numericMetadata?.numericType).toBe('int');
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual(['1 - 2']);
  });

  it('honors explicit float subtype for integer-valued float annotations', () => {
    const result = materializeNumericAnnotation(
      [1, 2],
      {
        binCount: 1,
        strategy: 'linear',
        paletteId: 'viridis',
      },
      'float',
    );

    expect(result.annotation.numericType).toBe('float');
    expect(result.annotation.numericMetadata?.numericType).toBe('float');
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual(['1.0 - 2.0']);
  });

  it('carries annotation numericType into materialized annotation metadata', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1, 2, 2),
          dimension: 2,
        },
      ],
      annotations: {
        abundance: {
          kind: 'numeric',
          numericType: 'int',
          values: [],
          colors: [],
          shapes: [],
        },
      },
      annotation_data: {},
      numeric_annotation_data: {
        abundance: [1200, 2500, 3900],
      },
    };

    const materialized = materializeVisualizationData(
      data,
      { abundance: { binCount: 3, strategy: 'linear', paletteId: 'viridis' } },
      10,
      'abundance',
    );

    expect(materialized.annotations.abundance.numericType).toBe('int');
    expect(materialized.annotations.abundance.numericMetadata?.numericType).toBe('int');
    expect(
      materialized.annotations.abundance.numericMetadata?.bins.map((bin) => bin.label),
    ).toEqual(['1200', '2500', '3900']);
  });

  it('can materialize only the requested numeric annotations without touching others', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1, 2, 2),
          dimension: 2,
        },
      ],
      annotations: {
        length: { kind: 'numeric', values: [], colors: [], shapes: [] },
        weight: { kind: 'numeric', values: [], colors: [], shapes: [] },
      },
      annotation_data: {
        length: [[], [], []],
        weight: [[], [], []],
      },
      numeric_annotation_data: {
        length: [1, 2, 3],
        weight: [10, 20, 30],
      },
    };

    const materialized = materializeVisualizationData(
      data,
      {
        length: { binCount: 2, strategy: 'linear', paletteId: 'viridis' },
        weight: { binCount: 2, strategy: 'quantile', paletteId: 'cividis' },
      },
      10,
      null,
      new Set(['weight']),
    );

    expect(materialized.annotations.length.kind).toBe('numeric');
    expect(materialized.annotations.weight.sourceKind).toBe('numeric');
    expect(materialized.annotations.weight.numericMetadata?.strategy).toBe('quantile');
    expect(materialized.annotation_data.length).toEqual([[], [], []]);
    expect(materialized.annotation_data.weight).toBeInstanceOf(Int32Array);
    expect(Array.from(materialized.annotation_data.weight as Int32Array)).toEqual([0, 1, 1]);
  });

  it('falls back from logarithmic binning when non-positive values are present', () => {
    const result = materializeNumericAnnotation([0, 1, 10, 100], {
      binCount: 4,
      strategy: 'logarithmic',
      paletteId: 'viridis',
    });

    expect(result.annotation.numericMetadata?.logSupported).toBe(false);
    // log → default (quantile) → linear (4 distinct values ≤ binCount 4)
    expect(result.annotation.numericMetadata?.strategy).toBe('linear');
  });

  it('creates logarithmic bins when all values are positive', () => {
    const result = materializeNumericAnnotation(
      [1, 10, 100, 1000],
      {
        binCount: 4,
        strategy: 'logarithmic',
        paletteId: 'viridis',
      },
      'int',
    );

    expect(result.annotation.numericMetadata?.strategy).toBe('logarithmic');
    expect(result.annotation.values).toEqual(
      result.annotation.numericMetadata?.bins.map((bin) => bin.id),
    );
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '1',
      '10',
      '100',
      '1000',
    ]);
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.colorPosition)).toEqual([
      0, 0.375, 0.625, 1,
    ]);
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.count)).toEqual([1, 1, 1, 1]);
    expect(result.annotationData).toBeInstanceOf(Int32Array);
    expect(Array.from(result.annotationData)).toEqual([0, 1, 2, 3]);
  });

  it('uses the midpoint color when only one realized bin remains', () => {
    const result = materializeNumericAnnotation([5, 5, 5], {
      binCount: 5,
      strategy: 'linear',
      paletteId: 'viridis',
    });

    expect(result.annotation.numericMetadata?.binCount).toBe(1);
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.colorPosition)).toEqual([0.5]);
    expect(result.annotation.colors).toHaveLength(1);
  });

  it('normalizes non-gradient numeric palettes to batlow', () => {
    const result = materializeNumericAnnotation([1, 2, 3, 4], {
      binCount: 2,
      strategy: 'linear',
      paletteId: 'kellys',
    });

    expect(result.annotation.colors[0]).toBe('#011959');
    expect(result.annotation.colors[1]).toBe('#FACCFA');
  });

  it('reverses numeric gradient colors without changing bin topology', () => {
    const forward = materializeNumericAnnotation([1, 2, 3, 4], {
      binCount: 2,
      strategy: 'linear',
      paletteId: 'viridis',
    });
    const reversed = materializeNumericAnnotation([1, 2, 3, 4], {
      binCount: 2,
      strategy: 'linear',
      paletteId: 'viridis',
      reverseGradient: true,
    });

    expect(reversed.annotation.numericMetadata?.topologySignature).toBe(
      forward.annotation.numericMetadata?.topologySignature,
    );
    expect(reversed.annotation.numericMetadata?.signature).not.toBe(
      forward.annotation.numericMetadata?.signature,
    );
    expect(reversed.annotation.colors).toEqual([...forward.annotation.colors].reverse());
    expect(Array.from(reversed.annotationData)).toEqual(Array.from(forward.annotationData));
  });

  it('changes the compatibility signature when bin counts change inside the same topology', () => {
    const sparse = materializeNumericAnnotation([0, 0, 10, 10], {
      binCount: 2,
      strategy: 'linear',
      paletteId: 'viridis',
    });
    const dense = materializeNumericAnnotation([0, 5, 5, 10], {
      binCount: 2,
      strategy: 'linear',
      paletteId: 'viridis',
    });

    expect(sparse.annotation.numericMetadata?.topologySignature).toBe(
      dense.annotation.numericMetadata?.topologySignature,
    );
    expect(sparse.annotation.numericMetadata?.signature).not.toBe(
      dense.annotation.numericMetadata?.signature,
    );
  });

  it('only keeps data-bearing bins as realized bins for sparse linear ranges', () => {
    const result = materializeNumericAnnotation([10, 20, 30, 40, 110, 120], {
      binCount: 12,
      strategy: 'linear',
      paletteId: 'viridis',
    });

    expect(result.annotation.numericMetadata?.binCount).toBe(result.annotation.values.length);
    expect(result.annotation.numericMetadata?.binCount).toBeLessThan(12);
    expect(result.annotation.numericMetadata?.bins.every((bin) => bin.count > 0)).toBe(true);
    expect(Math.max(...Array.from(result.annotationData))).toBe(
      (result.annotation.numericMetadata?.binCount ?? 1) - 1,
    );
  });

  it('keeps realized numeric labels unique for very narrow intervals', () => {
    const result = materializeNumericAnnotation([1, 1.00001, 1.00002, 1.00003], {
      binCount: 4,
      strategy: 'linear',
      paletteId: 'viridis',
    });

    const labels = result.annotation.numericMetadata?.bins.map((bin) => bin.label) ?? [];
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('assigns shared linear boundaries to the upper bin while keeping the final bin inclusive', () => {
    const result = materializeNumericAnnotation(
      [0, 5, 10],
      {
        binCount: 2,
        strategy: 'linear',
        paletteId: 'viridis',
      },
      'int',
    );

    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.label)).toEqual([
      '0',
      '5 - 10',
    ]);
    expect(result.annotation.numericMetadata?.bins.map((bin) => bin.count)).toEqual([1, 2]);
    expect(result.annotationData).toBeInstanceOf(Int32Array);
    expect(Array.from(result.annotationData)).toEqual([0, 1, 1]);
  });

  it('resolves persisted numeric settings with shared precedence rules', () => {
    const resolved = resolveNumericAnnotationDisplaySettings({
      persistedSettings: {
        maxVisibleValues: 12,
        selectedPaletteId: 'cividis',
        numericSettings: {
          strategy: 'quantile',
          signature: 'sig',
          topologySignature: 'top',
          reverseGradient: true,
        },
      },
      liveSettings: {
        binCount: 4,
        strategy: 'linear',
        paletteId: 'viridis',
        reverseGradient: false,
      },
      defaultBinCount: 10,
    });

    expect(resolved.hadInvalidPersistedSettings).toBe(false);
    expect(resolved.settings).toEqual({
      binCount: 12,
      strategy: 'quantile',
      paletteId: 'cividis',
      reverseGradient: true,
    });
  });

  it('appends N/A pseudo-bin for null values, reserving one slot from binCount', () => {
    const result = materializeNumericAnnotation(
      [1, null, 3, null, 5],
      { binCount: 3, strategy: 'linear', paletteId: 'viridis', reverseGradient: false },
      'int',
    );

    // binCount=3 with missing values → 2 numeric bins + 1 N/A = 3 total
    expect(result.annotation.values).toHaveLength(3);
    const naIndex = result.annotation.values.indexOf(NA_VALUE);
    expect(naIndex).toBe(2); // N/A is last
    expect(result.annotation.colors[naIndex]).toBe(NA_DEFAULT_COLOR);
    expect(result.annotation.shapes[naIndex]).toBe('circle');

    // Gradient uses full spectrum across the 2 numeric bins
    expect(result.annotation.colors[0]).toBe('#440154'); // viridis start
    expect(result.annotation.colors[1]).toBe('#FDE725'); // viridis end

    // Missing-value proteins assigned to N/A index
    expect(result.annotationData[1]).toBe(naIndex);
    expect(result.annotationData[3]).toBe(naIndex);

    // Non-missing proteins assigned to numeric bins
    expect(result.annotationData[0]).toBeGreaterThanOrEqual(0);
    expect(result.annotationData[0]).not.toBe(naIndex);
    expect(result.annotationData[4]).toBeGreaterThanOrEqual(0);
    expect(result.annotationData[4]).not.toBe(naIndex);
  });

  it('does not append N/A bin when there are no missing values', () => {
    const result = materializeNumericAnnotation(
      [1, 2, 3],
      { binCount: 3, strategy: 'linear', paletteId: 'viridis', reverseGradient: false },
      'int',
    );

    expect(result.annotation.values).not.toContain(NA_VALUE);
    // Full 3 bins used for numeric data
    expect(result.annotation.values).toHaveLength(3);
  });

  it('N/A color is not affected by gradient reversal', () => {
    const result = materializeNumericAnnotation(
      [1, null, 3],
      { binCount: 3, strategy: 'linear', paletteId: 'viridis', reverseGradient: true },
      'int',
    );

    // binCount=3 → 2 numeric bins + 1 N/A = 3 total
    const naIndex = result.annotation.values.indexOf(NA_VALUE);
    expect(naIndex).toBeGreaterThan(0);
    expect(result.annotation.colors[naIndex]).toBe(NA_DEFAULT_COLOR);
    // Reversed gradient: first bin should be viridis end, not start
    expect(result.annotation.colors[0]).toBe('#FDE725');
  });

  it('N/A does not push out the last numeric bin — all data must be covered', () => {
    // Regression: N/A used to be appended as an extra value WITHOUT reducing
    // binCount, so the total exceeded maxVisibleValues and the last bin was
    // cut off by sortAndLimitItems, losing data coverage.
    const values = [
      ...Array.from({ length: 100 }, (_, i) => i * 0.5), // 0..49.5
      null,
      null,
      null,
    ];
    const binCount = 10;
    const result = materializeNumericAnnotation(
      values,
      { binCount, strategy: 'linear', paletteId: 'cividis', reverseGradient: false },
      'float',
    );

    // Total values must fit within binCount (9 numeric + 1 N/A = 10)
    expect(result.annotation.values).toHaveLength(binCount);
    expect(result.annotation.values).toContain(NA_VALUE);

    // Every data point must be assigned to a bin (no missing annotationData)
    for (let i = 0; i < values.length; i++) {
      expect(result.annotationData[i]).toBeGreaterThanOrEqual(0);
    }

    // The highest value (49.5) must be in one of the numeric bins, not lost
    const lastDataIndex = 99; // index of value 49.5
    const lastBinIdx = result.annotationData[lastDataIndex];
    expect(result.annotation.values[lastBinIdx]).not.toBe(NA_VALUE);

    // The gradient must use the full color spectrum
    const numericColors = result.annotation.colors.filter(
      (_, i) => result.annotation.values[i] !== NA_VALUE,
    );
    const firstNumericBinPosition = result.annotation.numericMetadata?.bins[0]?.colorPosition ?? -1;
    const lastNumericBinPosition =
      result.annotation.numericMetadata?.bins.at(-1)?.colorPosition ?? -1;
    expect(firstNumericBinPosition).toBe(0);
    expect(lastNumericBinPosition).toBe(1);
    expect(numericColors[0]).not.toBe(numericColors.at(-1));
  });

  it('N/A does not reduce binCount when binCount is 1', () => {
    const result = materializeNumericAnnotation(
      [10, null, 20],
      { binCount: 1, strategy: 'linear', paletteId: 'viridis', reverseGradient: false },
      'int',
    );

    // binCount=1 cannot be reduced further, so 1 numeric bin + 1 N/A = 2 total
    expect(result.annotation.values).toHaveLength(2);
    const numericBins = result.annotation.values.filter((v) => v !== NA_VALUE);
    expect(numericBins).toHaveLength(1);

    // All data points still assigned
    for (let i = 0; i < result.annotationData.length; i++) {
      expect(result.annotationData[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('materializeVisualizationData null-selection gate', () => {
  it('materializes nothing when selectedNumericAnnotation is null', () => {
    const data: VisualizationData = {
      protein_ids: ['p1', 'p2'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1),
          dimension: 2,
        },
      ],
      annotations: {
        a: {
          kind: 'numeric',
          numericType: 'float',
          values: [],
          colors: [],
          shapes: [],
        } as Annotation,
        b: {
          kind: 'numeric',
          numericType: 'int',
          values: [],
          colors: [],
          shapes: [],
        } as Annotation,
      },
      annotation_data: {},
      numeric_annotation_data: {
        a: [1.0, 2.0],
        b: [3, 4],
      },
    };

    const out = materializeVisualizationData(data, {}, 10, null);

    // Both a and b should remain numeric (un-materialized).
    expect(out.annotations.a.kind).toBe('numeric');
    expect(out.annotations.b.kind).toBe('numeric');
  });

  it('materializes only the selected annotation', () => {
    const data: VisualizationData = {
      protein_ids: ['p1', 'p2'],
      projections: [
        {
          name: 'UMAP',
          data: Float32Array.of(0, 0, 1, 1),
          dimension: 2,
        },
      ],
      annotations: {
        a: {
          kind: 'numeric',
          numericType: 'float',
          values: [],
          colors: [],
          shapes: [],
        } as Annotation,
        b: {
          kind: 'numeric',
          numericType: 'int',
          values: [],
          colors: [],
          shapes: [],
        } as Annotation,
      },
      annotation_data: {},
      numeric_annotation_data: {
        a: [1.0, 2.0],
        b: [3, 4],
      },
    };

    const out = materializeVisualizationData(data, {}, 10, 'a');

    // 'a' should be materialized (kind becomes 'categorical' with sourceKind 'numeric').
    expect(out.annotations.a.kind).toBe('categorical');
    expect(out.annotations.a.sourceKind).toBe('numeric');
    // 'b' should remain numeric.
    expect(out.annotations.b.kind).toBe('numeric');
  });
});
