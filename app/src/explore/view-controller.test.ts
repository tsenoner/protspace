import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewController, type ViewController } from './view-controller';
import type { ExploreViewChange } from './types';
import type { ExploreViewRequestState } from './view-state';

// Stub requestAnimationFrame/cancelAnimationFrame for Node environment
beforeEach(() => {
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    setTimeout(() => cb(0), 0);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function createMockElements() {
  const plotElement = {
    selectedProjectionIndex: 0,
    selectedAnnotation: 'ec',
    tooltipAnnotations: [] as string[],
    getCurrentData: () => ({
      annotations: { ec: {}, pfam: {}, go: {} },
      projections: [{ name: 'UMAP' }, { name: 'PCA' }, { name: 't-SNE' }],
      protein_ids: [],
    }),
  };

  const controlBar = {
    selectedProjection: 'UMAP',
    selectedAnnotation: 'ec',
    tooltipAnnotations: [] as string[],
    applyProjectionSelection: vi.fn((projection: string) => {
      controlBar.selectedProjection = projection;
      // Simulate the real control-bar updating the plot
      const index = plotElement
        .getCurrentData()
        .projections.findIndex((p) => p.name === projection);
      if (index >= 0) plotElement.selectedProjectionIndex = index;
    }),
    applyAnnotationSelection: vi.fn((annotation: string) => {
      controlBar.selectedAnnotation = annotation;
      plotElement.selectedAnnotation = annotation;
    }),
    applyTooltipAnnotationsSelection: vi.fn((tooltip: string[]) => {
      controlBar.tooltipAnnotations = [...tooltip];
      plotElement.tooltipAnnotations = [...tooltip];
    }),
  };

  return { plotElement, controlBar };
}

function makeRequest(
  annotation?: string,
  projection?: string,
  tooltip?: string[],
): ExploreViewRequestState {
  return {
    requested: { annotation, projection, tooltip },
    present: {
      annotation: annotation !== undefined,
      projection: projection !== undefined,
      tooltip: tooltip !== undefined,
    },
    normalize: { annotation: false, projection: false, tooltip: false },
  };
}

function setup() {
  const { plotElement, controlBar } = createMockElements();
  const viewController = createViewController({
    plotElement: plotElement as never,
    controlBar: controlBar as never,
  });
  return { plotElement, controlBar, viewController };
}

describe('createViewController', () => {
  it('returns the current effective view from element state', () => {
    const { viewController } = setup();
    const view = viewController.getCurrentEffectiveView();

    expect(view).toEqual({ annotation: 'ec', projection: 'UMAP', tooltip: [] });
  });

  it('returns null when no data is available', () => {
    const { plotElement, controlBar } = createMockElements();
    plotElement.getCurrentData = () =>
      ({ annotations: {}, projections: [], protein_ids: [] }) as ReturnType<
        typeof plotElement.getCurrentData
      >;
    const vc = createViewController({
      plotElement: plotElement as never,
      controlBar: controlBar as never,
    });

    expect(vc.getCurrentEffectiveView()).toBeNull();
  });

  it('applies a valid view request and updates elements', () => {
    const { controlBar, viewController } = setup();
    const request = makeRequest('pfam', 'PCA');
    const result = viewController.applyViewSelection(request, 'url');

    expect(result).toEqual({ annotation: 'pfam', projection: 'PCA', tooltip: [] });
    expect(controlBar.applyProjectionSelection).toHaveBeenCalledWith('PCA');
    expect(controlBar.applyAnnotationSelection).toHaveBeenCalledWith('pfam');
  });

  it('falls back to first available when requested values are invalid', () => {
    const { viewController } = setup();
    const request = makeRequest('NONEXISTENT', 'UNKNOWN');
    const result = viewController.applyViewSelection(request, 'url');

    expect(result).toEqual({ annotation: 'ec', projection: 'UMAP', tooltip: [] });
  });

  it('returns null from applyViewSelection when dataset has no options', () => {
    const { plotElement, controlBar } = createMockElements();
    plotElement.getCurrentData = () =>
      ({ annotations: {}, projections: [], protein_ids: [] }) as ReturnType<
        typeof plotElement.getCurrentData
      >;
    const vc = createViewController({
      plotElement: plotElement as never,
      controlBar: controlBar as never,
    });

    const result = vc.applyViewSelection(makeRequest('ec', 'UMAP'), 'url');
    expect(result).toBeNull();
  });

  it('emits view changes to subscribers', () => {
    const { viewController } = setup();
    const changes: ExploreViewChange[] = [];
    viewController.subscribeToViewChanges((change) => changes.push(change));

    viewController.applyViewSelection(makeRequest('pfam', 'PCA'), 'user');

    expect(changes).toHaveLength(1);
    expect(changes[0].effective).toEqual({ annotation: 'pfam', projection: 'PCA', tooltip: [] });
    expect(changes[0].source).toBe('user');
  });

  it('unsubscribe stops receiving changes', () => {
    const { viewController } = setup();
    const changes: ExploreViewChange[] = [];
    const unsubscribe = viewController.subscribeToViewChanges((change) => changes.push(change));

    viewController.applyViewSelection(makeRequest('pfam', 'PCA'), 'url');
    expect(changes).toHaveLength(1);

    unsubscribe();
    viewController.applyViewSelection(makeRequest('go', 't-SNE'), 'url');
    expect(changes).toHaveLength(1);
  });

  it('does not call applyProjectionSelection when projection is unchanged', () => {
    const { controlBar, viewController } = setup();
    // Current state is already UMAP + ec
    const request = makeRequest('pfam', 'UMAP');
    viewController.applyViewSelection(request, 'url');

    expect(controlBar.applyProjectionSelection).not.toHaveBeenCalled();
    expect(controlBar.applyAnnotationSelection).toHaveBeenCalledWith('pfam');
  });

  it('resolveLatestView uses the last setRequestedView', () => {
    const { viewController } = setup();
    viewController.setRequestedView(makeRequest('pfam', 'PCA'));

    const resolved = viewController.resolveLatestView();
    expect(resolved).toEqual({ annotation: 'pfam', projection: 'PCA', tooltip: [] });
  });

  it('resolveLatestView falls back for invalid requests', () => {
    const { viewController } = setup();
    viewController.setRequestedView(makeRequest('NONEXISTENT', 'UNKNOWN'));

    const resolved = viewController.resolveLatestView();
    expect(resolved).toEqual({ annotation: 'ec', projection: 'UMAP', tooltip: [] });
  });

  it('applyLatestViewForDatasetLoad uses dataset-load source', () => {
    const { viewController } = setup();
    const changes: ExploreViewChange[] = [];
    viewController.subscribeToViewChanges((change) => changes.push(change));

    viewController.setRequestedView(makeRequest('pfam', 'PCA'));
    changes.length = 0; // clear the setRequestedView emission

    viewController.applyLatestViewForDatasetLoad();

    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('dataset-load');
  });

  it('getLatestViewRequest returns a clone that does not mutate internal state', () => {
    const { viewController } = setup();
    viewController.setRequestedView(makeRequest('pfam', 'PCA'));

    const snapshot = viewController.getLatestViewRequest();
    snapshot.requested.annotation = 'MUTATED';

    const fresh = viewController.getLatestViewRequest();
    expect(fresh.requested.annotation).toBe('pfam');
  });

  it('dispose clears subscribers', () => {
    const { viewController } = setup();
    const changes: ExploreViewChange[] = [];
    viewController.subscribeToViewChanges((change) => changes.push(change));

    viewController.dispose();
    viewController.applyViewSelection(makeRequest('pfam', 'PCA'), 'url');

    expect(changes).toHaveLength(0);
  });
});
