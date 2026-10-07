/**
 * @vitest-environment jsdom
 *
 * Characterization lock for the duplicate-stack overlay subsystem.
 *
 * Guards the contract the F-06 controller-extraction move must preserve: the
 * feature is gated off by default (enableDuplicateStackUI === false). What the
 * gate does once an overlay group exists (layers removed, no badges, no
 * spiderfy) is tested on the controller directly in
 * duplicate-stack-overlay-controller.enable-gate.test.ts. The shared grouping
 * helper, including the idToKey/byKey agreement click-to-spiderfy relies on, is
 * tested in duplicate-stacks/duplicate-stack-helpers.test.ts.
 *
 * The cancelled-compute race guard is tested end to end (start, cancel,
 * drain, restart) in scatter-plot.duplicate-stack-compute.test.ts.
 *
 * The element is created via document.createElement and NOT appended, so Lit's
 * connectedCallback / WebGL init never runs (same pattern as
 * scatter-plot.materialize-cache.test.ts).
 */
import { vi, describe, it, expect } from 'vitest';

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

interface DuplicateOverlayInternals extends HTMLElement {
  _mergedConfig: { enableDuplicateStackUI: boolean };
}

function makeElement(): DuplicateOverlayInternals {
  return document.createElement('protspace-scatterplot') as DuplicateOverlayInternals;
}

describe('duplicate-overlay characterization', () => {
  it('enableDuplicateStackUI defaults to false', () => {
    const el = makeElement();
    expect(el._mergedConfig.enableDuplicateStackUI).toBe(false);
  });
});
