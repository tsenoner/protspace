import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '../types';
import {
  getProteinAnnotationIndices,
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
} from './annotation-data-access';
import {
  DEFAULT_EAT_RELIABILITY,
  clampReliabilityBound,
  getEatBaseAnnotationKey,
  getEatConfidenceAnnotationKey,
  hasEatPredictions,
  materializeEatOverlay,
  normalizeReliability,
  parseEatCompanionColumn,
} from './eat-overlay';
import { getProteinEvidence, getProteinScores } from './plot-data-accessors';

function createData(): VisualizationData {
  return {
    protein_ids: ['observed', 'transferred', 'missing'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array(6) }],
    annotations: {
      ec: {
        kind: 'categorical',
        values: ['1.1.1.1', '2.2.2.2', '__NA__'],
        colors: ['#f00', '#0f0', '#ddd'],
        shapes: ['circle', 'circle', 'circle'],
      },
    },
    annotation_data: { ec: new Int32Array([0, 2, 2]) },
    annotation_predicted: {
      ec: [null, { value: '2.2.2.2', confidence: 0.81, source: 'observed' }, null],
    },
  };
}

describe('EAT overlay helpers', () => {
  it('recognizes exact reserved companions and synthetic confidence keys', () => {
    expect(parseEatCompanionColumn('ec__pred_source')).toEqual({ base: 'ec', kind: 'source' });
    expect(parseEatCompanionColumn('__pred_source')).toBeNull();
    expect(parseEatCompanionColumn('ec__pred_source_extra')).toBeNull();
    expect(getEatBaseAnnotationKey(getEatConfidenceAnnotationKey('ec'))).toBe('ec');
  });

  it('materializes only the selected base without mutating curated storage', () => {
    const data = createData();
    const materialized = materializeEatOverlay(data, 'ec', true);

    expect(Array.from(materialized.annotation_data.ec as Int32Array)).toEqual([0, 1, 2]);
    expect(Array.from(data.annotation_data.ec as Int32Array)).toEqual([0, 2, 2]);
    expect(materialized.annotation_predicted).toBe(data.annotation_predicted);
  });

  it('is a no-op when disabled and detects prediction-bearing datasets', () => {
    const data = createData();
    expect(materializeEatOverlay(data, 'ec', false)).toBe(data);
    expect(hasEatPredictions(data)).toBe(true);
    expect(hasEatPredictions({ ...data, annotation_predicted: undefined })).toBe(false);
  });

  it('upgrades single-valued storage to materialize every transferred label', () => {
    const data = createData();
    data.annotations.ec.values = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '__NA__'];
    data.annotation_data.ec = new Int32Array([0, 3, 3]);
    data.annotation_predicted!.ec[1] = {
      value: '2.2.2.2;3.3.3.3',
      values: ['2.2.2.2', '3.3.3.3'],
      confidence: 0.81,
      source: 'observed',
    };

    const materialized = materializeEatOverlay(data, 'ec', true);

    expect(isSparseMultiValueAnnotationData(materialized.annotation_data.ec)).toBe(true);
    expect(getProteinAnnotationIndices(materialized.annotation_data.ec, 0)).toEqual([0]);
    expect(getProteinAnnotationIndices(materialized.annotation_data.ec, 1)).toEqual([1, 2]);
    expect(getProteinAnnotationIndices(materialized.annotation_data.ec, 2)).toEqual([3]);
    expect(data.annotation_data.ec).toBeInstanceOf(Int32Array);
  });

  it('retains compact storage when one million-row column has one multi-hit prediction', () => {
    const size = 1_000_000;
    const data = createData();
    data.protein_ids = new Array(size).fill('protein');
    data.annotation_data.ec = new Int32Array(size).fill(0);
    data.annotations.ec.values = ['1.1.1.1', '2.2.2.2'];
    data.annotation_predicted!.ec = new Array(size).fill(null);
    data.annotation_predicted!.ec[size - 1] = {
      value: '1.1.1.1;2.2.2.2',
      values: ['1.1.1.1', '2.2.2.2'],
      confidence: 0.9,
      source: 'reference',
    };

    const rows = materializeEatOverlay(data, 'ec', true).annotation_data.ec;

    expect(isSparseMultiValueAnnotationData(rows)).toBe(true);
    if (!isSparseMultiValueAnnotationData(rows)) throw new Error('expected sparse storage');
    expect(rows.base).toBeInstanceOf(Int32Array);
    expect(rows.base.byteLength).toBe(size * Int32Array.BYTES_PER_ELEMENT);
    expect(rows.overrides.size).toBe(1);
    expect(rows.overrides.get(size - 1)).toEqual([0, 1]);
  });
});

