// @vitest-environment jsdom
/**
 * A selection or highlight drawn as GPU marks over points staged with nothing
 * marked draws what staging the selection draws, without re-staging.
 *
 * "Draws the same" is checked one level below pixels: every vertex that reaches
 * the rasteriser, in draw order, with the attributes the vertex shader hands it
 * and the blend state it is drawn under. The shader's mark and record-table
 * logic is replayed on the staged arrays; equal lists rasterise to equal frames.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
import { createStyleGetters, type StyleConfig } from '../../styling/style-getters';
import { computeVisibilityModel } from '../../styling/visibility-model';
import type { PointMarks, WebGLStyleGetters } from '../types';
import type { WebGLRenderer } from './webgl-renderer';
import {
  makeRenderer,
  markAllocations,
  plotData as fixturePlotData,
  styleGetters,
} from './test-support/renderer-fixture';
import { internalsOf } from './test-support/renderer-internals';
import { liveStyle } from './test-support/style-fixture';
import { replayVertex } from './test-support/vertex-replay';
import { createPerfCounters, perfCounters } from '../../../../utils/perf-counters';
import type * as PerfCounters from '../../../../utils/perf-counters';

vi.mock('../color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));
vi.mock('../../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

const counters = perfCounters!;

beforeEach(() => Object.assign(counters, createPerfCounters()));
afterEach(() => vi.restoreAllMocks());

const N = 600;
const VALUES = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];

function makeData(multi = false): VisualizationData {
  const codes = Array.from({ length: N }, (_, i) => (i * 7) % VALUES.length);
  return {
    protein_ids: Array.from({ length: N }, (_, i) => `P${i}`),
    projections: [{ name: 'p', data: new Float32Array(N * 2), dimension: 2 }],
    annotations: {
      fam: {
        values: VALUES,
        colors: VALUES.map((_, i) => `#${(0x203040 + i * 0x150b07).toString(16)}`),
        shapes: VALUES.map((_, i) => (i % 2 ? 'square' : 'circle')),
      },
    },
    annotation_data: {
      fam: multi
        ? codes.map((c, i) => (i % 4 ? [c] : [c, (c + 2) % VALUES.length]))
        : Int32Array.from(codes),
    },
    annotation_predicted: {
      fam: codes.map((c, i) => (i % 5 === 0 ? { value: VALUES[c], confidence: 0.5 } : null)),
    } as never,
  };
}

/** Points on a coarse grid, so many of them overlap. */
function plotData(data: VisualizationData, keep?: (i: number) => boolean): PlotData {
  const kept = Array.from({ length: N }, (_, i) => i).filter((i) => !keep || keep(i));
  return {
    length: kept.length,
    xs: Float32Array.from(kept, (i) => (i * 13) % 17),
    ys: Float32Array.from(kept, (i) => (i * 29) % 11),
    zs: null,
    originalIndices: keep ? Int32Array.from(kept) : null,
    proteinIds: data.protein_ids,
  };
}

const config: StyleConfig = {
  selectedProteinIds: [],
  highlightedProteinIds: [],
  selectedAnnotation: 'fam',
  hiddenAnnotationValues: [],
  otherAnnotationValues: [],
  zOrderMapping: { c0: 3, c1: 0, c2: 4, c3: 1, Other: 2 },
  sizes: { base: 30 },
  opacities: { base: 0.9, selected: 1, faded: 0.15 },
  eatOverlayEnabled: true,
};

/**
 * Every vertex a draw of the point program rasterises, in order. Other draws
 * (density, gamma) are listed by mode and count, which places the composite.
 */
function recordDraws(renderer: WebGLRenderer, gl: Record<string, unknown>): string[] {
  const r = internalsOf(renderer);
  const list: string[] = [];
  const uniforms: Record<string, number> = {};
  let program: unknown = null;
  let blend = false;
  const set = (loc: { name?: string } | null, v: number) => {
    if (loc?.name) uniforms[loc.name] = v;
  };
  Object.assign(gl, {
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    uniform1i: set,
    uniform1f: set,
    useProgram: (p: unknown) => (program = p),
    enable: (cap: number) => cap === gl.BLEND && (blend = true),
    disable: (cap: number) => cap === gl.BLEND && (blend = false),
    drawArrays: (mode: number, first: number, count: number) => {
      if (program !== r.resources.pointProgram) {
        list.push(`draw ${mode} ${count}`);
        return;
      }
      const shader = {
        recordStyle: uniforms.u_recordStyleOn ? r.recordTable.staged!.texels : null,
        marks: uniforms.u_marksOn
          ? {
              marked: r.markTexture.staged,
              pass: uniforms.u_markPass,
              markedOpacity: uniforms.u_markedOpacity,
              unmarkedOpacity: uniforms.u_unmarkedOpacity,
            }
          : null,
      };
      const slots = { ...r.stageArrays, recordIds: r.recordTable.ids };
      for (let k = first; k < first + count; k++) {
        const vertex = replayVertex(slots, k, shader);
        if (!vertex || vertex.alpha < 0.001) continue;
        const { rgb, alpha, form } = vertex;
        const stride = r.atlas?.plan.stride ?? 0;
        const pie =
          form[2] > 1.5 && r.atlas
            ? r.atlas.texels.subarray(k * stride * 4, (k + 1) * stride * 4)
            : [];
        const at = `${r.stageArrays.dataPositions[k * 2]},${r.stageArrays.dataPositions[k * 2 + 1]}`;
        list.push(
          `${blend ? 'blend' : 'over'} ${at} ${rgb} ${alpha} ${form} ${r.stageArrays.predicted[k]} ${Array.from(pie)}`,
        );
      }
    },
  });
  return list;
}

