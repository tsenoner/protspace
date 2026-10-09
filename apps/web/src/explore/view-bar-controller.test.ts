import type {
  ProtspaceAnnotationSelect,
  ProtspaceContoursMenu,
  ProtspaceProjectionMetadata,
  ProtspaceProjectionSelect,
  ProtspaceScatterplot,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewBarController, deriveViewOptions } from './view-bar-controller';
import { getWorkbenchStatus, resetWorkbenchStatusForTests } from './workbench-status';

/** Fixtures carry only what the controller reads, so they go through `unknown`. */
const asData = (data: unknown) => data as VisualizationData;

function makeData(): VisualizationData {
  return asData({
    protein_ids: ['p0', 'p1'],
    projections: [{ name: 'UMAP' }, { name: 'PCA' }],
    annotations: {
      family: { kind: 'categorical', values: ['A'] },
      species: { kind: 'categorical', values: ['H'] },
      gene_name: { kind: 'categorical', values: ['g'] },
      family__eat_confidence: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
      },
    },
    annotation_predicted: {
      family: [null, { value: 'A', confidence: 0.9, source: 'p0' }],
      species: [null, null],
    },
    statisticsRows: [],
  });
}

function setup(data = makeData()) {
  const plot = Object.assign(new EventTarget(), {
    data,
    selectedProjectionIndex: 0,
    selectedAnnotation: 'family',
    tooltipAnnotations: [] as string[],
    config: { pointSize: 80 } as Record<string, unknown>,
    filtersActive: false,
    isIsolationMode: () => false,
    getMaterializedData: vi.fn(() => data),
    getCurrentData: vi.fn(() => data),
  });
  // Each fake applySelection behaves like its element: set the value, dispatch at once.
  const projectionSelect = Object.assign(new EventTarget(), {
    projections: [] as readonly string[],
    selectedProjection: '',
    applySelection: vi.fn((projection: string) => {
      projectionSelect.selectedProjection = projection;
      projectionSelect.dispatchEvent(
        new CustomEvent('projection-change', { detail: { projection } }),
      );
    }),
    cancelPending: vi.fn(),
  });
  const annotationSelect = Object.assign(new EventTarget(), {
    annotations: [] as string[],
    eatAnnotations: [] as string[],
    annotationDefinitions: {} as Record<string, unknown>,
    statisticsRows: [] as readonly unknown[],
    selectedAnnotation: '',
    selectedProjection: '',
    tooltipAnnotations: [] as string[],
    applySelection: vi.fn(),
    applyTooltipSelection: vi.fn(),
    cancelPending: vi.fn(),
  });
  const contoursMenu = Object.assign(new EventTarget(), {
    densityLayer: 'off',
    // Like the element: an applied mode is the menu's mode from then on.
    applySelection: vi.fn((mode: string) => {
      contoursMenu.densityLayer = mode;
    }),
    cancelPending: vi.fn(),
  });
  const projectionMetadata = {
    projection: null as unknown,
    statisticsRows: undefined as unknown,
    selectedAnnotation: '',
    viewIsSubset: false,
  };
  const root = new EventTarget();
  const interactionController = { handleAnnotationChange: vi.fn() };
  const onUserChange = vi.fn();
  const controller = createViewBarController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    projectionSelect: projectionSelect as unknown as ProtspaceProjectionSelect,
    annotationSelect: annotationSelect as unknown as ProtspaceAnnotationSelect,
    contoursMenu: contoursMenu as unknown as ProtspaceContoursMenu,
    projectionMetadata: projectionMetadata as unknown as ProtspaceProjectionMetadata,
    interactionController,
    root: root as unknown as Document,
    onUserChange,
  });
  return {
    controller,
    plot,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    root,
    interactionController,
    onUserChange,
    data,
  };
}

/** As the DOM delivers a bubbling, composed event: on the picker, then on the document. */
function bubble(target: EventTarget, root: EventTarget, type: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail }));
  root.dispatchEvent(new CustomEvent(type, { detail }));
}

