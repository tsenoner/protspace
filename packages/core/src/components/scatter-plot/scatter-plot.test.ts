/**
 * @vitest-environment jsdom
 *
 * Lasso / brush selection: the slot→id resolution is shared by both paths via
 * the `_slotsToInteractiveIds` helper. The lasso cases drive the live
 * PlotInteractionController (via the element's `_interactionHost()` bridge), and
 * so do the brush cases, through its brush-end handler; both assert the
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
import type { PlotData } from '@protspace/utils';
import { PlotInteractionController } from './interaction/plot-interaction-controller';
import {
  createPlot,
  fakeFrames,
  makeFamilyData,
  type PlotInternals,
} from './test-support/plot-fixture';

/**
 * Drive the live lasso path through the controller using the element's real
 * host bridge: begin + extend to build a >=3-vertex polygon, then endLasso()
 * resolves slots → ids via host.queryByPolygon/resolveSlotsToIds and dispatches
 * through host.onSelect (_commitSelection). The controller is not initialize()'d,
 * so no SVG groups exist and the lasso path stays null (endLasso handles that).
 */
function runLassoSelection(sp: PlotInternals) {
  const controller = new PlotInteractionController(sp._interactionHost());
  controller.beginLasso([0, 0]);
  controller.extendLasso([10, 0]);
  controller.extendLasso([10, 10]);
  controller.endLasso();
}

/**
 * The live brush path the same way: the controller's brush-end handler, which the d3
 * brush calls when a drag ends, resolves the rectangle's slots → ids via
 * host.queryByPixels/resolveSlotsToIds and dispatches through host.onSelect.
 */
function runBrushSelection(sp: PlotInternals) {
  const controller = new PlotInteractionController(sp._interactionHost()) as unknown as {
    _handleBrushEnd(event: { selection: [[number, number], [number, number]] }): void;
  };
  controller._handleBrushEnd({
    selection: [
      [0, 0],
      [10, 10],
    ],
  });
}

/**
 * Build a scatter element with a 6-point SoA `_plotData`. `originalIndices`
 * controls the slot→originalIndex mapping (null = identity).
 */
function makeSelectionScatter(originalIndices: Int32Array | null): PlotInternals {
  const sp = createPlot({ data: makeFamilyData(), selectedAnnotation: 'fam' });
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
    proteinIds: sp.data!.protein_ids,
  } as unknown as PlotData;
  return sp;
}