describe('normalizeReliability', () => {
  it('blanks the bound its mode does not use', () => {
    // Both mirror directions compare states for equality, and the query round-trip
    // always reads back the canonical spelling. A caller that leaves the unused bound
    // at its previous value would never compare equal, so the de-dupe guard would
    // never fire and every repeat call would rewrite the query.
    expect(normalizeReliability({ mode: 'atLeast', min: 0.3, max: 0.7 })).toEqual({
      mode: 'atLeast',
      min: 0.3,
      max: 1,
    });
    expect(normalizeReliability({ mode: 'atMost', min: 0.3, max: 0.7 })).toEqual({
      mode: 'atMost',
      min: 0,
      max: 0.7,
    });
  });

  it('orders an inverted band instead of emitting an unsatisfiable one', () => {
    // The two sliders move independently, so the lower can be dragged past the upper.
    // `between 0.8..0.5` evaluates as `v >= 0.8 && v <= 0.5`, which nothing satisfies.
    expect(normalizeReliability({ mode: 'between', min: 0.8, max: 0.5 })).toEqual({
      mode: 'between',
      min: 0.5,
      max: 0.8,
    });
  });

  it('clamps a non-finite bound rather than propagating NaN', () => {
    expect(normalizeReliability({ mode: 'atLeast', min: Number.NaN, max: 1 })).toEqual({
      mode: 'atLeast',
      min: 0,
      max: 1,
    });
  });

  it('falls a non-finite bound back to its OWN neutral position', () => {
    // An emptied upper box means "no constraint above", i.e. 1. Defaulting it to 0 —
    // the LOWER bound's neutral position — turned it into `<= 0`, which hides every
    // prediction: the exact opposite filter.
    expect(normalizeReliability({ mode: 'atMost', min: 0, max: Number.NaN })).toEqual({
      mode: 'atMost',
      min: 0,
      max: 1,
    });
  });

  it('leaves the canonical default untouched', () => {
    expect(normalizeReliability(DEFAULT_EAT_RELIABILITY)).toEqual(DEFAULT_EAT_RELIABILITY);
  });
});

describe('clampReliabilityBound', () => {
  it('falls back per bound, so an emptied box reads as "no constraint on this side"', () => {
    // The upper bound's "constrains nothing" position is 1, not 0 — falling back to 0
    // there would turn an emptied box into a filter that hides every prediction.
    expect(clampReliabilityBound(Number.NaN)).toBe(0);
    expect(clampReliabilityBound(Number.NaN, 1)).toBe(1);
  });

  it('clamps a finite bound into 0..1', () => {
    expect(clampReliabilityBound(-0.5)).toBe(0);
    expect(clampReliabilityBound(1.5)).toBe(1);
    expect(clampReliabilityBound(0.42)).toBe(0.42);
  });
});

