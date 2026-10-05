/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as d3 from 'd3';
import { DuplicateStackOverlayController } from './duplicate-stack-overlay-controller';
import { DuplicateBadgesCanvasRenderer } from './duplicate-badges-canvas-renderer';
import { PointGridIndex } from '../interaction/point-grid-index';
import { tenPointPD } from './test-support/plot-data-fixtures';
import { materializePlotDataPoint } from '@protspace/utils';

/**
 * The `enableDuplicateStackUI` gate (deps.isEnabled) on the live overlay
 * paths. Unlike the host-level default-config check, the controller here has
 * a real SVG overlay group and live scales, so updateSelectionOverlays()
 * actually reaches updateOverlays / redrawBadgesOnly / maybeSpiderfyPoint.
 */

function makeFixture() {
  const pd = tenPointPD();
  const scales = {
    x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
    y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
  };
  const pointIndex = new PointGridIndex();
  pointIndex.setScales(scales);
  pointIndex.rebuild(
    pd,
    Array.from({ length: pd.length }, (_, i) => i),
  );
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
  const config = {
    width: 800,
    height: 600,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
  };
  const controller = new DuplicateStackOverlayController({
    getOverlayGroup: () => overlayGroup,
    getBadgesCanvas: () => undefined,
    getTransform: () => d3.zoomIdentity,
    getConfig: () => config,
    getScales: () => scales,
    getPlotData: () => pd,
    getPointGridIndex: () => pointIndex,
    getVisibleSlots: () => null,
    isEnabled: () => state.enabled,
    isSelectionMode: () => false,
    getColor: () => '#000000',
    onPointActivate: () => {},
    onHover: () => {},
    onHoverEnd: () => {},
  } as unknown as ConstructorParameters<typeof DuplicateStackOverlayController>[0]);
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
      vi.runAllTimers();
      drain();

      expect(layerCount()).toBe(0);
      expect(renderSpy).not.toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
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
