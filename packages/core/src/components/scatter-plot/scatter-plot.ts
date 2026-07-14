import { LitElement, html } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import * as d3 from 'd3';
import type {
  VisualizationData,
  PlotData,
  PlotDataPoint,
  ScatterplotConfig,
  NumericAnnotationDisplaySettingsMap,
  TooltipView,
} from '@protspace/utils';
import {
  DataProcessor,
  buildTooltipView,
  materializeVisualizationData,
  sliceVisualizationDataByIndices,
  EMPTY_PLOT_DATA,
  clonePlotData,
  plotDataId,
  materializePlotDataPoint,
  gatherPlotData,
  materializeEatOverlay,
} from '@protspace/utils';
import type { ScalePair } from '@protspace/utils';
import type { LegendSortMode } from '../legend/types';
import {
  isLegendColorMappingDetail,
  isLegendZOrderDetail,
  type LegendColorMappingChangeEvent,
  type LegendZOrderChangeEvent,
} from '../legend/legend-mapping-events';
import { scatterplotStyles } from './scatter-plot.styles';
import './projection-metadata/projection-metadata';
import './tooltips/protspace-tips';
import './tooltips/protein-tooltip';
import { DEFAULT_CONFIG } from './config';
import { createStyleGetters } from './styling/style-getters';
import { computeVisibilityModel } from './styling/visibility-model';
import type { VisibilityModel } from './styling/visibility-model';
import { MAX_POINTS_DIRECT_RENDER, WebGLRenderer } from './webgl';
import { QuadtreeIndex } from './interaction/quadtree-index';
import { computeViewportWindow, buildViewKey } from './duplicate-stacks/duplicate-stack-viewport';
import { DuplicateStackOverlayController } from './duplicate-stacks/duplicate-stack-overlay-controller';
import { estimateTooltipHeight } from './tooltips/tooltip-height-estimate';
import { computeTooltipStyle, TOOLTIP_FALLBACK_HEIGHT } from './tooltips/tooltip-position';
import { NumericRecomputeRunner } from './styling/numeric-recompute-runner';
import {
  WebglRenderPerfRunner,
  type PerfDatasetInfo,
  type RenderWebGLTrigger,
} from './webgl-render-perf';
import {
  PlotInteractionController,
  type PlotInteractionHost,
} from './interaction/plot-interaction-controller';
import {
  ConnectorOverlayController,
  type ProvenanceConnectorRequest,
  type ProvenanceConnectorStatus,
} from './provenance/connector-overlay-controller';

export type {
  ProvenanceConnectorPair,
  ProvenanceConnectorRequest,
  ProvenanceConnectorStatus,
} from './provenance/connector-overlay-controller';

// Visualization is only needed for viewport culling on very large datasets.
// For <= MAX_POINTS_DIRECT_RENDER we can render the full set once and then pan/zoom via uniforms
// (no per-frame quadtree queries or buffer rebuilds), which is substantially faster for ~500k points.
const VIRTUALIZATION_THRESHOLD = MAX_POINTS_DIRECT_RENDER;
const VIRTUALIZATION_PADDING = 100;

// Hit-test tuning (shared by hover + click). Search radius is in screen px and
// is divided by the zoom factor so the data-space radius stays constant; the
// point radius is derived from point size (sqrt(size)/3 matches the WebGL draw).
const HIT_TEST_SEARCH_RADIUS_PX = 15;
const POINT_RADIUS_SIZE_DIVISOR = 3;

/** Default number of bins for numeric→categorical materialization. Mirrors
 *  materializeVisualizationData's `defaultBinCount = 10` default. */
const DEFAULT_NUMERIC_BIN_COUNT = 10;

/**
 * Memoization key for `_getVisibilityModel`. Stored as a plain struct so each
 * field is compared by strict equality (===) in the guard in that method.
 * An identity-compared object or array ref cannot go into a string hash —
 * the coercion loses identity and causes spurious cache hits — so the struct
 * approach is the correct trade-off here.
 */
type VisibilityModelMemoKey = {
  data: VisualizationData | null;
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  baseOpacity: number;
  selectedOpacity: number;
  fadedOpacity: number;
  eatOverlayEnabled: boolean;
  eatConfidenceThreshold: number;
};

// Default configuration moved to config.ts

/**
 * High-performance WebGL-based scatterplot component for large datasets.
 * Uses WebGL for rendering and SVG overlay for interactions.
 */
@customElement('protspace-scatterplot')
export class ProtspaceScatterplot extends LitElement {
  static styles = scatterplotStyles;

  // Properties
  @property({ type: Object }) data: VisualizationData | null = null;
  @property({ type: Number }) selectedProjectionIndex = 0;
  @property({ type: String }) projectionPlane: 'xy' | 'xz' | 'yz' = 'xy';
  @property({ type: String }) selectedAnnotation = 'family';
  @property({ type: Array }) tooltipAnnotations: string[] = [];
  @property({ type: Array }) highlightedProteinIds: string[] = [];
  @property({ type: Array }) selectedProteinIds: string[] = [];
  @property({ type: Boolean }) selectionMode = false;
  @property({ type: String, attribute: 'selection-tool' })
  selectionTool: 'rectangle' | 'lasso' = 'rectangle';
  @property({ type: Array }) hiddenAnnotationValues: string[] = [];
  @property({ type: Array }) otherAnnotationValues: string[] = [];
  @property({ type: Object }) numericAnnotationSettings: NumericAnnotationDisplaySettingsMap = {};
  @property({ type: Object }) annotationSortModes: Record<string, LegendSortMode> = {};
  @property({ type: Object }) numericManualOrderIdsByAnnotation: Record<string, string[]> = {};
  @property({ type: Array }) filteredProteinIds: string[] = [];
  @property({ type: Boolean, attribute: 'filters-active' }) filtersActive = false;
  @property({ type: Object }) config: Partial<ScatterplotConfig> = {};
  @property({ type: Boolean, attribute: 'show-tour-button' }) showTourButton = false;
  @property({ type: Boolean, attribute: 'eat-overlay-enabled' }) eatOverlayEnabled = true;
  @property({ type: Number, attribute: 'eat-confidence-threshold' })
  eatConfidenceThreshold = 0.5;

  // State
  @state() private _plotData: PlotData = EMPTY_PLOT_DATA;
  @state() private _tooltipData: {
    x: number;
    y: number;
    view: TooltipView;
  } | null = null;
  @state() private _tooltipHeight: number | null = null;
  @state() private _mergedConfig = DEFAULT_CONFIG;
  // Plain field, NOT @state: render() never reads _transform (it drives the
  // canvas imperatively via the zoom RAF + d3 attr()), so reactivity here only
  // caused a redundant per-frame updated()/_renderPlot() pass (F-48). The
  // getter closures passed to WebGLRenderer and the duplicate-overlay/hit-test
  // reads are pull-based and keep working unchanged.
  private _transform = d3.zoomIdentity;
  @state() private _isolationHistory: string[][] = [];
  @state() private _isolationMode = false;
  private _zOrderMapping: Record<string, number> | null = null;
  private _colorMapping: Record<string, string> | null = null;
  private _shapeMapping: Record<string, string> | null = null;
  @state() private _canvasKey = 0;
  @state() private _numericRecomputeRunning = false;
  @state() private _connectorStatus: ProvenanceConnectorStatus | null = null;

  // Queries
  @query('canvas') private _canvas?: HTMLCanvasElement;
  @query('canvas.badges-canvas') private _badgesCanvas?: HTMLCanvasElement;
  @query('svg') private _svg!: SVGSVGElement;

  // Internal
  private _quadtreeIndex: QuadtreeIndex = new QuadtreeIndex();
  private resizeObserver: ResizeObserver;
  // d3 zoom/brush/lasso lifecycle, the three SVG groups, and the zoom/lasso RAF
  // loops live in the controller (F-07). Constructed in firstUpdated. Event
  // dispatch + the transform field stay on the host (INV-03/INV-05, F-48).
  private _interaction: PlotInteractionController | null = null;
  private _webglRenderer: WebGLRenderer | null = null;
  private _styleSig: string | null = null;
  private _styleGettersCache: ReturnType<typeof createStyleGetters> | null = null;
  // Deliberately NOT cleared to `null` by event handlers (unlike _styleGettersCache,
  // which is nulled out on color/shape mapping changes). The key comparison in
  // _getVisibilityModel covers every visibility-relevant input exhaustively:
  // data, selectedAnnotation, hiddenAnnotationValues, selectedProteinIds,
  // highlightedProteinIds, and the three opacity numbers. There are no deps on
  // colorMapping, zOrderMapping, otherAnnotationValues, or sizes that would
  // require event-handler invalidation — those inputs do not feed into the
  // visibility model.
  private _visibilityModelCache: VisibilityModel | null = null;
  private _visibilityModelKey: VisibilityModelMemoKey | null = null;
  // Memoized INTERACTIVE plot ids (opacityOf > 0), shared by the bottom-left
  // count and provenance interaction. Keyed on the visibility inputs that affect interactivity: the
  // hidden-mask inputs (data, selectedAnnotation, hiddenAnnotationValues)
  // AND selection/highlight + the three opacities, because a configured
  // fadedOpacity of 0 makes non-selected points non-interactive, so a
  // selection change CAN change the count. Plot-data is keyed by
  // (originalIndices ref + length), NOT the container ref: a projection
  // switch clones _plotData (new container, same originalIndices) and must
  // reuse the cache since interactivity is independent of x/y coordinates.
  private _interactableProteinIdsCache: ReadonlySet<string> | null = null;
  private _visiblePointCountKey: {
    originalIndices: Int32Array | null;
    plotLength: number;
    data: VisualizationData | null;
    selectedAnnotation: string;
    hiddenAnnotationValues: string[];
    selectedProteinIds: string[] | null;
    highlightedProteinIds: string[] | null;
    baseOpacity: number;
    selectedOpacity: number;
    fadedOpacity: number;
    eatOverlayEnabled: boolean;
  } | null = null;
  private _quadtreeRebuildRafId: number | null = null;
  // F-17: advanced on every quadtree rebuild and folded into the virtualization
  // cacheKey so a rebuild forces a miss even when the transform is unchanged
  // (otherwise un-hidden points stay missing until a pan/zoom changes the key).
  private _quadtreeGeneration = 0;
  private _hoverRaf: number | null = null;
  private _commitSelectionRafId: number | null = null;
  private _pendingHover: { event: MouseEvent; mouseX: number; mouseY: number } | null = null;
  private _visiblePlotData: PlotData = EMPTY_PLOT_DATA;
  private _scratchPoint: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  private _virtualizationCacheKey: string | null = null;
  private _hoveredProteinId: string | null = null;
  private _cachedScales: ScalePair | null = null;
  private _scalesCacheDeps: {
    plotDataLength: number;
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
  } | null = null;

