/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildStorageKey,
  generateDatasetHash,
  sliceVisualizationDataByIndices,
  type LegendSettingsMap,
  type VisualizationData,
} from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { createDefaultSettings } from './legend-helpers';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

// These tests seed and read the persisted settings through `localStorage` directly. Stub an
// in-memory store rather than using the runtime's: Node does not hand jsdom a usable
// `localStorage` without `--localstorage-file`, which made the `clear()` below throw outright.
// Same shape as the mock in `legend.score-sync.test.ts`.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

type ShapeSizeLegend = HTMLElement & {
  shapeSize: number;
  selectedAnnotation: string;
  annotationData: { name: string; values: string[]; kind?: 'categorical' | 'numeric' };
  _dialogSettings: Record<string, unknown> & { shapeSize: number | null };
  _handleCustomize: () => Promise<void>;
  _handleSettingsSave: () => void;
  _handleSettingsReset: () => void;
  _updateLegendItems: () => void;
  _dispatchLegendStateChange: () => void;
  _scatterplotController: { updateConfig: (config: { pointSize?: number }) => void };
  _persistenceController: {
    _datasetHash: string;
    updateDatasetHash: (data: typeof DATASET) => boolean;
    updateSelectedAnnotation: (annotation: string) => boolean;
    loadSettings: () => void;
    saveSettings: () => void;
  };
  _datasetProteinCount: number;
  data: { annotations: Record<string, { values: string[] }> } | null;
  getAllPersistedSettings: () => Record<string, { shapeSize: number }>;
  setFileSettings: (settings: LegendSettingsMap | null, datasetHash?: string) => void;
  applyShapeSize: (size: number, datasetHash?: string) => void;
  readonly pickedShapeSize: number | undefined;
};

/** The detached legend's dataset, which keys its storage. */
const DATASET = {
  protein_ids: ['p1', 'p2'],
  annotations: { a: { values: ['x'] }, b: { values: ['x'] } },
};

/**
 * A detached legend never runs `updated()`, which is where it counts the dataset's proteins
 * next to the hash, so the count is set directly. The default 2 protein ids give shape size 10.
 */
function makeLegend(proteinCount = 2) {
  const el = document.createElement('protspace-legend') as ShapeSizeLegend;
  const pointSizes: number[] = [];
  el._scatterplotController.updateConfig = (config) => {
    if (config.pointSize !== undefined) pointSizes.push(config.pointSize);
  };
  el._updateLegendItems = vi.fn();
  el._dispatchLegendStateChange = vi.fn();
  el._persistenceController.updateDatasetHash(DATASET);
  el._datasetProteinCount = proteinCount;
  const hash = el._persistenceController._datasetHash;
  const switchTo = (annotation: string) => {
    el.selectedAnnotation = annotation;
    el.annotationData = { name: annotation, values: ['x'], kind: 'categorical' };
    el._persistenceController.updateSelectedAnnotation(annotation);
    el._persistenceController.loadSettings();
  };
  const store = (annotation: string, shapeSize: number) =>
    localStorage.setItem(
      buildStorageKey('legend', hash, annotation),
      JSON.stringify({ shapeSize, maxVisibleValues: 10, hiddenValues: [], categories: {} }),
    );
  /** Save the settings dialog with `shapeSize` in the size field, null for an emptied one. */
  const pick = (shapeSize: number | null) => {
    el._dialogSettings = { ...el._dialogSettings, shapeSize, annotationSortModes: {} };
    el._handleSettingsSave();
  };
  /** Give the legend data with these annotations, which Reset and exports go through. */
  const annotate = (...annotations: string[]) => {
    el.data = {
      annotations: Object.fromEntries(annotations.map((name) => [name, { values: ['x'] }])),
    };
  };
  const stored = (annotation: string) =>
    JSON.parse(localStorage.getItem(buildStorageKey('legend', hash, annotation)) ?? 'null') as {
      shapeSize: number;
    } | null;
  const storedPick = () => localStorage.getItem(buildStorageKey('shape-size', hash));
  const legacyPick = () => localStorage.getItem(buildStorageKey('point-size', hash));
  return { el, hash, pointSizes, switchTo, store, pick, annotate, stored, storedPick, legacyPick };
}

