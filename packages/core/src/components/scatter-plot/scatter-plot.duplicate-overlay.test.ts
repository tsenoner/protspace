/**
 * @vitest-environment jsdom
 *
 * Characterization lock for the duplicate-stack overlay subsystem.
 *
 * Guards the contracts the move into DuplicateStackOverlayController must preserve:
 *  1. the shared helper groups exact-coord coincidents and drops solos, keying
 *     by the same per-projection coord key production groups by;
 *  2. the feature is gated off by default (enableDuplicateStackUI === false).
 *     What the gate does once an overlay group exists (layers removed, no
 *     badges, no spiderfy) is tested on the controller directly in
 *     duplicate-stack-overlay-controller.enable-gate.test.ts.
 *
 * The cancelled-compute race guard is tested end to end (start, cancel,
 * drain, restart) in scatter-plot.duplicate-stack-compute.test.ts.
 *
 * The element is created via document.createElement and NOT appended, so Lit's
 * connectedCallback / WebGL init never runs (same pattern as
 * scatter-plot.materialize-cache.test.ts). Lock 1 is name-stable and never
 * changes.
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
import {
  buildDuplicateStacks,
  getDuplicateStackKey,
} from './duplicate-stacks/duplicate-stack-helpers';

interface DuplicateOverlayInternals extends HTMLElement {
  _mergedConfig: { enableDuplicateStackUI: boolean };
}

function makeElement(): DuplicateOverlayInternals {
  return document.createElement('protspace-scatterplot') as DuplicateOverlayInternals;
}

describe('duplicate-overlay characterization', () => {
  // Lock 1: helper key contract is the same one production groups by.
  it('groups exact-coord coincidents and drops solos via the shared helper', () => {
    const r = buildDuplicateStacks([
      { id: 'a', x: 1, y: 1 },
      { id: 'b', x: 1, y: 1 },
      { id: 'c', x: 9, y: 9 },
    ]);

    // The coincident pair (a, b) forms exactly one stack; the solo (c) is dropped.
    expect(r.stacks).toHaveLength(1);
    expect(r.stacks[0].points.map((p) => p.id).sort()).toEqual(['a', 'b']);

    // idToKey records membership for ALL points (solos included) via the shared key.
    expect(r.idToKey.get('a')).toBe(getDuplicateStackKey({ x: 1, y: 1 }));
    expect(r.idToKey.get('b')).toBe(getDuplicateStackKey({ x: 1, y: 1 }));
    expect(r.idToKey.get('c')).toBe(getDuplicateStackKey({ x: 9, y: 9 }));

    // The dropped solo's key is absent from byKey/stacks.
    expect(r.byKey.has(getDuplicateStackKey({ x: 9, y: 9 }))).toBe(false);
  });

  // Lock 2: the feature is gated off by default.
  it('enableDuplicateStackUI defaults to false', () => {
    const el = makeElement();
    expect(el._mergedConfig.enableDuplicateStackUI).toBe(false);
  });
});
