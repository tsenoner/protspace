import { describe, it, expect } from 'vitest';
import { buildAnnotationValueList } from './annotation-values';
import { NA_VALUE } from './config';

// ─── Int32Array (single-valued) fixtures ────────────────────────────────────

/**
 * Build an Int32Array where each element is the annotation index for that protein.
 * -1 means "no annotation".
 */
function makeSingleValued(indices: number[]): Int32Array {
  return new Int32Array(indices);
}

// ─── Multi-valued fixtures ───────────────────────────────────────────────────

/**
 * Build a multi-valued AnnotationData (readonly (readonly number[])[]) directly.
 */
function makeMultiValued(indexLists: number[][]): readonly (readonly number[])[] {
  return indexLists.map((list) => list as readonly number[]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildAnnotationValueList', () => {
  describe('empty (proteinCount 0)', () => {
    it('returns [] for single-valued storage', () => {
      const colData = makeSingleValued([]);
      expect(buildAnnotationValueList(colData, [], 0)).toEqual([]);
    });

    it('returns [] for multi-valued storage', () => {
      const colData = makeMultiValued([]);
      expect(buildAnnotationValueList(colData, [], 0)).toEqual([]);
    });
  });

  describe('single-valued (Int32Array) — all proteins annotated', () => {
    it('produces one value per protein in order', () => {
      const values = ['alpha', 'beta', 'gamma'];
      // protein 0 → values[2], protein 1 → values[0], protein 2 → values[1]
      const colData = makeSingleValued([2, 0, 1]);
      const result = buildAnnotationValueList(colData, values, 3);
      expect(result).toEqual(['gamma', 'alpha', 'beta']);
    });

    it('length equals proteinCount when all are annotated', () => {
      const values = ['a', 'b'];
      const colData = makeSingleValued([0, 1, 0, 1]);
      const result = buildAnnotationValueList(colData, values, 4);
      expect(result).toHaveLength(4);
    });
  });

  describe('single-valued (Int32Array) — some proteins missing (compacted)', () => {
    it('omits proteins with idx < 0', () => {
      const values = ['cat', 'dog'];
      // protein 0 → values[0], protein 1 → missing (-1), protein 2 → values[1]
      const colData = makeSingleValued([0, -1, 1]);
      const result = buildAnnotationValueList(colData, values, 3);
      expect(result).toEqual(['cat', 'dog']);
    });

    it('length is less than proteinCount when some are missing', () => {
      const values = ['x'];
      const colData = makeSingleValued([-1, -1, 0, -1]);
      const result = buildAnnotationValueList(colData, values, 4);
      expect(result).toHaveLength(1);
      expect(result).toEqual(['x']);
    });

    it('preserves order of annotated proteins', () => {
      const values = ['first', 'second', 'third'];
      // proteins 0,2,4 are annotated; 1,3 are missing
      const colData = makeSingleValued([2, -1, 0, -1, 1]);
      const result = buildAnnotationValueList(colData, values, 5);
      expect(result).toEqual(['third', 'first', 'second']);
    });

    it('returns [] when all proteins have idx < 0', () => {
      const values = ['a', 'b'];
      const colData = makeSingleValued([-1, -1, -1]);
      const result = buildAnnotationValueList(colData, values, 3);
      expect(result).toEqual([]);
    });
  });

  describe('multi-valued — expanded', () => {
    it('a protein with 2 labels contributes 2 entries', () => {
      const values = ['labelA', 'labelB', 'labelC'];
      // protein 0 → [0, 1], protein 1 → [2]
      const colData = makeMultiValued([[0, 1], [2]]);
      const result = buildAnnotationValueList(colData, values, 2);
      expect(result).toEqual(['labelA', 'labelB', 'labelC']);
    });

    it('total length equals sum of label counts', () => {
      const values = ['v0', 'v1', 'v2', 'v3'];
      // protein 0 → 3 labels, protein 1 → 0 labels, protein 2 → 1 label
      const colData = makeMultiValued([[0, 1, 2], [], [3]]);
      const result = buildAnnotationValueList(colData, values, 3);
      expect(result).toHaveLength(4);
      expect(result).toEqual(['v0', 'v1', 'v2', 'v3']);
    });

    it('proteins with empty index lists contribute 0 entries', () => {
      const values = ['only'];
      const colData = makeMultiValued([[], [], [0]]);
      const result = buildAnnotationValueList(colData, values, 3);
      expect(result).toEqual(['only']);
    });
  });

  describe('toInternalValue applied (null → NA_VALUE)', () => {
    it('maps null values to NA_VALUE in single-valued storage', () => {
      // values[0] is null → should become NA_VALUE
      const values: (string | null)[] = [null, 'real'];
      const colData = makeSingleValued([0, 1]);
      const result = buildAnnotationValueList(colData, values, 2);
      expect(result[0]).toBe(NA_VALUE);
      expect(result[1]).toBe('real');
    });

    it('maps null values to NA_VALUE in multi-valued storage', () => {
      const values: (string | null)[] = [null, 'present'];
      const colData = makeMultiValued([[0, 1]]);
      const result = buildAnnotationValueList(colData, values, 1);
      expect(result).toEqual([NA_VALUE, 'present']);
    });

    it('non-null string values pass through unchanged', () => {
      const values: (string | null)[] = ['hello', 'world'];
      const colData = makeSingleValued([0, 1]);
      const result = buildAnnotationValueList(colData, values, 2);
      expect(result).toEqual(['hello', 'world']);
    });
  });
});
