import { describe, it, expect, vi } from 'vitest';
import * as d3 from 'd3';
import {
  materializeVisualizationData,
  type AnnotationData,
  type PlotData,
  type VisualizationData,
} from '@protspace/utils';
import { createStyleGetters, type StyleConfig } from './style-getters';
import { computeVisibilityModel, type VisibilityModel } from './visibility-model';
import type { ScalePair, WebGLStyleGetters } from '../webgl/types';
import {
  beginStylePass,
  createPassScratch,
  restageStyles,
  stageInPaintOrder,
} from '../webgl/renderer/pass-staging';
import {
  legacyRestage,
  legacyStage,
  stageArrays,
} from '../webgl/renderer/test-support/legacy-staging';
import { seededRandom } from '../../../test-support/seeded-random';

// jsdom has no 2D canvas, so the real resolveColor maps every colour to white
// and could not tell two colours apart. Parse hex by hand instead.
vi.mock('../webgl/color-utils', () => ({
  resolveColor: (color: string): [number, number, number] => {
    const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
    if (!hex) return [0.25, 0.5, 0.75];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
  },
}));

const scales: ScalePair = {
  x: d3.scaleLinear().domain([0, 100]).range([0, 800]),
  y: d3.scaleLinear().domain([0, 100]).range([600, 0]),
};

const VALUES = ['alpha', 'beta', 'gamma', 'delta', null, 'epsilon'];
const COLORS = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#a65628'];

type Storage = 'int32' | 'dense' | 'sparse' | 'csr';

/**
 * `n` proteins over VALUES. Codes include -1 (no value) and an index past the end
 * of `values` (reads as N/A); multi-valued rows mix hidden, Other and repeated
 * colours.
 */
function makeData(n: number, storage: Storage, seed = 1): VisualizationData {
  const next = seededRandom(seed);
  const code = () => {
    const r = next();
    if (r < 0.04) return -1;
    if (r < 0.07) return VALUES.length + 2;
    return Math.floor(next() * VALUES.length);
  };
  const codes = Array.from({ length: n }, code);
  let rows: AnnotationData;
  if (storage === 'int32') {
    rows = Int32Array.from(codes);
  } else {
    const lists = codes.map((c): number[] => {
      const r = next();
      if (r < 0.05) return [];
      if (r < 0.35) return [c < 0 ? 0 : c, Math.floor(next() * VALUES.length), 1];
      return c < 0 ? [] : [c];
    });
    if (storage === 'dense') {
      rows = lists;
    } else if (storage === 'csr') {
      const offsets = new Int32Array(n + 1);
      lists.forEach((list, i) => (offsets[i + 1] = offsets[i] + list.length));
      rows = { kind: 'csr', offsets, codes: Int32Array.from(lists.flat()), length: n };
    } else {
      const overrides = new Map<number, readonly number[]>();
      const base = new Int32Array(n);
      lists.forEach((list, i) => {
        if (list.length === 1) base[i] = list[0];
        else {
          base[i] = -1;
          overrides.set(i, list);
        }
      });
      rows = { kind: 'sparse-multi', base, overrides, length: n };
    }
  }
  return {
    protein_ids: Array.from({ length: n }, (_, i) => `P${i}`),
    projections: [{ name: 'p', data: new Float32Array(n * 2), dimension: 2 }],
    annotations: {
      family: { values: VALUES, colors: COLORS, shapes: VALUES.map(() => 'circle') },
    },
    annotation_data: { family: rows },
    annotation_predicted: {
      family: Array.from({ length: n }, (_, i) =>
        i % 7 === 3 ? { value: 'alpha', confidence: 0.9, source: 'P0' } : null,
      ),
    },
  };
}

/** Every protein, or every third one (as isolation and filters keep global indices). */
function makePlotData(data: VisualizationData, subset = false): PlotData {
  const n = data.protein_ids.length;
  const keep = subset ? Array.from({ length: n }, (_, i) => i).filter((i) => i % 3 !== 1) : null;
  const length = keep ? keep.length : n;
  const next = seededRandom(99);
  return {
    length,
    xs: Float32Array.from({ length }, () => next() * 100),
    ys: Float32Array.from({ length }, () => next() * 100),
    zs: null,
    originalIndices: keep ? Int32Array.from(keep) : null,
    proteinIds: data.protein_ids,
  };
}