const fileSettings = (shapeSize: number) => ({ ...createDefaultSettings('x'), shapeSize });

describe('legend shape size', () => {
  beforeEach(() => localStorage.clear());

  it('starts a fresh dataset at 10, drawn as point size 80', () => {
    const { el, pointSizes, switchTo } = makeLegend();
    switchTo('a');
    expect(el.shapeSize).toBe(10);
    expect(pointSizes.at(-1)).toBe(80);
  });

  it('shows the new default for a legacy 30 record and keeps any other stored size', () => {
    const { el, switchTo, store } = makeLegend();
    store('a', 30);
    store('b', 50);
    switchTo('a');
    expect(el.shapeSize).toBe(10);
    switchTo('b');
    expect(el.shapeSize).toBe(50);
  });

  it('carries a picked size across annotation switches and a new legend', () => {
    const { el, pointSizes, switchTo, store, pick } = makeLegend();
    store('b', 50);
    switchTo('a');
    pick(12);
    switchTo('b');
    expect(el.shapeSize).toBe(12);
    expect(pointSizes.at(-1)).toBe(96);
    switchTo('a');
    expect(el.shapeSize).toBe(12);

    const next = makeLegend();
    next.switchTo('b');
    expect(next.el.shapeSize).toBe(12);
  });

  it('resets a small dataset to 10', () => {
    const { el, switchTo, pick } = makeLegend();
    switchTo('a');
    pick(12);
    switchTo('b');
    el._handleSettingsReset();
    expect(el.shapeSize).toBe(10);
    switchTo('a');
    expect(el.shapeSize).toBe(10);
  });

  it('takes a bundle size as picked, including 30', () => {
    const { el, hash, pointSizes, switchTo } = makeLegend();
    switchTo('a');
    el.applyShapeSize(30, hash);
    expect(pointSizes.at(-1)).toBe(240);
    switchTo('b');
    expect(el.shapeSize).toBe(30);
  });

  it('caps a bundle size at 64 and saves the capped size', () => {
    const { el, hash, pointSizes, switchTo } = makeLegend();
    switchTo('a');
    el.applyShapeSize(200, hash);
    expect(el.shapeSize).toBe(64);
    expect(pointSizes.at(-1)).toBe(512);
    expect(el.pickedShapeSize).toBe(64);
  });

  it('caps a stored size at 64', () => {
    const { el, hash, switchTo, store } = makeLegend();
    store('a', 200);
    switchTo('a');
    expect(el.shapeSize).toBe(64);

    localStorage.setItem(buildStorageKey('shape-size', hash), '200');
    switchTo('b');
    expect(el.shapeSize).toBe(64);
  });

  it("stores and exports an annotation's oversized own size as 64", () => {
    const { el, switchTo, store, stored, annotate } = makeLegend();
    store('a', 200);
    switchTo('a');
    el._persistenceController.saveSettings();
    expect(stored('a')?.shapeSize).toBe(64);
    annotate('a');
    expect(el.getAllPersistedSettings().a.shapeSize).toBe(64);
  });

  it('caps a host-set size when the settings dialog is saved', async () => {
    const { el, pointSizes, switchTo } = makeLegend();
    switchTo('a');
    el.shapeSize = 200;
    // Opening the dialog awaits a render, which a detached element never does.
    document.body.appendChild(el);
    try {
      await el._handleCustomize();
      expect(el._dialogSettings.shapeSize).toBe(64);
      el._handleSettingsSave();
      expect(el.shapeSize).toBe(64);
      expect(pointSizes.at(-1)).toBe(512);
    } finally {
      el.remove();
    }
  });

  it('exports the picked size on every annotation', () => {
    const { el, switchTo, store, pick, annotate } = makeLegend();
    store('b', 50);
    switchTo('a');
    pick(12);
    annotate('a', 'b');
    const exported = el.getAllPersistedSettings();
    expect(exported.a.shapeSize).toBe(12);
    expect(exported.b.shapeSize).toBe(12);
  });

  it('reports a dataset-level size only once one is picked', () => {
    const { el, store, switchTo, pick } = makeLegend();
    store('a', 50);
    switchTo('a');
    expect(el.shapeSize).toBe(50);
    expect(el.pickedShapeSize).toBeUndefined();
    pick(12);
    expect(el.pickedShapeSize).toBe(12);
  });
});

