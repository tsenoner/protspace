import { describe, it, expect } from 'vitest';
import { composePaintDepth } from './paint-depth';

describe('composePaintDepth', () => {
  it('keeps selection contiguous while painting predicted markers last within each tier', () => {
    const unselectedObserved = composePaintDepth(0.2, 0.9, false);
    const unselectedPredicted = composePaintDepth(0.8, 0.3, true);
    const selectedObserved = composePaintDepth(0.8, 1, false);
    const selectedPredicted = composePaintDepth(0.8, 1, true);

    expect(unselectedObserved).toBeGreaterThan(unselectedPredicted);
    expect(unselectedPredicted).toBeGreaterThan(selectedObserved);
    expect(selectedObserved).toBeGreaterThan(selectedPredicted);
  });

  it('preserves base-depth ordering inside a semantic tier', () => {
    expect(composePaintDepth(0.8, 0.5, true)).toBeGreaterThan(composePaintDepth(0.2, 0.5, true));
  });
});
