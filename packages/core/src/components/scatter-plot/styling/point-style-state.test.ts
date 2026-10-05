import { describe, it, expect, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { DEFAULT_CONFIG } from '../config';
import { PointStyleState } from './point-style-state';

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
    config: DEFAULT_CONFIG,
    zOrderMapping: null as Record<string, number> | null,
    colorMapping: null as Record<string, string> | null,
    shapeMapping: null as Record<string, string> | null,
    canDrawMarks: true,
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
    config: () => inputs.config,
    zOrderMapping: () => inputs.zOrderMapping,
    colorMapping: () => inputs.colorMapping,
    shapeMapping: () => inputs.shapeMapping,
    canDrawMarks: () => inputs.canDrawMarks,
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
