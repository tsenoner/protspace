import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createDataRenderer, resolveRenderableView } from './data-renderer';
import type { EffectiveExploreView } from './view-state';

const projections: VisualizationData['projections'] = [
  { name: 'umap', dimension: 2, data: new Float32Array([0, 0, 1, 1]) },
];

describe('resolveRenderableView eat-confidence exclusion', () => {
  it('skips a leading eat-confidence key and defaults to the first non-eat annotation', () => {
    // `pfam__eat_confidence` iterates first in Object.keys() — this is the exact
    // shape of the bug: without the exclusion, the scatter plot would be
    // auto-colored by the raw EAT confidence values on load.
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2'],
      projections,
      annotations: {
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          colors: [],
          shapes: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
        pfam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        pfam__eat_confidence: new Int32Array([0, 1]),
        pfam: new Int32Array([0, 1]),
      },
    };

    const result = resolveRenderableView(data, null);

    expect(result.annotation).toBe('pfam');
  });

  it('ignores a deep-linked initialView.annotation that points at an eat-confidence key', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2'],
      projections,
      annotations: {
        pfam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          colors: [],
          shapes: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
      },
      annotation_data: {
        pfam: new Int32Array([0, 1]),
        pfam__eat_confidence: new Int32Array([0, 1]),
      },
    };
    const initialView: EffectiveExploreView = {
      annotation: 'pfam__eat_confidence',
      projection: 'umap',
      tooltip: [],
      density: 'off',
    };

    const result = resolveRenderableView(data, initialView);

    expect(result.annotation).toBe('pfam');
  });

  it('selects Object.keys(annotations)[0] as before when no eat-confidence keys are present', () => {
    const data: VisualizationData = {
      protein_ids: ['P1', 'P2'],
      projections,
      annotations: {
        species: {
          kind: 'categorical',
          values: ['human', 'mouse'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
        pfam: {
          kind: 'categorical',
          values: ['a', 'b'],
          colors: ['#000000', '#111111'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: {
        species: new Int32Array([0, 1]),
        pfam: new Int32Array([0, 1]),
      },
    };

    const result = resolveRenderableView(data, null);

    expect(result.annotation).toBe('species');
  });
});

describe('loadData overlay handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function datasetOf(size: number): VisualizationData {
    return {
      protein_ids: Array.from({ length: size }, (_, i) => `P${i}`),
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array(size * 2) }],
      annotations: {
        ec: { kind: 'categorical', values: ['a'], colors: ['#000'], shapes: ['circle'] },
      },
      annotation_data: { ec: new Int32Array(size) },
    };
  }

  function buildRenderer() {
    const overlayUpdate = vi.fn();
    const loadData = createDataRenderer({
      controlBar: { requestUpdate: vi.fn() },
      getIsDisposed: () => false,
      interactionController: { updateLegend: vi.fn() },
      legendElement: {},
      overlayController: { update: overlayUpdate },
      plotElement: { clearIsolationState: vi.fn(), requestUpdate: vi.fn(), config: {} },
      resolveInitialView: (): null => null,
      structureViewer: { style: { display: 'none' } },
    } as unknown as Parameters<typeof createDataRenderer>[0]);
    return { loadData, overlayUpdate };
  }

  it('leaves the overlay up for a small dataset, so it never uncovers an empty plot', async () => {
    const { loadData, overlayUpdate } = buildRenderer();
    const pending = loadData(datasetOf(10));
    await vi.runAllTimersAsync();
    await pending;

    // Dismissal belongs to the caller, once the whole load has settled.
    expect(overlayUpdate).not.toHaveBeenCalledWith(false);
  });

  it('finishes a large dataset without a fixed hold or a dismissal of its own', async () => {
    const { loadData, overlayUpdate } = buildRenderer();
    let done = false;
    const pending = loadData(datasetOf(1500)).then((view) => {
      done = true;
      return view;
    });

    // Five frames and the 30 ms legend sync, nowhere near the old 800 ms hold.
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(true);
    expect(await pending).not.toBeNull();

    expect(overlayUpdate).not.toHaveBeenCalledWith(false);
    const messages = overlayUpdate.mock.calls.map(([, , message]) => message);
    expect(messages).not.toContain('Ready to explore!');
  });
});
