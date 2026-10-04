/**
 * @vitest-environment jsdom
 *
 * `_reconcileConfigMerge` restages only what a config key feeds: style keys
 * restage the WebGL styles, geometry/interactivity keys rebuild the point
 * index, and render-only keys (contours) do neither.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ScatterplotConfig } from '@protspace/utils';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type Internals = HTMLElement & {
  config: Partial<ScatterplotConfig>;
  _webglRenderer: { invalidateStyleCache(): void; setStyleSignature(s: string): void } | null;
  _schedulePointGridIndexRebuild(): void;
  _reconcileConfigMerge(changed: Map<string, unknown>): void;
};

function apply(patch: Partial<ScatterplotConfig>) {
  const sp = document.createElement('protspace-scatterplot') as Internals;
  const invalidateStyleCache = vi.fn();
  sp._webglRenderer = { invalidateStyleCache, setStyleSignature: vi.fn() };
  const reindex = vi.spyOn(sp, '_schedulePointGridIndexRebuild').mockImplementation(() => {});
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
