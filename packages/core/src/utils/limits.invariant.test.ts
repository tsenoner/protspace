/**
 * The loader and the renderer must agree on one number.
 *
 * They previously did not: the loader admitted 2,000,000 rows while the renderer
 * drew at most 1,000,000 points, so a single-projection bundle at the loader's
 * own limit displayed half its proteins — silently, cut by array position rather
 * than by anything the user could reason about (#456).
 *
 * `AGENTS.md` is explicit that a fact living in two places is pinned by a test,
 * not by a comment asking the next reader to keep them in step. This is that
 * test.
 */
import { describe, expect, it } from 'vitest';
import { MAX_POINTS_PER_PROJECTION } from './limits';
import { MAX_RENDERABLE_POINTS } from '../components/scatter-plot/webgl/types';
import { DEFAULT_VALIDATION_LIMITS } from '../components/data-loader/utils/validation';

describe('point-count limits', () => {
  // Both hold by construction today — each site imports the shared symbol rather
  // than copying its value. They are here to fail the moment someone replaces a
  // derivation with a literal, which is exactly how the two drifted apart before.
  it('the renderer clamp is the shared cap', () => {
    expect(MAX_RENDERABLE_POINTS).toBe(MAX_POINTS_PER_PROJECTION);
  });

  it('the loader row cap is the shared cap', () => {
    expect(DEFAULT_VALIDATION_LIMITS.maxRows).toBe(MAX_POINTS_PER_PROJECTION);
  });
});
