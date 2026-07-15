import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '../types';
import {
  getEatBaseAnnotationKey,
  getEatConfidenceAnnotationKey,
  hasEatPredictions,
  materializeEatOverlay,
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

    expect(materialized.annotation_data.ec).toEqual([[0], [1, 2], [3]]);
    expect(data.annotation_data.ec).toBeInstanceOf(Int32Array);
  });
});
