import type { PredictedCell } from '@protspace/utils';
import { describe, expect, it } from 'vitest';
import { predictedAnnotations } from './eat-predictions';

const cell = {} as PredictedCell;
const NO_PREDICTION: PredictedCell | null = null;

describe('predictedAnnotations', () => {
  it('lists the annotations with a prediction, in order', () => {
    const data = {
      annotation_predicted: {
        a: [NO_PREDICTION, NO_PREDICTION],
        b: [NO_PREDICTION, cell],
        c: [cell],
      },
    };
    expect(predictedAnnotations(data)).toEqual(['b', 'c']);
    expect(predictedAnnotations({})).toEqual([]);
    expect(predictedAnnotations(null)).toEqual([]);
  });

  it('scans a dataset once: a later call returns the same list without reading a cell', () => {
    let reads = 0;
    const column = new Proxy([NO_PREDICTION, cell], {
      get(target, key, receiver) {
        if (key === 'some') reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const data = { annotation_predicted: { a: column } };

    const first = predictedAnnotations(data);
    expect(predictedAnnotations(data)).toBe(first);
    expect(reads).toBe(1);
  });
});
