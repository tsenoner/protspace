/**
 * @vitest-environment jsdom
 *
 * F-48 characterization: writing `_transform` must NOT schedule a Lit reactive
 * update. Pre-change (`@state() _transform`) Lit installs a reactive accessor,
 * so a write calls `requestUpdate('_transform', old)`, enqueues an update, and
 * once that update flushes `updated()` runs and (because `_transform` is not in
 * `_reconcileSelectionOverlays`'s selectionKeys) calls `_renderPlot()` every
 * zoom frame. Post-change (plain field) a write is inert to Lit: it does NOT
 * call `requestUpdate`, schedules no update, and triggers no `_renderPlot()`.
 *
 * The load-bearing signal: a `_transform` write does not call `requestUpdate`,
 * the single Lit hook that schedules an update (and hence the downstream
 * `updated()` -> `_renderPlot()` pass for this non-selection key). Spying
 * `requestUpdate` pins exactly the cause F-48 removes, with no downstream noise.
 *
 * RED/GREEN status on the UNMODIFIED tree: RED by design — today `_transform` is
 * `@state`, so the write calls `requestUpdate`. It goes GREEN once F-48 demotes
 * `_transform` to a plain (non-reactive) field.
 *
 * The element is constructed via `createElement` and NEVER appended: a reactive
 * `@state` setter calls `requestUpdate` synchronously on write, so the signal is
 * observable without connecting and without any `updateComplete` await (which on
 * an un-appended element never resolves: its first update is never enqueued).
 * Staying off the DOM also avoids the connect-time one-shot RAF startup render,
 * which a connected element runs on the next awaited tick regardless of any
 * `_transform` write and which would otherwise mask a `_renderPlot`-based assert.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import * as d3 from 'd3';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type TransformInternals = HTMLElement & {
  _transform: d3.ZoomTransform;
  requestUpdate(name?: PropertyKey, oldValue?: unknown): void;
};

describe('F-48 _transform is not a reactive Lit property', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writing _transform does not call requestUpdate (no Lit update scheduled)', () => {
    const sp = document.createElement('protspace-scatterplot') as TransformInternals;
    // Not appended: a reactive @state setter still calls requestUpdate
    // synchronously on write, so the spy captures the scheduling hook without
    // any connection / updateComplete await (which would hang on an un-appended
    // element whose first update is never enqueued).
    const reqSpy = vi.spyOn(sp, 'requestUpdate');

    sp._transform = d3.zoomIdentity.translate(40, 25).scale(2);

    // A reactive @state write calls requestUpdate('_transform', old); a plain
    // field write does not call requestUpdate at all.
    expect(reqSpy).not.toHaveBeenCalled();
    // The value is still readable by the pull-based getter closures.
    expect(sp._transform.k).toBe(2);
  });
});
