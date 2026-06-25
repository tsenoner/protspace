/**
 * @vitest-environment jsdom
 *
 * Lasso / brush selection: the slot→id resolution is shared by both paths via
 * the `_slotsToInteractiveIds` helper. The lasso cases drive the live
 * PlotInteractionController (via the element's `_interactionHost()` bridge) and
 * the brush case drives the `_handleBrushEnd` host shim; both assert the
 * dispatched `brush-selection` event carries ONLY the interactive ids, in slot
 * order, resolving originalIndex → proteinId correctly in both the identity
 * (originalIndices === null) and explicit-mapping cases.
 *
 * Construct the element via createElement without appending it (so Lit's
 * connectedCallback / WebGL init never runs — same approach as
 * scatter-plot.isolation.test.ts) and drive the controller / private handler
 * directly through the host bridge.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
import {
  PlotInteractionController,
  type PlotInteractionHost,
} from './interaction/plot-interaction-controller';

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

const RED = '#ff0000';
const GREEN = '#00ff00';

/**
 * Six proteins: p0–p2 family "A" (red), p3–p5 family "B" (green). Hiding "B"
 * drives p3–p5 to opacity 0 → non-interactive.
 */
function makeFamilyData(): VisualizationData {
  const families = ['A', 'A', 'A', 'B', 'B', 'B'];
  const colorFor = (v: string) => (v === 'A' ? RED : GREEN);
  const coords = new Float32Array(families.length * 2);
  families.forEach((_, i) => {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  });
  return {
    protein_ids: families.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map(colorFor),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

type QuadtreeStub = {
  queryByPolygon: (vertices: ReadonlyArray<[number, number]>) => number[];
  queryByPixels: (minX: number, minY: number, maxX: number, maxY: number) => number[];
};

type SelectionInternals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  _plotData: PlotData;
  _quadtreeIndex: QuadtreeStub;
  _interactionHost(): PlotInteractionHost;
  _handleBrushEnd(event: { selection: [[number, number], [number, number]] | null }): void;
};

/**
 * Drive the live lasso path through the controller using the element's real
 * host bridge: begin + extend to build a >=3-vertex polygon, then endLasso()
 * resolves slots → ids via host.queryByPolygon/resolveSlotsToIds and dispatches
 * through host.onSelect (_commitSelection). The controller is not initialize()'d,
 * so no SVG groups exist and the lasso path stays null (endLasso handles that).
 */
function runLassoSelection(sp: SelectionInternals) {
  const controller = new PlotInteractionController(sp._interactionHost());
  controller.beginLasso([0, 0]);
  controller.extendLasso([10, 0]);
  controller.extendLasso([10, 10]);
  controller.endLasso();
}

/**
 * Build a scatter element with a 6-point SoA `_plotData`. `originalIndices`
 * controls the slot→originalIndex mapping (null = identity).
 */
function makeSelectionScatter(originalIndices: Int32Array | null): SelectionInternals {
  const sp = document.createElement('protspace-scatterplot') as SelectionInternals;
  sp.data = makeFamilyData();
  sp.selectedAnnotation = 'fam';
  const n = 6;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i;
    ys[i] = i;
  }
  sp._plotData = {
    length: n,
    xs,
    ys,
    zs: null,
    originalIndices,
    proteinIds: sp.data.protein_ids,
  } as unknown as PlotData;
  return sp;
}

/** Run both nested rAFs that `_commitSelection` defers through. */
function stubSyncRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
}

describe('scatter-plot lasso/brush selection (slot → interactive id)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lasso selection excludes non-interactive (hidden) points, in slot order', () => {
    const sp = makeSelectionScatter(null);
    sp.hiddenAnnotationValues = ['B']; // p3–p5 → opacity 0 → non-interactive
    sp._quadtreeIndex.queryByPolygon = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    stubSyncRaf();
    runLassoSelection(sp);

    expect(events).toHaveLength(1);
    expect(events[0].detail.proteinIds).toEqual(['p0', 'p1', 'p2']);
    expect(events[0].detail.isMultiple).toBe(true);
  });

  it('brush selection excludes non-interactive (hidden) points, in slot order', () => {
    const sp = makeSelectionScatter(null);
    sp.hiddenAnnotationValues = ['B'];
    sp._quadtreeIndex.queryByPixels = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    stubSyncRaf();
    sp._handleBrushEnd({
      selection: [
        [0, 0],
        [10, 10],
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0].detail.proteinIds).toEqual(['p0', 'p1', 'p2']);
    expect(events[0].detail.isMultiple).toBe(true);
  });

  it('resolves ids through originalIndices when the mapping is non-trivial', () => {
    // Slot s maps to originalIndex (5 - s): reverse mapping. proteinIds stays the
    // full source array, so slot 0 → originalIndex 5 → p5, etc.
    const originalIndices = new Int32Array([5, 4, 3, 2, 1, 0]);
    const sp = makeSelectionScatter(originalIndices);
    // Hide family A (originalIndices 0,1,2 → p0,p1,p2). Those sit at slots 5,4,3.
    sp.hiddenAnnotationValues = ['A'];
    // Query returns all slots in ascending order.
    sp._quadtreeIndex.queryByPolygon = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    stubSyncRaf();
    runLassoSelection(sp);

    expect(events).toHaveLength(1);
    // Interactive (family B) at slots 0,1,2 → originalIndex 5,4,3 → p5,p4,p3,
    // emitted in slot order.
    expect(events[0].detail.proteinIds).toEqual(['p5', 'p4', 'p3']);
  });

  it('emits no event and clears the visual when every hit is non-interactive', () => {
    const sp = makeSelectionScatter(null);
    // Hide family B and only return its (hidden) slots from the query, so every
    // hit is non-interactive. (Hiding BOTH values would trip the all-hidden
    // escape hatch and make everything visible again.)
    sp.hiddenAnnotationValues = ['B'];
    sp._quadtreeIndex.queryByPixels = () => [3, 4, 5]; // only family B (hidden)

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    stubSyncRaf();
    sp._handleBrushEnd({
      selection: [
        [0, 0],
        [10, 10],
      ],
    });

    expect(events).toHaveLength(0);
    expect(sp.selectedProteinIds).toEqual([]);
  });
});

describe('scatter-plot WebGL context-loss recovery (detached guard)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('F-10: recovery microtask does not rebuild renderer after disconnect', async () => {
    type RecoveryInternals = HTMLElement & {
      updateComplete: Promise<boolean>;
      _updateSizeAndRender(): void;
      _handleWebglContextLost(): void;
    };
    const sp = document.createElement('protspace-scatterplot') as RecoveryInternals;
    // Connect so Lit's update lifecycle (and updateComplete) actually runs,
    // then disconnect synchronously after firing the loss event but BEFORE the
    // recovery microtask resolves. This is the exact route-change / GPU-recycle
    // sequence the finding targets: loss -> detach -> microtask. A disconnected
    // element must NOT reconstruct a fresh WebGLRenderer (fresh context +
    // listeners) on a detached renderRoot.
    document.body.appendChild(sp);
    await sp.updateComplete;
    const spy = vi.spyOn(sp, '_updateSizeAndRender');
    sp._handleWebglContextLost(); // schedules the recovery microtask
    sp.remove(); // isConnected === false before the microtask resolves
    await sp.updateComplete;
    await Promise.resolve(); // flush the .then microtask
    expect(spy).not.toHaveBeenCalled();
  });
});