describe('deriveViewOptions', () => {
  it('deriveViewOptions hides tooltip-only and EAT-confidence columns and lists predicted annotations', () => {
    const data = asData({
      projections: [{ name: 'umap' }],
      annotations: {
        pfam: { kind: 'categorical', values: ['a', 'b'] },
        gene_name: { kind: 'categorical', values: ['x'] },
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
        // Collision-renamed (`<base>__eat_confidence__runtime_N`): identity keys off
        // runtime.role, not the suffix.
        pfam__eat_confidence__runtime_2: {
          kind: 'numeric',
          values: ['0.1', '0.7'],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
      },
      annotation_predicted: {
        pfam: [null, { value: 'a', confidence: 0.8, source: 'P1' }],
        ec: [null, null],
      },
    });

    expect(deriveViewOptions(data)).toEqual({
      projections: ['umap'],
      annotations: ['pfam'],
      eatAnnotations: ['pfam'],
    });
  });

  it('deriveViewOptions reads the predicted annotations from the capability data', () => {
    const shown = asData({ projections: [], annotations: { ec: { kind: 'categorical' } } });
    const capability = asData({
      projections: [],
      annotations: {},
      annotation_predicted: { ec: [{ value: 'x', confidence: 1, source: 'p' }] },
    });

    expect(deriveViewOptions(shown, capability).eatAnnotations).toEqual(['ec']);
    expect(deriveViewOptions(shown).eatAnnotations).toEqual([]);
  });
});

describe('createViewBarController', () => {
  it("a projection pick sets the plot's index before onUserChange", () => {
    const m = setup();
    let indexAtChange = -1;
    m.onUserChange.mockImplementation(() => {
      indexAtChange = m.plot.selectedProjectionIndex;
    });

    m.projectionSelect.dispatchEvent(
      new CustomEvent('projection-change', { detail: { projection: 'PCA' } }),
    );

    expect(m.onUserChange).toHaveBeenCalledWith('projection');
    expect(indexAtChange).toBe(1);
    expect(m.annotationSelect.selectedProjection).toBe('PCA');
    expect(m.projectionMetadata.projection).toBe(m.data.projections[1]);
  });

  it('an annotation pick writes the plot and clears provenance before onUserChange', () => {
    const m = setup();
    const order: string[] = [];
    m.annotationSelect.addEventListener('annotation-change', () =>
      order.push(`plot:${m.plot.selectedAnnotation}`),
    );
    m.interactionController.handleAnnotationChange.mockImplementation(() =>
      order.push('clear provenance'),
    );
    m.onUserChange.mockImplementation((kind: string) => order.push(kind));

    bubble(m.annotationSelect, m.root, 'annotation-change', { annotation: 'species' });

    // The plot was written in the picker's own listener, before the document heard the event.
    expect(order).toEqual(['plot:species', 'clear provenance', 'annotation']);
    expect(m.plot.selectedAnnotation).toBe('species');
    expect(m.projectionMetadata.selectedAnnotation).toBe('species');
  });

  it('tooltip changes reach the plot', () => {
    const m = setup();

    m.annotationSelect.dispatchEvent(
      new CustomEvent('tooltip-annotations-change', {
        detail: { tooltipAnnotations: ['species'] },
      }),
    );

    expect(m.plot.tooltipAnnotations).toEqual(['species']);
    expect(m.onUserChange).toHaveBeenCalledWith('tooltip');
  });

  it("a contours pick writes the plot's config", () => {
    const m = setup();

    m.contoursMenu.dispatchEvent(
      new CustomEvent('density-layer-change', { detail: { densityLayer: 'auto' } }),
    );

    expect(m.plot.config).toEqual({ pointSize: 80, densityLayer: 'auto' });
    expect(m.onUserChange).toHaveBeenCalledWith('density');
  });

  it('a picker event for the value the plot already shows changes nothing', () => {
    const m = setup();
    // Record every write to the plot: an equal write still re-renders (a new config object) or
    // re-syncs the legend and the URL through the change events.
    const writes: string[] = [];
    for (const key of ['selectedProjectionIndex', 'selectedAnnotation', 'config'] as const) {
      let value = m.plot[key];
      Object.defineProperty(m.plot, key, {
        get: () => value,
        set: (next) => {
          writes.push(key);
          value = next;
        },
      });
    }

    m.projectionSelect.dispatchEvent(
      new CustomEvent('projection-change', { detail: { projection: 'UMAP' } }),
    );
    m.annotationSelect.dispatchEvent(
      new CustomEvent('annotation-change', { detail: { annotation: 'family' } }),
    );
    m.contoursMenu.dispatchEvent(
      new CustomEvent('density-layer-change', { detail: { densityLayer: 'off' } }),
    );

    expect(writes).toEqual([]);
    expect(m.interactionController.handleAnnotationChange).not.toHaveBeenCalled();
    expect(m.onUserChange).not.toHaveBeenCalled();
  });

  it('showInitialView sets the pickers without events', () => {
    const m = setup();
    const projectionChange = vi.fn();
    m.projectionSelect.addEventListener('projection-change', projectionChange);

    m.controller.showInitialView({ projection: 'PCA', annotation: 'species', tooltip: ['family'] });

    expect(m.projectionSelect.selectedProjection).toBe('PCA');
    expect(m.annotationSelect.selectedAnnotation).toBe('species');
    expect(m.annotationSelect.tooltipAnnotations).toEqual(['family']);
    expect(m.annotationSelect.selectedProjection).toBe('PCA');
    expect(m.projectionSelect.applySelection).not.toHaveBeenCalled();
    expect(m.annotationSelect.applySelection).not.toHaveBeenCalled();
    expect(projectionChange).not.toHaveBeenCalled();
    expect(m.onUserChange).not.toHaveBeenCalled();
  });

  it('resetForNewDataset cancels waiting picks', () => {
    const m = setup();

    m.controller.resetForNewDataset();

    expect(m.projectionSelect.cancelPending).toHaveBeenCalledOnce();
    expect(m.annotationSelect.cancelPending).toHaveBeenCalledOnce();
    expect(m.contoursMenu.cancelPending).toHaveBeenCalledOnce();
  });

  it('data-change refreshes the options and the projection details', () => {
    const m = setup();

    m.plot.dispatchEvent(new CustomEvent('data-change', { detail: { data: m.data } }));

    expect(m.projectionSelect.projections).toEqual(['UMAP', 'PCA']);
    expect(m.annotationSelect.annotations).toEqual(['family', 'species']);
    expect(m.annotationSelect.eatAnnotations).toEqual(['family']);
    expect(m.annotationSelect.annotationDefinitions).toBe(m.data.annotations);
    // With nothing valid selected yet, the first projection and annotation, as before.
    expect(m.projectionSelect.selectedProjection).toBe('UMAP');
    expect(m.annotationSelect.selectedAnnotation).toBe('family');
    expect(m.annotationSelect.selectedProjection).toBe('UMAP');
    expect(m.projectionMetadata.projection).toBe(m.data.projections[0]);
    expect(m.projectionMetadata.selectedAnnotation).toBe('family');
    expect(m.projectionMetadata.viewIsSubset).toBe(false);
  });

  it('the view pickers read and write through the pickers', () => {
    const m = setup();
    m.projectionSelect.selectedProjection = 'UMAP';
    m.annotationSelect.selectedAnnotation = 'family';
    m.annotationSelect.tooltipAnnotations = ['species'];

    expect(m.controller.selectedProjection).toBe('UMAP');
    expect(m.controller.selectedAnnotation).toBe('family');
    expect(m.controller.tooltipAnnotations).toEqual(['species']);

    m.controller.applyProjectionSelection('PCA');
    expect(m.projectionSelect.applySelection).toHaveBeenCalledWith('PCA');
    expect(m.plot.selectedProjectionIndex).toBe(1);
    m.controller.applyAnnotationSelection('species');
    expect(m.annotationSelect.applySelection).toHaveBeenCalledWith('species');
    m.controller.applyTooltipAnnotationsSelection(['family']);
    expect(m.annotationSelect.applyTooltipSelection).toHaveBeenCalledWith(['family']);
    m.controller.applyDensityLayerSelection('on');
    expect(m.contoursMenu.applySelection).toHaveBeenCalledWith('on');
  });

  it('dispose stops listening', () => {
    const m = setup();
    m.controller.dispose();

    m.projectionSelect.dispatchEvent(
      new CustomEvent('projection-change', { detail: { projection: 'PCA' } }),
    );
    bubble(m.annotationSelect, m.root, 'annotation-change', { annotation: 'species' });

    expect(m.onUserChange).not.toHaveBeenCalled();
    expect(m.plot.selectedProjectionIndex).toBe(0);
  });
});

describe('view-bar controller status', () => {
  beforeEach(() => {
    resetWorkbenchStatusForTests();
  });

  it('reports the contour mode to the workbench status', () => {
    const m = setup();

    m.contoursMenu.dispatchEvent(
      new CustomEvent('density-layer-change', { detail: { densityLayer: 'auto' } }),
    );
    expect(getWorkbenchStatus().densityLayer).toBe('auto');

    // A mode applied from the URL, then a new dataset's view: the menu keeps its mode, and the
    // status reports what the menu shows. (Task 2.8's fake applySelection sets densityLayer,
    // as the element does.)
    m.controller.applyDensityLayerSelection('on');
    expect(getWorkbenchStatus().densityLayer).toBe('on');
    m.contoursMenu.densityLayer = 'auto';
    m.controller.showInitialView({ projection: 'UMAP', annotation: 'family', tooltip: [] });
    expect(getWorkbenchStatus().densityLayer).toBe('auto');
  });
});