const baseConfig: StyleConfig = {
  selectedProteinIds: [],
  highlightedProteinIds: [],
  selectedAnnotation: 'family',
  hiddenAnnotationValues: [],
  otherAnnotationValues: [],
  zOrderMapping: null,
  colorMapping: null,
  shapeMapping: null,
  sizes: { base: 30 },
  opacities: { base: 0.8, selected: 1, faded: 0.2 },
  eatOverlayEnabled: true,
};

/** A legend-like configuration: custom colours, shapes, z-order, hidden and Other values. */
const legendConfig: StyleConfig = {
  ...baseConfig,
  hiddenAnnotationValues: ['gamma'],
  otherAnnotationValues: ['epsilon'],
  colorMapping: {
    alpha: '#111111',
    beta: '#222222',
    gamma: '#333333',
    delta: '#111111',
    __NA__: '#dddddd',
    Other: '#999999',
  },
  shapeMapping: { alpha: 'diamond', beta: 'square', __NA__: 'triangle-up', epsilon: 'plus' },
  zOrderMapping: { beta: 0, alpha: 1, Other: 2, delta: 3, __NA__: 4 },
};

/** The getters as the scatter plot hands them to the renderer. */
function rendererStyle(
  getters: ReturnType<typeof createStyleGetters>,
  opacityModel?: VisibilityModel,
): Required<WebGLStyleGetters> {
  return {
    getColors: getters.getColors,
    getPointSize: getters.getPointSize,
    getOpacity: opacityModel ? opacityModel.opacityOf : getters.getOpacity,
    getDepth: getters.getDepth,
    getShape: getters.getPointShape,
    isPredicted: getters.isPredicted,
    isMultilabel: getters.isMultilabel,
    createStylePass: () => getters.createStylePass(opacityModel),
  };
}

function expectSameStaging(
  style: Required<WebGLStyleGetters>,
  pd: PlotData,
  { selectionActive = false, maxLabels = 8, atlas = true } = {},
) {
  const count = pd.length;
  const legacy = stageArrays(count, maxLabels, atlas);
  const expected = legacyStage(style, pd, scales, count, selectionActive, legacy);

  const staged = stageArrays(count, maxLabels, atlas);
  const order = new Uint32Array(count);
  const pass = beginStylePass(style);
  expect(pass.records.colors.length).toBeGreaterThan(0); // the table pass, not the fallback
  const cut = stageInPaintOrder(
    staged,
    pass,
    createPassScratch(count),
    order,
    pd,
    scales,
    count,
    selectionActive,
  );

  expect(Array.from(order)).toEqual(Array.from(expected.order));
  expect(cut).toBe(expected.cut);
  expect(staged).toEqual(legacy);
  expectHidingPerRecord(style, pd);
}

/**
 * The renderer may apply the legend's hiding per record: every slot's opacity
 * must be its unhidden opacity, or 0 where its record is hidden.
 */
function expectHidingPerRecord(style: Required<WebGLStyleGetters>, pd: PlotData) {
  const pass = beginStylePass(style);
  const scratch = createPassScratch(pd.length);
  pass.resolve(pd, pd.length, scratch);
  const hidden = pass.hiddenRecords!;
  expect(hidden).toHaveLength(pass.records.colors.length);
  for (let i = 0; i < pd.length; i++) {
    const r = scratch.record[i];
    expect(scratch.opacity[i]).toBe(hidden[r] ? 0 : scratch.base[i]);
  }
}

