import { describe, it, expect } from 'vitest';
import type { ProtspaceData } from './types';
import type { FilterQuery } from './query-types';
import {
  evaluateQuery,
  evaluateQueryExcluding,
  hasConfiguredCondition,
  resolveAnnotationValue,
  resolveAnnotationInternalValues,
} from './query-evaluate';

/** Minimal test data: 5 proteins with categorical and numeric annotations */
function createTestData(): ProtspaceData {
  return {
    protein_ids: ['P1', 'P2', 'P3', 'P4', 'P5'],
    annotations: {
      organism: { values: ['Human', 'Mouse', 'Zebrafish'] },
      reviewed: { values: ['true', 'false'] },
      pfam: { values: ['PF00069', 'PF00076', null] },
      length: { kind: 'numeric', values: [] },
    },
    annotation_data: {
      // P1=Human, P2=Mouse, P3=Human, P4=Zebrafish, P5=Mouse
      organism: [[0], [1], [0], [2], [1]],
      // P1=true, P2=false, P3=true, P4=true, P5=false
      reviewed: [[0], [1], [0], [0], [1]],
      // P1=PF00069, P2=PF00076, P3=null, P4=PF00069, P5=PF00076
      pfam: [[0], [1], [2], [0], [1]],
    },
    numeric_annotation_data: {
      // P1=100, P2=250, P3=400, P4=550, P5=null
      length: [100, 250, 400, 550, null],
    },
  };
}

describe('resolveAnnotationValue', () => {
  it('resolves value from number[][] format', () => {
    const data = createTestData();
    expect(resolveAnnotationValue(0, 'organism', data)).toBe('Human');
    expect(resolveAnnotationValue(1, 'organism', data)).toBe('Mouse');
  });

  it('returns null for missing annotation', () => {
    const data = createTestData();
    expect(resolveAnnotationValue(0, 'nonexistent', data)).toBeNull();
  });

  it('returns null for out-of-range index', () => {
    const data = createTestData();
    expect(resolveAnnotationValue(99, 'organism', data)).toBeNull();
  });

  it('handles Int32Array format (single-valued columns)', () => {
    const data: ProtspaceData = {
      protein_ids: ['P1', 'P2'],
      annotations: { organism: { values: ['Human', 'Mouse'] } },
      annotation_data: { organism: Int32Array.from([0, 1]) },
    };
    expect(resolveAnnotationValue(0, 'organism', data)).toBe('Human');
    expect(resolveAnnotationValue(1, 'organism', data)).toBe('Mouse');
  });
});

