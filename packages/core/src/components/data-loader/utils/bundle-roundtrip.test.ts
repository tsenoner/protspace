import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractRowsFromParquetBundle } from './bundle';
import { convertParquetToVisualizationData } from './conversion';
import { createParquetBundle, countBundleDelimiters, isParquetBundle } from '@protspace/utils';

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
    const filePath = resolve(__dirname, '../../../../../../app/public/data/5K.parquetbundle');
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
    const filePath = resolve(__dirname, '../../../../../../app/public/data/5K.parquetbundle');
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

  it('should preserve raw numeric annotations through export/import', async () => {
    const filePath = resolve(
      __dirname,
      '../../../../../../app/tests/fixtures/phosphatase_no_binning.parquetbundle',
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

  it('round-trips numeric legend settings through bundle settings', async () => {
    const original = {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [
        {
          name: 'UMAP',
          data: [
            [0, 0],
            [1, 1],
            [2, 2],
          ] as Array<[number, number]>,
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
          data: [
            [0, 0],
            [1, 1],
          ] as Array<[number, number]>,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dimension, dimensions, ...rest } = metadata;
    return rest;
  }

  it('should preserve projection metadata fields through export/import cycle (5K)', async () => {
    const filePath = resolve(__dirname, '../../../../../../app/public/data/5K.parquetbundle');
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
    const filePath = resolve(__dirname, '../../../../../../app/public/data/5K.parquetbundle');
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
          data: [
            [0, 0],
            [1, 1],
            [2, 2],
          ] as Array<[number, number]>,
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
