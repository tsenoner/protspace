import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '../types';
import {
  getProteinAnnotationIndices,
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
