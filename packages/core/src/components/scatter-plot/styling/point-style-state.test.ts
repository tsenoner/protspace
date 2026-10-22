import { afterEach, describe, it, expect, vi } from 'vitest';
import type { EatReliabilityState, PlotData, VisualizationData } from '@protspace/utils';
import { DEFAULT_CONFIG, NEUTRAL_VALUE_COLOR } from '../config';
import { LIGHT_NEUTRALS, type PlotNeutrals } from './plot-neutrals';
import { PointStyleState } from './point-style-state';

const DARK: PlotNeutrals = { other: '#64748b', na: '#2a3547' };

/** Six proteins, the first three in family A and the rest in B, under `fam` and `other`. */
function makeData(): VisualizationData {
  const fams = ['A', 'A', 'A', 'B', 'B', 'B'];
  const column = () => ({
    values: ['A', 'B'],
    colors: ['#ff0000', '#00ff00'],
    shapes: ['circle', 'circle'],
  });
  const rows = () => Int32Array.from(fams, (f) => (f === 'A' ? 0 : 1));
  return {
    protein_ids: fams.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: new Float32Array(12), dimension: 2 }],
    annotations: { fam: column(), other: column() },
    annotation_data: { fam: rows(), other: rows() },
  } as unknown as VisualizationData;
}

/** A style state over inputs a test changes in place. */
function makeState() {
  const inputs = {
    data: makeData() as VisualizationData | null,
    selectedAnnotation: 'fam',
    hiddenAnnotationValues: [] as string[],
    otherAnnotationValues: [] as string[],
    selectedProteinIds: [] as string[],
    highlightedProteinIds: [] as string[],
    focusedValues: null as string[] | null,
    eatOverlayEnabled: true,
    eatDim: null as EatReliabilityState | null,
    config: DEFAULT_CONFIG,
    zOrderMapping: null as Record<string, number> | null,
    colorMapping: null as Record<string, string> | null,
    shapeMapping: null as Record<string, string> | null,
    canDrawMarks: true,
    neutrals: LIGHT_NEUTRALS as PlotNeutrals,
  };
  const state = new PointStyleState({
    data: () => inputs.data,
    selectedAnnotation: () => inputs.selectedAnnotation,
    hiddenAnnotationValues: () => inputs.hiddenAnnotationValues,
    otherAnnotationValues: () => inputs.otherAnnotationValues,
    selectedProteinIds: () => inputs.selectedProteinIds,
    highlightedProteinIds: () => inputs.highlightedProteinIds,
    focusedValues: () => inputs.focusedValues,
    eatOverlayEnabled: () => inputs.eatOverlayEnabled,
    eatDim: () => inputs.eatDim,
    config: () => inputs.config,
    zOrderMapping: () => inputs.zOrderMapping,
    colorMapping: () => inputs.colorMapping,
    shapeMapping: () => inputs.shapeMapping,
    canDrawMarks: () => inputs.canDrawMarks,
    neutrals: () => inputs.neutrals,
    onIdsRepeat: vi.fn(),
  });
  return { inputs, state };
}

type Inputs = ReturnType<typeof makeState>['inputs'];

// The model is memoized on exactly these inputs: a missing key field would keep
// a stale model, an extra one would redo it (and its O(N) mask) for nothing.
describe('model() memo key', () => {
  it('returns the same model while no input changes', () => {
    const { state } = makeState();
    expect(state.model()).toBe(state.model());
  });

  const keyFlips: Array<[string, (inputs: Inputs) => void]> = [
    ['data', (i) => (i.data = makeData())],
    ['selectedAnnotation', (i) => (i.selectedAnnotation = 'other')],
    ['hiddenAnnotationValues', (i) => (i.hiddenAnnotationValues = ['A'])],
    ['selectedProteinIds', (i) => (i.selectedProteinIds = ['p0'])],
    ['highlightedProteinIds', (i) => (i.highlightedProteinIds = ['p1'])],
    ['baseOpacity', (i) => (i.config = { ...i.config, baseOpacity: 0.5 })],
    ['selectedOpacity', (i) => (i.config = { ...i.config, selectedOpacity: 0.9 })],
    ['fadedOpacity', (i) => (i.config = { ...i.config, fadedOpacity: 0.1 })],
    ['eatOverlayEnabled', (i) => (i.eatOverlayEnabled = false)],
    ['focusedValues', (i) => (i.focusedValues = ['A'])],
  ];
  for (const [field, flip] of keyFlips) {
    it(`builds a new model when ${field} changes`, () => {
      const { inputs, state } = makeState();
      const before = state.model();
      flip(inputs);
      expect(state.model()).not.toBe(before);
    });
  }

  it('builds a new model when the EAT dim drops a prediction, and keeps it while the dim holds', () => {
    const { inputs, state } = makeState();
    const data = makeData();
    data.annotation_predicted = {
      fam: [null, null, { value: 'A', confidence: 0.2, source: 'p0' }, null, null, null],
    };
    inputs.data = data;
    const before = state.model();
    inputs.eatDim = { mode: 'atLeast', min: 0.5, max: 1 };
    const dimmed = state.model();
    expect(dimmed).not.toBe(before);
    expect(dimmed.opacityAt(2, 'p2')).toBe(0.25);
    expect(state.model()).toBe(dimmed);
    inputs.eatDim = null;
    expect(state.model().opacityAt(2, 'p2')).toBe(DEFAULT_CONFIG.baseOpacity);
  });

  it('keeps the model when the EAT dim drops nothing', () => {
    const { inputs, state } = makeState();
    const before = state.model();
    inputs.eatDim = { mode: 'atLeast', min: 0.5, max: 1 };
    expect(state.model()).toBe(before);
  });

  const otherFlips: Array<[string, (inputs: Inputs) => void]> = [
    ['otherAnnotationValues', (i) => (i.otherAnnotationValues = ['B'])],
    ['pointSize', (i) => (i.config = { ...i.config, pointSize: 200 })],
    ['a new config with the same opacities', (i) => (i.config = { ...i.config })],
    ['zOrderMapping', (i) => (i.zOrderMapping = { A: 1, B: 0 })],
    ['colorMapping', (i) => (i.colorMapping = { A: '#0000ff', B: '#00ff00' })],
    ['shapeMapping', (i) => (i.shapeMapping = { A: 'square', B: 'circle' })],
  ];
  for (const [field, flip] of otherFlips) {
    it(`keeps the model when ${field} changes`, () => {
      const { inputs, state } = makeState();
      const before = state.model();
      flip(inputs);
      expect(state.model()).toBe(before);
    });
  }
});

