import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyExploreViewRequest,
  getDatasetSearchParamsUpdate,
  parseExploreViewRequest,
} from './url-state';
import { createViewController } from './view-controller';
import type { ExploreViewChange } from './types';
import type { ExploreViewRequestState } from './view-state';
import type { DensityLayerMode } from '@protspace/utils';

function createMockElements() {
  const plotElement = {
    selectedProjectionIndex: 0,
    selectedAnnotation: 'ec',
    tooltipAnnotations: [] as string[],
    config: { pointSize: 240 } as Record<string, unknown>,
    getCurrentData: () => ({
      annotations: { ec: {}, pfam: {}, go: {} },
      projections: [{ name: 'UMAP' }, { name: 'PCA' }, { name: 't-SNE' }],
      protein_ids: [] as string[],
    }),
  };

  const pickers = {
    selectedProjection: 'UMAP',
    selectedAnnotation: 'ec',
    tooltipAnnotations: [] as string[],
    densityLayer: 'off' as DensityLayerMode,
    applyProjectionSelection: vi.fn((projection: string) => {
      pickers.selectedProjection = projection;
      // Simulate the view-bar controller updating the plot
      const index = plotElement
        .getCurrentData()
        .projections.findIndex((p) => p.name === projection);
      if (index >= 0) plotElement.selectedProjectionIndex = index;
    }),
    applyAnnotationSelection: vi.fn((annotation: string) => {
      pickers.selectedAnnotation = annotation;
      plotElement.selectedAnnotation = annotation;
    }),
    applyTooltipAnnotationsSelection: vi.fn((tooltip: string[]) => {
      pickers.tooltipAnnotations = [...tooltip];
      plotElement.tooltipAnnotations = [...tooltip];
    }),
    applyDensityLayerSelection: vi.fn((density: DensityLayerMode) => {
      pickers.densityLayer = density;
    }),
  };

  return { plotElement, pickers };
}

function makeRequest(
  annotation?: string,
  projection?: string,
  tooltip?: string[],
  density?: DensityLayerMode,
): ExploreViewRequestState {
  return {
    requested: { annotation, projection, tooltip, density },
    present: {
      annotation: annotation !== undefined,
      projection: projection !== undefined,
      tooltip: tooltip !== undefined,
      density: density !== undefined,
    },
    normalize: { annotation: false, projection: false, tooltip: false, density: false },
  };
}

function setup() {
  const { plotElement, pickers } = createMockElements();
  const viewController = createViewController({
    plotElement: plotElement as never,
    pickers: pickers as never,
  });
  return { plotElement, pickers, viewController };
}

