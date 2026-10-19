/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as d3 from 'd3';
import { DuplicateBadgesCanvasRenderer } from './duplicate-badges-canvas-renderer';
import { makeControllerFixture } from './test-support/overlay-controller-fixture';
import { materializePlotDataPoint } from '@protspace/utils';

/**
 * The `enableDuplicateStackUI` gate (deps.isEnabled) on the live overlay
 * paths. Unlike the host-level default-config check, the controller here has
 * a real SVG overlay group and live scales, so updateSelectionOverlays()
 * actually reaches updateOverlays / redrawBadgesOnly / maybeSpiderfyPoint.
 */

function makeFixture() {
  const svg = d3.select(document.body).append('svg');
  const overlayGroup = svg.append('g') as unknown as d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  >;
  // Stale layers from an earlier enabled render; the disabled path must clear them.
  overlayGroup.append('g').attr('class', 'duplicate-stacks-layer');
  overlayGroup.append('g').attr('class', 'duplicate-spiderfy-layer');

  const state = { enabled: false };
  const { controller, pd } = makeControllerFixture({
    overlayGroup,
    isEnabled: () => state.enabled,
  });
  const layerCount = () =>
    overlayGroup.selectAll('g.duplicate-stacks-layer, g.duplicate-spiderfy-layer').size();
  return { controller, state, pd, layerCount };
}

describe('DuplicateStackOverlayController — enableDuplicateStackUI gate', () => {
  let renderSpy: MockInstance;
  let clearSpy: MockInstance;
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    renderSpy = vi.spyOn(DuplicateBadgesCanvasRenderer.prototype, 'render');
    clearSpy = vi.spyOn(DuplicateBadgesCanvasRenderer.prototype, 'clear');
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });
  const drain = () => {
    while (rafQueue.length) {
      const q = rafQueue;
      rafQueue = [];
      q.forEach((cb) => cb(0));
    }
  };

  it.each([
    ['immediate', true],
    ['debounced', false],
  ])(
    'an overlay update (%s) removes both layers and draws no badges when disabled',
    (_label, duplicateImmediate) => {
      const { controller, layerCount } = makeFixture();
      expect(layerCount()).toBe(2);

      controller.updateSelectionOverlays({ duplicateImmediate });
      // The disabled path ignores the debounce and cleans up synchronously, so
      // both variants must already be done before any timer or RAF runs.
      expect(layerCount()).toBe(0);
      expect(clearSpy).toHaveBeenCalled();

      vi.runAllTimers();
      drain();
      expect(layerCount()).toBe(0);
      expect(renderSpy).not.toHaveBeenCalled();
      expect(controller.getStacks()).toHaveLength(0); // no viewport compute ran
    },
  );

  it('a click on a stacked point does not spiderfy while disabled', () => {
    const { controller, state, pd } = makeFixture();
    // Build the viewport stacks while enabled, so the click below has a real
    // stack to hit and only the gate can refuse it.
    state.enabled = true;
    controller.updateSelectionOverlays();
    drain();
    expect(controller.getStacks()).toHaveLength(3);

    const member = materializePlotDataPoint(pd, 2); // stack B at (50,50)
    state.enabled = false;
    expect(controller.maybeSpiderfyPoint(member)).toBe(false);
    expect(controller.hasExpanded()).toBe(false);

    state.enabled = true;
    expect(controller.maybeSpiderfyPoint(member)).toBe(true);
    expect(controller.getExpandedKey()).toBe('50|50');
  });
});
