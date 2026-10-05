/**
 * Shared setup for the scatter-plot element suites. A plot here is created and never
 * appended, so Lit's lifecycle never runs and a suite drives the private steps itself.
 */
import { vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { createMockCanvas } from '../webgl/renderer/test-support/mock-webgl2';
import type { ProtspaceScatterplot } from '../scatter-plot';
import '../scatter-plot';

// jsdom has no ResizeObserver, and the element constructs one.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

type Host = ProtspaceScatterplot;

/**
 * The element, with the private members the suites reach into made public. Each one is
 * typed from the element, so a rename fails type-check here instead of in no suite.
 * `keyof` leaves private members out, which is what lets them be redeclared.
 */
export type PlotInternals = Pick<Host, keyof Host> & {
  _buildPointGridIndex: Host['_buildPointGridIndex'];
  _buildStyleGetters: Host['_buildStyleGetters'];
  _canvas: Host['_canvas'];
  _colorMapping: Host['_colorMapping'];
  _commitSelection: Host['_commitSelection'];
  _commitSelectionRafId: Host['_commitSelectionRafId'];
  _connectorOverlay: Host['_connectorOverlay'];
  _connectorStatus: Host['_connectorStatus'];
  _createWebglRenderer: Host['_createWebglRenderer'];
  _dupOverlay: Host['_dupOverlay'];
  _flushRender: Host['_flushRender'];
  _focusedValues: Host['_focusedValues'];
  _formatConnectorStatus: Host['_formatConnectorStatus'];
  _getCurrentDisplayData: Host['_getCurrentDisplayData'];
  _getInteractableProteinIds: Host['_getInteractableProteinIds'];
  _getMaterializedData: Host['_getMaterializedData'];
  _getPointMarks: Host['_getPointMarks'];
  _getPointsForRendering: Host['_getPointsForRendering'];
  _getStageGetters: Host['_getStageGetters'];
  _getStyleGetters: Host['_getStyleGetters'];
  _getVisibilityModel: Host['_getVisibilityModel'];
  _getVisiblePointCount: Host['_getVisiblePointCount'];
  _getVisibleSlots: Host['_getVisibleSlots'];
  _handleCanvasMouseMove: Host['_handleCanvasMouseMove'];
  _handleColorMappingChange: Host['_handleColorMappingChange'];
  _handleShiftKey: Host['_handleShiftKey'];
  _handleWebglContextLost: Host['_handleWebglContextLost'];
  _handleWindowBlur: Host['_handleWindowBlur'];
  _handleZOrderChange: Host['_handleZOrderChange'];
  _hoveredProteinId: Host['_hoveredProteinId'];
  _hoverRaf: Host['_hoverRaf'];
  _interactableProteinIdsCache: Host['_interactableProteinIdsCache'];
  _interaction: Host['_interaction'];
  _interactionHost: Host['_interactionHost'];
  _invalidateScalesCache: Host['_invalidateScalesCache'];
  _isolationHistory: Host['_isolationHistory'];
  _isolationMode: Host['_isolationMode'];
  _measureTooltipHeight: Host['_measureTooltipHeight'];
  _mergedConfig: Host['_mergedConfig'];
  _numericRecomputeRunning: Host['_numericRecomputeRunning'];
  _pendingHover: Host['_pendingHover'];
  _plotData: Host['_plotData'];
  _plotDataBuild: Host['_plotDataBuild'];
  _pointGridIndex: Host['_pointGridIndex'];
  _pointMarks: Host['_pointMarks'];
  _processData: Host['_processData'];
  _rebuildStyle: Host['_rebuildStyle'];
  _reconcileConfigMerge: Host['_reconcileConfigMerge'];
  _reconcileProvenanceConnectors: Host['_reconcileProvenanceConnectors'];
  _reconcileSelectionOverlays: Host['_reconcileSelectionOverlays'];
  _refreshSelectedAnnotationValues: Host['_refreshSelectedAnnotationValues'];
  _renderPlot: Host['_renderPlot'];
  _renderWebGL: Host['_renderWebGL'];
  _reprocessAndRefresh: Host['_reprocessAndRefresh'];
  _requestRender: Host['_requestRender'];
  _runNumericRecomputeBody: Host['_runNumericRecomputeBody'];
  readonly _scales: Host['_scales'];
  _scalesCache: Host['_scalesCache'];
  _scalesKey: Host['_scalesKey'];
  _scheduleIdIndex: Host['_scheduleIdIndex'];
  _scheduleNumericAnnotationRefresh: Host['_scheduleNumericAnnotationRefresh'];
  _schedulePointGridIndexRebuild: Host['_schedulePointGridIndexRebuild'];
  _scheduleVisibleSlotsRefresh: Host['_scheduleVisibleSlotsRefresh'];
  _shapeMapping: Host['_shapeMapping'];
  _slotSelection: Host['_slotSelection'];
  _slotsToInteractiveIds: Host['_slotsToInteractiveIds'];
  _sparseIndex: Host['_sparseIndex'];
  _styleGettersCache: Host['_styleGettersCache'];
  _svg: Host['_svg'];
  _tooltipData: Host['_tooltipData'];
  _tooltipHeight: Host['_tooltipHeight'];
  _tooltipMeasureToken: Host['_tooltipMeasureToken'];
  _transform: Host['_transform'];
  _unmarkedGetters: Host['_unmarkedGetters'];
  _updateSelectionOverlays: Host['_updateSelectionOverlays'];
  _updateSizeAndRender: Host['_updateSizeAndRender'];
  _visibleIndex: Host['_visibleIndex'];
  _visibleSlots: Host['_visibleSlots'];
  _webglRenderer: Host['_webglRenderer'];
  _zOrderMapping: Host['_zOrderMapping'];
};

/** An unattached plot with `inputs` set. */
export function createPlot(inputs: Partial<PlotInternals> = {}): PlotInternals {
  const el = document.createElement('protspace-scatterplot') as unknown as PlotInternals;
  return Object.assign(el, inputs);
}

/**
 * `createPlot(inputs)` with its data processed, a real WebGLRenderer on the mock WebGL2
 * canvas, and one render drawn.
 */
export function mountPlot(inputs: Partial<PlotInternals>): PlotInternals {
  const el = createPlot(inputs);
  el._processData();
  const { canvas } = createMockCanvas();
  Object.defineProperty(el, '_canvas', { configurable: true, get: () => canvas });
  el._createWebglRenderer();
  el._requestRender();
  el._flushRender();
  return el;
}

interface FamilyDataOptions {
  n?: number;
  idPrefix?: string;
  /** Two family names and their colours. */
  families?: Record<string, string>;
  /** Distance between neighbours along the diagonal. */
  spacing?: number;
  /** A second categorical annotation, `other`, equal to `fam`, to switch to. */
  other?: boolean;
  /** A numeric column, `score`, never selected: with it, materializing returns a fresh object. */
  score?: boolean;
}

/**
 * `n` proteins on the diagonal, the first half (rounded up) in the first family and the
 * rest in the second, annotated as `fam`. Each row stores its own family name in `values`
 * and points at the first row with that name.
 */
export function makeFamilyData({
  n = 6,
  idPrefix = 'p',
  families = { A: '#ff0000', B: '#00ff00' },
  spacing = 1,
  other = false,
  score = false,
}: FamilyDataOptions = {}): VisualizationData {
  const [first, second] = Object.keys(families);
  const fams = Array.from({ length: n }, (_, i) => (i < Math.ceil(n / 2) ? first : second));
  const coords = Float32Array.from({ length: n * 2 }, (_, k) => Math.floor(k / 2) * spacing);
  const column = () => ({
    values: fams,
    colors: fams.map((f) => families[f]),
    shapes: fams.map(() => 'circle'),
  });
  const rows = () => fams.map((f) => [fams.indexOf(f)]);
  return {
    protein_ids: fams.map((_, i) => `${idPrefix}${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: { fam: column(), ...(other && { other: column() }) },
    annotation_data: { fam: rows(), ...(other && { other: rows() }) },
    ...(score && { numeric_annotation_data: { score: Float64Array.from(fams, (_, i) => i) } }),
  } as unknown as VisualizationData;
}

/**
 * Queues `requestAnimationFrame` callbacks until the suite runs a frame, and makes
 * `cancelAnimationFrame` remove one, as the browser does. `vi.unstubAllGlobals()` undoes it.
 */
export function fakeFrames() {
  const queued = new Map<number, FrameRequestCallback>();
  let lastId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queued.set(++lastId, cb);
    return lastId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queued.delete(id);
  });
  /** One frame: the callbacks queued before it that are still queued when their turn comes. */
  const run = () => {
    for (const id of [...queued.keys()]) {
      const cb = queued.get(id);
      queued.delete(id);
      cb?.(performance.now());
    }
  };
  return {
    run,
    /** Frames until none is queued. */
    flush() {
      for (let frame = 0; queued.size > 0; frame++) {
        if (frame === 100) throw new Error('frames never stop');
        run();
      }
    },
    clear: () => queued.clear(),
    get size() {
      return queued.size;
    },
  };
}
