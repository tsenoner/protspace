import { describe, it, expect, vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, VisualizationData } from '@protspace/utils';
import { createStyleGetters, type StyleConfig } from '../../styling/style-getters';
import type { PointStylePass, ScalePair } from '../types';
import { createPassScratch, packRecords, stageInPaintOrder } from './pass-staging';
import { stageArrays } from './test-support/legacy-staging';
import { replayVertex } from './test-support/vertex-replay';
import {
  canRestyle,
  collectStagedRecords,
  markedFirstDrawn,
  shownSlotCount,
  writeRecordTexels,
  type StagedRecords,
} from './record-table';
import { buildRecordSlotPalette, buildSlotPalette } from './density-pass';

// jsdom has no 2D canvas to resolve colours with; parse hex by hand.
vi.mock('../color-utils', () => ({
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

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const hex = (i: number) => `#${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`;

/** `n` proteins over `v` values, with some no-value and unknown codes. */
function makeData(n: number, v: number, seed = 1): VisualizationData {
  const next = rng(seed);
  const values = Array.from({ length: v }, (_, i) => (i === 3 ? null : `c${i}`));
  return {
    protein_ids: Array.from({ length: n }, (_, i) => `P${i}`),
    projections: [{ name: 'p', data: new Float32Array(n * 2), dimension: 2 }],
    annotations: {
      family: { values, colors: values.map((_, i) => hex(i)), shapes: values.map(() => 'circle') },
    },
    annotation_data: {
      family: Int32Array.from({ length: n }, () => {
        const r = next();
        return r < 0.03 ? -1 : r < 0.05 ? v + 3 : Math.floor(next() * v);
      }),
    },
  };
}

function makePlotData(data: VisualizationData): PlotData {
  const n = data.protein_ids.length;
  const next = rng(99);
  return {
    length: n,
    xs: Float32Array.from({ length: n }, () => next() * 100),
    ys: Float32Array.from({ length: n }, () => next() * 100),
    zs: null,
    originalIndices: Int32Array.from({ length: n }, (_, i) => n - 1 - i),
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

const legendConfig: StyleConfig = {
  ...baseConfig,
  hiddenAnnotationValues: ['c2'],
  otherAnnotationValues: ['c5'],
  colorMapping: { c0: '#111111', c1: '#222222', c2: '#333333', c4: '#111111', __NA__: '#dddddd' },
  shapeMapping: { c0: 'diamond', c1: 'square', __NA__: 'triangle-up' },
  zOrderMapping: { c1: 0, c0: 1, Other: 2, c4: 3, __NA__: 4 },
};

const passOf = (data: VisualizationData, config: StyleConfig): PointStylePass =>
  createStyleGetters(data, config).createStylePass();

/** Stage `pd` with or without a record table; with one, keep the table too. */
function stage(pd: PlotData, pass: PointStylePass, table: boolean, selectionActive = false) {
  const count = pd.length;
  const target = stageArrays(count, 8, false);
  if (table) target.recordIds = new Float32Array(count);
  const order = new Uint32Array(count);
  const scratch = createPassScratch(count);
  const cut = stageInPaintOrder(target, pass, scratch, order, pd, scales, count, selectionActive);
  let staged: StagedRecords | null = null;
  if (table) {
    staged = collectStagedRecords(
      pass.records.codes!,
      target.recordIds!,
      target.colors,
      count,
      pass.hiddenRecords!,
    );
    writeRecordTexels(staged!, scratch.packed!, pass.hiddenRecords!);
  }
  return { target, order, cut, staged };
}

/** What the vertex shader draws: each slot's own style, or its record's. */
function drawn(target: ReturnType<typeof stageArrays>, staged: StagedRecords, count: number) {
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const shapes = new Float32Array(count);
  const labelCounts = new Float32Array(count);
  const shader = { recordStyle: staged.texels, marks: null };
  for (let k = 0; k < count; k++) {
    if (target.recordIds![k] < 0) throw new Error('every slot of a category pass has a record');
    const { rgb, alpha, form } = replayVertex(target, k, shader)!;
    colors.set([...rgb, alpha], k * 4);
    [sizes[k], shapes[k], labelCounts[k]] = form;
  }
  return { colors, sizes, shapes, labelCounts };
}

function expectDrawnAsStaged(
  table: ReturnType<typeof stage>,
  plain: ReturnType<typeof stage>,
  count: number,
) {
  expect(Array.from(table.order)).toEqual(Array.from(plain.order));
  expect(table.cut).toBe(plain.cut);
  expect(table.target.dataPositions).toEqual(plain.target.dataPositions);
  expect(table.target.depths).toEqual(plain.target.depths);
  expect(table.target.predicted).toEqual(plain.target.predicted);
  const view = drawn(table.target, table.staged!, count);
  expect(view.colors).toEqual(plain.target.colors);
  expect(view.sizes).toEqual(plain.target.sizes);
  expect(view.shapes).toEqual(plain.target.shapes);
  expect(view.labelCounts).toEqual(plain.target.labelCounts);
}

describe('per-record style table', () => {
  const data = makeData(3000, 8);
  const pd = makePlotData(data);
  const n = pd.length;

  it('draws every point as staging without a table does', () => {
    for (const config of [
      baseConfig,
      legendConfig,
      {
        ...legendConfig,
        selectedProteinIds: ['P3', 'P9', 'P10', 'P2001'],
        highlightedProteinIds: ['P12'],
      },
      {
        ...legendConfig,
        hiddenAnnotationValues: data.annotations.family.values.map((v) => v ?? '__NA__'),
      },
    ]) {
      const pass = () => passOf(data, config);
      const selectionActive = config.selectedProteinIds.length > 0;
      expectDrawnAsStaged(
        stage(pd, pass(), true, selectionActive),
        stage(pd, pass(), false, selectionActive),
        n,
      );
    }
  });

  it('restyles a legend hide, show and recolour exactly as a fresh stage draws them', () => {
    const first = stage(pd, passOf(data, legendConfig), true);
    const steps: StyleConfig[] = [
      { ...legendConfig, hiddenAnnotationValues: ['c2', 'c0', '__NA__'] },
      { ...legendConfig, hiddenAnnotationValues: [] },
      // Isolate: every value but one.
      { ...legendConfig, hiddenAnnotationValues: ['c0', 'c2', 'c4', 'c5', 'c6', 'c7', '__NA__'] },
      { ...legendConfig, colorMapping: { ...legendConfig.colorMapping, c1: '#ff00ff' } },
      { ...legendConfig, shapeMapping: { ...legendConfig.shapeMapping, c4: 'plus' } },
    ];
    for (const config of steps) {
      const pass = passOf(data, config);
      expect(canRestyle(first.staged!, pass.records.codes, pass.hiddenRecords!)).toBe(true);
      writeRecordTexels(
        first.staged!,
        packRecords(pass.records, first.target),
        pass.hiddenRecords!,
      );
      expectDrawnAsStaged(first, stage(pd, passOf(data, config), false), n);
      const visible = Array.from({ length: n }, (_, k) => k).filter(
        (k) =>
          first.target.colors[k * 4 + 3] *
            first.staged!.texels[first.target.recordIds![k] * 8 + 3] >
          0,
      );
      expect(shownSlotCount(first.staged!)).toBe(visible.length);
    }
  });

  it('re-stages a hide that would move a selected point between paint tiers', () => {
    const rows = data.annotation_data.family as Int32Array;
    // Select points of c0 only: hiding c0 moves them, hiding c1 does not.
    const ids = data.protein_ids.filter((_, i) => rows[i] === 0).slice(0, 50);
    const selected = { ...legendConfig, selectedProteinIds: ids };
    const first = stage(pd, passOf(data, selected), true, true);
    const hide = (value: string) =>
      passOf(data, { ...selected, hiddenAnnotationValues: ['c2', value] });
    const blocked = hide('c0');
    expect(canRestyle(first.staged!, blocked.records.codes, blocked.hiddenRecords!)).toBe(false);
    const allowed = hide('c1');
    expect(canRestyle(first.staged!, allowed.records.codes, allowed.hiddenRecords!)).toBe(true);
    // And a restyle that is allowed draws what a fresh stage does.
    writeRecordTexels(
      first.staged!,
      packRecords(allowed.records, first.target),
      allowed.hiddenRecords!,
    );
    expectDrawnAsStaged(first, stage(pd, hide('c1'), false, true), n);
  });

  it('re-stages when the records name other categories', () => {
    const first = stage(pd, passOf(data, legendConfig), true);
    const other = makeData(3000, 8, 2);
    const pass = passOf(other, legendConfig);
    expect(canRestyle(first.staged!, pass.records.codes, pass.hiddenRecords!)).toBe(false);
    expect(canRestyle(first.staged!, undefined, pass.hiddenRecords!)).toBe(false);
  });

  it('keeps no table when a slot has a record that is not a category code', () => {
    const pass = passOf(data, legendConfig);
    const { target } = stage(pd, pass, true);
    target.recordIds![5] = pass.records.codes!.count;
    expect(
      collectStagedRecords(
        pass.records.codes!,
        target.recordIds!,
        target.colors,
        n,
        pass.hiddenRecords!,
      ),
    ).toBeNull();
  });

  it('builds the contour palette a per-point stage would, over few and many categories', () => {
    for (const values of [8, 40]) {
      const many = makeData(4000, values, values);
      const manyPd = makePlotData(many);
      const hidden = ['c1', 'c7', 'c9'];
      const config = { ...baseConfig, hiddenAnnotationValues: hidden };
      const table = stage(manyPd, passOf(many, config), true);
      const view = drawn(table.target, table.staged!, manyPd.length);
      expect(buildRecordSlotPalette(table.staged!, 2.2)).toEqual(
        buildSlotPalette(view.colors, manyPd.length, 2.2),
      );
      expect(buildRecordSlotPalette(table.staged!, 2.2)).toEqual(
        buildSlotPalette(
          stage(manyPd, passOf(many, config), false).target.colors,
          manyPd.length,
          2.2,
        ),
      );
    }
  });

  it('ranks marked slots after the rest, as the per-point palette does', () => {
    for (const values of [8, 40]) {
      const many = makeData(4000, values, values);
      const manyPd = makePlotData(many);
      const config = { ...baseConfig, hiddenAnnotationValues: ['c1'] };
      const table = stage(manyPd, passOf(many, config), true);
      const count = manyPd.length;
      // The first third of the draw order, so the first point of most colours moves.
      const marked = Uint8Array.from({ length: count }, (_, k) => (k < count / 3 ? 1 : 0));
      const { recordIds, colors } = table.target;
      const firstDrawn = markedFirstDrawn(table.staged!, recordIds!, colors, marked, count);
      const palette = buildRecordSlotPalette(table.staged!, 2.2, firstDrawn);
      const view = drawn(table.target, table.staged!, count);
      expect(palette).toEqual(buildSlotPalette(view.colors, count, 2.2, marked));
      expect(palette).not.toEqual(buildRecordSlotPalette(table.staged!, 2.2));
    }
  });
});
