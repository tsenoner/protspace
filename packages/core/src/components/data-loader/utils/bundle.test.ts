import { describe, it, expect } from 'vitest';
import { parquetWriteBuffer } from 'hyparquet-writer';
import {
  BUNDLE_DELIMITER,
  BUNDLE_DELIMITER_BYTES,
  concatenateBuffers,
  isParquetBundle,
  findBundleDelimiterPositions,
  type BundleSettings,
} from '@protspace/utils';
import { decodeParquetBundle, extractRowsFromParquetBundle } from './bundle';
import { DEFAULT_VALIDATION_LIMITS } from './validation';

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
        /Expected 2 to 5 delimiters/,
      );
    });

    // 5 parts (settings + statistics) and 6 (format v3, which appends the payloads
    // part) are layouts the Python producer writes, so they must pass this gate. The
    // 5-part case is not asserted here: with mock parts the call still rejects during
    // decode, so any assertion would be about the decode error, not about acceptance.
    // `tests/contract/bundle.contract.test.ts` proves acceptance against a real
    // producer-written 5-part bundle instead.

    it('should let a 6-part bundle past the gate and fail on its contents instead', async () => {
      const error: unknown = await extractRowsFromParquetBundle(createMockBundle(6)).catch(
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/Expected 2 to 5 delimiters/);
    });

    it('should reject bundle with 6 delimiters (7 parts)', async () => {
      const bundle = createMockBundle(7);

      await expect(extractRowsFromParquetBundle(bundle)).rejects.toThrow(
        /Expected 2 to 5 delimiters/,
      );
    });

    it('should reject bundle with no delimiters', async () => {
      const buffer = createMockParquetBuffer('no delimiter');

      await expect(extractRowsFromParquetBundle(buffer)).rejects.toThrow(
        /Expected 2 to 5 delimiters/,
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

type ColumnData = { name: string; data: unknown[] | Float32Array }[];

/** A v1 bundle with one annotated protein and one projection, whose rows are `projectionRows`. */
function legacyBundle(projectionRows: ColumnData): ArrayBuffer {
  const write = (columnData: ColumnData) => parquetWriteBuffer({ columnData: columnData as never });
  return concatenateBuffers(
    [
      write([
        { name: 'identifier', data: ['P0'] },
        { name: 'family', data: ['a'] },
      ]),
      write([
        { name: 'projection_name', data: ['pca2'] },
        { name: 'dimensions', data: [2] },
        { name: 'info_json', data: ['{}'] },
      ]),
      write(projectionRows),
    ],
    BUNDLE_DELIMITER_BYTES,
  );
}

describe('legacy bundle validation', () => {
  it('checks the decoded projection rows', async () => {
    // 10,000 rows take the conversion's large-data path, which does not check rows itself,
    // so only the reader's own check refuses this one.
    const rows = 10_000;
    const ids = Array.from({ length: rows }, (_, i) => `P${i}`);
    ids[0] = 'P0\u0001';
    const coordinates = new Float32Array(rows);
    const bundle = legacyBundle([
      { name: 'projection_name', data: new Array<string>(rows).fill('pca2') },
      { name: 'identifier', data: ids },
      { name: 'x', data: coordinates },
      { name: 'y', data: coordinates },
    ]);

    await expect(decodeParquetBundle(bundle)).rejects.toThrow(
      "Control characters detected in column 'identifier'",
    );
  });

  it('refuses a v1/v2 bundle above the row cap, pointing at protspace convert', async () => {
    const rows = DEFAULT_VALIDATION_LIMITS.maxRows + 1;
    const coordinates = Float32Array.from({ length: rows }, (_, i) => i);
    const bundle = legacyBundle([
      { name: 'projection_name', data: new Array<string>(rows).fill('pca2') },
      { name: 'identifier', data: Array.from({ length: rows }, (_, i) => `P${i}`) },
      { name: 'x', data: coordinates },
      { name: 'y', data: coordinates },
    ]);

    const error = await decodeParquetBundle(bundle).then(
      () => null,
      (reason: Error) => reason,
    );

    expect(error?.message).toContain(`${rows.toLocaleString()} rows (proteins x projections)`);
    expect(error?.message).toMatch(/Run "protspace convert" on the file/);
  }, 60_000);
});
