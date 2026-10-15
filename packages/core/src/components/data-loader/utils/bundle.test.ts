import { describe, it, expect } from 'vitest';
import { BUNDLE_DELIMITER, isParquetBundle, findBundleDelimiterPositions } from '@protspace/utils';
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
