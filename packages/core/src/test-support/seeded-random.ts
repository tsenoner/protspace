/**
 * Deterministic pseudo-random numbers in [0, 1) for test data, so a failure reproduces.
 * The Numerical Recipes LCG: each seed gives the sequence the suites' own copies gave.
 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