describe('scatter-plot lasso/brush selection (slot → interactive id)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lasso selection excludes non-interactive (hidden) points, in slot order', () => {
    const sp = makeSelectionScatter(null);
    sp.hiddenAnnotationValues = ['B']; // p3–p5 → opacity 0 → non-interactive
    sp._pointGridIndex.queryByPolygon = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    const frames = fakeFrames();
    runLassoSelection(sp);
    frames.flush();

    expect(events).toHaveLength(1);
    expect(events[0].detail.proteinIds).toEqual(['p0', 'p1', 'p2']);
    expect(events[0].detail.isMultiple).toBe(true);
  });

  it('flags the lassoed ids unique only while no protein id repeats', () => {
    const unique = makeSelectionScatter(null);
    const repeated = makeSelectionScatter(null);
    repeated.data!.protein_ids[2] = 'p0';
    const events: CustomEvent[] = [];
    for (const sp of [unique, repeated]) {
      sp._pointGridIndex.queryByPolygon = () => [0, 1, 2];
      sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));
    }

    const frames = fakeFrames();
    runLassoSelection(unique);
    runLassoSelection(repeated);
    frames.flush();

    expect(events.map((e) => e.detail.idsUnique)).toEqual([true, false]);
    expect(events[1].detail.proteinIds).toEqual(['p0', 'p1', 'p0']);
  });

  it('brush selection excludes non-interactive (hidden) points, in slot order', () => {
    const sp = makeSelectionScatter(null);
    sp.hiddenAnnotationValues = ['B'];
    sp._pointGridIndex.queryByPixels = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    const frames = fakeFrames();
    runBrushSelection(sp);
    frames.flush();

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
    sp._pointGridIndex.queryByPolygon = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    const frames = fakeFrames();
    runLassoSelection(sp);
    frames.flush();

    expect(events).toHaveLength(1);
    // Interactive (family B) at slots 0,1,2 → originalIndex 5,4,3 → p5,p4,p3,
    // emitted in slot order.
    expect(events[0].detail.proteinIds).toEqual(['p5', 'p4', 'p3']);
  });

  it('marks a lassoed selection from its slots once its ids come back', () => {
    const originalIndices = new Int32Array([5, 4, 3, 2, 1, 0]);
    const sp = makeSelectionScatter(originalIndices);
    sp.hiddenAnnotationValues = ['A'];
    sp._pointGridIndex.queryByPolygon = () => [0, 1, 2, 3, 4, 5];

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    const frames = fakeFrames();
    runLassoSelection(sp);
    frames.flush();

    // p5, p4, p3 by protein index. Claiming p0 too shows the mask stands in for lookups.
    const lasso = sp._style._slotSelection!;
    expect(lasso.ids).toBe(events[0].detail.proteinIds);
    expect(Array.from(lasso.mask)).toEqual([0, 0, 0, 1, 1, 1]);
    lasso.mask[0] = 1;
    // The control bar sets the selection back as a copy.
    sp.selectedProteinIds = [...events[0].detail.proteinIds];
    const marks = sp._style.model().markedSlots(sp.data!.protein_ids, originalIndices, 6);
    expect(Array.from(marks)).toEqual([1, 1, 1, 0, 0, 1]);
    sp.selectedProteinIds = ['p5', 'p4'];
    const fewer = sp._style.model().markedSlots(sp.data!.protein_ids, originalIndices, 6);
    expect(Array.from(fewer)).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it('emits no event and clears the visual when every hit is non-interactive', () => {
    const sp = makeSelectionScatter(null);
    // Hide family B and only return its (hidden) slots from the query, so every
    // hit is non-interactive. (Hiding BOTH values would trip the all-hidden
    // escape hatch and make everything visible again.)
    sp.hiddenAnnotationValues = ['B'];
    sp._pointGridIndex.queryByPixels = () => [3, 4, 5]; // only family B (hidden)

    const events: CustomEvent[] = [];
    sp.addEventListener('brush-selection', (e) => events.push(e as CustomEvent));

    const frames = fakeFrames();
    runBrushSelection(sp);
    frames.flush();

    expect(events).toHaveLength(0);
    expect(sp.selectedProteinIds).toEqual([]);
  });
});

describe('scatter-plot id index', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the id index while idle, for the models that follow', () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (task: () => void) => idle.push(task));
    const sp = makeSelectionScatter(null);
    sp._style.scheduleIdIndex();
    expect(idle).toHaveLength(1);
    idle[0]();
    // An id repeated in place afterwards is not in the index built before it.
    sp.data!.protein_ids[2] = 'p0';
    sp.selectedProteinIds = ['p0'];
    const marks = sp._style.model().markedSlots(sp.data!.protein_ids, null, 6);
    expect(Array.from(marks)).toEqual([1, 0, 0, 0, 0, 0]);
  });
});

describe('scatter-plot WebGL context-loss recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rebuilds the renderer with the selection, so an export draws it as before the loss', async () => {
    const sp = createPlot();
    document.body.appendChild(sp);
    sp.selectedProteinIds = ['p1'];
    await sp.updateComplete;
    const lost = sp._webglRenderer;
    sp._handleWebglContextLost();
    await sp.updateComplete;
    await Promise.resolve();
    expect(sp._webglRenderer).not.toBe(lost);
    expect(
      (sp._webglRenderer as unknown as { selectionActive: boolean } | null)?.selectionActive,
    ).toBe(true);
    sp.remove();
  });

  it('recovery microtask does not rebuild renderer after disconnect', async () => {
    const sp = createPlot();
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
