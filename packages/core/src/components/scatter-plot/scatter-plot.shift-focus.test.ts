/**
 * @vitest-environment jsdom
 *
 * Shift+hover focus vs. the rAF-coalesced hover (task 2.10). The hover runs a
 * frame after its mousemove, so the Shift state it acts on must be the freshest
 * one: a Shift keyup or window blur between the mousemove and its frame must
 * not be undone by the mousemove's stale `shiftKey`, and a Shift keydown in
 * that gap must still count.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, PlotDataPoint, VisualizationData } from '@protspace/utils';

import type { CategoryFocusDetail } from './scatter-plot.events';
import { createPlot, fakeFrames, type PlotInternals } from './test-support/plot-fixture';

function makeData(): VisualizationData {
  return {
    protein_ids: ['p0', 'p1'],
    projections: [{ name: 'umap', data: new Float32Array([0, 0, 50, 50]), dimension: 2 }],
    annotations: {
      fam: { values: ['A', 'B'], colors: ['#f00', '#0f0'], shapes: ['circle', 'circle'] },
    },
    annotation_data: { fam: [[0], [1]] },
  } as unknown as VisualizationData;
}

function makeScatter(): PlotInternals {
  const sp = createPlot({ data: makeData(), selectedAnnotation: 'fam' });
  sp._plotData = {
    length: 2,
    xs: new Float32Array([0, 50]),
    ys: new Float32Array([0, 50]),
    zs: null,
    originalIndices: null,
    proteinIds: sp.data!.protein_ids,
  } as unknown as PlotData;
  sp._transform = d3.zoomIdentity;
  // Prime the cached-scales getter so `_scales` is non-null (mousemove bails otherwise).
  sp._scalesCache = {
    scales: { x: (v: number) => v, y: (v: number) => v },
    plotDataLength: sp._plotData.length,
    key: sp._scalesKey(),
  };
  // The hit-test is covered elsewhere; always resolve the cursor to p0 (value 'A').
  const p0: PlotDataPoint = { id: 'p0', x: 0, y: 0, originalIndex: 0 };
  sp.pickInteractivePointAt = () => p0;
  return sp;
}

const move = (shiftKey: boolean) => new MouseEvent('mousemove', { shiftKey });
const shiftKey = (type: 'keydown' | 'keyup') => new KeyboardEvent(type, { key: 'Shift' });

describe('Shift+hover focus across the hover frame', () => {
  let frames: ReturnType<typeof fakeFrames>;

  beforeEach(() => {
    frames = fakeFrames();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a Shift mousemove focuses the hovered category on its frame', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    expect(sp._focusedValues).toBeNull();
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);
  });

  it('a Shift keyup between the mousemove and its frame keeps the focus off', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);

    sp._handleCanvasMouseMove(move(true));
    sp._handleShiftKey(shiftKey('keyup'));
    expect(sp._focusedValues).toBeNull();
    frames.run(); // the pending event still says shiftKey: true
    expect(sp._focusedValues).toBeNull();
  });

  it('a window blur between the mousemove and its frame keeps the focus off', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(true));
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);

    sp._handleCanvasMouseMove(move(true));
    sp._handleWindowBlur();
    frames.run();
    expect(sp._focusedValues).toBeNull();
  });

  it('a Shift keydown between the mousemove and its frame still focuses', () => {
    const sp = makeScatter();
    sp._handleCanvasMouseMove(move(false));
    sp._handleShiftKey(shiftKey('keydown'));
    frames.run(); // the pending event says shiftKey: false
    expect(sp._focusedValues).toEqual(['A']);
  });
});

describe('category-focus, the event the legend lights its rows from', () => {
  let frames: ReturnType<typeof fakeFrames>;

  beforeEach(() => {
    frames = fakeFrames();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function listen(sp: PlotInternals): CustomEvent<CategoryFocusDetail>[] {
    const events: CustomEvent<CategoryFocusDetail>[] = [];
    (sp as unknown as HTMLElement).addEventListener('category-focus', (event) =>
      events.push(event as CustomEvent<CategoryFocusDetail>),
    );
    return events;
  }

  it('fires with the focused values when the focus starts, and with null when it ends', () => {
    const sp = makeScatter();
    const events = listen(sp);

    sp._handleCanvasMouseMove(move(true));
    frames.run();
    sp._handleShiftKey(shiftKey('keyup'));

    expect(events.map((event) => event.detail.values)).toEqual([['A'], null]);
    // Bubbling and composed, so a page or another shadow root can hear it too.
    expect(events[0].bubbles).toBe(true);
    expect(events[0].composed).toBe(true);
  });

  it('fires once per change, not on every move over the same category', () => {
    const sp = makeScatter();
    const events = listen(sp);

    for (let i = 0; i < 3; i++) {
      sp._handleCanvasMouseMove(move(true));
      frames.run();
    }
    sp._handleWindowBlur();
    sp._handleWindowBlur();

    expect(events.map((event) => event.detail.values)).toEqual([['A'], null]);
  });

  it('a hover without Shift fires nothing', () => {
    const sp = makeScatter();
    const events = listen(sp);

    sp._handleCanvasMouseMove(move(false));
    frames.run();

    expect(events).toEqual([]);
  });
});

describe('focusCategories, the focus a legend score strip asks for', () => {
  let frames: ReturnType<typeof fakeFrames>;

  beforeEach(() => {
    frames = fakeFrames();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function listen(sp: PlotInternals): (string[] | null)[] {
    const values: (string[] | null)[] = [];
    (sp as unknown as HTMLElement).addEventListener('category-focus', (event) =>
      values.push((event as CustomEvent<CategoryFocusDetail>).detail.values),
    );
    return values;
  }

  it('focuses the categories without Shift, tells the legend, and ends on null', () => {
    const sp = makeScatter();
    const events = listen(sp);
    sp.focusCategories(['B']);
    expect(sp._focusedValues).toEqual(['B']);
    sp.focusCategories(null);
    expect(sp._focusedValues).toBeNull();
    expect(events).toEqual([['B'], null]);
  });

  it('Shift + hover on the plot wins, and the asked focus returns when it ends', () => {
    const sp = makeScatter();
    sp.focusCategories(['B']);
    sp._handleCanvasMouseMove(move(true));
    frames.run();
    expect(sp._focusedValues).toEqual(['A']);
    sp._handleShiftKey(shiftKey('keyup'));
    expect(sp._focusedValues).toEqual(['B']);
  });

  it('a hover without Shift keeps the asked focus', () => {
    const sp = makeScatter();
    sp.focusCategories(['B']);
    sp._handleCanvasMouseMove(move(false));
    frames.run();
    expect(sp._focusedValues).toEqual(['B']);
  });

  it('a selection outranks it', () => {
    const sp = makeScatter();
    sp.selectedProteinIds = ['p0'];
    sp.focusCategories(['B']);
    expect(sp._focusedValues).toBeNull();
  });

  it("a legend row's categories focus only while the plot's own Shift is held", () => {
    const sp = makeScatter();
    const events = listen(sp);
    sp.focusCategories(['B'], 'row');
    expect(sp._focusedValues).toBeNull();
    sp._handleShiftKey(shiftKey('keydown'));
    expect(sp._focusedValues).toEqual(['B']);
    sp._handleShiftKey(shiftKey('keyup'));
    expect(sp._focusedValues).toBeNull();
    // A window blur releases Shift but keeps the row: Shift again focuses it again.
    sp._handleShiftKey(shiftKey('keydown'));
    sp._handleWindowBlur();
    expect(sp._focusedValues).toBeNull();
    sp._handleShiftKey(shiftKey('keydown'));
    expect(sp._focusedValues).toEqual(['B']);
    sp.focusCategories(null);
    expect(sp._focusedValues).toBeNull();
    expect(events).toEqual([['B'], null, ['B'], null, ['B'], null]);
  });

  it('Shift typed into a text field does not focus a legend row', () => {
    const sp = makeScatter();
    sp.focusCategories(['B'], 'row');
    const input = document.createElement('input');
    sp._handleShiftKey(Object.assign(shiftKey('keydown'), { composedPath: () => [input] }));
    expect(sp._focusedValues).toBeNull();
  });

  it('covers the Other bucket the same way for a point, a legend row and a strip dot', () => {
    const sp = makeScatter();
    // 'A' (point p0's category) and 'C' sit under Other.
    sp.otherAnnotationValues = ['A', 'C'];
    sp._handleShiftKey(shiftKey('keydown'));
    sp._handleCanvasMouseMove(move(true));
    frames.run();
    const byPoint = sp._focusedValues;
    expect(byPoint).toEqual(['A', 'C']);
    sp._hoveredPoint = null;

    // The Other row, as a legend value, and a strip dot of one of its categories cover the same.
    sp.focusCategories(['Other'], 'row');
    expect(sp._focusedValues).toEqual(byPoint);
    sp.focusCategories(['C'], 'strip');
    expect(sp._focusedValues).toEqual(['C', 'A']);
    // A category with its own row covers just itself.
    sp.focusCategories(['B'], 'strip');
    expect(sp._focusedValues).toEqual(['B']);
  });

  it('a window blur, a new dataset or a new annotation ends it', () => {
    const sp = makeScatter();
    sp.focusCategories(['B']);
    sp._handleWindowBlur();
    expect(sp._focusedValues).toBeNull();

    sp.focusCategories(['B']);
    sp._reconcileFocus(new Map([['data', null]]));
    expect(sp._focusedValues).toBeNull();

    sp.focusCategories(['B']);
    sp._reconcileFocus(new Map([['selectedAnnotation', 'other']]));
    expect(sp._focusedValues).toBeNull();
  });
});