describe('evaluateQuery', () => {
  describe('empty/trivial queries', () => {
    it('returns all indices for empty query', () => {
      const data = createTestData();
      const result = evaluateQuery([], data);
      expect(result).toEqual(new Set([0, 1, 2, 3, 4]));
    });

    it('returns empty set for missing protein_ids', () => {
      const result = evaluateQuery([], {});
      expect(result).toEqual(new Set());
    });
  });

  describe('single condition', () => {
    it('matches proteins with selected value', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 2]));
    });

    it('matches multiple values (implicit OR)', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human', 'Mouse'] },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 1, 2, 4]));
    });

    it('skips condition with empty values', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: [] },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 1, 2, 3, 4]));
    });
  });

  describe('AND logic', () => {
    it('intersects two conditions', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
        {
          id: '2',
          logicalOp: 'AND',
          kind: 'categorical',
          annotation: 'reviewed',
          values: ['true'],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 2]));
    });
  });

  describe('OR logic', () => {
    it('unions two conditions', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
        {
          id: '2',
          logicalOp: 'OR',
          kind: 'categorical',
          annotation: 'reviewed',
          values: ['false'],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 1, 2, 4]));
    });
  });

  describe('NOT logic', () => {
    it('negates a single condition', () => {
      const query: FilterQuery = [
        {
          id: '1',
          logicalOp: 'NOT',
          kind: 'categorical',
          annotation: 'organism',
          values: ['Human'],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([1, 3, 4]));
    });

    it('NOT combined with AND', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human', 'Mouse'] },
        {
          id: '2',
          logicalOp: 'NOT',
          kind: 'categorical',
          annotation: 'reviewed',
          values: ['false'],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 2]));
    });
  });

  describe('operator precedence (flat, left-to-right)', () => {
    // Conditions are folded strictly left-to-right with no AND-over-OR precedence:
    // `A OR B AND C` evaluates as `(A OR B) AND C`, not the SQL-conventional
    // `A OR (B AND C)`. Use groups for the latter. This test pins that behaviour so
    // it stays an intentional choice rather than an accidental regression.
    it('folds A OR B AND C as (A OR B) AND C', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Zebrafish'] },
        {
          id: '2',
          logicalOp: 'OR',
          kind: 'categorical',
          annotation: 'organism',
          values: ['Mouse'],
        },
        {
          id: '3',
          logicalOp: 'AND',
          kind: 'categorical',
          annotation: 'reviewed',
          values: ['false'],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      // (Zebrafish{3} OR Mouse{1,4}) AND reviewed=false{1,4} -> {1,4}
      // NOT Zebrafish{3} OR (Mouse{1,4} AND reviewed=false{1,4}) -> {1,3,4}
      expect(result).toEqual(new Set([1, 4]));
    });
  });

  describe('groups', () => {
    it('evaluates a group as a unit', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'reviewed', values: ['true'] },
        {
          id: 'g1',
          logicalOp: 'AND',
          conditions: [
            { id: '2', kind: 'categorical', annotation: 'organism', values: ['Human'] },
            {
              id: '3',
              logicalOp: 'OR',
              kind: 'categorical',
              annotation: 'organism',
              values: ['Mouse'],
            },
          ],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 2]));
    });

    it('negates an entire group with NOT', () => {
      const query: FilterQuery = [
        {
          id: 'g1',
          logicalOp: 'NOT',
          conditions: [
            { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
            {
              id: '2',
              logicalOp: 'AND',
              kind: 'categorical',
              annotation: 'reviewed',
              values: ['true'],
            },
          ],
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([1, 3, 4]));
    });
  });

  describe('null value handling', () => {
    it('matches null via __NA__ normalized value', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'pfam', values: ['__NA__'] },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([2]));
    });

    it('NOT excludes null via __NA__ normalized value', () => {
      const query: FilterQuery = [
        { id: '1', logicalOp: 'NOT', kind: 'categorical', annotation: 'pfam', values: ['__NA__'] },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 1, 3, 4]));
    });
  });

  describe('missing annotation', () => {
    it('treats missing annotation as non-matching', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'nonexistent', values: ['foo'] },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set());
    });
  });

  describe('numeric conditions', () => {
    it('matches proteins greater than a threshold (exclusive)', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'numeric', annotation: 'length', operator: 'gt', min: 250, max: null },
      ];
      const result = evaluateQuery(query, createTestData());
      // > 250 → P3(400), P4(550); P2(250) excluded (exclusive)
      expect(result).toEqual(new Set([2, 3]));
    });

    it('matches proteins less than a threshold (exclusive)', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'numeric', annotation: 'length', operator: 'lt', min: null, max: 400 },
      ];
      const result = evaluateQuery(query, createTestData());
      // < 400 → P1(100), P2(250)
      expect(result).toEqual(new Set([0, 1]));
    });

    it('matches proteins within an inclusive interval', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'numeric', annotation: 'length', operator: 'between', min: 250, max: 400 },
      ];
      const result = evaluateQuery(query, createTestData());
      // between 250 and 400 inclusive → P2(250), P3(400)
      expect(result).toEqual(new Set([1, 2]));
    });

    it('never matches a protein with a null numeric value', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'numeric', annotation: 'length', operator: 'gt', min: 0, max: null },
      ];
      const result = evaluateQuery(query, createTestData());
      // P5 has null length → excluded even though 0 is below every real value
      expect(result).toEqual(new Set([0, 1, 2, 3]));
    });

    it('is a no-op (matches all) when a required bound is missing, like an empty categorical condition', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'numeric', annotation: 'length', operator: 'gt', min: null, max: null },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set([0, 1, 2, 3, 4]));
    });

    it('matches nothing when an unconfigured numeric condition is negated (symmetric with empty categorical)', () => {
      const query: FilterQuery = [
        {
          id: '1',
          logicalOp: 'NOT',
          kind: 'numeric',
          annotation: 'length',
          operator: 'gt',
          min: null,
          max: null,
        },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set());
    });

    it('matches nothing for between with min > max', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'numeric', annotation: 'length', operator: 'between', min: 500, max: 200 },
      ];
      const result = evaluateQuery(query, createTestData());
      expect(result).toEqual(new Set());
    });

    it('combines a numeric condition with a categorical one via AND', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
        {
          id: '2',
          logicalOp: 'AND',
          kind: 'numeric',
          annotation: 'length',
          operator: 'gt',
          min: 250,
          max: null,
        },
      ];
      const result = evaluateQuery(query, createTestData());
      // Human → P1,P3 ; length>250 → P3,P4 ; AND → P3
      expect(result).toEqual(new Set([2]));
    });

    it('combines a numeric condition with a categorical one via OR', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'organism', values: ['Zebrafish'] },
        {
          id: '2',
          logicalOp: 'OR',
          kind: 'numeric',
          annotation: 'length',
          operator: 'lt',
          min: null,
          max: 200,
        },
      ];
      const result = evaluateQuery(query, createTestData());
      // Zebrafish → P4 ; length<200 → P1 ; OR → P1,P4
      expect(result).toEqual(new Set([0, 3]));
    });

    it('negates a numeric condition with NOT', () => {
      const query: FilterQuery = [
        {
          id: '1',
          logicalOp: 'NOT',
          kind: 'numeric',
          annotation: 'length',
          operator: 'gt',
          min: 250,
          max: null,
        },
      ];
      const result = evaluateQuery(query, createTestData());
      // length>250 → P3,P4 ; NOT → P1,P2,P5 (P5 null is "not > 250")
      expect(result).toEqual(new Set([0, 1, 4]));
    });
  });
});