  // Duplicate-stack / spiderfy / badge overlay subsystem (state + schedulers +
  // chunked compute + badge canvas + spiderfy SVG layer). Event dispatch stays
  // on the host via the onPointActivate/onHover/onHoverEnd callbacks (INV-05/INV-03).
  private _dupOverlay = new DuplicateStackOverlayController({
    getOverlayGroup: () => this._interaction?.overlayGroup ?? null,
    getBadgesCanvas: () => this._badgesCanvas,
    getTransform: () => this._transform,
    getConfig: () => this._mergedConfig,
    getScales: () => this._scales,
    getPlotData: () => this._plotData,
    getQuadtree: () => this._quadtreeIndex,
    isEnabled: () => !!this._mergedConfig.enableDuplicateStackUI,
    isSelectionMode: () => this.selectionMode,
    getColor: (p) => this._getColors(p)[0] ?? '#888888',
    onPointActivate: (e, p) => this._handleClick(e, p),
    onHover: (e, p) => this._handleMouseOver(e, p),
    onHoverEnd: () => this._clearHoverState(),
  });

  private _connectorOverlay = new ConnectorOverlayController({
    getOverlayGroup: () => this._interaction?.overlayGroup ?? null,
    getPlotData: () => this._plotData,
    getScales: () => this._scales,
    onStatusChange: (status) => {
      if (
        this._connectorStatus?.shown === status?.shown &&
        this._connectorStatus?.total === status?.total &&
        this._connectorStatus?.missingEndpoints === status?.missingEndpoints
      ) {
        return;
      }
      this._connectorStatus = status;
    },
  });

  private _webglRenderPerf = new WebglRenderPerfRunner(this);

  // Monotonically-increasing token used to invalidate a pending async tooltip-height
  // measurement when a newer hover or a tooltip-clear supersedes it before the child
  // LitElement has finished rendering.
  private _tooltipMeasureToken = 0;

  // Monotonically-increasing token used to invalidate a pending WebGL context-loss
  // recovery microtask when a newer loss supersedes it, or when the element detaches
  // before updateComplete resolves (route change is a common GPU-recycle trigger).
  private _webglRecoveryToken = 0;

  // Track data reference to detect projection-only changes (same data object, different projection index).
  private _lastDataRef: VisualizationData | null = null;
  // Whether the current _plotData was built with a cull (filter or isolation).
  // The coordinate-only fast path must not run over a culled build: it can never
  // restore removed points, so clearing a filter would leave the canvas showing
  // the old subset while the legend (fed from getCurrentData()) shows everything.
  private _plotDataWasCulled = false;
  private _lastMaterializedSource: VisualizationData | null = null;
  private _lastMaterializedNumericValues: Array<number | null> | null = null;
  private _materializedDataCacheKey: string | null = null;
  private _materializedDataCache: VisualizationData | null = null;
  // F-40: memoize the filtered display-data rebuild. Keyed by reference on the
  // same inputs the filtered slice depends on so repeated reads with unchanged
  // inputs reuse the prior VisualizationData instead of reallocating.
  private _filteredDisplayCache: VisualizationData | null = null;
  private _filteredDisplayCacheDeps: {
    materialized: VisualizationData | null;
    filteredProteinIds: string[];
    filtersActive: boolean;
    selectedProjectionIndex: number;
    projectionPlane: 'xy' | 'xz' | 'yz';
  } | null = null;
  // Fast-path keys for _getMaterializedData: avoid JSON.stringify on the hot
  // per-point path (getOpacity -> visibility model -> materialized data). These
  // mirror the JSON cacheKey's reference/primitive inputs so a hit can return
  // the cached object before serializing. numericAnnotationSettings is replaced
  // wholesale, so comparing the selected annotation's settings ref is sound
  // (a numeric rebin yields a new ref -> fast-path miss -> JSON path re-materializes).
  private _lastMaterializedSelectedAnnotation: string | null = null;
  private _lastMaterializedEatOverlayEnabled = true;
  private _lastMaterializedSelectedSettings:
    | NumericAnnotationDisplaySettingsMap[string]
    | undefined = undefined;
  private _numericRecompute = new NumericRecomputeRunner({
    hasData: () => !!this.data,
    getSelectedAnnotation: () => this.selectedAnnotation,
    setRunning: (running) => {
      this._numericRecomputeRunning = running;
    },
    runRecompute: () => this._runNumericRecomputeBody(),
  });

  // Computed properties with caching
  private get _scales(): ScalePair | null {
    const config = this._mergedConfig;

    // Check if cache is valid
    const needsRecompute =
      !this._cachedScales ||
      !this._scalesCacheDeps ||
      this._scalesCacheDeps.plotDataLength !== this._plotData.length ||
      this._scalesCacheDeps.width !== config.width ||
      this._scalesCacheDeps.height !== config.height ||
      this._scalesCacheDeps.margin.top !== config.margin.top ||
      this._scalesCacheDeps.margin.right !== config.margin.right ||
      this._scalesCacheDeps.margin.bottom !== config.margin.bottom ||
      this._scalesCacheDeps.margin.left !== config.margin.left;

    if (needsRecompute) {
      const computedScales = DataProcessor.createScales(
        this._plotData,
        config.width,
        config.height,
        config.margin,
      );
      this._cachedScales = computedScales;
      this._scalesCacheDeps = {
        plotDataLength: this._plotData.length,
        width: config.width,
        height: config.height,
        margin: { ...config.margin },
      };
    }

    return this._cachedScales;
  }

  private _invalidateScalesCache() {
    this._cachedScales = null;
    this._scalesCacheDeps = null;
  }

  private _getMaterializedData(): VisualizationData | null {
    if (!this.data) return null;

    const sourceData = this.data;
    const selectedNumericValues = this.selectedAnnotation
      ? sourceData.numeric_annotation_data?.[this.selectedAnnotation]
      : undefined;
    const selectedNumericValuesCacheRef = selectedNumericValues ?? null;
    const selectedNumericSettings = this.selectedAnnotation
      ? this.numericAnnotationSettings?.[this.selectedAnnotation]
      : undefined;

    // Cheap reference/primitive fast-path: on a hit, return the cached object
    // without the JSON.stringify below. Keyed on the same reference/primitive
    // inputs the JSON cacheKey uses (selectedNumericType and
    // selectedNumericValuesLength are derived from data + selectedAnnotation,
    // both covered here). Reached per-point from the WebGL staging loops.
    if (
      this._materializedDataCache &&
      this._lastMaterializedSource === this.data &&
      this._lastMaterializedNumericValues === selectedNumericValuesCacheRef &&
      this._lastMaterializedSelectedAnnotation === this.selectedAnnotation &&
      this._lastMaterializedEatOverlayEnabled === this.eatOverlayEnabled &&
      this._lastMaterializedSelectedSettings === selectedNumericSettings
    ) {
      return this._materializedDataCache;
    }

    const selectedNumericAnnotation = this.selectedAnnotation
      ? sourceData.annotations[this.selectedAnnotation]
      : undefined;
    const selectedNumericType =
      selectedNumericAnnotation?.numericType ??
      selectedNumericAnnotation?.numericMetadata?.numericType ??
      null;

    const cacheKey = JSON.stringify({
      dataRef: this.data.protein_ids.length,
      selectedAnnotation: this.selectedAnnotation,
      selectedNumericValuesLength: selectedNumericValues?.length ?? 0,
      selectedNumericType,
      numericAnnotationSettings: selectedNumericSettings ?? null,
      annotationKeys: Object.keys(sourceData.annotations),
      eatOverlayEnabled: this.eatOverlayEnabled,
    });

    if (
      this._lastMaterializedSource === this.data &&
      this._lastMaterializedNumericValues === selectedNumericValuesCacheRef &&
      this._materializedDataCacheKey === cacheKey &&
      this._materializedDataCache
    ) {
      return this._materializedDataCache;
    }

    this._materializedDataCache = materializeEatOverlay(
      materializeVisualizationData(
        sourceData,
        this.numericAnnotationSettings,
        DEFAULT_NUMERIC_BIN_COUNT,
        this.selectedAnnotation,
      ),
      this.selectedAnnotation,
      this.eatOverlayEnabled,
    );
    this._lastMaterializedSource = this.data;
    this._lastMaterializedNumericValues = selectedNumericValuesCacheRef;
    this._lastMaterializedSelectedAnnotation = this.selectedAnnotation ?? null;
    this._lastMaterializedEatOverlayEnabled = this.eatOverlayEnabled;
    this._lastMaterializedSelectedSettings = selectedNumericSettings;
    this._materializedDataCacheKey = cacheKey;
    return this._materializedDataCache;
  }

  private _getVisibleProteinIdsSet(): Set<string> | null {
    if (!this.filtersActive) return null;
    return new Set(this.filteredProteinIds);
  }

  /** INV-11: the exact set of reactive inputs that affect rendered geometry. */
  private _geometryInputsChanged(changed: Map<string, unknown>): boolean {
    return (
      changed.has('data') ||
      changed.has('filteredProteinIds') ||
      changed.has('filtersActive') ||
      changed.has('selectedProjectionIndex') ||
      changed.has('projectionPlane')
    );
  }

  constructor() {
    super();
    this.resizeObserver = new ResizeObserver(() => this._updateSizeAndRender());
  }

  private _syncWebglSelectionActive() {
    this._webglRenderer?.setSelectionActive(
      this.selectedProteinIds.length > 0 || this.highlightedProteinIds.length > 0,
    );
  }