describe('legend default shape size from the protein count', () => {
  beforeEach(() => localStorage.clear());

  it('defaults a large dataset by its protein count when the annotation stores the filler 10', () => {
    const { el, pointSizes, switchTo, store } = makeLegend(105_562);
    store('a', 10);
    switchTo('a');
    expect(el.shapeSize).toBe(2);
    expect(pointSizes.at(-1)).toBe(16);
  });

  it('reads the legacy filler 30 and a missing record as unset too', () => {
    const { el, switchTo, store } = makeLegend(573_649);
    store('a', 30);
    switchTo('a');
    expect(el.shapeSize).toBe(1);
    switchTo('b');
    expect(el.shapeSize).toBe(1);
  });

  it("keeps an annotation's own size over the default", () => {
    const { el, pointSizes, switchTo, store } = makeLegend(105_562);
    store('a', 5);
    switchTo('a');
    expect(el.shapeSize).toBe(5);
    expect(pointSizes.at(-1)).toBe(40);
    switchTo('b');
    expect(el.shapeSize).toBe(2);
  });

  it("lets a bundle's top-level size win over the annotation's own size and the default", () => {
    const { el, hash, switchTo, store } = makeLegend(105_562);
    store('a', 5);
    switchTo('a');
    el.applyShapeSize(20, hash);
    expect(el.shapeSize).toBe(20);
    switchTo('b');
    expect(el.shapeSize).toBe(20);
    switchTo('a');
    expect(el.shapeSize).toBe(20);
  });

  it("lets a stored pick win over the annotation's own size", () => {
    const { el, hash, switchTo, store } = makeLegend(105_562);
    store('a', 5);
    localStorage.setItem(buildStorageKey('shape-size', hash), '7');
    switchTo('a');
    expect(el.shapeSize).toBe(7);
  });

  // The legacy key is migrated when a legend first takes the dataset's hash, so these tests seed
  // it through one legend, as an earlier session left it, and load the dataset in the next.

  it('migrates the 10 the old Reset stored under the legacy key as Reset does now', () => {
    const earlier = makeLegend(105_562);
    // The old Reset stored 10 but left the size picked before it in each annotation's record.
    earlier.store('a', 12);
    earlier.store('b', 12);
    localStorage.setItem(buildStorageKey('point-size', earlier.hash), '10');

    const { el, switchTo, annotate, stored, storedPick, legacyPick } = makeLegend(105_562);
    expect(legacyPick()).toBeNull();
    expect(storedPick()).toBeNull();
    switchTo('a');
    expect(el.shapeSize).toBe(2);
    switchTo('b');
    expect(el.shapeSize).toBe(2);
    expect(stored('a')?.shapeSize).toBe(10);
    expect(el.pickedShapeSize).toBeUndefined();
    annotate('a', 'b');
    expect(el.getAllPersistedSettings().a.shapeSize).toBe(10);
  });

  it('moves any other size stored under the legacy key to the current key, as a pick', () => {
    const earlier = makeLegend(105_562);
    earlier.store('b', 5);
    localStorage.setItem(buildStorageKey('point-size', earlier.hash), '7');

    const { el, switchTo, stored, storedPick, legacyPick } = makeLegend(105_562);
    expect(storedPick()).toBe('7');
    expect(legacyPick()).toBeNull();
    switchTo('a');
    expect(el.shapeSize).toBe(7);
    expect(el.pickedShapeSize).toBe(7);
    switchTo('b');
    expect(el.shapeSize).toBe(7);
    expect(stored('b')?.shapeSize).toBe(5);
  });

  it('keeps the current key over the legacy one, which it drops', () => {
    const earlier = makeLegend(105_562);
    localStorage.setItem(buildStorageKey('point-size', earlier.hash), '7');
    localStorage.setItem(buildStorageKey('shape-size', earlier.hash), '10');

    const { el, switchTo, storedPick, legacyPick } = makeLegend(105_562);
    expect(legacyPick()).toBeNull();
    switchTo('a');
    expect(el.shapeSize).toBe(10);
    expect(storedPick()).toBe('10');
  });

  it('migrates the legacy key once', () => {
    const earlier = makeLegend(105_562);
    localStorage.setItem(buildStorageKey('point-size', earlier.hash), '10');
    makeLegend(105_562);
    // An annotation's own size stored after the migration survives the next load.
    earlier.store('b', 12);

    const { el, switchTo } = makeLegend(105_562);
    switchTo('b');
    expect(el.shapeSize).toBe(12);
  });

  it('stores no size when the default is in use', () => {
    const { el, switchTo, stored, storedPick } = makeLegend(105_562);
    switchTo('a');
    el._persistenceController.saveSettings();
    expect(el.shapeSize).toBe(2);
    expect(stored('a')?.shapeSize).toBe(10);
    expect(storedPick()).toBeNull();
    expect(el.pickedShapeSize).toBeUndefined();
  });

  it('exports the filler 10 and no picked size, never the computed default', () => {
    const { el, switchTo, annotate } = makeLegend(105_562);
    switchTo('b');
    el._persistenceController.saveSettings();
    switchTo('a');
    expect(el.shapeSize).toBe(2);
    annotate('a', 'b');
    const exported = el.getAllPersistedSettings();
    expect(exported.a.shapeSize).toBe(10);
    expect(exported.b.shapeSize).toBe(10);
    expect(el.pickedShapeSize).toBeUndefined();
  });

  it('Reset clears the stored size and returns every annotation to the default', () => {
    const { el, pointSizes, switchTo, store, pick, annotate, storedPick } = makeLegend(105_562);
    // A record written while a size was picked can hold that size as the annotation's own.
    store('b', 12);
    switchTo('a');
    pick(12);
    expect(storedPick()).toBe('12');
    annotate('a', 'b');

    el._handleSettingsReset();
    expect(el.shapeSize).toBe(2);
    expect(pointSizes.at(-1)).toBe(16);
    expect(storedPick()).toBeNull();
    expect(el.pickedShapeSize).toBeUndefined();

    switchTo('b');
    expect(el.shapeSize).toBe(2);
    const exported = el.getAllPersistedSettings();
    expect(exported.b.shapeSize).toBe(10);
    expect(Object.values(exported).map((settings) => settings.shapeSize)).toEqual(
      Object.keys(exported).map(() => 10),
    );

    const next = makeLegend(105_562);
    next.switchTo('b');
    expect(next.el.shapeSize).toBe(2);
  });

  it('an emptied size field returns the dataset to its default on Save', () => {
    const { el, pointSizes, switchTo, store, pick, annotate, storedPick } = makeLegend(105_562);
    store('b', 12);
    switchTo('a');
    pick(12);
    annotate('a', 'b');

    pick(null);
    expect(el.shapeSize).toBe(2);
    expect(pointSizes.at(-1)).toBe(16);
    expect(storedPick()).toBeNull();
    expect(el.pickedShapeSize).toBeUndefined();

    switchTo('b');
    expect(el.shapeSize).toBe(2);
    expect(el.getAllPersistedSettings().b.shapeSize).toBe(10);
  });

  it("an emptied size field also drops an annotation's own size", () => {
    const { el, switchTo, store, pick, annotate } = makeLegend(105_562);
    store('a', 5);
    switchTo('a');
    expect(el.shapeSize).toBe(5);
    annotate('a');

    pick(null);
    expect(el.shapeSize).toBe(2);
    switchTo('b');
    switchTo('a');
    expect(el.shapeSize).toBe(2);
  });

  it('Reset also drops the per-annotation sizes of bundle settings not yet applied', () => {
    const { el, hash, switchTo, annotate } = makeLegend(105_562);
    el.setFileSettings({ a: fileSettings(5), b: fileSettings(7) }, hash);
    switchTo('a');
    expect(el.shapeSize).toBe(5);
    annotate('a', 'b');

    el._handleSettingsReset();
    expect(el.shapeSize).toBe(2);
    switchTo('b');
    expect(el.shapeSize).toBe(2);
  });
});

