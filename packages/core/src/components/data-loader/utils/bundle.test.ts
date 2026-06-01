import { describe, it, expect } from 'vitest';
import {
  BUNDLE_DELIMITER,
  isParquetBundle,
  findBundleDelimiterPositions,
  type BundleSettings,
} from '@protspace/utils';
import { extractRowsFromParquetBundle } from './bundle';

// Helper to create a mock parquet-like buffer with PAR1 magic bytes
function createMockParquetBuffer(content: string = 'test'): ArrayBuffer {
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);
  // PAR1 magic at start and end
  const magic = encoder.encode('PAR1');
  const buffer = new Uint8Array(magic.length + contentBytes.length + magic.length);
  buffer.set(magic, 0);
  buffer.set(contentBytes, magic.length);
  buffer.set(magic, magic.length + contentBytes.length);
  return buffer.buffer;
}

// Helper to create a mock bundle with the specified number of parts
function createMockBundle(numParts: number): ArrayBuffer {
  const encoder = new TextEncoder();
  const delimiterBytes = encoder.encode(BUNDLE_DELIMITER);

  const parts: Uint8Array[] = [];
  for (let i = 0; i < numParts; i++) {
    const partContent = new Uint8Array(createMockParquetBuffer(`part${i + 1}`));
    parts.push(partContent);
  }

  // Calculate total size
  let totalSize = 0;
  for (let i = 0; i < parts.length; i++) {
    totalSize += parts[i].length;
    if (i < parts.length - 1) {
      totalSize += delimiterBytes.length;
    }
  }

  // Concatenate
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    result.set(parts[i], offset);
    offset += parts[i].length;
    if (i < parts.length - 1) {
      result.set(delimiterBytes, offset);
      offset += delimiterBytes.length;
    }
  }

  return result.buffer;
}

describe('bundle utilities', () => {
  describe('isParquetBundle', () => {
    it('should return true for buffer containing delimiter', () => {
      const bundle = createMockBundle(3);
      expect(isParquetBundle(bundle)).toBe(true);
    });

    it('should return false for buffer without delimiter', () => {
      const buffer = createMockParquetBuffer('no delimiter');
      expect(isParquetBundle(buffer)).toBe(false);
    });

    it('should return false for empty buffer', () => {
      const buffer = new ArrayBuffer(0);
      expect(isParquetBundle(buffer)).toBe(false);
    });
  });

  describe('findBundleDelimiterPositions', () => {
    it('should find 2 delimiters in a 3-part bundle', () => {
      const bundle = createMockBundle(3);
      const uint8Array = new Uint8Array(bundle);
      const positions = findBundleDelimiterPositions(uint8Array);

      expect(positions.length).toBe(2);
      expect(positions[0]).toBeGreaterThan(0);
      expect(positions[1]).toBeGreaterThan(positions[0]);
    });

    it('should find 3 delimiters in a 4-part bundle', () => {
      const bundle = createMockBundle(4);
      const uint8Array = new Uint8Array(bundle);
      const positions = findBundleDelimiterPositions(uint8Array);

      expect(positions.length).toBe(3);
      expect(positions[0]).toBeGreaterThan(0);
      expect(positions[1]).toBeGreaterThan(positions[0]);
      expect(positions[2]).toBeGreaterThan(positions[1]);
    });

    it('should return empty array for buffer without delimiter', () => {
      const buffer = createMockParquetBuffer('no delimiter');
      const uint8Array = new Uint8Array(buffer);
      const positions = findBundleDelimiterPositions(uint8Array);

      expect(positions.length).toBe(0);
    });
  });

  describe('extractRowsFromParquetBundle', () => {
    // Note: These tests require proper parquet files which we can't easily mock.
    // The following tests verify the error handling behavior.

    it('should reject bundle with 1 delimiter (2 parts)', async () => {
      const bundle = createMockBundle(2);

      await expect(extractRowsFromParquetBundle(bundle)).rejects.toThrow(
        /Expected 2 or 3 delimiters/,
      );
    });

    it('should reject bundle with 4 delimiters (5 parts)', async () => {
      const bundle = createMockBundle(5);

      await expect(extractRowsFromParquetBundle(bundle)).rejects.toThrow(
        /Expected 2 or 3 delimiters/,
      );
    });

    it('should reject bundle with no delimiters', async () => {
      const buffer = createMockParquetBuffer('no delimiter');

      await expect(extractRowsFromParquetBundle(buffer)).rejects.toThrow(
        /Expected 2 or 3 delimiters/,
      );
    });
  });
});

describe('BundleSettings type', () => {
  it('should have correct structure', () => {
    const settings: BundleSettings = {
      legendSettings: {
        organism: {
          maxVisibleValues: 10,
          // Legacy field — kept to verify backward-compat parsing.
          includeShapes: true,
          shapeSize: 24,
          sortMode: 'size-desc',
          hiddenValues: ['unknown'],
          categories: {
            human: { zOrder: 0, color: '#ff0000', shape: 'circle' },
          },
          enableDuplicateStackUI: false,
          selectedPaletteId: 'kellys',
        },
      },
      exportOptions: {
        organism: {
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

    expect(settings.legendSettings.organism.maxVisibleValues).toBe(10);
    expect(settings.legendSettings.organism.sortMode).toBe('size-desc');
    expect(settings.legendSettings.organism.categories.human.color).toBe('#ff0000');
    expect(settings.exportOptions.organism.imageWidth).toBe(2048);
  });

  it('should accept settings with empty maps', () => {
    const settings: BundleSettings = {
      legendSettings: {},
      exportOptions: {},
    };

    expect(Object.keys(settings.legendSettings)).toHaveLength(0);
    expect(Object.keys(settings.exportOptions)).toHaveLength(0);
  });

  it('should accept settings with extra/unknown fields (forward compatibility)', () => {
    // This simulates loading settings from a newer version with additional fields
    const settingsWithExtras = {
      legendSettings: {
        organism: {
          maxVisibleValues: 10,
          shapeSize: 24,
          sortMode: 'size-desc',
          hiddenValues: [],
          categories: {},
          enableDuplicateStackUI: false,
          selectedPaletteId: 'kellys',
          unknownField: 'some value',
        },
      },
      exportOptions: {},
    };

    // Type-cast to BundleSettings - extra fields should be ignored
    const settings = settingsWithExtras as BundleSettings;
    expect(settings.legendSettings.organism.maxVisibleValues).toBe(10);
    expect(settings.legendSettings.organism.sortMode).toBe('size-desc');
  });

  it('should work with multiple annotations', () => {
    const settings: BundleSettings = {
      legendSettings: {
        organism: {
          maxVisibleValues: 10,
          shapeSize: 24,
          sortMode: 'size-desc',
          hiddenValues: ['unknown'],
          categories: {
            human: { zOrder: 0, color: '#ff0000', shape: 'circle' },
          },
          enableDuplicateStackUI: false,
          selectedPaletteId: 'kellys',
        },
        family: {
          maxVisibleValues: 5,
          shapeSize: 16,
          sortMode: 'alpha-asc',
          hiddenValues: [],
          categories: {
            kinase: { zOrder: 1, color: '#00ff00', shape: 'square' },
            phosphatase: { zOrder: 0, color: '#0000ff', shape: 'diamond' },
          },
          enableDuplicateStackUI: true,
          selectedPaletteId: 'kellys',
        },
      },
      exportOptions: {
        organism: {
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

    expect(Object.keys(settings.legendSettings)).toHaveLength(2);
    expect(settings.legendSettings.family.categories.kinase.color).toBe('#00ff00');
  });
});
