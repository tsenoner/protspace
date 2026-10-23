import { describe, expect, it } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { countEatPredictions } from './eat-population-counts';

const cell = { value: 'predicted', confidence: 0.9, source: 'o1' };
const data = {
  annotation_predicted: { ec: [null, cell, cell, null], go: [null, null] },
} as unknown as VisualizationData;

describe('countEatPredictions', () => {
  it('counts the proteins with a prediction for the annotation', () => {
    expect(countEatPredictions(data, 'ec')).toBe(2);
  });

  it('is null for an annotation without predictions, or no data', () => {
    expect(countEatPredictions(data, 'go')).toBeNull();
    expect(countEatPredictions(data, 'family')).toBeNull();
    expect(countEatPredictions(null, 'ec')).toBeNull();
  });
});
