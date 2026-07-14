import { describe, it, expect } from 'vitest';
import { djb2Hash, generateDatasetHash } from './data-hash';

describe('djb2Hash', () => {
  it('should return consistent hash for the same input', () => {
    const input = 'hello world';
    const hash1 = djb2Hash(input);
    const hash2 = djb2Hash(input);
    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different inputs', () => {
    const hash1 = djb2Hash('hello');
    const hash2 = djb2Hash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const result = djb2Hash('');
    expect(result).toBe(5381); // Initial hash value when no characters are processed
  });

  it('should return an unsigned 32-bit integer', () => {
    const result = djb2Hash('test string with many characters');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });

  it('should produce different hashes for similar strings', () => {
    const hash1 = djb2Hash('abcdefghijklmnopqrstuvwxyz');
    const hash2 = djb2Hash('abcdefghijklmnopqrstuvwxyzz');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle special characters', () => {
    const hash1 = djb2Hash('hello\x00world');
    const hash2 = djb2Hash('helloworld');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle unicode characters', () => {
    const result = djb2Hash('こんにちは');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('generateDatasetHash', () => {
  it('should return 16-character hex string for valid input', () => {
    const result = generateDatasetHash(['protein1', 'protein2']);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should return a zeroed 64-bit hash for empty array', () => {
    const result = generateDatasetHash([]);
    expect(result).toBe('0000000000000000');
  });

  it('should return consistent hash for the same protein IDs', () => {
    const proteins = ['P12345', 'Q67890', 'O11111'];
    const hash1 = generateDatasetHash(proteins);
    const hash2 = generateDatasetHash(proteins);
    expect(hash1).toBe(hash2);
  });

  it('should return the same hash regardless of input order', () => {
    const hash1 = generateDatasetHash(['P12345', 'Q67890', 'O11111']);
    const hash2 = generateDatasetHash(['O11111', 'P12345', 'Q67890']);
    const hash3 = generateDatasetHash(['Q67890', 'O11111', 'P12345']);
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should return different hashes for different protein sets', () => {
    const hash1 = generateDatasetHash(['P12345', 'Q67890']);
    const hash2 = generateDatasetHash(['P12345', 'Q67891']);
    expect(hash1).not.toBe(hash2);
  });

  it('should handle single protein ID', () => {
    const result = generateDatasetHash(['P12345']);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
    expect(result).not.toBe('0000000000000000');
  });

  it('should handle large arrays of protein IDs', () => {
    const proteins = Array.from({ length: 10000 }, (_, i) => `P${i.toString().padStart(5, '0')}`);
    const result = generateDatasetHash(proteins);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should handle protein IDs with special characters', () => {
    const result = generateDatasetHash(['P12345-1', 'Q67890.2', 'O11111_HUMAN']);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should differentiate between similar protein ID combinations', () => {
    const hash1 = generateDatasetHash(['AB', 'CD']);
    const hash2 = generateDatasetHash(['ABC', 'D']);
    const hash3 = generateDatasetHash(['A', 'BCD']);
    expect(hash1).not.toBe(hash2);
    expect(hash2).not.toBe(hash3);
    expect(hash1).not.toBe(hash3);
  });

  it('should not mutate the input array', () => {
    const proteins = ['Z99999', 'A00001', 'M50000'];
    const originalOrder = [...proteins];
    generateDatasetHash(proteins);
    expect(proteins).toEqual(originalOrder);
  });

  it('should handle duplicate protein IDs', () => {
    const hash1 = generateDatasetHash(['P12345', 'P12345', 'Q67890']);
    const hash2 = generateDatasetHash(['P12345', 'Q67890']);
    expect(hash1).not.toBe(hash2);
  });

  it('should include raw numeric annotation data in dataset fingerprinting', () => {
    const baseDataset = {
      protein_ids: ['P1', 'P2'],
      annotations: {
        length: {
          kind: 'numeric' as const,
          values: [],
        },
      },
      numeric_annotation_data: {
        length: [10, 20],
      },
    };

    const changedNumericDataset = {
      ...baseDataset,
      numeric_annotation_data: {
        length: [10, 21],
      },
    };

    expect(generateDatasetHash(baseDataset)).not.toBe(generateDatasetHash(changedNumericDataset));
  });

  it('changes when EAT value, confidence, or source changes', () => {
    const base = {
      protein_ids: ['P1', 'P2'],
      annotations: {},
      annotation_predicted: {
        ec: [null, { value: '1.1.1.1', confidence: 0.8, source: 'P1' }],
      },
    };
    expect(generateDatasetHash(base)).not.toBe(
      generateDatasetHash({
        ...base,
        annotation_predicted: {
          ec: [null, { value: '1.1.1.1', confidence: 0.81, source: 'P1' }],
        },
      }),
    );
    expect(generateDatasetHash(base)).not.toBe(
      generateDatasetHash({
        ...base,
        annotation_predicted: {
          ec: [null, { value: '2.2.2.2', confidence: 0.8, source: 'P1' }],
        },
      }),
    );
    expect(generateDatasetHash(base)).not.toBe(
      generateDatasetHash({
        ...base,
        annotation_predicted: {
          ec: [null, { value: '1.1.1.1', confidence: 0.8, source: 'REF' }],
        },
      }),
    );
  });

  it('ignores materialized numeric bin labels when raw numeric data is unchanged', () => {
    const baseDataset = {
      protein_ids: ['P1', 'P2', 'P3'],
      annotations: {
        length: {
          kind: 'categorical' as const,
          sourceKind: 'numeric' as const,
          values: ['1 - <2', '2 - 3'],
        },
      },
      numeric_annotation_data: {
        length: [1, 2, 3],
      },
    };

    const rebinnedDataset = {
      ...baseDataset,
      annotations: {
        length: {
          kind: 'categorical' as const,
          sourceKind: 'numeric' as const,
          values: ['1 - <1.6667', '1.6667 - <2.3333', '2.3333 - 3'],
        },
      },
    };

    expect(generateDatasetHash(baseDataset)).toBe(generateDatasetHash(rebinnedDataset));
  });

  it('treats raw and materialized numeric annotations as the same dataset', () => {
    const rawDataset = {
      protein_ids: ['P1', 'P2', 'P3'],
      annotations: {
        length: {
          kind: 'numeric' as const,
          values: [],
        },
      },
      numeric_annotation_data: {
        length: [1, 2, 3],
      },
    };

    const materializedDataset = {
      ...rawDataset,
      annotations: {
        length: {
          kind: 'categorical' as const,
          sourceKind: 'numeric' as const,
          values: ['1 - <2', '2 - 3'],
        },
      },
    };

    expect(generateDatasetHash(rawDataset)).toBe(generateDatasetHash(materializedDataset));
  });

  it('falls back to numeric metadata when raw numeric arrays are unavailable', () => {
    const materializedOnlyDataset = {
      protein_ids: ['P1', 'P2', 'P3'],
      annotations: {
        length: {
          kind: 'categorical' as const,
          sourceKind: 'numeric' as const,
          values: ['1 - 2', '2 - 3'],
          numericMetadata: {
            strategy: 'linear',
            binCount: 2,
            bins: [
              { id: 'num:linear:1:2', label: '1 - 2', lowerBound: 1, upperBound: 2, count: 2 },
              { id: 'num:linear:2:3', label: '2 - 3', lowerBound: 2, upperBound: 3, count: 1 },
            ],
          },
        },
      },
    };

    const changedTopologyDataset = {
      ...materializedOnlyDataset,
      annotations: {
        length: {
          ...materializedOnlyDataset.annotations.length,
          numericMetadata: {
            ...materializedOnlyDataset.annotations.length.numericMetadata,
            bins: [
              {
                id: 'num:linear:1:1.5',
                label: '1 - 1.5',
                lowerBound: 1,
                upperBound: 1.5,
                count: 1,
              },
              {
                id: 'num:linear:1.5:3',
                label: '1.5 - 3',
                lowerBound: 1.5,
                upperBound: 3,
                count: 2,
              },
            ],
          },
        },
      },
    };

    expect(generateDatasetHash(materializedOnlyDataset)).not.toBe(
      generateDatasetHash(changedTopologyDataset),
    );
  });

  it('ignores numeric metadata label and count changes when topology is unchanged', () => {
    const baseDataset = {
      protein_ids: ['P1', 'P2', 'P3'],
      annotations: {
        length: {
          kind: 'categorical' as const,
          sourceKind: 'numeric' as const,
          values: ['1 - 2', '2 - 3'],
          numericMetadata: {
            strategy: 'linear',
            binCount: 2,
            bins: [
              { id: 'num:linear:1:2', label: '1 - 2', lowerBound: 1, upperBound: 2, count: 2 },
              { id: 'num:linear:2:3', label: '2 - 3', lowerBound: 2, upperBound: 3, count: 1 },
            ],
          },
        },
      },
    };

    const changedLabelsAndCounts = {
      ...baseDataset,
      annotations: {
        length: {
          ...baseDataset.annotations.length,
          numericMetadata: {
            ...baseDataset.annotations.length.numericMetadata,
            bins: [
              {
                id: 'num:linear:1:2',
                label: 'low range',
                lowerBound: 1,
                upperBound: 2,
                count: 999,
              },
              {
                id: 'num:linear:2:3',
                label: 'high range',
                lowerBound: 2,
                upperBound: 3,
                count: 0,
              },
            ],
          },
        },
      },
    };

    expect(generateDatasetHash(baseDataset)).toBe(generateDatasetHash(changedLabelsAndCounts));
  });

  it('detects numeric changes beyond the first chunk of values', () => {
    const numericValues = Array.from({ length: 80 }, (_, index) => index + 1);
    const baseDataset = {
      protein_ids: numericValues.map((value) => `P${value}`),
      annotations: {
        length: {
          kind: 'numeric' as const,
          values: [],
        },
      },
      numeric_annotation_data: {
        length: numericValues,
      },
    };

    const changedNumericDataset = {
      ...baseDataset,
      numeric_annotation_data: {
        length: numericValues.map((value, index) => (index === 79 ? 999 : value)),
      },
    };

    expect(generateDatasetHash(baseDataset)).not.toBe(generateDatasetHash(changedNumericDataset));
  });

  it('treats raw numeric datasets with the same protein-to-value mapping as identical regardless of row order', () => {
    const orderedDataset = {
      protein_ids: ['P1', 'P2', 'P3'],
      annotations: {
        length: {
          kind: 'numeric' as const,
          values: [],
        },
      },
      numeric_annotation_data: {
        length: [10, 20, 30],
      },
    };

    const reorderedDataset = {
      protein_ids: ['P3', 'P1', 'P2'],
      annotations: orderedDataset.annotations,
      numeric_annotation_data: {
        length: [30, 10, 20],
      },
    };

    expect(generateDatasetHash(orderedDataset)).toBe(generateDatasetHash(reorderedDataset));
  });
});