describe('EAT overlay over CSR storage (bundle format v3)', () => {
  // p0 → [A], p1 → [] (curated missing), p2 → [B, C], p3 → [] (curated missing)
  function createCsrData(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array(8) }],
      annotations: {
        ec: {
          kind: 'categorical',
          values: ['A', 'B', 'C'],
          colors: ['#f00', '#0f0', '#00f'],
          shapes: ['circle', 'circle', 'circle'],
        },
      },
      annotation_data: {
        ec: {
          kind: 'csr',
          end: Int32Array.of(1, 1, 3, 3),
          codes: Int32Array.of(0, 1, 2),
          length: 4,
        },
      },
      annotation_predicted: {
        // p1 gets a single-valued transfer, p3 a two-valued one.
        ec: [
          null,
          { value: 'C', confidence: 0.8, source: 'p0' },
          null,
          { value: 'A;B', values: ['A', 'B'], confidence: 0.6, source: 'p2' },
        ],
      },
    };
  }

  it('rebuilds CSR with predicted rows replaced and every other row preserved', () => {
    const data = createCsrData();
    const out = materializeEatOverlay(data, 'ec', true);
    const rows = out.annotation_data.ec;
    expect(isCsrAnnotationData(rows)).toBe(true);

    expect(getProteinAnnotationIndices(rows, 0)).toEqual([0]); // untouched
    expect(getProteinAnnotationIndices(rows, 1)).toEqual([2]); // predicted 'C'
    expect(getProteinAnnotationIndices(rows, 2)).toEqual([1, 2]); // untouched
    expect(getProteinAnnotationIndices(rows, 3)).toEqual([0, 1]); // predicted 'A;B'

    if (!isCsrAnnotationData(rows)) throw new Error('expected CSR');
    expect(Array.from(rows.end)).toEqual([1, 2, 4, 6]);
    expect(rows.codes.length).toBe(6);
    expect(rows.end[rows.length - 1]).toBe(rows.codes.length);
  });

  it('does not mutate or alias the curated CSR storage', () => {
    const data = createCsrData();
    const source = data.annotation_data.ec;
    const out = materializeEatOverlay(data, 'ec', true);
    if (!isCsrAnnotationData(source) || !isCsrAnnotationData(out.annotation_data.ec)) {
      throw new Error('expected CSR');
    }
    expect(Array.from(source.end)).toEqual([1, 1, 3, 3]);
    expect(Array.from(source.codes)).toEqual([0, 1, 2]);
    expect(out.annotation_data.ec.codes.buffer).not.toBe(source.codes.buffer);
  });

  // p0 → [A], p1 → [B], p2 → [C], p3 → [A, B], with a score and an evidence code
  // attached to every hit. p1's single hit is replaced by a two-valued transfer, which
  // renumbers every hit from p2 onwards — the case that silently shifted the payloads.
  function createCsrDataWithPayloads(): VisualizationData {
    return {
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array(8) }],
      annotations: {
        ec: {
          kind: 'categorical',
          values: ['A', 'B', 'C'],
          colors: ['#f00', '#0f0', '#00f'],
          shapes: ['circle', 'circle', 'circle'],
        },
      },
      annotation_data: {
        ec: {
          kind: 'csr',
          end: Int32Array.of(1, 2, 3, 5),
          codes: Int32Array.of(0, 1, 2, 0, 1),
          length: 4,
        },
      },
      // Hit 4 deliberately carries neither a score nor an evidence code.
      annotation_scores_csr: {
        ec: {
          hitEnd: Int32Array.of(1, 2, 3, 4, 4),
          values: Float64Array.of(0.25, 0.5, 0.75, 0.125),
        },
      },
      annotation_evidence_csr: {
        ec: { codes: Int32Array.of(0, 1, 2, 0, -1), dict: ['IDA', 'IEA', 'ISS'] },
      },
      annotation_predicted: {
        ec: [null, { value: 'A;C', values: ['A', 'C'], confidence: 0.6, source: 'p0' }, null, null],
      },
    };
  }

  it('renumbers the flat score and evidence payloads with the rebuilt hits', () => {
    const out = materializeEatOverlay(createCsrDataWithPayloads(), 'ec', true);
    const rows = out.annotation_data.ec;
    if (!isCsrAnnotationData(rows)) throw new Error('expected CSR');
    expect(Array.from(rows.end)).toEqual([1, 3, 4, 6]);

    // Curated rows keep their own score and evidence, including the rows AFTER the
    // multi-valued transfer that shifted every later hit number.
    expect(getProteinScores(out, 0, 'ec')).toEqual([[0.25]]);
    expect(getProteinEvidence(out, 0, 'ec')).toEqual(['IDA']);
    expect(getProteinScores(out, 2, 'ec')).toEqual([[0.75]]);
    expect(getProteinEvidence(out, 2, 'ec')).toEqual(['ISS']);
    expect(getProteinScores(out, 3, 'ec')).toEqual([[0.125], null]);
    expect(getProteinEvidence(out, 3, 'ec')).toEqual(['IDA', null]);

    // The predicted row carries no curated score or evidence of its own, one slot per value.
    expect(getProteinScores(out, 1, 'ec')).toEqual([null, null]);
    expect(getProteinEvidence(out, 1, 'ec')).toEqual([null, null]);
  });

  it('leaves the curated payloads untouched and drops no unused capacity', () => {
    const data = createCsrDataWithPayloads();
    const out = materializeEatOverlay(data, 'ec', true);
    expect(out.annotation_scores_csr?.ec).not.toBe(data.annotation_scores_csr?.ec);
    expect(Array.from(data.annotation_scores_csr!.ec.values)).toEqual([0.25, 0.5, 0.75, 0.125]);
    expect(Array.from(data.annotation_evidence_csr!.ec.codes)).toEqual([0, 1, 2, 0, -1]);
    // p1's 0.5 is gone with the row it belonged to; the slack is not retained.
    expect(Array.from(out.annotation_scores_csr!.ec.values)).toEqual([0.25, 0.75, 0.125]);
    expect(out.annotation_scores_csr!.ec.values.buffer.byteLength).toBe(
      3 * Float64Array.BYTES_PER_ELEMENT,
    );
  });

  it('does not grow the payload records on a dataset that carries none', () => {
    const out = materializeEatOverlay(createCsrData(), 'ec', true);
    expect('annotation_scores_csr' in out).toBe(false);
    expect('annotation_evidence_csr' in out).toBe(false);
  });

  it('leaves the row alone when a prediction resolves to no known value', () => {
    const data = createCsrData();
    data.annotation_predicted!.ec = [
      { value: 'not-a-category', confidence: 0.9, source: 'p2' },
      null,
      null,
      null,
    ];
    const rows = materializeEatOverlay(data, 'ec', true).annotation_data.ec;
    expect(getProteinAnnotationIndices(rows, 0)).toEqual([0]);
  });
});