  private _handleWebglContextLost = () => {
    this._webglRenderer?.destroy();
    this._webglRenderer = null;
    this._canvasKey += 1;
    const token = ++this._webglRecoveryToken;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (token !== this._webglRecoveryToken || !this.isConnected) return;
      this._updateSizeAndRender();
    });
  };

  /**
   * F-35/F-11: single construction point for the WebGL renderer. Both firstUpdated
   * and the lazy _updateSizeAndRender path route through here so the renderer is
   * built exactly once (firstUpdated previously orphaned the renderer that
   * _updateSizeAndRender had just created). Requires _canvas to be present.
   */
  private _createWebglRenderer() {
    if (!this._canvas) return;
    this._webglRenderer = new WebGLRenderer(
      this._canvas,
      () => this._scales,
      () => this._transform,
      () => this._mergedConfig,
      {
        getColors: (p: PlotDataPoint) => this._getColors(p),
        getPointSize: (p: PlotDataPoint) => this._getPointSize(p),
        getOpacity: (p: PlotDataPoint) => this._getOpacity(p),
        getDepth: (p: PlotDataPoint) => this._getDepth(p),
        getShape: (p: PlotDataPoint) => this._getPointShape(p),
        isPredicted: (p: PlotDataPoint) => this._getStyleGetters().isPredicted(p),
      },
      this._handleWebglContextLost,
    );
    this._updateStyleSignature();
    this._webglRenderer.setStyleSignature(this._styleSig);
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver.observe(this);

    this.addEventListener('legend-zorder-change', this._handleZOrderChange);
    this.addEventListener('legend-colormapping-change', this._handleColorMappingChange);
    this.addEventListener('dragover', this.handleDragOver);
    this.addEventListener('dragenter', this.handleDragEnter);
    this.addEventListener('dragleave', this.handleDragLeave);
    this.addEventListener('drop', this.handleDrop);
    window.addEventListener('keydown', this._handleConnectorKeydown);
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    if (this._quadtreeRebuildRafId !== null) {
      cancelAnimationFrame(this._quadtreeRebuildRafId);
      this._quadtreeRebuildRafId = null;
    }
    if (this._hoverRaf !== null) {
      cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = null;
    }
    if (this._commitSelectionRafId !== null) {
      cancelAnimationFrame(this._commitSelectionRafId);
      this._commitSelectionRafId = null;
    }
    this._pendingHover = null;
    this._numericRecompute.cancel();
    this._dupOverlay.cancelDebounce();
    this._dupOverlay.cancelCompute();
    this._dupOverlay.clearBadges();
    this._connectorOverlay.clear();
    this._webglRenderer?.destroy();
    // Cancels the zoom/lasso RAFs, interrupts the reset transition, and tears
    // down the d3 brush + lasso (F-07).
    this._interaction?.teardown();

    super.disconnectedCallback();
    this.removeEventListener('legend-zorder-change', this._handleZOrderChange);
    this.removeEventListener('legend-colormapping-change', this._handleColorMappingChange);
    this.removeEventListener('dragover', this.handleDragOver);
    this.removeEventListener('dragenter', this.handleDragEnter);
    this.removeEventListener('dragleave', this.handleDragLeave);
    this.removeEventListener('drop', this.handleDrop);
    window.removeEventListener('keydown', this._handleConnectorKeydown);
  }

  private _handleConnectorKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this._connectorOverlay.hasActiveRequest()) {
      this.clearProvenanceConnectors();
    }
  };

  private handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    this.setAttribute('dragging', '');
  };

  private handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    this.setAttribute('dragging', '');
  };

  private handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    this.removeAttribute('dragging');
  };

  private handleDrop = (e: DragEvent) => {
    e.preventDefault();
    this.removeAttribute('dragging');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      this.dispatchEvent(
        new CustomEvent('file-dropped', {
          detail: { file: files[0] },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  private _handleZOrderChange = (event: Event) => {
    const { detail } = event as LegendZOrderChangeEvent;
    if (!isLegendZOrderDetail(detail)) return; // F-19: skip rather than overwrite GPU state with undefined
    this._zOrderMapping = detail.zOrderMapping;
    // z-order affects GPU depth; force a fresh style getter cache so getDepth sees the new mapping
    this._styleGettersCache = null;

    if (this._plotData.length > 0) {
      // Z-order mapping changed but coordinates didn't — re-sort by depth without
      // invalidating the position cache. Single render path (F-31): these fields are
      // plain (not @state), so updated()'s catch-all never fires a second render.
      this._webglRenderer?.invalidateDepthOrder();
      this._webglRenderer?.invalidateStyleCache();
      this._renderPlot();
    }
  };

  private _handleColorMappingChange = (event: Event) => {
    const { detail } = event as LegendColorMappingChangeEvent;
    if (!isLegendColorMappingDetail(detail)) return; // F-19
    this._colorMapping = detail.colorMapping;
    this._shapeMapping = detail.shapeMapping;
    const colorOnly = detail.colorOnly ?? false;

    // Force fresh style getters to use new color/shape mapping
    this._styleGettersCache = null;

    if (this._plotData.length > 0) {
      // INV-08: color-only changes skip depth re-sort + virtualization invalidation.
      if (!colorOnly) {
        this._webglRenderer?.invalidateDepthOrder();
        this._invalidateVirtualizationCache();
      }
      this._webglRenderer?.invalidateStyleCache();
      this._renderPlot(); // single render path (F-31)
    }
  };

  updated(changedProperties: Map<string, unknown>) {
    this._reconcileSelectionDefaults(changedProperties);
    this._reconcileFilterOnDataSwap(changedProperties);
    this._reprocessGeometryIfNeeded(changedProperties);
    if (
      changedProperties.has('numericAnnotationSettings') &&
      !this._geometryInputsChanged(changedProperties) &&
      this.data
    ) {
      this._scheduleNumericAnnotationRefresh();
    }
    this._reconcileConfigMerge(changedProperties);
    this._rebuildStyleAndSignature(changedProperties);
    this._reconcileSelectionMode(changedProperties);
    this._reconcileProvenanceConnectors(changedProperties);
    this._refreshStyleGettersCache(changedProperties);
    this._reconcileSelectionOverlays(changedProperties);
    this._reconcileTooltipMeasurement(changedProperties);
    if (this.data && changedProperties.has('eatOverlayEnabled')) {
      this.dispatchEvent(
        new CustomEvent('data-change', {
          detail: { data: this.getCurrentData() ?? this._getMaterializedData() ?? this.data },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _reconcileProvenanceConnectors(changedProperties: Map<string, unknown>): void {
    const contextChanged =
      changedProperties.has('data') ||
      changedProperties.has('selectedAnnotation') ||
      changedProperties.has('hiddenAnnotationValues') ||
      (changedProperties.has('eatOverlayEnabled') && !this.eatOverlayEnabled) ||
      (changedProperties.has('selectedProteinIds') && this.selectedProteinIds.length === 0);
    if (contextChanged) {
      this.clearProvenanceConnectors();
      return;
    }

    if (
      changedProperties.has('_plotData') ||
      changedProperties.has('selectedProjectionIndex') ||
      changedProperties.has('projectionPlane') ||
      changedProperties.has('filteredProteinIds') ||
      changedProperties.has('filtersActive') ||
      changedProperties.has('config')
    ) {
      this._connectorOverlay.render();
    }
  }

  /**
   * INV-10: when new data is loaded (or projection index changes), ensure the
   * selection is valid. This prevents a blank plot when switching from a dataset
   * with many projections/annotations to one with only a single projection/annotation.
   */
  private _reconcileSelectionDefaults(changedProperties: Map<string, unknown>) {
    if (
      (changedProperties.has('data') || changedProperties.has('selectedProjectionIndex')) &&
      this.data
    ) {
      const projectionsCount = Array.isArray(this.data.projections)
        ? this.data.projections.length
        : 0;
      if (!Number.isFinite(this.selectedProjectionIndex)) {
        this.selectedProjectionIndex = 0;
      } else if (projectionsCount > 0) {
        const clamped = Math.max(0, Math.min(this.selectedProjectionIndex, projectionsCount - 1));
        if (clamped !== this.selectedProjectionIndex) {
          this.selectedProjectionIndex = clamped;
        }
      } else if (this.selectedProjectionIndex !== 0) {
        this.selectedProjectionIndex = 0;
      }

      const annotationKeys = Object.keys(this.data.annotations || {});
      if (this.selectedAnnotation && annotationKeys.includes(this.selectedAnnotation)) {
        // ok
      } else {
        this.selectedAnnotation = annotationKeys[0] || '';
        // Reset filters when the active annotation changes due to a data swap
        this.hiddenAnnotationValues = [];
        this.otherAnnotationValues = [];
        this._colorMapping = null;
        this._shapeMapping = null;
      }
    }
  }

  /**
   * A query filter is scoped to the current dataset. On a dataset swap, drop the
   * filtered-id set before _processData runs below — otherwise a stale set (ids
   * from the previous dataset) would match nothing and blank the new plot. Set
   * here (not via a getter) so the synchronous _processData read sees it cleared.
   */
  private _reconcileFilterOnDataSwap(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('data')) {
      // F-40: the filtered-display memo is keyed by reference on the previous
      // materialized object. _getMaterializedData returns a fresh object after a
      // data swap, so the reference check already misses — but drop the cache
      // explicitly here too so a stale slice from the previous dataset can never
      // be returned. Value-identical to the original (no cache) behavior; it only
      // forces the recompute that would happen anyway.
      this._filteredDisplayCache = null;
      this._filteredDisplayCacheDeps = null;
      if (this.filtersActive) {
        this.filteredProteinIds = [];
        this.filtersActive = false;
      }
    }
  }

  /** INV-11: reprocess geometry + emit data-change when a geometry input changes. */
  private _reprocessGeometryIfNeeded(changedProperties: Map<string, unknown>) {
    if (this._geometryInputsChanged(changedProperties)) {
      this._processData();
      this._scheduleQuadtreeRebuild();
      this._webglRenderer?.invalidatePositionCache();
      this._webglRenderer?.invalidateStyleCache();
      if (changedProperties.has('data')) {
        this.resetZoom();
      }

      if (changedProperties.has('data') && this.data) {
        this._webglRenderPerf.maybeAutoRunFromUrl();
      }

      // Dispatch data-change event for auto-sync with control bar and other components
      if (
        (changedProperties.has('data') ||
          changedProperties.has('filteredProteinIds') ||
          changedProperties.has('filtersActive')) &&
        this.data
      ) {
        this.dispatchEvent(
          new CustomEvent('data-change', {
            // Send the CURRENT (filtered/isolated) view so the legend reflects what
            // is shown — counts update to the kept set, exactly as isolation does.
            // The legend preserves its visible-category structure via the constrained
            // state reported by the sync controller's getIsolationState().
            detail: { data: this.getCurrentData() ?? this._getMaterializedData() ?? this.data },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
  }

  /** INV-14: config shallow-merge + duplicate-UI teardown + style signature + quadtree schedule. */
  private _reconcileConfigMerge(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('config')) {
      const prev = this._mergedConfig;
      this._mergedConfig = { ...DEFAULT_CONFIG, ...prev, ...this.config };
      const prevDupUI = !!prev.enableDuplicateStackUI;
      const nextDupUI = !!this._mergedConfig.enableDuplicateStackUI;
      if (prevDupUI !== nextDupUI) {
        // Cancel any in-flight work and invalidate caches when toggling.
        this._dupOverlay.cancelDebounce();
        this._dupOverlay.cancelCompute();
        this._dupOverlay.resetCacheKey();
      }
      this._updateStyleSignature();
      this._webglRenderer?.invalidateStyleCache();
      this._webglRenderer?.setStyleSignature(this._styleSig);
      this._scheduleQuadtreeRebuild();
    }
  }

  private _rebuildStyleAndSignature(changedProperties: Map<string, unknown>) {
    const visibilityMembershipChanged =
      changedProperties.has('selectedAnnotation') ||
      changedProperties.has('hiddenAnnotationValues') ||
      changedProperties.has('otherAnnotationValues') ||
      changedProperties.has('eatOverlayEnabled');
    if (visibilityMembershipChanged || changedProperties.has('eatConfidenceThreshold')) {
      // Threshold changes only vary non-zero predicted alpha, so membership and geometry are
      // unchanged. Keep range-input updates off the O(N) spatial-index path.
      if (visibilityMembershipChanged) this._scheduleQuadtreeRebuild();
      this._webglRenderer?.invalidateStyleCache();
      this._updateStyleSignature();
      this._webglRenderer?.setStyleSignature(this._styleSig);

      // Position/sort rebuild only when annotation or "Other" category changes
      // (affects colors, shapes, z-order). Visibility toggles only change alpha
      // values — hidden points stay in GPU arrays with alpha=0, preserving sort
      // order and enabling the fast color-only update path.
      if (
        changedProperties.has('selectedAnnotation') ||
        changedProperties.has('otherAnnotationValues') ||
        changedProperties.has('eatOverlayEnabled')
      ) {
        this._webglRenderer?.invalidatePositionCache();
      }
    }
  }

  private _reconcileSelectionMode(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has('selectionMode') ||
      (changedProperties.has('selectionTool') && this.selectionMode)
    ) {
      this._interaction?.updateSelectionMode();
    }
  }

  /** Refresh cached style getters when any relevant input changes. */
  private _refreshStyleGettersCache(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has('data') ||
      changedProperties.has('numericAnnotationSettings') ||
      changedProperties.has('selectedAnnotation') ||
      changedProperties.has('hiddenAnnotationValues') ||
      changedProperties.has('otherAnnotationValues') ||
      changedProperties.has('selectedProteinIds') ||
      changedProperties.has('highlightedProteinIds') ||
      changedProperties.has('eatOverlayEnabled') ||
      changedProperties.has('eatConfidenceThreshold') ||
      changedProperties.has('config')
    ) {
      this._styleGettersCache = this._buildStyleGetters();
    }
  }

  private _reconcileSelectionOverlays(changedProperties: Map<string, unknown>) {
    if (
      changedProperties.has('selectedProteinIds') ||
      changedProperties.has('highlightedProteinIds')
    ) {
      this._updateSelectionOverlays();
      this._syncWebglSelectionActive();
      this._webglRenderer?.invalidateStyleCache();
      this._renderPlot();
    }
    // Render for other changes
    const selectionKeys = ['selectedProteinIds', 'highlightedProteinIds'];
    const changedKeys = Array.from(changedProperties.keys()).map(String);
    const onlySelectionChanged =
      changedKeys.length > 0 && changedKeys.every((k) => selectionKeys.includes(k));
    if (!onlySelectionChanged) {
      this._renderPlot();
      this._updateSelectionOverlays();
    }
  }

  private _reconcileTooltipMeasurement(changedProperties: Map<string, unknown>) {
    // Only measure tooltip height when the tooltip data itself changes. The rendered
    // height is derived purely from _tooltipData.view, so there is no reason to
    // read offsetHeight (which forces a synchronous layout reflow) on unrelated
    // updates such as zoom/pan (_transform), selection overlays, or the self-triggered
    // _tooltipHeight update. Clearing _tooltipData to null IS a _tooltipData change,
    // so the null-reset path in _measureTooltipHeight still fires correctly.
    if (changedProperties.has('_tooltipData')) {
      this._measureTooltipHeight();
    }
  }

  private _measureTooltipHeight() {
    if (!this._tooltipData) {
      this._tooltipMeasureToken++; // invalidate any in-flight async measurement
      if (this._tooltipHeight !== null) {
        this._tooltipHeight = null;
      }
      return;
    }
    const el = this.renderRoot.querySelector('protspace-protein-tooltip') as
      | (HTMLElement & { updateComplete?: Promise<unknown> })
      | null;
    if (!el) return;

    // The <protspace-protein-tooltip> child LitElement renders its updated content
    // one microtask AFTER this parent's updated() runs. Reading offsetHeight here
    // would return the previous (or empty, on first hover) content height. Instead
    // we wait for the child's own render cycle to complete before measuring.
    const token = ++this._tooltipMeasureToken;
    const childReady: Promise<unknown> = el.updateComplete ?? Promise.resolve();
    void childReady.then(
      () => {
        // Guard against: (a) a newer hover that bumped the token while we were
        // waiting, or (b) the tooltip being cleared while we were waiting.
        if (token !== this._tooltipMeasureToken || !this._tooltipData) return;
        const height = el.offsetHeight;
        if (height > 0 && height !== this._tooltipHeight) {
          this._tooltipHeight = height;
        }
      },
      // The child's updateComplete rejects only if its render throws; swallow it
      // so this measurement never surfaces an unhandled promise rejection.
      () => {},
    );
  }

  firstUpdated() {
    this._interaction = new PlotInteractionController(this._interactionHost());
    this._interaction.initialize();
    this._updateSizeAndRender();
    if (this._canvas) {
      // _updateSizeAndRender already lazily constructs the renderer when _canvas
      // exists; guard here so firstUpdated no longer orphans that instance (F-35).
      if (!this._webglRenderer) {
        this._createWebglRenderer();
      }
      this._syncWebglSelectionActive();
    }
    this._connectorOverlay.render();
  }

  private _processData() {
    // Build _plotData from the FULL materialized data and apply the query filter
    // as an id-membership filter (see processVisualizationData) rather than from a
    // pre-sliced display array. This keeps each point's originalIndex a GLOBAL
    // index into the full dataset, which the style getters and tooltip path
    // require — a slice-local index would mis-resolve colours/values under any
    // non-prefix filter. Isolation already worked this way; filtering now matches.
    const dataToUse = this._getMaterializedData();
    if (!dataToUse) return;

    const visibleProteinIds = this._getVisibleProteinIdsSet();

    // Fast path applies only to a projection change on the plain, unfiltered,
    // non-isolated plot. Whenever a filter or isolation is active we rebuild so
    // the kept set is recomputed (and originalIndex stays global). The current
    // build must also have been un-culled: a culled _plotData is missing points
    // that only a full rebuild can restore (e.g. right after Reset All flips
    // filtersActive back to false).
    const onlyProjectionChanged =
      this._plotData.length > 0 &&
      this._lastDataRef === dataToUse &&
      !this._isolationMode &&
      !this.filtersActive &&
      !this._plotDataWasCulled;

    if (onlyProjectionChanged) {
      // Fast path: update coordinates in-place from the new projection data.
      // No new object allocation — just overwrite x/y on existing PlotDataPoints.
      this._updatePlotDataCoordinates(dataToUse);
    } else {
      // Release old data references before allocating the new dataset.
      // Without this, old and new PlotData coexist in memory during processing
      // (e.g. 100K + 570K points), which can cause OOM on constrained devices.
      this._plotData = EMPTY_PLOT_DATA;
      this._visiblePlotData = EMPTY_PLOT_DATA;
      this._quadtreeIndex.clear();
      this._webglRenderer?.releaseDataReferences();

      this._plotData = DataProcessor.processVisualizationData(
        dataToUse,
        this.selectedProjectionIndex,
        this._isolationMode,
        this._isolationHistory,
        this.projectionPlane,
        visibleProteinIds,
      );
      this._plotDataWasCulled = this._isolationMode || visibleProteinIds !== null;
    }

    this._lastDataRef = dataToUse;

    // z-order is resolved in WebGL depth (see style getters), so we avoid sorting 500k+ points on CPU.

    // Invalidate scales cache when plot data changes
    this._invalidateScalesCache();
    this._invalidateVirtualizationCache();
  }

  private _refreshSelectedAnnotationValues(dataToUse: VisualizationData) {
    const annotationName = this.selectedAnnotation;
    if (!dataToUse.annotations[annotationName] || !dataToUse.annotation_data?.[annotationName]) {
      this._processData();
      return;
    }

    // Style-getters read annotation values lazily via getProteinAnnotationValues —
    // changing the selected annotation only requires re-render + cache invalidation.
    this._plotData = clonePlotData(this._plotData);
    this._lastDataRef = dataToUse;
    this._styleGettersCache = null;
    this._invalidateVirtualizationCache();
  }

  private _scheduleNumericAnnotationRefresh() {
    this._numericRecompute.schedule();
  }

  /**
   * Component-owned data-refresh routing + lifecycle-bound render tail + the
   * `data-change` re-emit. Runs inside the deferred RAF for the current job
   * (NumericRecomputeRunner owns the job id, events, RAF, and running state).
   */
  private _runNumericRecomputeBody() {
    const materializedData = this._getMaterializedData();
    if (!materializedData) return;

    // _refreshSelectedAnnotationValues only reads annotations / annotation_data
    // (both present on the materialized object) and then triggers a lazy
    // style-getter rebuild that itself uses includeFilteredProteinIds:false.
    // Excluding filtered ids returns the cached materialized object by
    // reference (no per-point deep-slice of projections/numeric/scores/evidence),
    // matching the pattern at _getVisibilityModel / _buildStyleGetters.
    const displayData =
      this._getCurrentDisplayData({ includeFilteredProteinIds: false }) ?? materializedData;

    if (this._plotData.length > 0) {
      this._refreshSelectedAnnotationValues(displayData);
    } else {
      this._processData();
    }

    this._scheduleQuadtreeRebuild();
    this._webglRenderer?.invalidateStyleCache();
    this._updateStyleSignature();
    this._webglRenderer?.setStyleSignature(this._styleSig);
    this._renderPlot();
    this._updateSelectionOverlays();

    const currentData = this.getCurrentData() ?? displayData ?? materializedData ?? this.data;
    if (currentData) {
      this.dispatchEvent(
        new CustomEvent('data-change', {
          detail: { data: currentData },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _getCurrentDisplayData(options?: {
    includeFilteredProteinIds?: boolean;
  }): VisualizationData | null {
    const materializedData = this._getMaterializedData();
    if (!materializedData) return null;

    const visibleProteinIds =
      options?.includeFilteredProteinIds === false ? null : this._getVisibleProteinIdsSet();
    if (!visibleProteinIds) {
      return materializedData;
    }

    const deps = this._filteredDisplayCacheDeps;
    if (
      this._filteredDisplayCache &&
      deps &&
      deps.materialized === materializedData &&
      deps.filteredProteinIds === this.filteredProteinIds &&
      deps.filtersActive === this.filtersActive &&
      deps.selectedProjectionIndex === this.selectedProjectionIndex &&
      deps.projectionPlane === this.projectionPlane
    ) {
      return this._filteredDisplayCache;
    }

    const keptIndices: number[] = [];
    materializedData.protein_ids.forEach((proteinId, index) => {
      if (visibleProteinIds.has(proteinId)) {
        keptIndices.push(index);
      }
    });

    const result = sliceVisualizationDataByIndices(materializedData, keptIndices);
    this._filteredDisplayCache = result;
    this._filteredDisplayCacheDeps = {
      materialized: materializedData,
      filteredProteinIds: this.filteredProteinIds,
      filtersActive: this.filtersActive,
      selectedProjectionIndex: this.selectedProjectionIndex,
      projectionPlane: this.projectionPlane,
    };
    return result;
  }

  /**
   * Update PlotData coordinates in-place from a new projection.
   * Reads directly from VisualizationData.projections — no intermediate allocation.
   * This avoids the ~700MB memory spike from rebuilding the full PlotData container.
   */
  private _updatePlotDataCoordinates(data: VisualizationData) {
    const projection = data.projections[this.selectedProjectionIndex];
    if (!projection) return;

    const pd = this._plotData;
    // xs/ys/zs are readonly fields, but the Float32Array contents are mutable.
    const { xs, ys, zs } = pd;
    const oi = pd.originalIndices;

    const dim = projection.dimension;
    for (let i = 0; i < pd.length; i++) {
      const origIdx = oi ? oi[i] : i;
      const base = origIdx * dim;
      const c0 = projection.data[base];
      const c1 = projection.data[base + 1];

      let xVal = c0;
      let yVal = c1;

      if (dim === 3) {
        const c2 = projection.data[base + 2];
        if (zs) zs[i] = c2;
        if (this.projectionPlane === 'xz') {
          yVal = c2;
        } else if (this.projectionPlane === 'yz') {
          xVal = c1;
          yVal = c2;
        }
      }

      xs[i] = xVal;
      ys[i] = yVal;
    }

    // New container ref so Lit detects the change and extent-cache invalidates.
    this._plotData = clonePlotData(this._plotData);
  }

  private _buildQuadtree() {
    // Cancel any in-flight duplicate stack computation — it uses the old quadtree
    // and would overwrite cleared state with stale results when it finishes.
    this._dupOverlay.cancelCompute();

    if (!this._plotData.length || !this._scales) {
      this._dupOverlay.resetState();
      // F-17: an emptied quadtree also changes the indexed slot set; bump the
      // generation and invalidate so the transform-keyed cache cannot serve a
      // stale slot set. No render here — there is nothing to draw.
      this._quadtreeGeneration++;
      this._invalidateVirtualizationCache();
      return;
    }
    const pd = this._plotData;
    const oi = pd.originalIndices;
    const sp = this._scratchPoint;
    const visibilityModel = this._getVisibilityModel();
    const visibleSlots: number[] = [];
    for (let s = 0; s < pd.length; s++) {
      const origIdx = oi ? oi[s] : s;
      sp.id = pd.proteinIds[origIdx];
      sp.x = pd.xs[s];
      sp.y = pd.ys[s];
      sp.originalIndex = origIdx;
      if (visibilityModel.isInteractive(sp)) visibleSlots.push(s);
    }
    this._quadtreeIndex.setScales(this._scales);
    this._quadtreeIndex.rebuild(pd, visibleSlots);
    // Duplicate stacks are computed lazily for the current viewport (see the
    // controller's ensureForViewport) to keep quadtree rebuilds fast on large datasets.
    this._dupOverlay.resetState();

    // Trigger a fresh duplicate overlay update so badges are recomputed for the
    // new quadtree (e.g. after a projection switch).  Without this, the overlays
    // rendered synchronously in updated() used a stale cache and nothing would
    // re-trigger them after the deferred quadtree rebuild.
    this._dupOverlay.updateSelectionOverlays({ duplicateImmediate: true });

    // F-17: any rebuild can change the indexed (isInteractive) slot set, so the
    // transform-keyed virtualization cache is now stale even if the transform is
    // unchanged. Bump the generation (folded into the cacheKey), force a miss,
    // and schedule a render so un-hidden points reappear without a pan/zoom.
    this._quadtreeGeneration++;
    this._invalidateVirtualizationCache();
    this._renderPlot();
  }

  private _scheduleQuadtreeRebuild() {
    if (this._quadtreeRebuildRafId !== null) {
      cancelAnimationFrame(this._quadtreeRebuildRafId);
    }
    this._quadtreeRebuildRafId = requestAnimationFrame(() => {
      this._quadtreeRebuildRafId = null;
      this._buildQuadtree();
    });
  }

  /**
   * Bridge handed to the PlotInteractionController (F-07): narrow pull-getters +
   * callbacks so the controller never reaches into the component. Event dispatch
   * stays on the host (INV-03/INV-05); the host owns the _transform field (F-48,
   * written back via onTransform).
   */
  private _interactionHost(): PlotInteractionHost {
    return {
      getSvg: () => this._svg,
      getCanvas: () => this._canvas,
      getMergedConfig: () => this._mergedConfig,
      getSelectionMode: () => this.selectionMode,
      getSelectionTool: () => this.selectionTool,
      hasScales: () => this._scales != null,
      getTransform: () => this._transform,
      queryByPolygon: (vertices) => this._quadtreeIndex.queryByPolygon(vertices),
      queryByPixels: (x0, y0, x1, y1) => this._quadtreeIndex.queryByPixels(x0, y0, x1, y1),
      resolveSlotsToIds: (slots) => this._slotsToInteractiveIds(slots),
      onTransform: (t) => {
        this._transform = t;
      },
      onSelect: (ids, clearVisual) => this._commitSelection(ids, clearVisual),
      onHover: (event) => this._handleCanvasMouseMove(event),
      onHoverEnd: () => this._handleCanvasMouseOut(),
      onClick: (event) => this._handleCanvasClick(event),
      renderWebGL: (trigger) => this._renderWebGL(trigger),
      updateSelectionOverlays: (opts) => this._updateSelectionOverlays(opts),
    };
  }

  private _updateSizeAndRender() {
    const width = this.clientWidth || 800;
    const height = this.clientHeight || 600;

    if (this._canvas) {
      if (!this._webglRenderer) {
        this._createWebglRenderer();
      }
      this._webglRenderer!.resize(width, height);
      // Force fresh style getters to ensure depth values are recomputed consistently
      this._styleGettersCache = null;
      this._webglRenderer!.invalidatePositionCache();
      // Also invalidate style cache to force re-sorting of colors when point order may change
      this._webglRenderer!.invalidateStyleCache();
    }

    // Keep badge canvas in sync with layout and DPR
    if (this._badgesCanvas) {
      const dpr = window.devicePixelRatio || 1;
      const physicalWidth = Math.max(1, Math.floor(width * dpr));
      const physicalHeight = Math.max(1, Math.floor(height * dpr));
      if (
        this._badgesCanvas.width !== physicalWidth ||
        this._badgesCanvas.height !== physicalHeight
      ) {
        this._badgesCanvas.width = physicalWidth;
        this._badgesCanvas.height = physicalHeight;
        this._badgesCanvas.style.width = `${width}px`;
        this._badgesCanvas.style.height = `${height}px`;
      }
    }

    if (this._svg) {
      this._svg.setAttribute('width', width.toString());
      this._svg.setAttribute('height', height.toString());
    }

    this._mergedConfig = { ...this._mergedConfig, width, height };
    this._invalidateVirtualizationCache();
    // Scales depend on width/height; rebuild spatial index to keep hit-testing accurate after resize
    this._scheduleQuadtreeRebuild();
    this._renderPlot();
    this._updateSelectionOverlays();
    this._connectorOverlay.render();
  }

  // HiDPI setup and quality handled by WebGLRenderer

  /**
   * Resolve a list of quadtree slots to the protein ids of the interactive
   * points among them, in a single allocation-free pass.
   *
   * Shared by lasso and brush selection. Reuses `_scratchPoint` and the cached
   * visibility model so that selecting from the ~573K-point flagship dataset
   * does not allocate a PlotDataPoint per hit plus two intermediate arrays.
   * `isInteractive` reads only `id`/`originalIndex`, so the scratch point's
   * x/y (and absent z) are irrelevant here — behavior matches the prior
   * `slots.map(materialize).filter(isInteractive).map(p => p.id)` chain.
   */
  private _slotsToInteractiveIds(slots: number[]): string[] {
    const pd = this._plotData;
    const oi = pd.originalIndices;
    const sp = this._scratchPoint;
    const model = this._getVisibilityModel();
    const ids: string[] = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const origIdx = oi ? oi[s] : s;
      sp.id = pd.proteinIds[origIdx];
      sp.x = pd.xs[s];
      sp.y = pd.ys[s];
      sp.originalIndex = origIdx;
      if (model.isInteractive(sp)) ids.push(sp.id);
    }
    return ids;
  }

  /**
   * Host shim retained for the characterization suite (F-07): the live brush
   * lifecycle (incl. clearing the brush rectangle on commit) lives in
   * PlotInteractionController, but scatter-plot.test.ts drives this handler
   * directly. Body stays behavior-identical for slot→id resolution + dispatch;
   * the brush-rectangle clear is owned by the controller for the live path.
   * Public so the test can drive it (mirrors pickInteractivePointAt); not called
   * from app code (controller owns the live path).
   */
  _handleBrushEnd(event: d3.D3BrushEvent<unknown>) {
    if (!event.selection) return;

    const [[x0, y0], [x1, y1]] = event.selection as [[number, number], [number, number]];
    const slots = this._quadtreeIndex.queryByPixels(x0, y0, x1, y1);
    const selectedIds = this._slotsToInteractiveIds(slots);
    this._commitSelection(selectedIds, () => {
      /* brush-rectangle clear owned by the controller for the live path */
    });
  }

  /**
   * Shared selection commit logic for both brush and lasso.
   * Updates selectedProteinIds, dispatches the event, and schedules visual cleanup.
   */
  private _commitSelection(selectedIds: string[], clearVisual: () => void) {
    if (selectedIds.length > 0) {
      // F-16: track the deferred-commit RAF so disconnectedCallback can cancel it.
      // The post-disconnect no-op is achieved by that cancellation (a selection
      // committed then disconnected before this RAF fires never dispatches), NOT
      // by guarding the body on isConnected — the connected selection flow must
      // dispatch byte-identically (INV-03/INV-05).
      this._commitSelectionRafId = requestAnimationFrame(() => {
        this._commitSelectionRafId = null;
        this.selectedProteinIds = [...selectedIds];

        this.dispatchEvent(
          new CustomEvent('brush-selection', {
            detail: {
              proteinIds: selectedIds,
              isMultiple: true,
            },
            bubbles: true,
            composed: true,
          }),
        );

        this.requestUpdate();
        requestAnimationFrame(clearVisual);
      });
    } else {
      clearVisual();
    }
  }

  private _renderPlot() {
    if (!this._scales || this._plotData.length === 0) {
      this._webglRenderer?.clear();
      return;
    }

    if (this._canvas && this._webglRenderer) {
      this._renderWebGL('plot');
      this._interaction?.setupCanvasEventHandling();
    }
  }

  private _renderWebGL(trigger: RenderWebGLTrigger = 'unknown') {
    if (!this._webglRenderer) return;
    const perfToken = this._webglRenderPerf.start(trigger);

    const pd = this._getPointsForRendering();

    this._webglRenderer.setTrackRenderedPointIds(pd.length > MAX_POINTS_DIRECT_RENDER);
    this._webglRenderer.render(pd);
    this._interaction?.mainGroup?.selectAll('.protein-point').remove();

    this._webglRenderPerf.stop(perfToken, pd.length);
  }

  public async runWebGLRenderPerfMeasurements(
    iterations?: number,
    options?: { download?: boolean; dataset?: PerfDatasetInfo },
  ) {
    return this._webglRenderPerf.runWebGLRenderPerfMeasurements(iterations, options);
  }

  private _getPointsForRendering(): PlotData {
    if (!this._scales || this._plotData.length === 0) {
      this._visiblePlotData = EMPTY_PLOT_DATA;
      return EMPTY_PLOT_DATA;
    }

    // For smaller datasets, pass all points - renderer handles display mode
    if (this._plotData.length < VIRTUALIZATION_THRESHOLD || !this._quadtreeIndex.hasTree()) {
      this._visiblePlotData = this._plotData;
      return this._plotData;
    }

    // For very large datasets, apply viewport culling
    const config = this._mergedConfig;
    const transform = this._transform;

    const { minX, maxX, minY, maxY } = computeViewportWindow(
      transform,
      config,
      VIRTUALIZATION_PADDING,
    );

    const cacheKey = `${buildViewKey(transform, config.width, config.height)}|${this._quadtreeGeneration}`;
    if (this._virtualizationCacheKey !== cacheKey) {
      const slots = this._quadtreeIndex.queryByPixels(minX, minY, maxX, maxY);
      this._visiblePlotData = gatherPlotData(this._plotData, slots);
      this._virtualizationCacheKey = cacheKey;
    }

    return this._visiblePlotData;
  }

  private _invalidateVirtualizationCache() {
    this._virtualizationCacheKey = null;
    this._visiblePlotData = this._plotData;
    // Reset visible data to full dataset on any invalidation.
  }

  private _updateSelectionOverlays(options: { duplicateImmediate?: boolean } = {}) {
    const overlayGroup = this._interaction?.overlayGroup;
    if (!overlayGroup) return;
    // The selected-overlay clear stays on the host; the duplicate-stack/spiderfy/
    // badge update is owned by the controller (F-06).
    overlayGroup.selectAll('.selected-overlay').remove();
    this._dupOverlay.updateSelectionOverlays(options);
  }

  private _getPointShape(point: PlotDataPoint): string {
    const getters = this._getStyleGetters();
    return getters.getPointShape(point);
  }

  private _getColors(point: PlotDataPoint): string[] {
    const getters = this._getStyleGetters();
    return getters.getColors(point);
  }

  private _getPointSize(point: PlotDataPoint): number {
    const getters = this._getStyleGetters();
    return getters.getPointSize(point);
  }

  private _getOpacity(point: PlotDataPoint): number {
    // Facade: two external consumers reach into this private member —
    // webgl-render-perf.ts (via a privacy cast, acknowledged debt) and
    // app/tests/brush-selection.spec.ts:323. Do not rename or remove this
    // method without migrating those callers first.
    // Delegates to the shared visibility model, which is the single opacity
    // authority.
    return this._getVisibilityModel().opacityOf(point);
  }

  /**
   * Pull-based, memoized accessor for the shared point-visibility model.
   *
   * PULL-BASED on purpose (design D1): there is no `willUpdate`; isolation,
   * reset, and numeric-rebin rAF all call `_processData`/`_buildQuadtree`
   * imperatively outside the Lit cycle; and pinned tests drive unattached
   * elements where lifecycle never runs. A lifecycle-recomputed model would be
   * stale at those sites. So the model is computed lazily and memoized purely on
   * input identity — no lifecycle hooks, no version counters, no invalidation
   * plumbing.
   *
   * Keys (all reference/strict-equality): the materialized display data (same
   * source `_buildStyleGetters` uses — `_getCurrentDisplayData` returns the
   * cached materialized object by reference when filtered ids are excluded, so
   * it is reference-stable until materialization is rebuilt), `selectedAnnotation`,
   * `hiddenAnnotationValues` ref, selection/highlight refs, and the three opacity
   * numbers from the merged config. (Opacities are extracted as three plain
   * numbers rather than keying on `_mergedConfig` itself: `_mergedConfig` is
   * rebuilt as a new object on unrelated changes such as width/height/margin, so
   * its reference is never stable as a cache key.)
   *
   * Two-level: on a miss we pass the previous model to `computeVisibilityModel`,
   * which reuses the O(N) hidden mask when (data, selectedAnnotation, hidden ref)
   * are unchanged — so selection/highlight/opacity-only changes never redo the
   * mask pass. Isolation is NOT an input: it is physical culling upstream; the
   * model sees only the materialized data + alpha-layer inputs.
   */
  private _getVisibilityModel(): VisibilityModel {
    // Same data expression `_buildStyleGetters` uses, so the component path and
    // the hit-test path share one model instance over one data reference.
    const data =
      this._getCurrentDisplayData({ includeFilteredProteinIds: false }) ??
      this._getMaterializedData() ??
      this.data;
    const baseOpacity = this._mergedConfig.baseOpacity;
    const selectedOpacity = this._mergedConfig.selectedOpacity;
    const fadedOpacity = this._mergedConfig.fadedOpacity;

    const key = this._visibilityModelKey;
    if (
      this._visibilityModelCache &&
      key &&
      key.data === data &&
      key.selectedAnnotation === this.selectedAnnotation &&
      key.hiddenAnnotationValues === this.hiddenAnnotationValues &&
      key.selectedProteinIds === this.selectedProteinIds &&
      key.highlightedProteinIds === this.highlightedProteinIds &&
      key.baseOpacity === baseOpacity &&
      key.selectedOpacity === selectedOpacity &&
      key.fadedOpacity === fadedOpacity &&
      key.eatOverlayEnabled === this.eatOverlayEnabled &&
      key.eatConfidenceThreshold === this.eatConfidenceThreshold
    ) {
      return this._visibilityModelCache;
    }

    const model = computeVisibilityModel(
      {
        data,
        selectedAnnotation: this.selectedAnnotation,
        hiddenAnnotationValues: this.hiddenAnnotationValues,
        selectedProteinIds: this.selectedProteinIds,
        highlightedProteinIds: this.highlightedProteinIds,
        opacities: { base: baseOpacity, selected: selectedOpacity, faded: fadedOpacity },
        eatOverlayEnabled: this.eatOverlayEnabled,
        eatConfidenceThreshold: this.eatConfidenceThreshold,
      },
      this._visibilityModelCache ?? undefined,
    );

    this._visibilityModelCache = model;
    this._visibilityModelKey = {
      data,
      selectedAnnotation: this.selectedAnnotation,
      hiddenAnnotationValues: this.hiddenAnnotationValues,
      selectedProteinIds: this.selectedProteinIds,
      highlightedProteinIds: this.highlightedProteinIds,
      baseOpacity,
      selectedOpacity,
      fadedOpacity,
      eatOverlayEnabled: this.eatOverlayEnabled,
      eatConfidenceThreshold: this.eatConfidenceThreshold,
    };
    return model;
  }

  /**
   * Number of INTERACTIVE plot points in the chart (opacityOf > 0): the points
   * the user can actually see and interact with. `_plotData` is already
   * physically culled by isolation and query filters; this further drops
   * legend-hidden points AND selection-faded points whose configured
   * any selected/base/faded tier is 0 (opacity 0 == invisible, exactly what the
   * WebGL renderer and hit-test treat as non-interactive). The memo key therefore
   * includes selection/highlight whenever any supported tier can cross the
   * interactive boundary, and keys plot-data on (originalIndices ref + length)
   * rather than the `_plotData` container ref so a pure projection switch
   * (which clonePlotData()s a new container sharing the same originalIndices)
   * reuses the cache — interactivity is independent of x/y coordinates.
   */
  private _getInteractableProteinIds(): ReadonlySet<string> {
    const data =
      this._getCurrentDisplayData({ includeFilteredProteinIds: false }) ??
      this._getMaterializedData() ??
      this.data;
    const pd = this._plotData;
    const baseOpacity = this._mergedConfig.baseOpacity;
    const selectedOpacity = this._mergedConfig.selectedOpacity;
    const fadedOpacity = this._mergedConfig.fadedOpacity;
    // Selection/highlight can change membership whenever any opacity tier is non-interactive.
    // Under the default all-positive tiers, connector-owned highlights reuse this cache.
    const allOpacityTiersInteractive = baseOpacity > 0 && selectedOpacity > 0 && fadedOpacity > 0;
    const selectedProteinIdsKey = allOpacityTiersInteractive ? null : this.selectedProteinIds;
    const highlightedProteinIdsKey = allOpacityTiersInteractive ? null : this.highlightedProteinIds;

    const key = this._visiblePointCountKey;
    if (
      this._interactableProteinIdsCache !== null &&
      key &&
      key.originalIndices === pd.originalIndices &&
      key.plotLength === pd.length &&
      key.data === data &&
      key.selectedAnnotation === this.selectedAnnotation &&
      key.hiddenAnnotationValues === this.hiddenAnnotationValues &&
      key.selectedProteinIds === selectedProteinIdsKey &&
      key.highlightedProteinIds === highlightedProteinIdsKey &&
      key.baseOpacity === baseOpacity &&
      key.selectedOpacity === selectedOpacity &&
      key.fadedOpacity === fadedOpacity &&
      key.eatOverlayEnabled === this.eatOverlayEnabled
    ) {
      return this._interactableProteinIdsCache;
    }

    const model = this._getVisibilityModel();
    const oi = pd.originalIndices;
    const sp = this._scratchPoint;
    const proteinIds = new Set<string>();
    for (let s = 0; s < pd.length; s++) {
      const origIdx = oi ? oi[s] : s;
      sp.id = pd.proteinIds[origIdx];
      sp.originalIndex = origIdx;
      // x/y intentionally NOT set: isInteractive → opacityOf → isHidden /
      // baseOpacityOf read only id + originalIndex, never coordinates.
      if (model.isInteractive(sp)) proteinIds.add(sp.id);
    }
    this._interactableProteinIdsCache = proteinIds;
    this._visiblePointCountKey = {
      originalIndices: pd.originalIndices,
      plotLength: pd.length,
      data,
      selectedAnnotation: this.selectedAnnotation,
      hiddenAnnotationValues: this.hiddenAnnotationValues,
      selectedProteinIds: selectedProteinIdsKey,
      highlightedProteinIds: highlightedProteinIdsKey,
      baseOpacity,
      selectedOpacity,
      fadedOpacity,
      eatOverlayEnabled: this.eatOverlayEnabled,
    };
    return proteinIds;
  }

  private _getVisiblePointCount(): number {
    return this._getInteractableProteinIds().size;
  }

  private _getDepth(point: PlotDataPoint): number {
    const getters = this._getStyleGetters();
    return getters.getDepth(point);
  }

  /** Build style getters for the current data and visual state. */
  private _buildStyleGetters(): ReturnType<typeof createStyleGetters> {
    const styleData =
      this._getCurrentDisplayData({ includeFilteredProteinIds: false }) ??
      this._getMaterializedData() ??
      this.data;

    return createStyleGetters(
      styleData,
      {
        selectedProteinIds: this.selectedProteinIds,
        highlightedProteinIds: this.highlightedProteinIds,
        selectedAnnotation: this.selectedAnnotation,
        hiddenAnnotationValues: this.hiddenAnnotationValues,
        otherAnnotationValues: this.otherAnnotationValues,
        zOrderMapping: this._zOrderMapping,
        colorMapping: this._colorMapping,
        shapeMapping: this._shapeMapping,
        sizes: {
          base: this._mergedConfig.pointSize,
        },
        opacities: {
          base: this._mergedConfig.baseOpacity,
          selected: this._mergedConfig.selectedOpacity,
          faded: this._mergedConfig.fadedOpacity,
        },
        eatOverlayEnabled: this.eatOverlayEnabled,
      },
      this._getVisibilityModel(),
    );
  }

  private _getStyleGetters() {
    if (!this._styleGettersCache) {
      this._styleGettersCache = this._buildStyleGetters();
    }
    return this._styleGettersCache;
  }

  private _getLocalPointerPosition(event: MouseEvent): {
    x: number;
    y: number;
  } {
    const rect = this.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  private _handleMouseOver(event: MouseEvent, point: PlotDataPoint) {
    if (!this.data) return;
    const { x, y } = this._getLocalPointerPosition(event);
    const view = buildTooltipView(
      this.data,
      point.originalIndex,
      this.selectedAnnotation,
      this.tooltipAnnotations,
      this.eatOverlayEnabled,
    );
    this._tooltipData = { x, y, view };

    if (this._hoveredProteinId !== point.id) {
      this._hoveredProteinId = point.id;
      // detail.view is the lookup-friendly shape consumers should read
      // (gene/protein name, selected-annotation values, scores, evidence).
      // detail.point is the bare lazy point — no annotation Records.
      this.dispatchEvent(
        new CustomEvent('protein-hover', {
          detail: { proteinId: point.id, point, view },
          bubbles: true,
        }),
      );
    }
  }

  private _handleClick(event: MouseEvent, point: PlotDataPoint) {
    const view = this.data
      ? buildTooltipView(
          this.data,
          point.originalIndex,
          this.selectedAnnotation,
          this.tooltipAnnotations,
          this.eatOverlayEnabled,
        )
      : null;
    this.dispatchEvent(
      new CustomEvent('protein-click', {
        detail: {
          proteinId: point.id,
          point,
          view,
          modifierKeys: {
            ctrl: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
            alt: event.altKey,
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Setup event handling for canvas-based rendering
   */
  /**
   * Handle mouse move events for canvas rendering.
   * Coalesces rapid mousemoves to at most one hover computation per animation frame.
   */
  private _handleCanvasMouseMove(event: MouseEvent): void {
    if (!this._scales) return;
    // d3.pointer must be read synchronously: event.currentTarget is null after dispatch.
    const [mouseX, mouseY] = d3.pointer(event);
    this._pendingHover = { event, mouseX, mouseY };
    // Coalesce rapid mousemoves to at most one hover computation per frame (uses latest position).
    if (this._hoverRaf !== null) return;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = null;
      const pending = this._pendingHover;
      this._pendingHover = null;
      if (pending) this._processCanvasHover(pending.event, pending.mouseX, pending.mouseY);
    });
  }

  /**
   * Shared screen→data hit-test for hover and click (F-28). Resolves the nearest
   * INTERACTIVE, currently-RENDERED point under the cursor, or null. Owns the
   * transform inversion, quadtree `findNearest`, the isInteractive/isPointRendered
   * guards, and the within-radius distance check. Callers branch only on the result.
   */
  pickInteractivePointAt(mouseX: number, mouseY: number): PlotDataPoint | null {
    if (!this._scales) return null;

    // Transform mouse coordinates to data space
    const dataX = (mouseX - this._transform.x) / this._transform.k;
    const dataY = (mouseY - this._transform.y) / this._transform.k;

    // Find nearest slot using spatial index (search radius adjusted for zoom)
    const searchRadius = HIT_TEST_SEARCH_RADIUS_PX / this._transform.k;
    const nearestSlot = this._quadtreeIndex.findNearest(dataX, dataY, searchRadius);
    if (nearestSlot < 0) return null;

    const nearestPoint = materializePlotDataPoint(this._plotData, nearestSlot);

    // Don't pick non-interactive points (hidden/faded-to-0 → opacity 0)
    if (!this._getVisibilityModel().isInteractive(nearestPoint)) return null;

    // Verify the point is actually rendered (not excluded due to point limits)
    if (this._webglRenderer && !this._webglRenderer.isPointRendered(nearestPoint.id)) {
      return null;
    }

    // Calculate actual distance to verify it's within the point
    const pointX = this._scales.x(nearestPoint.x);
    const pointY = this._scales.y(nearestPoint.y);
    const distance = Math.sqrt(Math.pow(dataX - pointX, 2) + Math.pow(dataY - pointY, 2));
    const pointRadius = Math.sqrt(this._getPointSize(nearestPoint)) / POINT_RADIUS_SIZE_DIVISOR;

    return distance <= pointRadius ? nearestPoint : null;
  }

  /**
   * Deferred hover processing — runs inside a rAF scheduled by _handleCanvasMouseMove.
   * Behaviour is identical to the former per-event body; only the call frequency is throttled.
   */
  private _processCanvasHover(event: MouseEvent, mouseX: number, mouseY: number): void {
    const point = this.pickInteractivePointAt(mouseX, mouseY);
    if (point) {
      this._handleMouseOver(event, point);
      return;
    }
    // No point found, clear hover state if it exists
    this._clearHoverState();
  }

  /**
   * Handle click events for canvas rendering
   */
  private _handleCanvasClick(event: MouseEvent): void {
    if (!this._scales) return;

    // If the click originated from the spiderfy UI, let the spiderfy handlers deal with it.
    // This avoids collapsing the expanded stack (and early-returning) before a spiderfy node can be selected.
    const target = event.target as Element | null;
    if (target?.closest('.dup-spiderfy')) {
      return;
    }

    // Clicking anywhere outside the expanded stack collapses it.
    const hadExpanded = this._dupOverlay.collapseExpanded();

    const [mouseX, mouseY] = d3.pointer(event);
    const nearestPoint = this.pickInteractivePointAt(mouseX, mouseY);
    if (!nearestPoint) {
      this.clearProvenanceConnectors();
      return;
    }

    // If this point belongs to a duplicate stack, spiderfy instead of picking an arbitrary member.
    if (this._dupOverlay.maybeSpiderfyPoint(nearestPoint)) return;

    // If we just collapsed an expanded stack, treat this click as a "dismiss" click.
    // This prevents accidental selection when the user is simply trying to close the spiderfy UI.
    if (hadExpanded) return;

    this._handleClick(event, nearestPoint);
  }

  /**
   * Handle mouse out events for canvas rendering
   */
  private _handleCanvasMouseOut(): void {
    if (this._hoverRaf !== null) {
      cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = null;
    }
    this._pendingHover = null;
    this._clearHoverState();
  }

  private _clearHoverState(): void {
    if (this._tooltipData) {
      this._tooltipData = null;
    }

    // Dispatch "hover cleared" signal so other components can reset their hover UI.
    if (this._hoveredProteinId !== null) {
      this._hoveredProteinId = null;
      this.dispatchEvent(
        new CustomEvent('protein-hover', {
          detail: { proteinId: null, point: null, view: null },
          bubbles: true,
        }),
      );
    }
  }

  resetZoom() {
    this._interaction?.resetZoom();
  }

  /**
   * Content-scaled fallback height derived from the tooltip view model.
   * Used when the async DOM measurement has not yet resolved (first hover or
   * hover that changed data). Delegates to the pure `estimateTooltipHeight`
   * helper so the logic is unit-testable without a DOM.
   */
  private _estimateTooltipHeight(): number {
    if (!this._tooltipData) return TOOLTIP_FALLBACK_HEIGHT;
    return estimateTooltipHeight(this._tooltipData.view);
  }

  private _getTooltipStyle() {
    if (!this._tooltipData) return '';

    const { x, y } = this._tooltipData;
    const config = this._mergedConfig;
    return computeTooltipStyle({
      x,
      y,
      height: this._tooltipHeight ?? this._estimateTooltipHeight(),
      viewportWidth: config.width,
      viewportHeight: config.height,
    });
  }

  render() {
    const config = this._mergedConfig;
    const useAltCanvas = this._canvasKey % 2 === 1;

    return html`
      <div class="container">
        <!-- Canvas for high-performance rendering (always visible for better performance) -->
        ${useAltCanvas
          ? html`<canvas
              data-key="alt"
              style="position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1;"
            ></canvas>`
          : html`<canvas
              data-key="base"
              style="position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1;"
            ></canvas>`}

        <!-- Canvas overlay for duplicate count badges (faster than SVG for large numbers of badges) -->
        <canvas
          class="badges-canvas"
          style="position: absolute; top: 0; left: 0; pointer-events: none; z-index: 2;"
        ></canvas>

        <!-- SVG overlay for interactions and UI elements -->
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 ${config.width} ${config.height}"
          style="position: absolute; top: 0; left: 0; max-width: ${config.width}px; max-height: ${config.height}px; z-index: 3; background: transparent;"
        ></svg>

        <protspace-projection-metadata
          .projection=${this.data?.projections[this.selectedProjectionIndex] ?? null}
        ></protspace-projection-metadata>

        <protspace-tips
          data-driver-id="tips"
          .showTourButton=${this.showTourButton}
        ></protspace-tips>

        ${this._tooltipData
          ? html`
              <protspace-protein-tooltip
                class="visible"
                style="${this._getTooltipStyle()}"
                .view=${this._tooltipData.view}
              >
              </protspace-protein-tooltip>
            `
          : ''}
        ${this.selectionMode || this.selectedProteinIds.length > 0
          ? html`
              <div
                class="mode-indicator"
                style="z-index: 10; display: flex; flex-direction: column; gap: 4px;"
              >
                ${this.selectionMode
                  ? html`<div>
                      Selection Mode (${this.selectionTool === 'lasso' ? 'Lasso' : 'Rectangle'})
                    </div>`
                  : ''}
                ${this.selectedProteinIds.length > 0
                  ? html`<div style="font-size: 11px; opacity: 0.8;">
                      ${this.selectedProteinIds.length} proteins selected
                    </div>`
                  : ''}
              </div>
            `
          : ''}
        ${this.data
          ? html` <div class="plot-indicator">${this._getVisiblePointCount()} points</div> `
          : ''}
        ${this._numericRecomputeRunning
          ? html`
              <div class="plot-indicator" style="left: auto; right: 0.5rem;">
                Recalculating bins for
                ${this._numericRecompute.runningAnnotation() ?? 'annotation'}...
              </div>
            `
          : ''}
        ${this._connectorStatus
          ? html`
              <div class="connector-status" role="status" aria-live="polite">
                <span>${this._formatConnectorStatus(this._connectorStatus)}</span>
                <button
                  type="button"
                  aria-label="Close provenance connections"
                  @click=${this.clearProvenanceConnectors}
                >
                  ×
                </button>
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _formatConnectorStatus(status: ProvenanceConnectorStatus): string {
    const base = `Showing ${status.shown} of ${status.total} provenance connection${status.total === 1 ? '' : 's'}`;
    if (status.missingEndpoints === 0) return base;
    return `${base} · ${status.missingEndpoints} connection${status.missingEndpoints === 1 ? '' : 's'} unavailable outside the current view`;
  }

  /** Draw a bounded set of EAT source-to-target pairs in the current plot view. */
  setProvenanceConnectors(request: ProvenanceConnectorRequest): void {
    const pairs = request.pairs.slice(0, 20);
    const endpointIds = new Set<string>();
    for (const pair of pairs) {
      endpointIds.add(pair.sourceProteinId);
      endpointIds.add(pair.targetProteinId);
    }
    this.highlightedProteinIds = [...endpointIds];
    this._connectorOverlay.set({ ...request, pairs });
  }

  /** Clear EAT connector geometry, status, and connector-owned endpoint highlights. */
  clearProvenanceConnectors = (): void => {
    const wasActive = this._connectorOverlay.hasActiveRequest();
    this._connectorOverlay.clear();
    if (wasActive && this.highlightedProteinIds.length > 0) {
      this.highlightedProteinIds = [];
    }
  };

  private _updateStyleSignature() {
    const cfg = this._mergedConfig;
    const parts = [
      `ps:${cfg.pointSize}`,
      `annot:${this.selectedAnnotation}`,
      `eat:${this.eatOverlayEnabled ? 1 : 0}`,
      `eat-threshold:${this.eatConfidenceThreshold}`,
    ];
    this._styleSig = parts.join('|');
  }

  /**
   * Shared isolation render-refresh: reprocess derived plot data, rebuild the
   * quadtree, invalidate + re-sign the WebGL renderer's caches, request a Lit
   * update, and render once the update settles. Called by isolateSelection() and
   * resetIsolation() — the only divergence (resetIsolation clears _lastDataRef to
   * force the full-rebuild path) stays at the call site, before this method runs.
   */
  private _reprocessAndRefresh(): void {
    this._processData();
    this._buildQuadtree();

    if (this._webglRenderer) {
      this._webglRenderer.invalidatePositionCache();
      this._webglRenderer.invalidateStyleCache();
      this._updateStyleSignature();
      this._webglRenderer.setStyleSignature(this._styleSig);
    }

    this.requestUpdate();

    this.updateComplete.then(() => {
      this._renderPlot();
    });
  }

  isolateSelection() {
    if (!this.data || this.selectedProteinIds.length === 0) {
      return;
    }

    // Validate selected IDs against current plot data
    const currentProteinIds = new Set(
      Array.from({ length: this._plotData.length }, (_, s) => plotDataId(this._plotData, s)),
    );
    const validSelectedIds = this.selectedProteinIds.filter((id) => currentProteinIds.has(id));

    if (validSelectedIds.length === 0) {
      return;
    }

    // Add valid selection to isolation history
    this._isolationHistory.push(validSelectedIds);
    this._isolationMode = true;
    this.selectedProteinIds = [];

    this._reprocessAndRefresh();

    // Snap back to the full view of the isolated subset. Without this, a zoom
    // applied before isolating lingers and the isolated points render under a
    // stale transform instead of filling the plot (#297).
    this.resetZoom();

    this.dispatchEvent(
      new CustomEvent('data-isolation', {
        detail: {
          isolationHistory: this._isolationHistory,
          isolationMode: this._isolationMode,
          dataSize: this._plotData.length,
        },
        bubbles: true,
        composed: true,
      }),
    );

    // Dispatch data-change event to update legend and other auto-sync components
    this.dispatchEvent(
      new CustomEvent('data-change', {
        detail: {
          data: this.getCurrentData(),
          isSplitData: true,
          isolationMode: true,
        },
        bubbles: true,
        composed: true,
      }),
    );

    // Auto-disable selection mode if only 1 point left
    if (this._plotData.length <= 1) {
      this.selectionMode = false;
      this.dispatchEvent(
        new CustomEvent('auto-disable-selection', {
          detail: {
            reason: 'insufficient-data',
            dataSize: this._plotData.length,
          },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** True when a duplicate-badge spider is currently expanded. */
  hasExpandedDuplicateStack(): boolean {
    return this._dupOverlay.hasExpanded();
  }

  /** Collapse the currently-open duplicate-badge spider, if any. */
  closeExpandedDuplicateStack(): void {
    this._dupOverlay.closeExpanded();
  }

  /**
   * Clear isolation state without reprocessing. Use before loading new data.
   * Dispatches `data-isolation-reset` when state actually changed, so listeners
   * (e.g. the control bar's Reset chip) stay in sync. Pass `{ silent: true }`
   * when the caller will dispatch its own reset event with a fuller payload.
   */
  clearIsolationState(options?: { silent?: boolean }): void {
    const wasIsolated = this._isolationMode;
    this._isolationHistory = [];
    this._isolationMode = false;
    if (wasIsolated && !options?.silent) {
      this.dispatchEvent(
        new CustomEvent('data-isolation-reset', {
          detail: {
            isolationHistory: this._isolationHistory,
            isolationMode: this._isolationMode,
          },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  resetIsolation() {
    this.clearIsolationState({ silent: true });
    this.selectedProteinIds = [];

    // Invalidate data ref so _processData takes the full rebuild path
    // instead of the fast coordinate-only path (which would keep the filtered subset)
    this._lastDataRef = null;

    this._reprocessAndRefresh();

    // Exiting isolation restores the full dataset, so snap back to the full
    // view — mirrors isolateSelection() and the data-change reset so a zoom
    // applied inside the isolated view doesn't linger over the full plot (#297).
    this.resetZoom();

    this.dispatchEvent(
      new CustomEvent('data-isolation-reset', {
        detail: {
          isolationHistory: this._isolationHistory,
          isolationMode: this._isolationMode,
          dataSize: this._plotData.length,
        },
        bubbles: true,
        composed: true,
      }),
    );

    // Dispatch data-change event to update legend back to full data
    this.dispatchEvent(
      new CustomEvent('data-change', {
        detail: {
          data: this.getCurrentData(),
          isFiltered: false,
          isolationMode: false,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  getIsolationHistory(): string[][] {
    return [...this._isolationHistory];
  }

  isIsolationMode(): boolean {
    return this._isolationMode;
  }

  getCurrentData(options?: { includeFilteredProteinIds?: boolean }): VisualizationData | null {
    const currentDisplayData = this._getCurrentDisplayData(options);
    if (!currentDisplayData) return null;

    // If we're in isolation mode, return filtered data based on current plot data
    if (this._isolationMode && this._plotData.length > 0) {
      const pd = this._plotData;
      const currentProteinIds = Array.from({ length: pd.length }, (_, s) => plotDataId(pd, s));

      // `keptIndices` are the ascending positions in currentDisplayData.protein_ids to keep.
      // _plotData.originalIndices is the ascending list of surviving indices into
      // pd.proteinIds (the full source id array). When no view filter is active,
      // currentDisplayData.protein_ids IS that same full array in the same order, so
      // originalIndices already equals keptIndices — reuse it instead of re-scanning all
      // ~573K ids and building a throwaway Set. The length-equality check detects that
      // unfiltered case (a filtered display is always a strict subset, so its length
      // differs); otherwise fall back to the membership scan.
      let keptIndices: number[];
      if (pd.originalIndices && currentDisplayData.protein_ids.length === pd.proteinIds.length) {
        keptIndices = Array.from(pd.originalIndices);
      } else {
        const currentProteinIdsSet = new Set(currentProteinIds);
        keptIndices = [];
        currentDisplayData.protein_ids.forEach((proteinId, index) => {
          if (currentProteinIdsSet.has(proteinId)) keptIndices.push(index);
        });
      }

      // Delegate the per-index slice to the shared helper (same construction the
      // filtered-display path uses), then override protein_ids with the
      // plotDataId-ordered current ids exactly as before. This also reslices
      // annotation_scores/annotation_evidence consistently, silently correcting
      // the prior isolation-mode misalignment (sanctioned by F-13; no consumer
      // indexes scores/evidence off this result, so INV-04 holds).
      const sliced = sliceVisualizationDataByIndices(currentDisplayData, keptIndices);
      return { ...sliced, protein_ids: currentProteinIds };
    }

    return currentDisplayData;
  }

  getMaterializedData(): VisualizationData | null {
    return this._getMaterializedData();
  }

  /** Stable authoritative membership for points currently rendered with non-zero opacity. */
  getInteractableProteinIds(): ReadonlySet<string> {
    return this._getInteractableProteinIds();
  }

  /**
   * Capture the scatterplot at a specific resolution for high-quality export.
   * Renders directly to an off-screen WebGL canvas without affecting the display.
   *
   * @param width Target width in CSS pixels
   * @param height Target height in CSS pixels
   * @param options Export options (dpr, backgroundColor)
   * @returns Canvas containing the rendered visualization
   *
   * @example
   * const canvas = scatterplot.captureAtResolution(6000, 3000);
   * const dataUrl = canvas.toDataURL('image/png');
   */
  public captureAtResolution(
    width: number,
    height: number,
    options: {
      dpr?: number;
      backgroundColor?: string;
      /** Render only this data-coordinate region. Used by zoom-inset rendering
       *  so the inset is a real geometric zoom (native point sizes) rather
       *  than a raster crop+upscale of the main plot. */
      dataDomain?: { xMin: number; xMax: number; yMin: number; yMax: number };
      /** Override the canvas dims used to compute point sizing. Inset renders
       *  pass the source plot's render size so dots stay the same visual size
       *  as in the main plot, instead of shrinking with the inset. */
      pointSizeReference?: { width: number; height: number };
      /** Ignore the live zoom/pan transform and render the default fit-all
       *  view (what a double-click reset shows). The figure editor sets this
       *  so a zoomed-in plot doesn't leak into the exported/preview figure. */
      resetView?: boolean;
    } = {},
  ): HTMLCanvasElement {
    if (!this._webglRenderer) {
      throw new Error('WebGL renderer not initialized');
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('Width and height must be positive numbers');
    }

    const {
      dpr = 1,
      backgroundColor = '#ffffff',
      dataDomain,
      pointSizeReference,
      resetView = false,
    } = options;

    // Capture WebGL content using native off-screen rendering
    const webglCanvas = this._webglRenderer.renderToCanvas(
      width,
      height,
      dpr,
      dataDomain,
      pointSizeReference,
      resetView,
    );

    // Composite with badges canvas if present. For the unzoomed (resetView)
    // capture, re-render the badges at the identity transform so they line up
    // with the fit-all points; the live _badgesCanvas is positioned for the
    // live zoom/pan and would otherwise leak the zoom into the figure (#294).
    // The inset path (dataDomain set) keeps the live canvas — its badge handling
    // is a separate, pre-existing concern.
    const badgesCanvas =
      resetView && !dataDomain
        ? this._dupOverlay.captureBadges(d3.zoomIdentity)
        : this._badgesCanvas;
    if (badgesCanvas && badgesCanvas.width > 0 && badgesCanvas.height > 0) {
      const ctx = webglCanvas.getContext('2d');
      if (ctx) {
        // Scale badges to match output dimensions
        ctx.drawImage(
          badgesCanvas,
          0,
          0,
          badgesCanvas.width,
          badgesCanvas.height,
          0,
          0,
          webglCanvas.width,
          webglCanvas.height,
        );
      }
    }

    // Apply background color if the canvas has transparency
    if (backgroundColor && backgroundColor !== 'transparent') {
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = webglCanvas.width;
      outputCanvas.height = webglCanvas.height;
      const ctx = outputCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        ctx.drawImage(webglCanvas, 0, 0);
        return outputCanvas;
      }
    }

    return webglCanvas;
  }

  /**
   * Margin used for a render at the given export dimensions. Returned values
   * are in *export pixel space*. The publish modal uses this to translate
   * inset source rects (in canvas-norm 0–1) into accurate data-coordinate
   * viewports, instead of approximating with the raw extent.
   */
  public getRenderInfo(
    exportWidth: number,
    exportHeight: number,
  ): { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number } | null {
    if (!this._webglRenderer) return null;
    return this._webglRenderer.getRenderInfo(exportWidth, exportHeight);
  }

  /**
   * Data extent of the most recently rendered points. With `padded: true`
   * applies the same 5% padding the renderer uses by default — so the
   * returned domain matches what the main plot is actually showing.
   */
  public getDataExtent(
    options: { padded?: boolean } = {},
  ): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
    if (!this._webglRenderer) return null;
    const ext = this._webglRenderer.getDataExtent();
    if (!ext) return null;
    if (!options.padded) return ext;
    const xPad = Math.abs(ext.xMax - ext.xMin) * 0.05;
    const yPad = Math.abs(ext.yMax - ext.yMin) * 0.05;
    return {
      xMin: ext.xMin - xPad,
      xMax: ext.xMax + xPad,
      yMin: ext.yMin - yPad,
      yMax: ext.yMax + yPad,
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-scatterplot': ProtspaceScatterplot;
  }
}
