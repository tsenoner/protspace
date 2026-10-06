/**
 * @vitest-environment jsdom
 *
 * `_reconcileConfigMerge` restages only what a config key feeds: style keys
 * restage the WebGL styles, geometry/interactivity keys rebuild the point
 * index, and render-only keys (contours) do neither.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ScatterplotConfig } from '@protspace/utils';

import { createPlot } from './test-support/plot-fixture';

function apply(patch: Partial<ScatterplotConfig>) {
  const sp = createPlot();
  const invalidateStyleCache = vi.fn();
  sp._webglRenderer = { invalidateStyleCache } as never;
  const reindex = vi.spyOn(sp._pointGrid, 'scheduleRebuild').mockImplementation(() => {});
  sp.config = { width: 800, height: 600 };
  sp._reconcileConfigMerge(new Map([['config', undefined]]));
  invalidateStyleCache.mockClear();
  reindex.mockClear();

  sp.config = { ...sp.config, ...patch };
  sp._reconcileConfigMerge(new Map([['config', undefined]]));
  return {
    restyled: invalidateStyleCache.mock.calls.length > 0,
    reindexed: reindex.mock.calls.length > 0,
  };
}

describe('_reconcileConfigMerge', () => {
  it.each<[string, Partial<ScatterplotConfig>, boolean, boolean]>([
    ['densityLayer', { densityLayer: 'on' }, false, false],
    ['unchanged width', { width: 800 }, false, false],
    ['pointSize', { pointSize: 120 }, true, false],
    ['fadedOpacity', { fadedOpacity: 0 }, true, true],
    ['width', { width: 640 }, false, true],
    ['margin', { margin: { top: 1, right: 40, bottom: 40, left: 40 } }, false, true],
    ['enableDuplicateStackUI', { enableDuplicateStackUI: true }, false, true],
  ])('%s', (_name, patch, restyled, reindexed) => {
    expect(apply(patch)).toEqual({ restyled, reindexed });
  });
});