describe('hasConfiguredCondition', () => {
  it('is false for an empty query', () => {
    expect(hasConfiguredCondition([])).toBe(false);
  });

  it('is false for the seeded unconfigured categorical condition', () => {
    const query: FilterQuery = [{ id: '1', kind: 'categorical', annotation: '', values: [] }];
    expect(hasConfiguredCondition(query)).toBe(false);
  });

  it('is false when an annotation is picked but no values are selected (still a no-op)', () => {
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: 'organism', values: [] },
    ];
    expect(hasConfiguredCondition(query)).toBe(false);
  });

  it('is true for a categorical condition with at least one value', () => {
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
    ];
    expect(hasConfiguredCondition(query)).toBe(true);
  });

  it('is false for a numeric condition missing its required bound', () => {
    const query: FilterQuery = [
      { id: '1', kind: 'numeric', annotation: 'length', operator: 'gt', min: null, max: null },
    ];
    expect(hasConfiguredCondition(query)).toBe(false);
  });

  it('is true for a numeric condition with its required bound set', () => {
    const query: FilterQuery = [
      { id: '1', kind: 'numeric', annotation: 'length', operator: 'gt', min: 250, max: null },
    ];
    expect(hasConfiguredCondition(query)).toBe(true);
  });

  it('is false for a group containing only unconfigured conditions', () => {
    const query: FilterQuery = [
      {
        id: 'g1',
        conditions: [{ id: '1', kind: 'categorical', annotation: '', values: [] }],
      },
    ];
    expect(hasConfiguredCondition(query)).toBe(false);
  });

  it('is true when a group contains one configured condition among unconfigured ones', () => {
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: '', values: [] },
      {
        id: 'g1',
        logicalOp: 'AND',
        conditions: [
          { id: '2', kind: 'categorical', annotation: '', values: [] },
          {
            id: '3',
            logicalOp: 'AND',
            kind: 'categorical',
            annotation: 'organism',
            values: ['Human'],
          },
        ],
      },
    ];
    expect(hasConfiguredCondition(query)).toBe(true);
  });
});

describe('evaluateQueryExcluding', () => {
  it('returns all indices when excluding single condition from single-condition query', () => {
    const data = createTestData();
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
    ];
    const result = evaluateQueryExcluding(query, data, '1');
    expect(result).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('returns other condition result when excluding one of two AND conditions', () => {
    const data = createTestData();
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
      { id: '2', logicalOp: 'AND', kind: 'categorical', annotation: 'reviewed', values: ['true'] },
    ];
    const result = evaluateQueryExcluding(query, data, '1');
    expect(result).toEqual(new Set([0, 2, 3]));
  });

  it('excludes condition inside a group', () => {
    const data = createTestData();
    const query: FilterQuery = [
      {
        id: 'g1',
        logicalOp: 'AND',
        conditions: [
          { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
          {
            id: '2',
            logicalOp: 'AND',
            kind: 'categorical',
            annotation: 'reviewed',
            values: ['true'],
          },
        ],
      },
    ];
    const result = evaluateQueryExcluding(query, data, '2');
    expect(result).toEqual(new Set([0, 2]));
  });

  it('returns full query result when excluding non-existent ID', () => {
    const data = createTestData();
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
    ];
    const result = evaluateQueryExcluding(query, data, 'nonexistent');
    expect(result).toEqual(new Set([0, 2]));
  });

  it('excludes a numeric condition from a mixed query', () => {
    const data = createTestData();
    const query: FilterQuery = [
      { id: '1', kind: 'categorical', annotation: 'organism', values: ['Human'] },
      {
        id: '2',
        logicalOp: 'AND',
        kind: 'numeric',
        annotation: 'length',
        operator: 'gt',
        min: 250,
        max: null,
      },
    ];
    // Full query: Human {0,2} AND length>250 {2,3} → {2}.
    // Excluding the numeric condition '2' leaves just the categorical → {0,2}.
    const result = evaluateQueryExcluding(query, data, '2');
    expect(result).toEqual(new Set([0, 2]));
  });

  it('returns all indices for empty data', () => {
    const result = evaluateQueryExcluding([], {}, '1');
    expect(result).toEqual(new Set());
  });
});