/**
 * A renderer over `pd`, with contours on. `view` applies a change and draws it,
 * signalled as the scatter plot does: with `marks`, a selection is drawn as
 * marks over unmarked staging and a legend hide restyles; otherwise every change
 * re-stages with the selection. It returns the draws and the re-stages they took.
 */
function setup(data: VisualizationData, pd: PlotData, marks: boolean) {
  let state: Partial<StyleConfig> = {};
  let getters = createStyleGetters(data, config);
  let pointMarks: PointMarks | null = null;
  const style: WebGLStyleGetters = { ...liveStyle(() => getters), getPointMarks: () => pointMarks };
  const { renderer, gl } = makeRenderer({
    style,
    getConfig: () => ({ width: 800, height: 600, densityLayer: 'on' }) as never,
  });
  const draws = recordDraws(renderer, gl as unknown as Record<string, unknown>);
  const internals = internalsOf(renderer);
  const view = (next: Partial<StyleConfig>) => {
    const merged = { ...config, ...state, ...next };
    state = { ...state, ...next };
    const model = computeVisibilityModel({
      data,
      selectedAnnotation: merged.selectedAnnotation,
      hiddenAnnotationValues: merged.hiddenAnnotationValues,
      selectedProteinIds: merged.selectedProteinIds,
      highlightedProteinIds: merged.highlightedProteinIds,
      opacities: merged.opacities,
    });
    renderer.setSelectionActive(
      merged.selectedProteinIds.length > 0 || merged.highlightedProteinIds.length > 0,
    );
    if (marks) {
      getters = createStyleGetters(data, merged, model.unmarked);
      pointMarks = model.marks && {
        slots: model.markedSlots(pd.proteinIds, pd.originalIndices, pd.length),
        ...model.marks,
      };
      if ('hiddenAnnotationValues' in next) renderer.invalidateCategoryStyles();
    } else {
      getters = createStyleGetters(data, merged, model);
      renderer.invalidateStyleCache();
    }
    draws.length = 0;
    Object.assign(counters, createPerfCounters());
    renderer.render(pd);
    return {
      draws: [...draws],
      palette: internals.contourPalette,
      state: { ...state },
      restages: counters.restage,
    };
  };
  return { renderer, view };
}

/** The draws of `state` by staging it, on a fresh renderer. */
function staged(data: VisualizationData, pd: PlotData, state: Partial<StyleConfig>) {
  return setup(data, pd, false).view(state);
}

const SELECTION = ['P3', 'P10', 'P11', 'P64', 'P65', 'P250', 'P251', 'P500'];
// Every point of c4, which draws first unselected: selecting it reorders the contour colours.
const CATEGORY = Array.from({ length: N }, (_, i) => i)
  .filter((i) => (i * 7) % VALUES.length === 4)
  .map((i) => `P${i}`);

const STATES: [string, Partial<StyleConfig>][] = [
  ['one selected point', { selectedProteinIds: ['P10'] }],
  ['a selection across categories', { selectedProteinIds: SELECTION }],
  ['a whole category selected', { selectedProteinIds: CATEGORY }],
  ['a highlight only', { highlightedProteinIds: ['P4', 'P12'] }],
  ['a selection and a highlight', { selectedProteinIds: SELECTION, highlightedProteinIds: ['P4'] }],
  [
    'a selection with hidden categories',
    { selectedProteinIds: SELECTION, hiddenAnnotationValues: ['c3', 'c5'] },
  ],
  [
    'a selection that is all hidden',
    { selectedProteinIds: ['P0', 'P6'], hiddenAnnotationValues: ['c0'] },
  ],
  ['a selection of unknown ids', { selectedProteinIds: ['nope'] }],
  [
    'a selection with "Other"',
    { selectedProteinIds: SELECTION, otherAnnotationValues: ['c4', 'c5'] },
  ],
  ['a selection without z-order', { selectedProteinIds: SELECTION, zOrderMapping: null }],
  ['nothing selected', { selectedProteinIds: [] }],
];

