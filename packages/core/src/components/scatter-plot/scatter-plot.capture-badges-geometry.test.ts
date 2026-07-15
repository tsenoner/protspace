/**
 * @vitest-environment jsdom
 *
 * End-to-end regression for #301 + #302 at the host level: a real
 * ProtspaceScatterplot with real PlotData / QuadtreeIndex / overlay
 * controller, and a stubbed WebGL renderer whose createExportScales delegates
 * to the REAL ExportRenderer static. Asserts the badges composited by
 * captureAtResolution (a) cover stacks outside the last zoomed live viewport
 * and (b) land exactly on the export-projected dot positions at a non-live
 * aspect ratio, with the dots' size factor.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VisualizationData, PlotData, ScatterplotConfig } from '@protspace/utils';

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
import { ExportRenderer } from './webgl/renderer/export-renderer';
import { DuplicateBadgesCanvasRenderer } from './duplicate-stacks/duplicate-badges-canvas-renderer';

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  _processData(): void;
  _buildQuadtree(): void;
  _plotData: PlotData;
  _mergedConfig: Required<ScatterplotConfig>;
  _scales: { x: (n: number) => number; y: (n: number) => number } | null;
  _webglRenderer: unknown;
  _dupOverlay: {
    ensureForViewport(k: string, a: number, b: number, c: number, d: number): boolean;
    stacks: unknown[];
  };
  captureAtResolution(
    width: number,
    height: number,
    options?: { resetView?: boolean },
  ): HTMLCanvasElement;
};

// Three duplicate stacks at far-apart coords + two solos; a single annotation
// value so nothing is legend-hidden. Shape mirrors
// scatter-plot.duplicate-stack-compute.test.ts's fixture.
function dupData(): VisualizationData {
  const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const coords = [
    [0, 0],
    [0, 0], // stack A (corner)
    [50, 50],
    [50, 50], // stack B (center)
    [100, 100],
    [100, 100], // stack C (opposite corner)
    [25, 75],
    [75, 25], // solos
  ];
  const families = ids.map(() => 'A');
  return {
    protein_ids: ids,
    projections: [{ name: 'p', data: new Float32Array(coords.flat()), dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map(() => '#f00'),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: { fam: families.map(() => [0]) },
    numeric_annotation_data: {},
  } as unknown as VisualizationData;
}

function prime(): Internals {
  const sp = document.createElement('protspace-scatterplot') as Internals;
  // Unattached elements never run Lit's update cycle, so _reconcileConfigMerge
  // never fires — enable the overlay directly on the merged config.
  sp._mergedConfig = { ...sp._mergedConfig, enableDuplicateStackUI: true };
  sp.data = dupData();
  sp.selectedAnnotation = 'fam';
  sp._processData(); // builds _plotData
  sp._buildQuadtree(); // builds quadtree + retains _visibleSlots (direct, no RAF)
  // Stub the renderer AFTER _buildQuadtree (its tail calls _renderPlot).
  sp._webglRenderer = {
    renderToCanvas: vi.fn((w: number, h: number, dpr: number) => {
      const c = document.createElement('canvas');
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      return c;
    }),
    createExportScales: vi.fn((w: number, h: number) =>
      ExportRenderer.createExportScales(sp._mergedConfig, sp._plotData, w, h),
    ),
  };
  return sp;
}

describe('captureAtResolution end-to-end badge geometry (#301/#302)', () => {
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const drain = () => {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(0));
  };

  it('after zooming the live view onto one stack, a 1600×400 capture still badges all three stacks, each on its export-projected dot', () => {
    const sp = prime();
    const spy = vi.spyOn(DuplicateBadgesCanvasRenderer.prototype, 'renderExport');

    // #301 precondition: live viewport compute restricted to stack A's base px.
    const live = sp._scales!;
    const ax = live.x(0);
    const ay = live.y(0);
    sp._dupOverlay.ensureForViewport('zoomed', ax - 10, ay - 10, ax + 10, ay + 10);
    drain();
    expect(sp._dupOverlay.stacks).toHaveLength(1);

    const out = sp.captureAtResolution(1600, 400, { resetView: true });
    expect(out).toBeInstanceOf(HTMLCanvasElement);

    expect(spy).toHaveBeenCalledTimes(1);
    const stacks = spy.mock.calls[0][0] as Array<{ key: string; px: number; py: number }>;
    // #301: all three stacks, not just the zoomed one.
    expect(stacks.map((s) => s.key).sort()).toEqual(['0|0', '100|100', '50|50']);

    // #302 alignment: badge px/py equal the REAL export projection of the
    // stack coords at the output physical dims (1600×400, dpr 1).
    const exportScales = ExportRenderer.createExportScales(
      sp._mergedConfig,
      sp._plotData,
      1600,
      400,
    )!;
    for (const [key, x, y] of [
      ['0|0', 0, 0],
      ['50|50', 50, 50],
      ['100|100', 100, 100],
    ] as const) {
      const s = stacks.find((st) => st.key === key)!;
      expect(s.px).toBeCloseTo(exportScales.x(x), 6);
      expect(s.py).toBeCloseTo(exportScales.y(y), 6);
    }

    // #302 size rule: badgeScale = dpr(1) × sqrt((1600·400)/(800·600)).
    expect(spy.mock.calls[0][1]).toBeCloseTo(Math.sqrt((1600 * 400) / (800 * 600)), 6);
  });

  it('alignment holds at a second output size (900×900) — spec requires ≥2 sizes', () => {
    const sp = prime();
    const spy = vi.spyOn(DuplicateBadgesCanvasRenderer.prototype, 'renderExport');

    sp.captureAtResolution(900, 900, { resetView: true });

    expect(spy).toHaveBeenCalledTimes(1);
    const stacks = spy.mock.calls[0][0] as Array<{ key: string; px: number; py: number }>;
    expect(stacks.map((s) => s.key).sort()).toEqual(['0|0', '100|100', '50|50']);

    const exportScales = ExportRenderer.createExportScales(
      sp._mergedConfig,
      sp._plotData,
      900,
      900,
    )!;
    for (const [key, x, y] of [
      ['0|0', 0, 0],
      ['50|50', 50, 50],
      ['100|100', 100, 100],
    ] as const) {
      const s = stacks.find((st) => st.key === key)!;
      expect(s.px).toBeCloseTo(exportScales.x(x), 6);
      expect(s.py).toBeCloseTo(exportScales.y(y), 6);
    }
    expect(spy.mock.calls[0][1]).toBeCloseTo(Math.sqrt((900 * 900) / (800 * 600)), 6);
  });
});