describe('createViewController', () => {
  it('returns the current effective view from element state', () => {
    const { viewController } = setup();
    const view = viewController.getCurrentEffectiveView();

    expect(view).toEqual({
      annotation: 'ec',
      projection: 'UMAP',
      tooltip: [],
      density: 'off',
    });
  });

  it('returns null when no data is available', () => {
    const { plotElement, pickers } = createMockElements();
    plotElement.getCurrentData = () =>
      ({ annotations: {}, projections: [], protein_ids: [] }) as ReturnType<
        typeof plotElement.getCurrentData
      >;
    const vc = createViewController({
      plotElement: plotElement as never,
      pickers: pickers as never,
    });

    expect(vc.getCurrentEffectiveView()).toBeNull();
  });

  it('applies a valid view request and updates elements', () => {
    const { pickers, viewController } = setup();
    const request = makeRequest('pfam', 'PCA');
    const result = viewController.applyViewSelection(request, 'url');

    expect(result).toEqual({
      annotation: 'pfam',
      projection: 'PCA',
      tooltip: [],
      density: 'off',
    });
    expect(pickers.applyProjectionSelection).toHaveBeenCalledWith('PCA');
    expect(pickers.applyAnnotationSelection).toHaveBeenCalledWith('pfam');
  });

  it('falls back to first available when requested values are invalid', () => {
    const { viewController } = setup();
    const request = makeRequest('NONEXISTENT', 'UNKNOWN');
    const result = viewController.applyViewSelection(request, 'url');

    expect(result).toEqual({
      annotation: 'ec',
      projection: 'UMAP',
      tooltip: [],
      density: 'off',
    });
  });

  it('returns null from applyViewSelection when dataset has no options', () => {
    const { plotElement, pickers } = createMockElements();
    plotElement.getCurrentData = () =>
      ({ annotations: {}, projections: [], protein_ids: [] }) as ReturnType<
        typeof plotElement.getCurrentData
      >;
    const vc = createViewController({
      plotElement: plotElement as never,
      pickers: pickers as never,
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
    expect(changes[0].effective).toEqual({
      annotation: 'pfam',
      projection: 'PCA',
      tooltip: [],
      density: 'off',
    });
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
    const { pickers, viewController } = setup();
    // Current state is already UMAP + ec
    const request = makeRequest('pfam', 'UMAP');
    viewController.applyViewSelection(request, 'url');

    expect(pickers.applyProjectionSelection).not.toHaveBeenCalled();
    expect(pickers.applyAnnotationSelection).toHaveBeenCalledWith('pfam');
  });

  it('resolveLatestView uses the last setRequestedView', () => {
    const { viewController } = setup();
    viewController.setRequestedView(makeRequest('pfam', 'PCA'));

    const resolved = viewController.resolveLatestView();
    expect(resolved).toEqual({
      annotation: 'pfam',
      projection: 'PCA',
      tooltip: [],
      density: 'off',
    });
  });

  it('resolveLatestView falls back for invalid requests', () => {
    const { viewController } = setup();
    viewController.setRequestedView(makeRequest('NONEXISTENT', 'UNKNOWN'));

    const resolved = viewController.resolveLatestView();
    expect(resolved).toEqual({
      annotation: 'ec',
      projection: 'UMAP',
      tooltip: [],
      density: 'off',
    });
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

  it('suppresses the pickers’ echo of an applied view', () => {
    const { pickers, viewController } = setup();
    const changes: ExploreViewChange[] = [];
    viewController.subscribeToViewChanges((change) => changes.push(change));

    // The real annotation picker dispatches annotation-change synchronously, which the
    // app forwards back into the view controller as a user change.
    const applyAnnotation = pickers.applyAnnotationSelection;
    pickers.applyAnnotationSelection = vi.fn((annotation: string) => {
      applyAnnotation(annotation);
      viewController.handleUserAnnotationChange();
    });

    viewController.applyViewSelection(makeRequest('pfam', 'UMAP'), 'url');

    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('url');
  });

  it('emits a user change that lands right after a url-applied view', () => {
    const { pickers, plotElement, viewController } = setup();
    const changes: ExploreViewChange[] = [];
    viewController.subscribeToViewChanges((change) => changes.push(change));

    viewController.applyViewSelection(makeRequest('ec', 'UMAP', ['pfam']), 'url');
    changes.length = 0;

    // User toggles the extra tooltip annotation back off before the next frame.
    pickers.tooltipAnnotations = [];
    plotElement.tooltipAnnotations = [];
    viewController.handleUserTooltipAnnotationsChange();

    expect(changes).toHaveLength(1);
    expect(changes[0].source).toBe('user');
    expect(changes[0].effective.tooltip).toEqual([]);
  });

  describe('dataset defaults', () => {
    const defaults = { annotation: 'pfam', projection: 'PCA', tooltip: ['go'] };

    it('applies the defaults to an empty request, with no normalization (Back to a bare entry)', () => {
      const { pickers, viewController } = setup();
      const changes: ExploreViewChange[] = [];
      viewController.subscribeToViewChanges((change) => changes.push(change));

      viewController.setDatasetDefaults(defaults);
      viewController.setRequestedView(createEmptyExploreViewRequest());

      expect(pickers.applyProjectionSelection).toHaveBeenCalledWith('PCA');
      expect(pickers.applyAnnotationSelection).toHaveBeenCalledWith('pfam');
      expect(pickers.applyTooltipAnnotationsSelection).toHaveBeenCalledWith(['go']);
      expect(changes).toHaveLength(1);
      expect(changes[0].effective).toEqual({
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: ['go'],
        density: 'off',
      });
      expect(changes[0].normalize).toEqual({
        annotation: false,
        projection: false,
        tooltip: false,
        density: false,
      });
    });

    it('resolveLatestView honours the defaults', () => {
      const { viewController } = setup();
      viewController.setDatasetDefaults(defaults);
      viewController.recordRequestedView(createEmptyExploreViewRequest());

      expect(viewController.resolveLatestView()).toEqual({
        annotation: 'pfam',
        projection: 'PCA',
        tooltip: ['go'],
        density: 'off',
      });
    });

    it('fills only what an explicit request leaves unset', () => {
      const { viewController } = setup();
      viewController.setDatasetDefaults(defaults);

      const result = viewController.applyViewSelection(makeRequest('go'), 'url');

      expect(result).toEqual({ annotation: 'go', projection: 'PCA', tooltip: [], density: 'off' });
    });

    it('null restores the first-available fallback', () => {
      const { viewController } = setup();
      viewController.setDatasetDefaults(defaults);
      viewController.setDatasetDefaults(null);

      const result = viewController.applyViewSelection(createEmptyExploreViewRequest(), 'url');

      expect(result).toEqual({ annotation: 'ec', projection: 'UMAP', tooltip: [], density: 'off' });
    });
  });

  it('recordCurrentView replaces a recorded request with the view on screen, without applying it', () => {
    const { viewController, pickers } = setup();
    // A failed Back recorded the entry's parameters for a load that never
    // happened; the view on screen is ec on UMAP.
    viewController.recordRequestedView(makeRequest('pfam', 'PCA', ['go']));

    viewController.recordCurrentView();

    expect(viewController.getLatestViewRequest().requested).toEqual({
      annotation: 'ec',
      projection: 'UMAP',
      tooltip: undefined,
    });
    expect(viewController.resolveLatestView()).toEqual({
      annotation: 'ec',
      projection: 'UMAP',
      tooltip: [],
      density: 'off',
    });
    expect(pickers.applyAnnotationSelection).not.toHaveBeenCalled();
  });

  it('dispose clears subscribers', () => {
    const { viewController } = setup();
    const changes: ExploreViewChange[] = [];
    viewController.subscribeToViewChanges((change) => changes.push(change));

    viewController.dispose();
    viewController.applyViewSelection(makeRequest('pfam', 'PCA'), 'url');

    expect(changes).toHaveLength(0);
  });

  it('applies a requested density mode to the plot config and the contours picker', () => {
    const { plotElement, pickers, viewController } = setup();

    const effective = viewController.applyViewSelection(
      makeRequest('ec', 'UMAP', [], 'auto'),
      'url',
    );

    expect(effective?.density).toBe('auto');
    expect(pickers.applyDensityLayerSelection).toHaveBeenCalledWith('auto');
    expect(pickers.densityLayer).toBe('auto');
    expect(plotElement.config).toEqual({
      pointSize: 240,
      densityLayer: 'auto',
    });
  });

  // The sequence of a menu choice made on a `density=on` URL: the load resets
  // the recorded request (dataset-controller.ts `handleDataLoaded`) and
  // applies it, then the URL sync applies the entry the menu pushed
  // (use-url-state-sync.ts, 'apply-view'). Both name the same view, so the
  // contour layer is set once, not switched Off and back On.
  it('sets contours once on a menu switch from density=on', () => {
    const { pickers, viewController } = setup();
    const previous = new URLSearchParams('annotation=pfam&density=on');
    viewController.setRequestedView(parseExploreViewRequest(previous));
    expect(pickers.densityLayer).toBe('on');

    const densityWrites: DensityLayerMode[] = [];
    let densityLayer = pickers.densityLayer;
    Object.defineProperty(pickers, 'densityLayer', {
      get: () => densityLayer,
      set: (mode: DensityLayerMode) => {
        densityWrites.push(mode);
        densityLayer = mode;
      },
    });

    viewController.recordRequestedView(createEmptyExploreViewRequest());
    viewController.applyLatestViewForDatasetLoad();
    const pushed = getDatasetSearchParamsUpdate(previous, 'phosphatase', 'menu');
    viewController.setRequestedView(parseExploreViewRequest(pushed!.next));

    expect(densityWrites).toEqual(['off']);
  });

  it('reads the current density mode back off the plot config', () => {
    const { plotElement, viewController } = setup();
    plotElement.config = { densityLayer: 'on' };

    expect(viewController.getCurrentEffectiveView()?.density).toBe('on');
  });
});
