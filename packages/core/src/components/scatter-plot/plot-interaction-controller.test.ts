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
      // slot resolution + picking are host-owned (reuse _slotsToInteractiveIds / pickInteractivePointAt)
      resolveSlotsToIds: (slots: number[]) => slots.map((s) => `p${s}`),
      queryByPolygon: (_v: ReadonlyArray<[number, number]>) => [0, 1],
      queryByPixels: () => [0, 1],
      pickInteractivePointAt: () => null,
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
});