describe('category style pass', () => {
  const storages: Storage[] = ['int32', 'dense', 'sparse', 'csr'];

  for (const storage of storages) {
    describe(`${storage} storage`, () => {
      const data = makeData(3000, storage);

      it('stages the defaults exactly as the per-point getters did', () => {
        const getters = createStyleGetters(data, baseConfig);
        expectSameStaging(rendererStyle(getters), makePlotData(data));
      });

      it('stages legend colours, shapes, z-order, hidden and Other values', () => {
        const getters = createStyleGetters(data, legendConfig);
        expectSameStaging(rendererStyle(getters), makePlotData(data));
      });

      it('stages a selection, a highlight and the EAT overlay over a culled subset', () => {
        const getters = createStyleGetters(data, {
          ...legendConfig,
          selectedProteinIds: ['P3', 'P9', 'P10', 'P2001'],
          highlightedProteinIds: ['P12', 'P13'],
        });
        expectSameStaging(rendererStyle(getters), makePlotData(data, true), {
          selectionActive: true,
        });
      });

      it('stages with a reduced atlas stride, and with no atlas', () => {
        const getters = createStyleGetters(data, legendConfig);
        expectSameStaging(rendererStyle(getters), makePlotData(data), { maxLabels: 2 });
        expectSameStaging(rendererStyle(getters), makePlotData(data), { atlas: false });
      });
    });
  }

  it('stages Shift-focus fading', () => {
    const data = makeData(2500, 'sparse', 3);
    const model = computeVisibilityModel({
      data,
      selectedAnnotation: 'family',
      hiddenAnnotationValues: [],
      selectedProteinIds: [],
      highlightedProteinIds: [],
      opacities: baseConfig.opacities,
      focusedValues: ['beta', '__NA__'],
    });
    const getters = createStyleGetters(data, legendConfig, model);
    expectSameStaging(rendererStyle(getters), makePlotData(data), { selectionActive: true });
  });

  it('reads opacity from the model it is given and depth from its own', () => {
    // The plot resolves the visibility model afresh for each pass, while the
    // getters keep the one they were built with; the per-point path did the same.
    const data = makeData(2500, 'int32', 4);
    const getters = createStyleGetters(data, legendConfig);
    const newer = computeVisibilityModel({
      data,
      selectedAnnotation: 'family',
      hiddenAnnotationValues: ['alpha'],
      selectedProteinIds: ['P5', 'P6'],
      highlightedProteinIds: [],
      opacities: baseConfig.opacities,
    });
    expectSameStaging(rendererStyle(getters, newer), makePlotData(data), {
      selectionActive: true,
    });
  });

  it('stages the all-hidden escape hatch', () => {
    const data = makeData(2500, 'dense', 5);
    const getters = createStyleGetters(data, {
      ...legendConfig,
      hiddenAnnotationValues: VALUES.map((v) => v ?? '__NA__'),
    });
    expectSameStaging(rendererStyle(getters), makePlotData(data));
  });

  it('stages a binned numeric annotation', () => {
    const n = 2600;
    const next = seededRandom(6);
    const source: VisualizationData = {
      protein_ids: Array.from({ length: n }, (_, i) => `P${i}`),
      projections: [{ name: 'p', data: new Float32Array(n * 2), dimension: 2 }],
      annotations: {
        length: { kind: 'numeric', numericType: 'int', values: [], colors: [], shapes: [] },
      },
      annotation_data: {},
      numeric_annotation_data: {
        length: Array.from({ length: n }, () => (next() < 0.05 ? null : Math.floor(next() * 900))),
      },
    };
    const data = materializeVisualizationData(source, {}, 10, 'length');
    const getters = createStyleGetters(data, {
      ...baseConfig,
      selectedAnnotation: 'length',
      zOrderMapping: Object.fromEntries(data.annotations.length.values.map((v, i) => [v, i])),
    });
    expectSameStaging(rendererStyle(getters), makePlotData(data));
  });

  it('stages with no selected annotation, and with one the data does not have', () => {
    const data = makeData(500, 'int32', 7);
    for (const selectedAnnotation of ['', 'missing']) {
      const getters = createStyleGetters(data, { ...legendConfig, selectedAnnotation });
      expectSameStaging(rendererStyle(getters), makePlotData(data));
    }
    expectSameStaging(rendererStyle(createStyleGetters(null, legendConfig)), makePlotData(data));
  });

  it('restages styles in the staged order as the per-point getters did', () => {
    const data = makeData(3000, 'sparse', 8);
    const pd = makePlotData(data, true);
    const count = pd.length;
    const first = rendererStyle(createStyleGetters(data, legendConfig));
    const target = stageArrays(count, 8, true);
    const order = new Uint32Array(count);
    const scratch = createPassScratch(count);
    stageInPaintOrder(target, beginStylePass(first), scratch, order, pd, scales, count, false);

    // A legend hide: styles change, order and positions stay.
    const hidden = rendererStyle(
      createStyleGetters(data, { ...legendConfig, hiddenAnnotationValues: ['beta', '__NA__'] }),
    );
    const expected = stageArrays(count, 8, true);
    expected.labelColorData!.set(target.labelColorData!);
    legacyRestage(hidden, pd, order, count, expected);

    const seen: number[] = [];
    restageStyles(target, beginStylePass(hidden), scratch, order, pd, count, count, (slot) =>
      seen.push(slot),
    );
    expect(seen).toEqual(Array.from(order));
    for (const channel of ['colors', 'sizes', 'labelCounts', 'shapes', 'predicted'] as const) {
      expect(target[channel]).toEqual(expected[channel]);
    }
    expect(target.labelColorData).toEqual(expected.labelColorData);
  });

  it('keys records by category code', () => {
    const data = makeData(100, 'int32', 9);
    const getters = createStyleGetters(data, legendConfig);
    const pass = getters.createStylePass();
    // One record per value, then N/A for an unknown code, then "no value".
    expect(pass.records.colors).toEqual([
      ['#111111'],
      ['#222222'],
      [],
      ['#111111'],
      ['#dddddd'],
      ['#888888'],
      ['#dddddd'],
      ['#888888'],
    ]);
    expect(pass.records.shapes).toEqual([
      'diamond',
      'square',
      'circle',
      'circle',
      'triangle-up',
      'circle',
      'triangle-up',
      'circle',
    ]);
    const pd = makePlotData(data);
    const scratch = createPassScratch(pd.length);
    pass.resolve(pd, pd.length, scratch);
    const rows = data.annotation_data.family as Int32Array;
    for (let i = 0; i < pd.length; i++) {
      const c = rows[i];
      expect(scratch.record[i]).toBe(c < 0 ? 7 : c < VALUES.length ? c : 6);
    }
  });

  it('gives each distinct multi-valued code list one record, kept across passes', () => {
    const data = makeData(4, 'dense', 11);
    data.annotation_data.family = [[0, 1], [3], [0, 1], [1, 0]];
    const getters = createStyleGetters(data, legendConfig);
    const pd = makePlotData(data);
    const scratch = createPassScratch(4);
    getters.createStylePass().resolve(pd, 4, scratch);
    const first = Array.from(scratch.record.subarray(0, 4));
    // Equal lists share a record; order matters, as it does for the colours.
    expect(first[0]).toBe(first[2]);
    expect(first[3]).not.toBe(first[0]);
    expect(first[1]).toBe(3);
    const pass = getters.createStylePass();
    expect(pass.records.colors[first[0]]).toEqual(['#111111', '#222222']);
    expect(pass.records.colors[first[3]]).toEqual(['#222222', '#111111']);
    const recordCount = pass.records.colors.length;
    pass.resolve(pd, 4, scratch);
    expect(Array.from(scratch.record.subarray(0, 4))).toEqual(first);
    expect(pass.records.colors.length).toBe(recordCount);
  });

  it('keys the code records by the annotation storage they read', () => {
    const data = makeData(100, 'int32', 12);
    const pass = createStyleGetters(data, legendConfig).createStylePass();
    expect(pass.records.codes).toEqual({
      values: data.annotations.family.values,
      rows: data.annotation_data.family,
      count: VALUES.length + 2,
    });
    // Another set of getters over the same storage keys records the same way.
    const other = createStyleGetters(data, baseConfig).createStylePass();
    expect(other.records.codes!.values).toBe(pass.records.codes!.values);
    expect(other.records.codes!.rows).toBe(pass.records.codes!.rows);
    expect(
      createStyleGetters(data, { ...legendConfig, selectedAnnotation: '' }).createStylePass()
        .records.codes,
    ).toBeUndefined();
  });

  it('marks the records the legend hides, per pass', () => {
    const data = makeData(100, 'int32', 13);
    const getters = createStyleGetters(data, legendConfig);
    // gamma is hidden, N/A is not, and a point with no value is always hidden.
    expect(getters.createStylePass().hiddenRecords).toEqual(
      VALUES.map((v) => v === 'gamma').concat(false, true),
    );
    const newer = computeVisibilityModel({
      data,
      selectedAnnotation: 'family',
      hiddenAnnotationValues: ['alpha', '__NA__'],
      selectedProteinIds: [],
      highlightedProteinIds: [],
      opacities: baseConfig.opacities,
    });
    // N/A covers the null value and a code that names no value.
    expect(getters.createStylePass(newer).hiddenRecords).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
    ]);
  });

  it('builds its records once per set of getters', () => {
    const getters = createStyleGetters(makeData(100, 'int32', 10), legendConfig);
    expect(getters.createStylePass().records).toBe(getters.createStylePass().records);
  });
});
