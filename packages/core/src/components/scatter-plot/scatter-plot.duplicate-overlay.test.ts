/**
 * @vitest-environment jsdom
 *
 * Characterization lock for the duplicate-stack overlay subsystem.
 *
 * Guards the contracts the F-06 controller-extraction move must preserve:
 *  1. the shared helper groups exact-coord coincidents and drops solos, keying
 *     by the same per-projection coord key production groups by (F-36 contract);
 *  2. the feature is gated off by default (enableDuplicateStackUI === false) and
 *     the overlay update is a no-op (does not throw) on an element with no
 *     overlay group attached;
 *  3. cancelCompute bumps the compute job id so any in-flight chunked compute
 *     aborts early (stale-result race guard).
 *
 * The element is created via document.createElement and NOT appended, so Lit's
 * connectedCallback / WebGL init never runs (same pattern as
 * scatter-plot.materialize-cache.test.ts L18-21).
 *
 * F-06 moved the subsystem into DuplicateStackOverlayController; these probes
 * now reach through `el._dupOverlay` while asserting the SAME observable
 * contracts (job-id monotonicity, no-op-when-disabled). Lock 1 is name-stable
 * and never changes.
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
import { buildDuplicateStacks, getDuplicateStackKey } from './duplicate-stack-helpers';

interface DuplicateOverlayController {
  // TS-private at compile time, reachable at runtime — the job-id race guard.
  computeJobId: number;
  updateSelectionOverlays: (opts?: { duplicateImmediate?: boolean }) => void;
  cancelCompute: () => void;
}

interface DuplicateOverlayInternals extends HTMLElement {
  _mergedConfig?: { enableDuplicateStackUI?: boolean };
  _dupOverlay: DuplicateOverlayController;
}

function makeElement(): DuplicateOverlayInternals {
  return document.createElement('protspace-scatterplot') as DuplicateOverlayInternals;
}

describe('duplicate-overlay characterization', () => {
  // Lock 1: helper key contract is the same one production groups by (F-36).
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

  // Lock 2: the feature is gated off by default -> no badge canvas writes, no SVG layer.
  it('does nothing when enableDuplicateStackUI is false (default)', () => {
    const el = makeElement();
    expect(el._mergedConfig?.enableDuplicateStackUI ?? false).toBe(false);
    // The overlay update is a no-op with no overlay group attached; must not throw.
    expect(() => el._dupOverlay.updateSelectionOverlays()).not.toThrow();
  });

  // Lock 3: cancelCompute bumps the job id so an in-flight chunk aborts (race guard).
  it('cancelling compute bumps the job id (stale-result guard)', () => {
    const el = makeElement();
    const before = el._dupOverlay.computeJobId;
    el._dupOverlay.cancelCompute();
    expect(el._dupOverlay.computeJobId).toBeGreaterThan(before);
  });
});