describe('the mark texture', () => {
  it('takes only the rows a new selection changed, and no re-stage', () => {
    let marks: PointMarks | null = null;
    const style = { ...styleGetters(), getPointMarks: () => marks };
    // Rows of 2048 texels, as wide as this device allows.
    const { renderer, gl } = makeRenderer({ style, maxTextureSize: 2048 });
    const pd = fixturePlotData(5000);
    const mark = (...slots: number[]) => {
      const marked = new Uint8Array(pd.length);
      for (const s of slots) marked[s] = 1;
      marks = { slots: marked, marked: 1, unmarked: 0.2 };
      gl.texSubImage2D.mockClear();
      renderer.render(pd);
      // Rows of the texture the call uploaded: [first row, row count].
      return gl.texSubImage2D.mock.calls.map((c) => [c[3], c[5]]);
    };
    renderer.render(pd);
    expect(counters.restage).toBe(1);
    // Every point has the same depth, so slot s draws s-th.
    expect(mark(3000)).toEqual([[1, 1]]);
    expect(mark(3000)).toEqual([]);
    expect(mark(10)).toEqual([[0, 2]]);
    expect(mark(10, 4999)).toEqual([[2, 1]]);
    expect(counters.restage).toBe(1);
  });

  it('is allocated in rows as wide as the device allows', () => {
    const { renderer, gl } = makeRenderer({ maxTextureSize: 4096 });
    renderer.render(fixturePlotData(5000));
    expect(markAllocations(gl)).toEqual([[4096, 2]]);
    expect(renderer.canDrawMarks).toBe(true);
  });

  it('leaves the marks to staging, staged once, when the points outnumber its texels', () => {
    // 64 x 64 texels hold 4096 points.
    const { renderer, gl } = makeRenderer({ maxTextureSize: 64 });
    renderer.render(fixturePlotData(5000));
    expect(renderer.canDrawMarks).toBe(false);
    // Empty, which frees the texels a smaller capacity held.
    expect(markAllocations(gl)).toEqual([[64, 0]]);
    expect(counters.restage).toBe(1);
  });

  it('leaves the marks to staging when the device refuses it, without failing the points', () => {
    const style = styleGetters();
    // A driver refusing anything wider than 1000 texels: only the mark texture is.
    const { renderer, degraded } = makeRenderer({ style, driverTextureLimit: 1000 });
    // Staged as the scatter plot stages: faded only while the marks cannot be drawn.
    style.getOpacity = () => (renderer.canDrawMarks ? 0.9 : 0.15);
    renderer.render(fixturePlotData(5000));
    expect(degraded).toEqual([]);
    expect(renderer.canDrawMarks).toBe(false);
    // The frame it was refused in is staged again, as the scatter plot now stages it.
    expect(internalsOf(renderer).stageArrays.colors[3]).toBeCloseTo(0.15);
  });
});

describe('selection drawn as GPU marks', () => {
  for (const multi of [false, true]) {
    for (const culled of [false, true]) {
      const data = makeData(multi);
      const pd = plotData(data, culled ? (i) => i % 3 !== 1 : undefined);
      const label = `${multi ? 'multi-label' : 'single-label'}${culled ? ', culled' : ''}`;

      it.each(STATES)(`draws %s as staging does (${label})`, (_, next) => {
        const marked = setup(data, pd, true).view(next);
        const expected = staged(data, pd, next);
        expect(marked.draws.length).toBeGreaterThan(0);
        expect(marked.draws).toEqual(expected.draws);
        expect(marked.palette).toEqual(expected.palette);
      });

      it(`follows a session of selection changes without staging again (${label})`, () => {
        const { view } = setup(data, pd, true);
        view({});
        let restaged = 0;
        // "Other" and the z-order re-stage in the scatter plot too.
        const session = STATES.filter(
          ([, s]) => !('otherAnnotationValues' in s) && !('zOrderMapping' in s),
        );
        for (const [, next] of session) {
          const { draws, palette, state, restages } = view(next);
          restaged += restages;
          const expected = staged(data, pd, state);
          expect(draws).toEqual(expected.draws);
          expect(palette).toEqual(expected.palette);
        }
        // Legend hides restyle through the table; a multi-label annotation has none.
        expect(restaged).toBe(multi ? 2 : 0);
      });
    }
  }
});