describe('multi-label annotations', () => {
  /** P1=[A,B], P2=[A], P3=[B,C], P4=[] (no labels) */
  function createMultilabelData(): ProtspaceData {
    return {
      protein_ids: ['P1', 'P2', 'P3', 'P4'],
      annotations: {
        domain: { values: ['A', 'B', 'C'] },
      },
      annotation_data: {
        domain: [[0, 1], [0], [1, 2], []],
      },
    };
  }

  describe('resolveAnnotationInternalValues', () => {
    it('returns every label for a multi-label protein', () => {
      const data = createMultilabelData();
      expect(resolveAnnotationInternalValues(0, 'domain', data)).toEqual(['A', 'B']);
      expect(resolveAnnotationInternalValues(1, 'domain', data)).toEqual(['A']);
    });

    it('resolves a protein with no labels to [__NA__]', () => {
      const data = createMultilabelData();
      expect(resolveAnnotationInternalValues(3, 'domain', data)).toEqual(['__NA__']);
    });

    it('resolves a missing annotation column to [__NA__]', () => {
      const data = createMultilabelData();
      expect(resolveAnnotationInternalValues(0, 'nonexistent', data)).toEqual(['__NA__']);
    });

    it('deduplicates repeated labels', () => {
      const data: ProtspaceData = {
        protein_ids: ['P1'],
        annotations: { domain: { values: ['A'] } },
        annotation_data: { domain: [[0, 0]] },
      };
      expect(resolveAnnotationInternalValues(0, 'domain', data)).toEqual(['A']);
    });

    it('handles Int32Array single-valued storage', () => {
      const data: ProtspaceData = {
        protein_ids: ['P1', 'P2'],
        annotations: { domain: { values: ['A', 'B'] } },
        annotation_data: { domain: Int32Array.from([1, -1]) },
      };
      expect(resolveAnnotationInternalValues(0, 'domain', data)).toEqual(['B']);
      expect(resolveAnnotationInternalValues(1, 'domain', data)).toEqual(['__NA__']);
    });
  });

  describe('evaluateQuery with multi-label data', () => {
    it('matches a protein when ANY of its labels is selected', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'domain', values: ['B'] },
      ];
      // P1=[A,B] and P3=[B,C] both carry B — not just proteins whose FIRST label is B.
      const result = evaluateQuery(query, createMultilabelData());
      expect(result).toEqual(new Set([0, 2]));
    });

    it('AND of two values on the same annotation matches proteins carrying both', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'domain', values: ['A'] },
        { id: '2', logicalOp: 'AND', kind: 'categorical', annotation: 'domain', values: ['B'] },
      ];
      // Only P1 carries both A and B.
      const result = evaluateQuery(query, createMultilabelData());
      expect(result).toEqual(new Set([0]));
    });

    it('multiple selected values act as any-label OR', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'domain', values: ['A', 'C'] },
      ];
      const result = evaluateQuery(query, createMultilabelData());
      expect(result).toEqual(new Set([0, 1, 2]));
    });

    it('NOT excludes proteins carrying the value among ANY label', () => {
      const query: FilterQuery = [
        { id: '1', logicalOp: 'NOT', kind: 'categorical', annotation: 'domain', values: ['B'] },
      ];
      // P1 and P3 carry B somewhere in their label list, so only P2 and P4 remain.
      const result = evaluateQuery(query, createMultilabelData());
      expect(result).toEqual(new Set([1, 3]));
    });

    it('matches unlabeled proteins via __NA__', () => {
      const query: FilterQuery = [
        { id: '1', kind: 'categorical', annotation: 'domain', values: ['__NA__'] },
      ];
      const result = evaluateQuery(query, createMultilabelData());
      expect(result).toEqual(new Set([3]));
    });
  });
});
