import { afterEach, describe, it, expect, vi } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
import { DEFAULT_CONFIG } from '../config';
import { NA_VALUE } from '@protspace/utils';
import { seededRandom } from '../../../test-support/seeded-random';
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
    // The overlay reaches the model only through the materialized data (`data`).
    ['eatOverlayEnabled alone', (i) => (i.eatOverlayEnabled = false)],
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

describe('interactable()', () => {
  it('marks the slots the per-point opacity does, on the hidden mask path and off it', () => {
    const random = seededRandom(2026);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const values = ['A', 'B', 'C', null];
    const tiers = [0, 0.15, 0.9, 1];
    let fast = 0;
    let fallback = 0;
    for (let round = 0; round < 300; round++) {
      const n = 1 + Math.floor(random() * 80);
      const rows = Int32Array.from({ length: n }, () => Math.floor(random() * 6) - 1);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const data = {
        protein_ids: ids,
        projections: [{ name: 'umap', data: new Float32Array(2 * n), dimension: 2 }],
        annotations: {
          fam: { values, colors: values.map(() => '#ff0000'), shapes: values.map(() => 'circle') },
        },
        annotation_data: { fam: rows },
      } as unknown as VisualizationData;
      const { inputs, state } = makeState();
      const some = () => ids.filter(() => random() < 0.2);
      inputs.data = data;
      inputs.selectedAnnotation = pick(['fam', 'fam', 'fam', '', 'missing']);
      inputs.hiddenAnnotationValues = [...values.map((v) => v ?? NA_VALUE), 'Z'].filter(
        () => random() < 0.4,
      );
      inputs.selectedProteinIds = random() < 0.4 ? some() : [];
      inputs.highlightedProteinIds = random() < 0.3 ? some() : [];
      inputs.focusedValues = random() < 0.3 ? [pick(['A', 'B', NA_VALUE])] : null;
      inputs.config = {
        ...DEFAULT_CONFIG,
        baseOpacity: pick(tiers),
        selectedOpacity: pick(tiers),
        fadedOpacity: pick(tiers),
      };
      const oi =
        random() < 0.5
          ? null
          : Int32Array.from(ids.map((_, i) => i).filter(() => random() < 0.7)).sort(
              () => random() - 0.5,
            );
      const length = oi ? oi.length : n;
      const pd = { length, originalIndices: oi, proteinIds: ids } as unknown as PlotData;

      // The per-point pass `interactable` falls back to.
      const model = state.model();
      const visible = new Uint8Array(length);
      const expectedIds = new Set<string>();
      for (let s = 0; s < length; s++) {
        const i = oi ? oi[s] : s;
        if (model.opacityAt(i, ids[i]) > 0) {
          visible[s] = 1;
          expectedIds.add(ids[i]);
        }
      }
      if (model.interactiveSlots(oi, length)) fast++;
      else fallback++;

      const slots = state.interactable(pd);
      expect(slots.visible).toEqual(visible);
      expect(slots.count).toBe(expectedIds.size);
      expect([...slots.ids()]).toEqual([...expectedIds]);
    }
    expect(fast).toBeGreaterThan(80);
    expect(fallback).toBeGreaterThan(40);
  });

  it("reads the hidden mask instead of each slot's opacity while only hiding decides", () => {
    const { inputs, state } = makeState();
    inputs.hiddenAnnotationValues = ['A'];
    const ids = inputs.data!.protein_ids;
    const pd = { length: ids.length, originalIndices: null, proteinIds: ids } as PlotData;
    const opacityAt = vi.spyOn(state.model(), 'opacityAt');
    const slots = state.interactable(pd);
    expect(opacityAt).not.toHaveBeenCalled();
    expect([...slots.visible]).toEqual([0, 0, 0, 1, 1, 1]);
    expect(slots.count).toBe(3);
  });
});