type MockPlot = Awaited<ReturnType<typeof mountLegendWithScatterplot>>['plot'];
type ResettableLegend = ProtspaceLegend & {
  _handleSettingsReset: () => void;
  _handleCustomize: () => Promise<void>;
  _handleItemClick: (value: string) => void;
};

function makeData(count: number, prefix = 'p'): VisualizationData {
  const codes = Int32Array.from({ length: count }, (_, i) => i % 2);
  const categorical = (values: string[]) => ({
    kind: 'categorical' as const,
    values,
    colors: ['#ff0000', '#0000ff'],
    shapes: ['circle', 'circle'],
  });
  return {
    protein_ids: Array.from({ length: count }, (_, i) => `${prefix}${i}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(count * 2) }],
    annotations: { group: categorical(['A', 'B']), kind: categorical(['x', 'y']) },
    annotation_data: { group: codes, kind: codes.slice() },
  };
}

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

function showView(plot: MockPlot, view: VisualizationData): void {
  plot.getCurrentData = () => view;
  plot.dispatchEvent(new CustomEvent('data-change', { detail: { data: view } }));
}

describe('legend default shape size with a scatterplot', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mount(count: number) {
    const data = makeData(count);
    const { legend, plot } = await mountLegendWithScatterplot(data, 'group');
    await settle(legend);
    return { data, legend: legend as ResettableLegend, plot };
  }

  const pointSize = (plot: MockPlot) => (plot.config as { pointSize?: number }).pointSize;

  it("sizes dots by the whole dataset's protein count, also with categories hidden", async () => {
    const { legend, plot } = await mount(40_000);
    expect(legend.shapeSize).toBe(4);
    expect(pointSize(plot)).toBe(32);

    legend._handleItemClick('A');
    await settle(legend);
    expect(legend.shapeSize).toBe(4);
    expect(pointSize(plot)).toBe(32);
  });

  it('counts the whole dataset, not the filtered view', async () => {
    const { data, legend, plot } = await mount(40_000);
    const kept = Array.from({ length: 1_000 }, (_, i) => i);
    const view = sliceVisualizationDataByIndices(data, kept);
    plot.filtersActive = true;
    plot.filteredProteinIds = view.protein_ids;
    showView(plot, view);
    await settle(legend);
    expect(legend.proteinIds).toHaveLength(1_000);

    plot.selectedAnnotation = 'kind';
    legend.selectedAnnotation = 'kind';
    await settle(legend);
    expect(legend.shapeSize).toBe(4);

    legend._handleSettingsReset();
    expect(legend.shapeSize).toBe(4);
    expect(pointSize(plot)).toBe(32);
  });

  it('recomputes the default for the next dataset', async () => {
    const { legend, plot } = await mount(5_000);
    expect(legend.shapeSize).toBe(10);

    const next = makeData(40_000, 'q');
    legend.clearForNewDataset(generateDatasetHash(next));
    plot.data = next;
    showView(plot, next);
    await settle(legend);
    expect(legend.shapeSize).toBe(4);
    expect(pointSize(plot)).toBe(32);
  });

  it('names the default in the settings dialog and returns to it from an emptied field', async () => {
    const { legend, plot } = await mount(40_000);
    legend.applyShapeSize(10);
    expect(pointSize(plot)).toBe(80);

    await legend._handleCustomize();
    await settle(legend);
    const input = legend.shadowRoot!.querySelector<HTMLInputElement>('#shape-size-input')!;
    expect(input.value).toBe('10');
    expect(input.placeholder).toBe('4');
    expect(input.parentElement?.querySelector('.settings-note')?.textContent).toContain(
      'Default for this dataset: 4',
    );
    input.value = '';
    input.dispatchEvent(new Event('input'));
    legend.shadowRoot!.querySelector<HTMLButtonElement>('.modal-footer .btn-primary')!.click();
    await settle(legend);

    expect(legend.shapeSize).toBe(4);
    expect(pointSize(plot)).toBe(32);
    expect(legend.pickedShapeSize).toBeUndefined();
  });
});
