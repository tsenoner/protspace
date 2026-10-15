/**
 * @vitest-environment jsdom
 *
 * F-07: PlotInteractionController owns the d3 zoom/brush/lasso lifecycle and the
 * zoom/lasso RAF loops, signalling the host via callbacks (event dispatch
 * stays on the host — INV-03/INV-05). These unit tests drive the controller with
 * a real SVG element + injected callbacks and a synchronous RAF.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import { PlotInteractionController } from './plot-interaction-controller';

function syncRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
}

function makeHostBridge(svg: SVGSVGElement) {
  const calls = { transforms: [] as d3.ZoomTransform[], selections: [] as string[][] };
  return {
    bridge: {
      getSvg: () => svg,
      getCanvas: () => document.createElement('canvas'),
      getMergedConfig: () => ({
        width: 800,
        height: 600,
        zoomExtent: [0.1, 10] as [number, number],
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      getSelectionMode: () => false,
      getSelectionTool: () => 'rectangle' as const,
      hasScales: () => true,
      getTransform: () => d3.zoomIdentity,
      // slot resolution is host-owned (reuses _slotsToInteractiveIds)
      resolveSlotsToIds: (slots: number[]) => slots.map((s) => `p${s}`),
      queryByPolygon: (_v: ReadonlyArray<[number, number]>) => [0, 1],
      queryByPixels: () => [0, 1],
      onTransform: (t: d3.ZoomTransform) => calls.transforms.push(t),
      onSelect: (ids: string[]) => calls.selections.push(ids),
      onHover: () => {},
      onHoverEnd: () => {},
      onClick: () => {},
      renderWebGL: () => {},
      updateSelectionOverlays: () => {},
    },
    calls,
  };
}

describe('PlotInteractionController', () => {
  let svg: SVGSVGElement;
  beforeEach(() => {
    syncRaf();
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    svg.remove();
  });

  it('initialize() creates the three SVG groups and a zoom behavior', () => {
    const { bridge } = makeHostBridge(svg);
    const c = new PlotInteractionController(bridge);
    c.initialize();
    expect(svg.querySelector('g.scatter-plot-container')).not.toBeNull();
    expect(svg.querySelector('g.brush-container')).not.toBeNull();
    expect(svg.querySelector('g.overlay-container')).not.toBeNull();
  });

  it('zoom emits onTransform and schedules a single render RAF', () => {
    const { bridge, calls } = makeHostBridge(svg);
    const renderSpy = vi.fn();
    const c = new PlotInteractionController({ ...bridge, renderWebGL: renderSpy });
    c.initialize();
    const t = d3.zoomIdentity.translate(10, 20).scale(2);
    // drive the controller's zoom handler directly via its public hook
    c.applyZoom(t);
    expect(calls.transforms.at(-1)?.k).toBe(2);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('lasso end resolves slots → ids via the host bridge and fires onSelect', () => {
    const { bridge, calls } = makeHostBridge(svg);
    const c = new PlotInteractionController(bridge);
    c.initialize();
    c.beginLasso([0, 0]);
    c.extendLasso([10, 0]);
    c.extendLasso([10, 10]);
    c.endLasso();
    expect(calls.selections.at(-1)).toEqual(['p0', 'p1']);
  });

  // The guard is unobservable from the app: a two-vertex polygon also hits
  // PointGridIndex's own guard, and the host ignores an empty selection.
  it('lasso end with fewer than 3 vertices queries nothing and clears the path', () => {
    const { bridge, calls } = makeHostBridge(svg);
    const queryByPolygon = vi.fn(bridge.queryByPolygon);
    const c = new PlotInteractionController({ ...bridge, queryByPolygon });
    c.initialize();
    c.beginLasso([0, 0]);
    c.extendLasso([10, 10]);
    expect(svg.querySelector('path.lasso-path')).not.toBeNull();
    c.endLasso();
    expect(queryByPolygon).not.toHaveBeenCalled();
    expect(calls.selections).toEqual([]);
    expect(svg.querySelector('path.lasso-path')).toBeNull();
  });

  // #189: the brush extent is the viewport in local (untransformed) coordinates,
  // so a brush can start anywhere on screen at every zoom level. The plot
  // margins must not shrink it (the original bug left an 80 px dead zone).
  describe('brush extent', () => {
    function extentOf(c: PlotInteractionController) {
      const brush = (c as unknown as { _brush: d3.BrushBehavior<unknown> | null })._brush;
      if (!brush) throw new Error('brush not set up');
      return (brush.extent() as unknown as () => [[number, number], [number, number]])();
    }

    function setUpBrush(initial: d3.ZoomTransform) {
      let transform = initial;
      const { bridge } = makeHostBridge(svg);
      const c = new PlotInteractionController({
        ...bridge,
        getMergedConfig: () => ({
          ...bridge.getMergedConfig(),
          margin: { top: 40, right: 40, bottom: 40, left: 40 },
        }),
        getSelectionMode: () => true,
        getTransform: () => transform,
        onTransform: (t) => {
          transform = t;
        },
      });
      c.initialize();
      c.updateSelectionMode();
      return c;
    }

    it.each([
      [
        'identity',
        d3.zoomIdentity,
        [
          [0, 0],
          [800, 600],
        ],
      ],
      [
        'zoomed in about the centre',
        d3.zoomIdentity.translate(-400, -300).scale(2),
        [
          [200, 150],
          [600, 450],
        ],
      ],
      [
        'zoomed out about the centre',
        d3.zoomIdentity.translate(200, 150).scale(0.5),
        [
          [-400, -300],
          [1200, 900],
        ],
      ],
      [
        'zoomed in and panned',
        d3.zoomIdentity.translate(-80, -80).scale(2),
        [
          [40, 40],
          [440, 340],
        ],
      ],
    ])('covers the viewport when set up %s', (_name, transform, expected) => {
      const c = setUpBrush(transform);
      expect(extentOf(c)).toEqual(expected);
    });

    it('follows a zoom applied while the rectangle tool is active', () => {
      const c = setUpBrush(d3.zoomIdentity);
      c.applyZoom(d3.zoomIdentity.translate(-80, -80).scale(2));
      expect(extentOf(c)).toEqual([
        [40, 40],
        [440, 340],
      ]);
    });
  });

  it('teardown() cancels every interaction RAF and clears lasso visuals', () => {
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const { bridge } = makeHostBridge(svg);
    const c = new PlotInteractionController(bridge);
    c.initialize();
    c.beginLasso([0, 0]);
    c.extendLasso([1, 1]); // arms _lassoRafId
    c.teardown();
    expect(cancel).toHaveBeenCalled();
    expect(svg.querySelector('path.lasso-path')).toBeNull();
  });

  // F-12: resetZoom() runs a 750ms d3 transition on the SVG selection. teardown()
  // (called from the host's disconnectedCallback) must interrupt that transition so
  // it cannot keep re-arming the zoom RAF / writing the transform after disconnect.
  // d3 stores the pending transition schedule on node.__transition synchronously when
  // .transition() is called; interrupt() removes it. We assert teardown() clears it.
  it('teardown() interrupts the in-flight resetZoom transition', () => {
    const { bridge } = makeHostBridge(svg);
    const c = new PlotInteractionController(bridge);
    c.initialize();
    type NodeWithTransition = SVGSVGElement & { __transition?: unknown };
    // Start the 750ms reset transition, then tear down before it can settle.
    c.resetZoom();
    expect((svg as NodeWithTransition).__transition).not.toBeUndefined(); // scheduled
    c.teardown();
    expect((svg as NodeWithTransition).__transition).toBeUndefined(); // interrupt() cleared it
  });
});