describe('style getters lifecycle', () => {
  it('returns the same getters until they are invalidated or refreshed', () => {
    const { inputs, state } = makeState();
    const first = state.getters();
    // A mapping is read when the getters are built, so a change alone keeps them.
    inputs.colorMapping = { A: '#0000ff', B: '#00ff00' };
    expect(state.getters()).toBe(first);

    state.invalidateGetters();
    const second = state.getters();
    expect(second).not.toBe(first);
    expect(second.getColors({ id: 'p0', x: 0, y: 0, originalIndex: 0 })).toEqual(['#0000ff']);

    state.refreshGetters();
    expect(state.getters()).not.toBe(second);
  });

  it('keeps the unmarked getters the live view stages while the getters and model do', () => {
    const { inputs, state } = makeState();
    inputs.selectedProteinIds = ['p1'];
    expect(state.marksOnGpu()).toBe(true);
    const unmarked = state.stageGetters();
    expect(unmarked).not.toBe(state.getters());
    expect(state.stageGetters()).toBe(unmarked);

    state.invalidateGetters();
    expect(state.stageGetters()).not.toBe(unmarked);
  });

  it('stages the getters themselves while the selection is staged', () => {
    const { inputs, state } = makeState();
    inputs.selectedProteinIds = ['p1'];
    inputs.focusedValues = ['A'];
    expect(state.marksOnGpu()).toBe(false);
    expect(state.stageGetters()).toBe(state.getters());
    expect(state.stageModel()).toBe(state.model());
  });
});

describe('releaseDataset()', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops the getters, the slots and the previous model, and cancels the id index build', () => {
    const idle = new Map<number, IdleRequestCallback>();
    let handles = 0;
    vi.stubGlobal('requestIdleCallback', (task: IdleRequestCallback) => {
      idle.set(++handles, task);
      return handles;
    });
    vi.stubGlobal('cancelIdleCallback', (handle: number) => idle.delete(handle));
    const { inputs, state } = makeState();
    const ids = inputs.data!.protein_ids;
    const pd = {
      length: ids.length,
      originalIndices: null,
      proteinIds: ids,
    } as unknown as PlotData;
    const getters = state.getters();
    state.interactable(pd);
    const previous = state.model();
    expect(previous.idsUnique()).toBe(true);
    state.scheduleIdIndex();

    // A new dataset over the same ids array, whose model would reuse the old id index.
    inputs.data = { ...inputs.data! };
    state.releaseDataset();
    expect(idle.size).toBe(0);
    const model = state.model();
    expect(model).not.toBe(previous);
    expect(model.idsUniqueIfIndexed()).toBeNull();
    expect(state.getters()).not.toBe(getters);
    expect(state.currentInteractable(pd)).toBeNull();
  });

  it('keeps a model already over the current data', () => {
    const { state } = makeState();
    const model = state.model();
    state.releaseDataset();
    expect(state.model()).toBe(model);
  });
});

describe('exportGetters()', () => {
  const p3 = { id: 'p3', x: 0, y: 0, originalIndex: 3 };

  it('is getters() while the neutrals are light', () => {
    const { state } = makeState();
    expect(state.exportGetters()).toBe(state.getters());
  });

  it('with dark neutrals, colours Other #888888 while getters() colours it with the dark grey', () => {
    const { inputs, state } = makeState();
    inputs.otherAnnotationValues = ['B'];
    inputs.neutrals = DARK;
    expect(state.getters().getColors(p3)).toEqual(['#64748b']);
    expect(state.exportGetters().getColors(p3)).toEqual([NEUTRAL_VALUE_COLOR]);
    // Built once while the live getters stand.
    expect(state.exportGetters()).toBe(state.exportGetters());
  });

  it('invalidateGetters drops the light export getters too', () => {
    const { inputs, state } = makeState();
    inputs.neutrals = DARK;
    const first = state.exportGetters();
    state.invalidateGetters();
    const second = state.exportGetters();
    expect(second).not.toBe(first);
    state.refreshGetters();
    expect(state.exportGetters()).not.toBe(second);
  });
});
