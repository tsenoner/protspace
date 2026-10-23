/**
 * @vitest-environment jsdom
 *
 * Exports stay light: whatever neutral greys the live view draws Other and N/A with, an export
 * stages through light getters and knocks out against white.
 *
 * The element is never appended (no Lit lifecycle, no WebGL): the renderer is a stub that keeps
 * the options the plot built it with.
 */
import { vi, describe, it, expect } from 'vitest';
import type { PlotDataPoint, VisualizationData } from '@protspace/utils';
import type { WebGLStyleGetters } from './webgl/types';
import type { PlotNeutrals } from './styling/plot-neutrals';

/** The options of each renderer the plot built. */
const constructed = vi.hoisted(
  () => [] as { style: WebGLStyleGetters; exportStyle: WebGLStyleGetters }[],
);

// Every colour resolves to black, so a knockout taken from any colour the export is given
// reads [0, 0, 0]; only a fixed white knockout reads [1, 1, 1].
vi.mock('./webgl/color-utils', () => ({
  resolveColor: (): [number, number, number] => [0, 0, 0],
}));

vi.mock('./webgl', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  WebGLRenderer: class {
    constructor(_canvas: unknown, options: (typeof constructed)[number]) {
      constructed.push(options);
    }
    setSelectionActive() {}
    prewarm() {}
  },
}));

import { createPlot, type PlotInternals } from './test-support/plot-fixture';

const DARK: PlotNeutrals = { other: '#64748b', na: '#2a3547' };
const IDS = ['p0', 'p1', 'p2', 'p3', 'p4'];

function makeData(): VisualizationData {
  const fams = ['A', 'B', 'A', 'B', 'A'];
  return {
    protein_ids: IDS,
    projections: [
      { name: 'umap', data: Float32Array.from(IDS.flatMap((_, i) => [i, i])), dimension: 2 },
    ],
    annotations: {
      fam: { values: ['A', 'B'], colors: ['#ff0000', '#00ff00'], shapes: ['circle', 'circle'] },
    },
    annotation_data: { fam: Int32Array.from(fams, (f) => (f === 'A' ? 0 : 1)) },
  } as unknown as VisualizationData;
}

const point = (i: number): PlotDataPoint => ({ id: IDS[i], x: i, y: i, originalIndex: i });

/** A plot with B in Other, drawing its neutral greys dark, as Task 6.4's theme will. */
function makeDarkPlot(): PlotInternals {
  const el = createPlot({
    data: makeData(),
    selectedAnnotation: 'fam',
    otherAnnotationValues: ['B'],
  });
  el._processData();
  (el as unknown as { _neutrals: () => PlotNeutrals })._neutrals = () => DARK;
  return el;
}

/** The live and export style getters `el` hands a renderer it builds now. */
function rendererStyles(el: PlotInternals) {
  Object.defineProperty(el, '_canvas', { value: document.createElement('canvas') });
  el._createWebglRenderer();
  const { style, exportStyle } = constructed.at(-1)!;
  return { live: style, exported: exportStyle };
}

describe('exports stage light', () => {
  it('exportStyle.getColors gives #888888 for Other while style.getColors gives the dark grey', () => {
    const { live, exported } = rendererStyles(makeDarkPlot());
    expect(live.getColors(point(1))).toEqual(['#64748b']);
    expect(exported.getColors(point(1))).toEqual(['#888888']);
    // A category of its own keeps its colour in both.
    expect(exported.getColors(point(0))).toEqual(['#ff0000']);
  });

  it.each([undefined, '#ffffff', 'white', 'transparent', 'rgba(0,0,0,0)', '#0b1120'])(
    'captureAtResolution passes the knockout [1, 1, 1] whatever the background option (%s)',
    (backgroundColor) => {
      const el = createPlot();
      const renderToCanvas = vi.fn((..._args: unknown[]) => document.createElement('canvas'));
      el._webglRenderer = { renderToCanvas } as never;
      el.captureAtResolution(100, 80, backgroundColor === undefined ? {} : { backgroundColor });
      expect(renderToCanvas).toHaveBeenCalledTimes(1);
      expect(renderToCanvas.mock.calls[0][6]).toEqual([1, 1, 1]);
    },
  );
});
