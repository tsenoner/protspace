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
  AnnotationData,
  TooltipView,
} from '@protspace/utils';
import {
  DataProcessor,
  buildTooltipView,
  materializeVisualizationData,
  sliceAnnotationData,
  EMPTY_PLOT_DATA,
  clonePlotData,
  plotDataId,
  materializePlotDataPoint,
  gatherPlotData,
} from '@protspace/utils';
import type { LegendSortMode } from '../legend/types';
import { scatterplotStyles } from './scatter-plot.styles';
import './projection-metadata';
import './protspace-tips';
import './protein-tooltip';
import { DEFAULT_CONFIG } from './config';
import { createStyleGetters } from './style-getters';
import { computeVisibilityModel } from './visibility-model';
import type { VisibilityModel } from './visibility-model';
import { MAX_POINTS_DIRECT_RENDER, WebGLRenderer } from './webgl';
import { QuadtreeIndex } from './quadtree-index';
import { getDuplicateStackKey } from './duplicate-stack-helpers';
import { estimateTooltipHeight } from './tooltip-height-estimate';
import {
  WebglRenderPerfRunner,
  type PerfDatasetInfo,
  type RenderWebGLTrigger,
} from './webgl-render-perf';

// Visualization is only needed for viewport culling on very large datasets.
// For <= MAX_POINTS_DIRECT_RENDER we can render the full set once and then pan/zoom via uniforms
// (no per-frame quadtree queries or buffer rebuilds), which is substantially faster for ~500k points.
const VIRTUALIZATION_THRESHOLD = MAX_POINTS_DIRECT_RENDER;
const VIRTUALIZATION_PADDING = 100;

// Duplicate stack UI performance tuning (target: M1 MacBook + Chrome)
const DUPLICATE_BADGES_MAX_VISIBLE = 800;
const DUPLICATE_BADGES_VIEWPORT_PADDING = 60;
const DUPLICATE_BADGES_UPDATE_DEBOUNCE_MS = 120;
const DUPLICATE_STACK_COMPUTE_CHUNK_SIZE = 25_000;
type ScalePair = {
  x: d3.ScaleLinear<number, number>;
  y: d3.ScaleLinear<number, number>;
};

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

  // State
  @state() private _plotData: PlotData = EMPTY_PLOT_DATA;
  @state() private _tooltipData: {
    x: number;
    y: number;
    view: TooltipView;
  } | null = null;
  @state() private _tooltipHeight: number | null = null;
  @state() private _mergedConfig = DEFAULT_CONFIG;
  @state() private _transform = d3.zoomIdentity;
  @state() private _isolationHistory: string[][] = [];
  @state() private _isolationMode = false;
  @state() private _zOrderMapping: Record<string, number> | null = null;
  @state() private _colorMapping: Record<string, string> | null = null;
  @state() private _shapeMapping: Record<string, string> | null = null;
  @state() private _canvasKey = 0;
  @state() private _numericRecomputeState: {
    running: boolean;
    annotation: string | null;
    startedAt: number | null;
  } = {
    running: false,
    annotation: null,
    startedAt: null,
  };

  // Queries
  @query('canvas') private _canvas?: HTMLCanvasElement;
  @query('canvas.badges-canvas') private _badgesCanvas?: HTMLCanvasElement;
  @query('svg') private _svg!: SVGSVGElement;

  // Internal
  private _quadtreeIndex: QuadtreeIndex = new QuadtreeIndex();
  private resizeObserver: ResizeObserver;
  private _zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private _svgSelection: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private _mainGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private _brushGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private _overlayGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private _brush: d3.BrushBehavior<unknown> | null = null;
  private _isBrushing = false;
  private _lassoVertices: Array<[number, number]> = [];
  private _lassoPath: SVGPathElement | null = null;
  private _isLassoing = false;
  private _lassoRafId: number | null = null;
  private _webglRenderer: WebGLRenderer | null = null;
  private _zoomRafId: number | null = null;
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
  // Memoized count of non-hidden plot points for the bottom-left indicator.
  // Keyed on the mask-relevant visibility inputs only (NOT selection/highlight:
  // fading never removes a point from view, so recounting on selection changes
  // would be wasted O(N) work).
  private _visiblePointCountCache: number | null = null;
  private _visiblePointCountKey: {
    plotData: PlotData;
    data: VisualizationData | null;
    selectedAnnotation: string;
    hiddenAnnotationValues: string[];
  } | null = null;
  private _quadtreeRebuildRafId: number | null = null;
  private _hoverRaf: number | null = null;
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

  // Duplicate stacks (exact same coordinates)
  private _duplicateStacks: Array<{
    key: string;
    x: number;
    y: number;
    px: number;
    py: number;
    points: PlotDataPoint[];
  }> = [];
  private _duplicateStackByKey = new Map<
    string,
    { key: string; x: number; y: number; px: number; py: number; points: PlotDataPoint[] }
  >();
  private _pointIdToDuplicateStackKey = new Map<string, string>();
  private _expandedDuplicateStackKey: string | null = null;
  // Anchor position the user clicked to open the current spider. Stored separately
  // from the per-viewport stack object so it survives the rebuild that happens on
  // every pan/zoom (see _applyExpandedSpiderAnchor).
  private _expandedSpiderAnchor: { stackKey: string; x: number; y: number } | null = null;
  private _isDuplicateStackUIEnabled(): boolean {
    return !!this._mergedConfig.enableDuplicateStackUI;
  }
  private _duplicateOverlayDebounceId: number | null = null;
  private _duplicateStacksCacheKey: string | null = null;
  private _duplicateStacksComputeJobId = 0;
  private _duplicateStacksComputing = false;
  // Spiderfy interaction can lose native 'click' due to d3.zoom gesture handling in some browsers.
  // Track press/release to reliably treat spiderfy node interactions like normal point clicks.
  private _spiderfyPressByPointerId = new Map<number, { x: number; y: number; t: number }>();

  private _webglRenderPerf = new WebglRenderPerfRunner(this);

  // Monotonically-increasing token used to invalidate a pending async tooltip-height
  // measurement when a newer hover or a tooltip-clear supersedes it before the child
  // LitElement has finished rendering.
  private _tooltipMeasureToken = 0;

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
  private _numericRecomputeJobId = 0;

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
      ) as ScalePair | null;
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
    const selectedNumericValuesCacheRef = this.selectedAnnotation
      ? (this.data.numeric_annotation_data?.[this.selectedAnnotation] ?? null)
      : null;
    const selectedNumericSettings = this.selectedAnnotation
      ? this.numericAnnotationSettings?.[this.selectedAnnotation]
      : undefined;
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
    });

    if (
      this._lastMaterializedSource === this.data &&
      this._lastMaterializedNumericValues === selectedNumericValuesCacheRef &&
      this._materializedDataCacheKey === cacheKey &&
      this._materializedDataCache
    ) {
      return this._materializedDataCache;
    }

    this._materializedDataCache = materializeVisualizationData(
      sourceData,
      this.numericAnnotationSettings,
      10,
      this.selectedAnnotation,
    );
    this._lastMaterializedSource = this.data;
    this._lastMaterializedNumericValues = selectedNumericValuesCacheRef;
    this._materializedDataCacheKey = cacheKey;
    return this._materializedDataCache;
  }

  private _getVisibleProteinIdsSet(): Set<string> | null {
    if (!this.filtersActive) return null;
    return new Set(this.filteredProteinIds);
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
    this.requestUpdate();
    void this.updateComplete.then(() => this._updateSizeAndRender());
  };

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver.observe(this);

    this.addEventListener('legend-zorder-change', this._handleZOrderChange);
    this.addEventListener('legend-colormapping-change', this._handleColorMappingChange);
    this.addEventListener('dragover', this.handleDragOver);
    this.addEventListener('dragenter', this.handleDragEnter);
    this.addEventListener('dragleave', this.handleDragLeave);
    this.addEventListener('drop', this.handleDrop);
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    if (this._quadtreeRebuildRafId !== null) {
      cancelAnimationFrame(this._quadtreeRebuildRafId);
      this._quadtreeRebuildRafId = null;
    }
    if (this._zoomRafId !== null) {
      cancelAnimationFrame(this._zoomRafId);
      this._zoomRafId = null;
    }
    if (this._hoverRaf !== null) {
      cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = null;
    }
    this._pendingHover = null;
    this._cancelDuplicateOverlayDebounce();
    this._cancelDuplicateStackCompute();
    this._clearDuplicateBadgesCanvas();
    this._webglRenderer?.destroy();
    if (this._brush) {
      this._brush.on('start', null).on('end', null);
      this._brush = null;
      this._isBrushing = false;
    }
    this._cleanupLasso();

    super.disconnectedCallback();
    this.removeEventListener('legend-zorder-change', this._handleZOrderChange);
    this.removeEventListener('legend-colormapping-change', this._handleColorMappingChange);
    this.removeEventListener('dragover', this.handleDragOver);
    this.removeEventListener('dragenter', this.handleDragEnter);
    this.removeEventListener('dragleave', this.handleDragLeave);
    this.removeEventListener('drop', this.handleDrop);
  }

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
    const customEvent = event as CustomEvent;
    this._zOrderMapping = customEvent.detail.zOrderMapping;
    // z-order affects GPU depth; force a fresh style getter cache so getDepth sees the new mapping
    this._styleGettersCache = null;

    if (this._plotData.length > 0) {
      // Z-order mapping changed but coordinates didn't — ask the renderer to
      // re-sort by depth without invalidating the position cache.
      this._webglRenderer?.invalidateDepthOrder();
      this._webglRenderer?.invalidateStyleCache();
      this._renderPlot();
    }
  };

  private _handleColorMappingChange = (event: Event) => {
    const customEvent = event as CustomEvent;
    this._colorMapping = customEvent.detail.colorMapping;
    this._shapeMapping = customEvent.detail.shapeMapping;
    const colorOnly = customEvent.detail.colorOnly ?? false;

    // Force fresh style getters to use new color/shape mapping
    this._styleGettersCache = null;

    // Trigger render (z-order is handled in WebGL depth; avoid CPU-sorting on every zoom/pan)
    if (this._plotData.length > 0) {
      // For color-only changes, we don't need to invalidate positions or re-sort points
      // Only invalidate style cache to update colors
      if (!colorOnly) {
        // Z-order mapping may have changed; ask the renderer to re-sort by depth
        // without invalidating the position cache.
        this._webglRenderer?.invalidateDepthOrder();
        this._invalidateVirtualizationCache();
      }
      this._webglRenderer?.invalidateStyleCache();
      this._renderPlot();
    }
  };

  updated(changedProperties: Map<string, unknown>) {
    // When new data is loaded (or projection index changes), ensure the selection is valid.
    // This prevents a blank plot when switching from a dataset with many projections/annotations
    // to one with only a single projection/annotation.
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

    // A query filter is scoped to the current dataset. On a dataset swap, drop the
    // filtered-id set before _processData runs below — otherwise a stale set (ids
    // from the previous dataset) would match nothing and blank the new plot. Set
    // here (not via a getter) so the synchronous _processData read sees it cleared.
    if (changedProperties.has('data') && this.filtersActive) {
      this.filteredProteinIds = [];
      this.filtersActive = false;
    }

    const numericSettingsChangedOnly =
      changedProperties.has('numericAnnotationSettings') &&
      !changedProperties.has('data') &&
      !changedProperties.has('filteredProteinIds') &&
      !changedProperties.has('filtersActive') &&
      !changedProperties.has('selectedProjectionIndex') &&
      !changedProperties.has('projectionPlane');

    if (
      changedProperties.has('data') ||
      changedProperties.has('filteredProteinIds') ||
      changedProperties.has('filtersActive') ||
      changedProperties.has('selectedProjectionIndex') ||
      changedProperties.has('projectionPlane')
    ) {
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
            detail: { data: this.getCurrentData() ?? this._getMaterializedData() ?? this.data },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
    if (numericSettingsChangedOnly && this.data) {
      this._scheduleNumericAnnotationRefresh();
    }
    if (changedProperties.has('config')) {
      const prev = this._mergedConfig;
      this._mergedConfig = { ...DEFAULT_CONFIG, ...prev, ...this.config };
      const prevDupUI = !!prev.enableDuplicateStackUI;
      const nextDupUI = !!this._mergedConfig.enableDuplicateStackUI;
      if (prevDupUI !== nextDupUI) {
        // Cancel any in-flight work and invalidate caches when toggling.
        this._cancelDuplicateOverlayDebounce();
        this._cancelDuplicateStackCompute();
        this._duplicateStacksCacheKey = null;
      }
      this._updateStyleSignature();
      this._webglRenderer?.invalidateStyleCache();
      this._webglRenderer?.setStyleSignature(this._styleSig);
      this._scheduleQuadtreeRebuild();
    }
    if (
      changedProperties.has('selectedAnnotation') ||
      changedProperties.has('hiddenAnnotationValues') ||
      changedProperties.has('otherAnnotationValues')
    ) {
      this._scheduleQuadtreeRebuild();
      this._webglRenderer?.invalidateStyleCache();
      this._updateStyleSignature();
      this._webglRenderer?.setStyleSignature(this._styleSig);

      // Position/sort rebuild only when annotation or "Other" category changes
      // (affects colors, shapes, z-order). Visibility toggles only change alpha
      // values — hidden points stay in GPU arrays with alpha=0, preserving sort
      // order and enabling the fast color-only update path.
      if (
        changedProperties.has('selectedAnnotation') ||
        changedProperties.has('otherAnnotationValues')
      ) {
        this._webglRenderer?.invalidatePositionCache();
      }
    }
    if (
      changedProperties.has('selectionMode') ||
      (changedProperties.has('selectionTool') && this.selectionMode)
    ) {
      this._updateSelectionMode();
    }
    // Refresh cached style getters when any relevant input changes
    if (
      changedProperties.has('data') ||
      changedProperties.has('numericAnnotationSettings') ||
      changedProperties.has('selectedAnnotation') ||
      changedProperties.has('hiddenAnnotationValues') ||
      changedProperties.has('otherAnnotationValues') ||
      changedProperties.has('selectedProteinIds') ||
      changedProperties.has('highlightedProteinIds') ||
      changedProperties.has('config')
    ) {
      this._styleGettersCache = this._buildStyleGetters();
    }
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
    this._initializeInteractions();
    this._updateSizeAndRender();
    if (this._canvas) {
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
          getStrokeColor: (p: PlotDataPoint) => this._getStrokeColor(p),
          getStrokeWidth: (p: PlotDataPoint) => this._getStrokeWidth(p),
          getShape: (p: PlotDataPoint) => this._getPointShape(p),
        },
        this._handleWebglContextLost,
      );
      this._updateStyleSignature();
      this._webglRenderer.setStyleSignature(this._styleSig);
      this._syncWebglSelectionActive();
    }
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
    if (!this.data) return;

    const jobId = ++this._numericRecomputeJobId;
    this._numericRecomputeState = {
      running: true,
      annotation: this.selectedAnnotation,
      startedAt: performance.now(),
    };
    this.dispatchEvent(
      new CustomEvent('numeric-recompute-start', {
        detail: { annotation: this.selectedAnnotation },
        bubbles: true,
        composed: true,
      }),
    );
    this.requestUpdate();

    requestAnimationFrame(() => {
      if (jobId !== this._numericRecomputeJobId) return;

      const materializedData = this._getMaterializedData();
      if (!materializedData) {
        this._numericRecomputeState = { running: false, annotation: null, startedAt: null };
        return;
      }

      const displayData = this._getCurrentDisplayData() ?? materializedData;

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

      this.dispatchEvent(
        new CustomEvent('numeric-recompute-end', {
          detail: {
            annotation: this.selectedAnnotation,
            durationMs:
              this._numericRecomputeState.startedAt == null
                ? 0
                : performance.now() - this._numericRecomputeState.startedAt,
          },
          bubbles: true,
          composed: true,
        }),
      );
      this._numericRecomputeState = { running: false, annotation: null, startedAt: null };
      this.requestUpdate();
    });
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

    const keptIndices: number[] = [];
    materializedData.protein_ids.forEach((proteinId, index) => {
      if (visibleProteinIds.has(proteinId)) {
        keptIndices.push(index);
      }
    });

    return {
      ...materializedData,
      protein_ids: keptIndices.map((index) => materializedData.protein_ids[index]),
      projections: materializedData.projections.map((projection) => {
        const dim = projection.dimension;
        const out = new Float32Array(keptIndices.length * dim);
        for (let k = 0; k < keptIndices.length; k++) {
          const base = keptIndices[k] * dim;
          const o = k * dim;
          out[o] = projection.data[base];
          out[o + 1] = projection.data[base + 1];
          if (dim === 3) out[o + 2] = projection.data[base + 2];
        }
        return { ...projection, data: out, dimension: dim };
      }),
      annotation_data: Object.fromEntries(
        Object.entries(materializedData.annotation_data).map(([annotationName, rows]) => [
          annotationName,
          sliceAnnotationData(rows, keptIndices),
        ]),
      ),
      numeric_annotation_data: materializedData.numeric_annotation_data
        ? Object.fromEntries(
            Object.entries(materializedData.numeric_annotation_data).map(
              ([annotationName, values]) => [
                annotationName,
                keptIndices.map((index) => values[index]),
              ],
            ),
          )
        : undefined,
      annotation_scores: materializedData.annotation_scores
        ? Object.fromEntries(
            Object.entries(materializedData.annotation_scores).map(([annotationName, rows]) => [
              annotationName,
              keptIndices.map((index) => rows[index]),
            ]),
          )
        : undefined,
      annotation_evidence: materializedData.annotation_evidence
        ? Object.fromEntries(
            Object.entries(materializedData.annotation_evidence).map(([annotationName, rows]) => [
              annotationName,
              keptIndices.map((index) => rows[index]),
            ]),
          )
        : undefined,
    };
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
    this._cancelDuplicateStackCompute();

    if (!this._plotData.length || !this._scales) {
      this._duplicateStacks = [];
      this._duplicateStackByKey.clear();
      this._pointIdToDuplicateStackKey.clear();
      this._expandedDuplicateStackKey = null;
      this._duplicateStacksCacheKey = null;
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
    // Duplicate stacks are computed lazily for the current viewport (see _ensureDuplicateStacksForViewport)
    // to keep quadtree rebuilds fast on large datasets.
    this._duplicateStacks = [];
    this._duplicateStackByKey.clear();
    this._pointIdToDuplicateStackKey.clear();
    this._expandedDuplicateStackKey = null;
    this._duplicateStacksCacheKey = null;

    // Trigger a fresh duplicate overlay update so badges are recomputed for the
    // new quadtree (e.g. after a projection switch).  Without this, the overlays
    // rendered synchronously in updated() used a stale cache and nothing would
    // re-trigger them after the deferred quadtree rebuild.
    this._scheduleDuplicateOverlayUpdate(true);
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

  private _initializeInteractions() {
    if (!this._svg) return;

    this._svgSelection = d3.select(this._svg);

    // Clear existing content
    this._svgSelection.selectAll('*').remove();

    // Create main container group
    this._mainGroup = this._svgSelection.append('g').attr('class', 'scatter-plot-container');

    // Create brush group
    this._brushGroup = this._svgSelection.append('g').attr('class', 'brush-container');

    // Create overlay group (above brush) for transient drawings like selections
    this._overlayGroup = this._svgSelection.append('g').attr('class', 'overlay-container');

    this._zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(this._mergedConfig.zoomExtent)
      .on('zoom', (event) => {
        this._transform = event.transform;
        if (this._mainGroup) {
          this._mainGroup.attr('transform', event.transform);
        }
        if (this._brushGroup) {
          this._brushGroup.attr('transform', event.transform);
        }
        if (this._overlayGroup) {
          this._overlayGroup.attr('transform', event.transform);
        }
        // Smooth WebGL rendering during zoom using requestAnimationFrame
        if (this._canvas) {
          if (this._zoomRafId !== null) {
            cancelAnimationFrame(this._zoomRafId);
          }
          this._zoomRafId = requestAnimationFrame(() => {
            this._zoomRafId = null;
            this._renderWebGL('zoom');
            // During active zoom/pan, defer duplicate badge DOM updates to keep interactions smooth.
            this._updateSelectionOverlays({ duplicateImmediate: false });
          });
        }
        // Keep brush extent in sync with the viewport when scroll-zooming in selection mode.
        // Skip if a brush gesture is in progress — re-applying the brush resets D3's drag state.
        if (
          this.selectionMode &&
          this.selectionTool === 'rectangle' &&
          this._brush &&
          !this._isBrushing
        ) {
          this._updateBrushExtent();
        }
      });
    this._svgSelection.call(this._zoom);
    this._setupDblClickHandlers();
  }

  /** Disable D3's built-in double-click zoom and attach our own reset handler. */
  private _setupDblClickHandlers() {
    if (!this._svgSelection) return;
    this._svgSelection.on('dblclick.zoom', null);
    this._svgSelection.on('dblclick.reset', (event: MouseEvent) => {
      event.preventDefault();
      this.resetZoom();
    });
  }

  private _updateSizeAndRender() {
    const width = this.clientWidth || 800;
    const height = this.clientHeight || 600;

    if (this._canvas) {
      if (!this._webglRenderer) {
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
            getStrokeColor: (p: PlotDataPoint) => this._getStrokeColor(p),
            getStrokeWidth: (p: PlotDataPoint) => this._getStrokeWidth(p),
            getShape: (p: PlotDataPoint) => this._getPointShape(p),
          },
          this._handleWebglContextLost,
        );
        this._updateStyleSignature();
        this._webglRenderer.setStyleSignature(this._styleSig);
      }
      this._webglRenderer.resize(width, height);
      // Force fresh style getters to ensure depth values are recomputed consistently
      this._styleGettersCache = null;
      this._webglRenderer.invalidatePositionCache();
      // Also invalidate style cache to force re-sorting of colors when point order may change
      this._webglRenderer.invalidateStyleCache();
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
  }

  private _clearDuplicateBadgesCanvas() {
    if (!this._badgesCanvas) return;
    const ctx = this._badgesCanvas.getContext('2d');
    if (!ctx) return;
    // Clear in device pixels (canvas is sized to DPR).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._badgesCanvas.width, this._badgesCanvas.height);
  }

  private _renderDuplicateBadgesCanvas(
    stacks: Array<{ key: string; px: number; py: number; points: PlotDataPoint[] }>,
  ) {
    if (!this._badgesCanvas) return;
    const ctx = this._badgesCanvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = this._mergedConfig.width;
    const height = this._mergedConfig.height;

    // Work in CSS pixels for drawing; scale to device pixels once.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const t = this._transform;
    const badgeOffset = { x: 10, y: -10 };
    const r = 9;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 10px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';

    for (let i = 0; i < stacks.length; i++) {
      const s = stacks[i];
      const x = t.x + t.k * s.px + badgeOffset.x;
      const y = t.y + t.k * s.py + badgeOffset.y;
      const isExpanded = s.key === this._expandedDuplicateStackKey;

      ctx.fillStyle = isExpanded ? 'rgba(59, 130, 246, 0.9)' : 'rgba(17, 24, 39, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(s.points.length), x, y);
    }
  }

  // HiDPI setup and quality handled by WebGLRenderer

  private _updateSelectionMode() {
    if (!this._svgSelection || !this._brushGroup || !this._scales) return;

    // Clean up both selection tools
    this._brushGroup.selectAll('*').remove();
    this._cleanupLasso();
    this._brush = null;
    this._isBrushing = false;

    if (this.selectionMode) {
      // Keep scroll-wheel zoom active but disable drag-to-pan (drag = selection)
      if (this._zoom && this._svgSelection) {
        this._svgSelection
          .on('mousedown.zoom', null)
          .on('touchstart.zoom', null)
          .on('touchmove.zoom', null)
          .on('touchend.zoom', null);
      }

      if (this.selectionTool === 'lasso') {
        this._setupLasso();
      } else {
        this._setupBrush();
      }
    } else {
      // Re-enable zoom
      if (this._zoom) {
        this._svgSelection.call(this._zoom);
        this._setupDblClickHandlers();
      }
    }
  }

  private _setupBrush() {
    if (!this._svgSelection || !this._brushGroup) return;

    this._brush = d3
      .brush()
      .handleSize(0)
      .on('start', () => {
        this._isBrushing = true;
      })
      .on('end', (event) => {
        this._isBrushing = false;
        this._handleBrushEnd(event);
      });

    this._updateBrushExtent();
  }

  /** Recompute the brush extent from the current zoom transform and re-apply. */
  private _updateBrushExtent() {
    if (!this._brush || !this._brushGroup) return;

    const config = this._mergedConfig;
    const t = this._transform;
    const vx0 = t.invertX(0);
    const vy0 = t.invertY(0);
    const vx1 = t.invertX(config.width);
    const vy1 = t.invertY(config.height);

    this._brush.extent([
      [Math.min(vx0, vx1), Math.min(vy0, vy1)],
      [Math.max(vx0, vx1), Math.max(vy0, vy1)],
    ]);

    this._brushGroup.call(this._brush);
  }

  // ── Lasso selection ──────────────────────────────────────────────

  private _setupLasso() {
    if (!this._svgSelection) return;

    this._svgSelection
      .on('pointerdown.lasso', (event: PointerEvent) => this._handleLassoStart(event))
      .on('pointermove.lasso', (event: PointerEvent) => this._handleLassoMove(event))
      .on('pointerup.lasso', (event: PointerEvent) => this._handleLassoEnd(event));
  }

  private _cleanupLasso() {
    if (this._svgSelection) {
      this._svgSelection.on('pointerdown.lasso', null);
      this._svgSelection.on('pointermove.lasso', null);
      this._svgSelection.on('pointerup.lasso', null);
    }
    if (this._lassoRafId !== null) {
      cancelAnimationFrame(this._lassoRafId);
      this._lassoRafId = null;
    }
    this._lassoPath?.remove();
    this._lassoPath = null;
    this._lassoVertices = [];
    this._isLassoing = false;
  }

  /** Convert a pointer event to local (untransformed) SVG coordinates. */
  private _pointerToLocal(event: PointerEvent): [number, number] {
    const [svgX, svgY] = d3.pointer(event);
    const localX = (svgX - this._transform.x) / this._transform.k;
    const localY = (svgY - this._transform.y) / this._transform.k;
    return [localX, localY];
  }

  private _handleLassoStart(event: PointerEvent) {
    if (event.button !== 0) return; // left click only
    event.preventDefault();

    this._isLassoing = true;
    this._lassoVertices = [this._pointerToLocal(event)];

    // Create the SVG path in the brush group (same coordinate space as the brush)
    if (this._brushGroup) {
      this._lassoPath = this._brushGroup.append('path').attr('class', 'lasso-path').node();
    }

    // Capture pointer for reliable tracking even if cursor leaves the SVG
    (event.target as Element)?.setPointerCapture?.(event.pointerId);
  }

  private _handleLassoMove(event: PointerEvent) {
    if (!this._isLassoing || !this._lassoPath) return;
    event.preventDefault();

    this._lassoVertices.push(this._pointerToLocal(event));

    // Throttle SVG path updates to animation frames
    if (this._lassoRafId === null) {
      this._lassoRafId = requestAnimationFrame(() => {
        this._lassoRafId = null;
        if (!this._lassoPath || this._lassoVertices.length < 2) return;

        const d = this._lassoVertices
          .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`)
          .join(' ');
        this._lassoPath.setAttribute('d', d);
      });
    }
  }

  private _handleLassoEnd(event: PointerEvent) {
    if (!this._isLassoing) return;
    event.preventDefault();
    this._isLassoing = false;

    (event.target as Element)?.releasePointerCapture?.(event.pointerId);

    // Need at least 3 vertices to form a polygon
    if (this._lassoVertices.length < 3) {
      this._clearLassoVisual();
      return;
    }

    // Close the path visually
    if (this._lassoPath) {
      const d = this._lassoPath.getAttribute('d') ?? '';
      this._lassoPath.setAttribute('d', d + ' Z');
    }

    const slots = this._quadtreeIndex.queryByPolygon(this._lassoVertices);
    const visibilityModel = this._getVisibilityModel();
    const selectedIds = slots
      .map((s) => materializePlotDataPoint(this._plotData, s))
      .filter((p) => visibilityModel.isInteractive(p))
      .map((p) => p.id);
    this._commitSelection(selectedIds, () => this._clearLassoVisual());
  }

  private _clearLassoVisual() {
    if (this._lassoPath) {
      this._lassoPath.remove();
      this._lassoPath = null;
    }
    this._lassoVertices = [];
  }

  private _handleBrushEnd(event: d3.D3BrushEvent<unknown>) {
    if (!event.selection) return;

    const [[x0, y0], [x1, y1]] = event.selection as [[number, number], [number, number]];
    const slots = this._quadtreeIndex.queryByPixels(x0, y0, x1, y1);
    const visibilityModel = this._getVisibilityModel();
    const selectedIds = slots
      .map((s) => materializePlotDataPoint(this._plotData, s))
      .filter((p) => visibilityModel.isInteractive(p))
      .map((p) => p.id);
    this._commitSelection(selectedIds, () => {
      if (this._brush && this._brushGroup) {
        this._brushGroup.call(this._brush.move, null);
      }
    });
  }

  /**
   * Shared selection commit logic for both brush and lasso.
   * Updates selectedProteinIds, dispatches the event, and schedules visual cleanup.
   */
  private _commitSelection(selectedIds: string[], clearVisual: () => void) {
    if (selectedIds.length > 0) {
      requestAnimationFrame(() => {
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
      this._setupCanvasEventHandling();
    }
  }

  private _renderWebGL(trigger: RenderWebGLTrigger = 'unknown') {
    const perfToken = this._webglRenderPerf.start(trigger);

    const pd = this._getPointsForRendering();

    this._webglRenderer!.setTrackRenderedPointIds(pd.length > MAX_POINTS_DIRECT_RENDER);
    this._webglRenderer!.render(pd);
    this._mainGroup?.selectAll('.protein-point').remove();

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
    const padding = VIRTUALIZATION_PADDING;

    const leftPx = transform.invertX(config.margin.left - padding);
    const rightPx = transform.invertX(config.width - config.margin.right + padding);
    const topPx = transform.invertY(config.margin.top - padding);
    const bottomPx = transform.invertY(config.height - config.margin.bottom + padding);

    const minX = Math.min(leftPx, rightPx);
    const maxX = Math.max(leftPx, rightPx);
    const minY = Math.min(topPx, bottomPx);
    const maxY = Math.max(topPx, bottomPx);

    const cacheKey = `${Math.round(transform.x)}|${Math.round(transform.y)}|${transform.k.toFixed(3)}|${config.width}|${config.height}`;
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
    if (!this._overlayGroup) return;
    this._overlayGroup.selectAll('.selected-overlay').remove();
    this._scheduleDuplicateOverlayUpdate(options.duplicateImmediate ?? true);
  }

  private _cancelDuplicateOverlayDebounce() {
    if (this._duplicateOverlayDebounceId !== null) {
      window.clearTimeout(this._duplicateOverlayDebounceId);
      this._duplicateOverlayDebounceId = null;
    }
  }

  private _cancelDuplicateStackCompute() {
    // Bump job id so any in-flight chunked compute aborts early.
    this._duplicateStacksComputeJobId++;
    this._duplicateStacksComputing = false;
  }

  private _scheduleDuplicateOverlayUpdate(immediate: boolean) {
    if (!this._overlayGroup) return;

    // When the feature is disabled, keep this lightweight and synchronous.
    if (!this._isDuplicateStackUIEnabled()) {
      this._updateDuplicateOverlays();
      return;
    }

    if (immediate) {
      this._cancelDuplicateOverlayDebounce();
      this._updateDuplicateOverlays();
      return;
    }

    // Cheap path: redraw existing badges with the current zoom transform (no recompute, no DOM churn).
    this._redrawDuplicateBadgesCanvasOnly();

    // Debounce to avoid DOM churn during pan/zoom.
    this._cancelDuplicateOverlayDebounce();
    this._duplicateOverlayDebounceId = window.setTimeout(() => {
      this._duplicateOverlayDebounceId = null;
      this._updateDuplicateOverlays();
    }, DUPLICATE_BADGES_UPDATE_DEBOUNCE_MS);
  }

  private _ensureDuplicateStacksForViewport(
    viewKey: string,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): boolean {
    if (this._duplicateStacksCacheKey === viewKey) return true;
    if (this._duplicateStacksComputing) return false;

    this._duplicateStacksComputing = true;
    const jobId = ++this._duplicateStacksComputeJobId;

    // Query only the slots currently in (or near) the viewport. This is the key perf win.
    const candidateSlots = this._quadtreeIndex.queryByPixels(minX, minY, maxX, maxY);
    const scales = this._scales;
    if (!scales) {
      this._duplicateStacksComputing = false;
      return false;
    }

    const stackMap = new Map<
      string,
      { key: string; x: number; y: number; px: number; py: number; points: PlotDataPoint[] }
    >();
    const idToKey = new Map<string, string>();

    let idx = 0;
    const step = () => {
      if (jobId !== this._duplicateStacksComputeJobId) return; // cancelled
      const end = Math.min(candidateSlots.length, idx + DUPLICATE_STACK_COMPUTE_CHUNK_SIZE);
      for (; idx < end; idx++) {
        const slot = candidateSlots[idx];
        const p = materializePlotDataPoint(this._plotData, slot);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

        // Group only points that share coords in the *current* projection
        // (see duplicate-stack-helpers for the rationale and key contract).
        const key = getDuplicateStackKey(p);

        let stack = stackMap.get(key);
        if (!stack) {
          stack = {
            key,
            x: p.x,
            y: p.y,
            px: scales.x(p.x),
            py: scales.y(p.y),
            points: [],
          };
          stackMap.set(key, stack);
        }
        stack.points.push(p);
        idToKey.set(p.id, key);
      }

      if (idx < candidateSlots.length) {
        requestAnimationFrame(step);
        return;
      }

      // Finalize: keep only true duplicates.
      const stacks: Array<{
        key: string;
        x: number;
        y: number;
        px: number;
        py: number;
        points: PlotDataPoint[];
      }> = [];
      const byKey = new Map<
        string,
        { key: string; x: number; y: number; px: number; py: number; points: PlotDataPoint[] }
      >();

      for (const stack of stackMap.values()) {
        if (stack.points.length > 1) {
          stacks.push(stack);
          byKey.set(stack.key, stack);
        }
      }

      this._duplicateStacks = stacks;
      this._duplicateStackByKey = byKey;
      this._pointIdToDuplicateStackKey = idToKey;

      // If the expanded stack is no longer available for this viewport, collapse it.
      if (
        this._expandedDuplicateStackKey &&
        !this._duplicateStackByKey.has(this._expandedDuplicateStackKey)
      ) {
        this._expandedDuplicateStackKey = null;
        this._expandedSpiderAnchor = null;
      }

      // Restore the user's spider anchor on the freshly built stack object so
      // pan/zoom doesn't snap the spider back to whichever group member was
      // iterated first.
      this._applyExpandedSpiderAnchor();

      this._duplicateStacksCacheKey = viewKey;
      this._duplicateStacksComputing = false;

      // Re-render overlays for the freshly computed viewport stacks.
      this._updateDuplicateOverlays();
    };

    requestAnimationFrame(step);
    return false;
  }

  private _capDuplicateStacksForRendering(
    stacks: Array<{ key: string; px: number; py: number; points: PlotDataPoint[] }>,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): Array<{ key: string; px: number; py: number; points: PlotDataPoint[] }> {
    let stacksToRender = stacks;

    if (stacksToRender.length > DUPLICATE_BADGES_MAX_VISIBLE) {
      stacksToRender = [...stacksToRender]
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, DUPLICATE_BADGES_MAX_VISIBLE);

      // Ensure the expanded stack remains visible even if it is not in the top-N.
      if (
        this._expandedDuplicateStackKey &&
        !stacksToRender.some((s) => s.key === this._expandedDuplicateStackKey)
      ) {
        const expanded = this._duplicateStackByKey.get(this._expandedDuplicateStackKey);
        if (
          expanded &&
          expanded.px >= minX &&
          expanded.px <= maxX &&
          expanded.py >= minY &&
          expanded.py <= maxY
        ) {
          stacksToRender = [...stacksToRender, expanded];
        }
      }
    }

    return stacksToRender;
  }

  private _redrawDuplicateBadgesCanvasOnly() {
    if (!this._isDuplicateStackUIEnabled() || this.selectionMode) {
      this._clearDuplicateBadgesCanvas();
      return;
    }
    if (!this._scales) return;

    const config = this._mergedConfig;
    const padding = DUPLICATE_BADGES_VIEWPORT_PADDING;
    const leftPx = this._transform.invertX(config.margin.left - padding);
    const rightPx = this._transform.invertX(config.width - config.margin.right + padding);
    const topPx = this._transform.invertY(config.margin.top - padding);
    const bottomPx = this._transform.invertY(config.height - config.margin.bottom + padding);

    const minX = Math.min(leftPx, rightPx);
    const maxX = Math.max(leftPx, rightPx);
    const minY = Math.min(topPx, bottomPx);
    const maxY = Math.max(topPx, bottomPx);

    const visibleStacks = this._duplicateStacks.filter(
      (s) => s.px >= minX && s.px <= maxX && s.py >= minY && s.py <= maxY,
    );
    const stacksToRender = this._capDuplicateStacksForRendering(
      visibleStacks,
      minX,
      minY,
      maxX,
      maxY,
    );

    // Note: canvas drawing uses screen coordinates and already keeps badge size constant.
    this._renderDuplicateBadgesCanvas(stacksToRender);
  }

  private _ensureDuplicateSpiderfyLayer() {
    if (!this._overlayGroup) return null;
    let spiderfyLayer = this._overlayGroup.select<SVGGElement>('g.duplicate-spiderfy-layer');
    if (spiderfyLayer.empty()) {
      spiderfyLayer = this._overlayGroup.append('g').attr('class', 'duplicate-spiderfy-layer');
    }
    return spiderfyLayer;
  }

  private _updateDuplicateOverlays() {
    if (!this._overlayGroup || !this._scales) return;

    if (!this._isDuplicateStackUIEnabled()) {
      // Remove both to clean up older DOM from previous versions.
      this._overlayGroup.selectAll('g.duplicate-stacks-layer, g.duplicate-spiderfy-layer').remove();
      this._expandedDuplicateStackKey = null;
      this._clearDuplicateBadgesCanvas();
      return;
    }

    // Don't show stack UI while brushing/selecting.
    if (this.selectionMode) {
      this._overlayGroup.selectAll('g.duplicate-stacks-layer, g.duplicate-spiderfy-layer').remove();
      this._expandedDuplicateStackKey = null;
      this._clearDuplicateBadgesCanvas();
      return;
    }

    const spiderfyLayer = this._ensureDuplicateSpiderfyLayer();
    if (!spiderfyLayer) return;

    const k = this._transform.k || 1;
    const config = this._mergedConfig;
    const viewKey = `${Math.round(this._transform.x)}|${Math.round(this._transform.y)}|${k.toFixed(3)}|${config.width}|${config.height}`;

    // Compute visible window in "base pixel space" (same as quadtree indexing).
    const padding = DUPLICATE_BADGES_VIEWPORT_PADDING;
    const leftPx = this._transform.invertX(config.margin.left - padding);
    const rightPx = this._transform.invertX(config.width - config.margin.right + padding);
    const topPx = this._transform.invertY(config.margin.top - padding);
    const bottomPx = this._transform.invertY(config.height - config.margin.bottom + padding);

    const minX = Math.min(leftPx, rightPx);
    const maxX = Math.max(leftPx, rightPx);
    const minY = Math.min(topPx, bottomPx);
    const maxY = Math.max(topPx, bottomPx);

    // Ensure we have duplicate stacks for the current viewport before trying to render.
    if (!this._ensureDuplicateStacksForViewport(viewKey, minX, minY, maxX, maxY)) {
      // Keep existing DOM as-is until computation finishes; _updateDuplicateOverlays will rerun.
      return;
    }

    const visibleStacks = this._duplicateStacks.filter(
      (s) => s.px >= minX && s.px <= maxX && s.py >= minY && s.py <= maxY,
    );

    // --- Badges (N) ---
    const stacksToRender = this._capDuplicateStacksForRendering(
      visibleStacks,
      minX,
      minY,
      maxX,
      maxY,
    );

    // Phase 3: render badges via a lightweight 2D canvas overlay (much faster than many SVG nodes).
    // Spiderfy remains in SVG for interaction.
    this._renderDuplicateBadgesCanvas(stacksToRender);

    // --- Spiderfy ---
    spiderfyLayer.selectAll('*').remove();
    if (!this._expandedDuplicateStackKey) return;

    const stack = this._duplicateStackByKey.get(this._expandedDuplicateStackKey);
    if (!stack) {
      this._expandedDuplicateStackKey = null;
      return;
    }

    // Hide spiderfy if the stack is off-screen (e.g., after a zoom/pan).
    if (!(stack.px >= minX && stack.px <= maxX && stack.py >= minY && stack.py <= maxY)) {
      this._expandedDuplicateStackKey = null;
      return;
    }

    const points = stack.points;
    const n = points.length;
    // Ring radius in screen pixels (kept constant by scale(1/k) below)
    const ringRadius = Math.min(70, Math.max(22, 12 + n * 2));
    const nodeRadius = 5;

    const spiderGroup = spiderfyLayer
      .append('g')
      .attr('class', 'dup-spiderfy')
      // Keep spiderfy UI constant-size in screen pixels via scale(1/k)
      .attr('transform', `translate(${stack.px},${stack.py}) scale(${1 / k})`);

    const items = points.map((p, idx) => {
      const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
      const x = ringRadius * Math.cos(angle);
      const y = ringRadius * Math.sin(angle);
      return { point: p, idx, x, y };
    });

    // Leader lines
    spiderGroup
      .selectAll('line.dup-spiderfy-line')
      .data(items)
      .enter()
      .append('line')
      .attr('class', 'dup-spiderfy-line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d) => d.x)
      .attr('y2', (d) => d.y);

    // Clickable nodes
    const nodes = spiderGroup
      .selectAll('g.dup-spiderfy-node')
      .data(items)
      .enter()
      .append('g')
      .attr('class', 'dup-spiderfy-node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    // Create circles with explicit pointer-events and handle selection via pointer press/release.
    // We avoid relying on the native 'click' event because it can be suppressed by d3.zoom gesture handling.
    nodes
      .append('circle')
      .attr('class', 'dup-spiderfy-node-circle')
      .attr('r', nodeRadius)
      .attr('fill', (d) => this._getColors(d.point)[0] ?? '#888888')
      .style('pointer-events', 'all')
      .style('cursor', 'pointer')
      .on('pointerdown', (event) => {
        event.stopPropagation();
        const pe = event as PointerEvent;
        if (typeof pe.pointerId === 'number') {
          this._spiderfyPressByPointerId.set(pe.pointerId, {
            x: pe.clientX,
            y: pe.clientY,
            t: Date.now(),
          });
        }
        // Keep pointer events routed to this element even if the pointer moves slightly.
        const el = event.currentTarget as HTMLElement | null;
        if (el && typeof el.setPointerCapture === 'function' && typeof pe.pointerId === 'number') {
          try {
            el.setPointerCapture(pe.pointerId);
          } catch {
            // ignore
          }
        }
      })
      .on('pointerup', (event, d) => {
        event.stopPropagation();
        const pe = event as PointerEvent;
        const rec =
          typeof pe.pointerId === 'number'
            ? this._spiderfyPressByPointerId.get(pe.pointerId)
            : undefined;
        if (typeof pe.pointerId === 'number') this._spiderfyPressByPointerId.delete(pe.pointerId);
        if (!rec) return;

        // Treat a short, low-movement press/release as a click.
        const dx = pe.clientX - rec.x;
        const dy = pe.clientY - rec.y;
        const dist2 = dx * dx + dy * dy;
        const dt = Date.now() - rec.t;
        if (dist2 <= 16 && dt <= 700) {
          this._handleClick(event as unknown as MouseEvent, d.point);
        }
      })
      .on('lostpointercapture', (event) => {
        const pe = event as PointerEvent;
        if (typeof pe.pointerId === 'number') this._spiderfyPressByPointerId.delete(pe.pointerId);
      })
      .on('pointercancel', (event) => {
        const pe = event as PointerEvent;
        if (typeof pe.pointerId === 'number') this._spiderfyPressByPointerId.delete(pe.pointerId);
      })
      .on('mouseenter', (event, d) => {
        // Show the real tooltip for the hovered protein (not the stack centroid)
        this._handleMouseOver(event as unknown as MouseEvent, d.point);
      })
      .on('mouseleave', () => {
        this._clearHoverState();
      });
  }

  private _toggleSpiderfy(stackKey: string, anchorPoint?: PlotDataPoint) {
    this._expandedDuplicateStackKey =
      this._expandedDuplicateStackKey === stackKey ? null : stackKey;

    if (this._expandedDuplicateStackKey && anchorPoint) {
      // Remember where the user clicked so the spider stays anchored to that
      // point across pan/zoom — _duplicateStackByKey rebuilds with fresh
      // objects on every viewport recompute and would otherwise drop the anchor.
      this._expandedSpiderAnchor = {
        stackKey: this._expandedDuplicateStackKey,
        x: anchorPoint.x,
        y: anchorPoint.y,
      };
      this._applyExpandedSpiderAnchor();
    } else {
      this._expandedSpiderAnchor = null;
    }

    this._updateDuplicateOverlays();
  }

  private _applyExpandedSpiderAnchor(): void {
    const anchor = this._expandedSpiderAnchor;
    if (!anchor || !this._scales) return;
    if (anchor.stackKey !== this._expandedDuplicateStackKey) return;
    const stack = this._duplicateStackByKey.get(anchor.stackKey);
    if (!stack) return;
    stack.x = anchor.x;
    stack.y = anchor.y;
    stack.px = this._scales.x(anchor.x);
    stack.py = this._scales.y(anchor.y);
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
      key.fadedOpacity === fadedOpacity
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
    };
    return model;
  }

  /**
   * Number of plot points actually visible in the chart: `_plotData` (already
   * physically culled by isolation and query filters) minus legend-hidden
   * points (the visibility model's alpha layer). Memo key mirrors the model's
   * mask-relevant inputs — same data expression as `_getVisibilityModel` —
   * because hidden-ness is independent of selection/highlight/opacity.
   */
  private _getVisiblePointCount(): number {
    const data =
      this._getCurrentDisplayData({ includeFilteredProteinIds: false }) ??
      this._getMaterializedData() ??
      this.data;
    const key = this._visiblePointCountKey;
    if (
      this._visiblePointCountCache !== null &&
      key &&
      key.plotData === this._plotData &&
      key.data === data &&
      key.selectedAnnotation === this.selectedAnnotation &&
      key.hiddenAnnotationValues === this.hiddenAnnotationValues
    ) {
      return this._visiblePointCountCache;
    }

    const model = this._getVisibilityModel();
    const pd = this._plotData;
    const oi = pd.originalIndices;
    const sp = this._scratchPoint;
    let count = 0;
    for (let s = 0; s < pd.length; s++) {
      const origIdx = oi ? oi[s] : s;
      sp.id = pd.proteinIds[origIdx];
      sp.x = pd.xs[s];
      sp.y = pd.ys[s];
      sp.originalIndex = origIdx;
      if (model.tierOf(sp) !== 'hidden') count++;
    }
    this._visiblePointCountCache = count;
    this._visiblePointCountKey = {
      plotData: this._plotData,
      data,
      selectedAnnotation: this.selectedAnnotation,
      hiddenAnnotationValues: this.hiddenAnnotationValues,
    };
    return count;
  }

  private _getDepth(point: PlotDataPoint): number {
    const getters = this._getStyleGetters();
    return getters.getDepth(point);
  }

  private _getStrokeColor(point: PlotDataPoint): string {
    const getters = this._getStyleGetters();
    return getters.getStrokeColor(point);
  }

  private _getStrokeWidth(point: PlotDataPoint): number {
    const getters = this._getStyleGetters();
    return getters.getStrokeWidth(point);
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
  private _setupCanvasEventHandling(): void {
    if (!this._svgSelection) return;

    // Use event delegation on the SVG overlay for canvas interactions
    this._svgSelection
      .on('mousemove.canvas', (event) => this._handleCanvasMouseMove(event))
      .on('click.canvas', (event) => this._handleCanvasClick(event))
      .on('mouseout.canvas', () => this._handleCanvasMouseOut());
  }

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
   * Deferred hover processing — runs inside a rAF scheduled by _handleCanvasMouseMove.
   * Behaviour is identical to the former per-event body; only the call frequency is throttled.
   */
  private _processCanvasHover(event: MouseEvent, mouseX: number, mouseY: number): void {
    if (!this._scales) return; // may have been cleared between scheduling and the frame

    // Transform mouse coordinates to data space
    const dataX = (mouseX - this._transform.x) / this._transform.k;
    const dataY = (mouseY - this._transform.y) / this._transform.k;

    // Find nearest slot using spatial index
    const searchRadius = 15 / this._transform.k; // Search radius adjusted for zoom
    const nearestSlot = this._quadtreeIndex.findNearest(dataX, dataY, searchRadius);

    if (nearestSlot >= 0) {
      const nearestPoint = materializePlotDataPoint(this._plotData, nearestSlot);

      // Don't hover non-interactive points (hidden/faded-to-0 → opacity 0)
      if (!this._getVisibilityModel().isInteractive(nearestPoint)) {
        this._clearHoverState();
        return;
      }

      // Verify the point is actually rendered (not excluded due to point limits)
      if (this._webglRenderer && !this._webglRenderer.isPointRendered(nearestPoint.id)) {
        // Point exists in spatial index but isn't rendered - clear tooltip
        this._clearHoverState();
        return;
      }

      // Calculate actual distance to verify it's within the point
      const pointX = this._scales.x(nearestPoint.x);
      const pointY = this._scales.y(nearestPoint.y);
      const distance = Math.sqrt(Math.pow(dataX - pointX, 2) + Math.pow(dataY - pointY, 2));
      const pointRadius = Math.sqrt(this._getPointSize(nearestPoint)) / 3;

      if (distance <= pointRadius) {
        this._handleMouseOver(event, nearestPoint);
        return;
      }
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
    const hadExpanded = !!this._expandedDuplicateStackKey;
    if (this._expandedDuplicateStackKey) {
      this._expandedDuplicateStackKey = null;
      this._updateDuplicateOverlays();
    }

    const [mouseX, mouseY] = d3.pointer(event);

    // Transform mouse coordinates to data space
    const dataX = (mouseX - this._transform.x) / this._transform.k;
    const dataY = (mouseY - this._transform.y) / this._transform.k;

    // Find nearest slot using spatial index
    const searchRadius = 15 / this._transform.k;
    const nearestSlot = this._quadtreeIndex.findNearest(dataX, dataY, searchRadius);

    if (nearestSlot >= 0) {
      const nearestPoint = materializePlotDataPoint(this._plotData, nearestSlot);

      // Don't click non-interactive points (hidden/faded-to-0 → opacity 0)
      if (!this._getVisibilityModel().isInteractive(nearestPoint)) {
        return;
      }

      // Verify the point is actually rendered (not excluded due to point limits)
      if (this._webglRenderer && !this._webglRenderer.isPointRendered(nearestPoint.id)) {
        return;
      }

      // Calculate actual distance to verify it's within the point
      const pointX = this._scales.x(nearestPoint.x);
      const pointY = this._scales.y(nearestPoint.y);
      const distance = Math.sqrt(Math.pow(dataX - pointX, 2) + Math.pow(dataY - pointY, 2));
      const pointRadius = Math.sqrt(this._getPointSize(nearestPoint)) / 3;

      if (distance <= pointRadius) {
        if (this._isDuplicateStackUIEnabled()) {
          // If this point belongs to a duplicate stack, spiderfy instead of picking an arbitrary member.
          const stackKey = this._pointIdToDuplicateStackKey.get(nearestPoint.id);
          const stack = stackKey ? this._duplicateStackByKey.get(stackKey) : undefined;
          if (stack && stack.points.length > 1) {
            this._toggleSpiderfy(stack.key, nearestPoint);
            return;
          }
        }

        // If we just collapsed an expanded stack, treat this click as a "dismiss" click.
        // This prevents accidental selection when the user is simply trying to close the spiderfy UI.
        if (hadExpanded) return;

        this._handleClick(event, nearestPoint);
      }
    }
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
    if (this._zoom && this._svgSelection) {
      this._svgSelection.transition().duration(750).call(this._zoom.transform, d3.zoomIdentity);
    }
  }

  /**
   * Content-scaled fallback height derived from the tooltip view model.
   * Used when the async DOM measurement has not yet resolved (first hover or
   * hover that changed data). Delegates to the pure `estimateTooltipHeight`
   * helper so the logic is unit-testable without a DOM.
   */
  private _estimateTooltipHeight(): number {
    if (!this._tooltipData) return 160;
    return estimateTooltipHeight(this._tooltipData.view);
  }

  private _getTooltipStyle() {
    if (!this._tooltipData) return '';

    const { x, y } = this._tooltipData;
    const config = this._mergedConfig;
    const padding = 15;
    const tooltipMaxWidth = 350;
    const tooltipHeight = this._tooltipHeight ?? this._estimateTooltipHeight();

    let left = x + 15;
    let top = y - 60;
    let transform = '';

    // Horizontal adjustment: if it goes off the right edge, flip to the left side
    if (left + tooltipMaxWidth > config.width) {
      // Position anchor at x - 15 and use translateX(-100%) to pull it to the left
      // this ensures the right edge of the tooltip is close to the mouse regardless of width
      left = x - 15;
      transform = 'translateX(-100%)';
    }

    // Keep within horizontal bounds (left side)
    if (!transform && left < padding) {
      left = padding;
    } else if (transform && left - tooltipMaxWidth < padding) {
      // If flipped to the left and would go off the left edge, clamp it
      left = tooltipMaxWidth + padding;
    }

    // Vertical adjustment: clamp to viewport using the measured height when
    // available, so tall multi-annotation tooltips do not run off the bottom.
    if (top + tooltipHeight > config.height - padding) {
      top = config.height - tooltipHeight - padding;
    }
    if (top < padding) {
      top = padding;
    }

    return `left: ${left}px; top: ${top}px;${transform ? ` transform: ${transform};` : ''}`;
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
        ${this._numericRecomputeState.running
          ? html`
              <div class="plot-indicator" style="left: auto; right: 0.5rem;">
                Recalculating bins for ${this._numericRecomputeState.annotation ?? 'annotation'}...
              </div>
            `
          : ''}
      </div>
    `;
  }

  private _updateStyleSignature() {
    const cfg = this._mergedConfig;
    const parts = [`ps:${cfg.pointSize}`, `annot:${this.selectedAnnotation}`];
    this._styleSig = parts.join('|');
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

    // Process data and update rendering
    this._processData();
    this._buildQuadtree();

    // Ensure canvas renderer is completely refreshed
    if (this._webglRenderer) {
      this._webglRenderer.invalidatePositionCache();
      this._webglRenderer.invalidateStyleCache();
      this._updateStyleSignature();
      this._webglRenderer.setStyleSignature(this._styleSig);
    }

    // Force immediate component update
    this.requestUpdate();

    // Render after all updates are complete
    this.updateComplete.then(() => {
      this._renderPlot();
    });

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
    return this._expandedDuplicateStackKey !== null;
  }

  /** Collapse the currently-open duplicate-badge spider, if any. */
  closeExpandedDuplicateStack(): void {
    if (this._expandedDuplicateStackKey === null) return;
    this._expandedDuplicateStackKey = null;
    this._expandedSpiderAnchor = null;
    this._updateDuplicateOverlays();
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

    // Process data and update rendering
    this._processData();
    this._buildQuadtree();

    // Ensure canvas renderer is completely refreshed
    if (this._webglRenderer) {
      this._webglRenderer.invalidatePositionCache();
      this._webglRenderer.invalidateStyleCache();
      this._updateStyleSignature();
      this._webglRenderer.setStyleSignature(this._styleSig);
    }

    // Force immediate component update
    this.requestUpdate();

    // Render after all updates are complete
    this.updateComplete.then(() => {
      this._renderPlot();
    });

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

      // Filter annotation data to match current protein IDs
      const filteredAnnotationData: Record<string, AnnotationData> = {};
      const filteredNumericAnnotationData: { [key: string]: (number | null)[] } = {};

      for (const [annotationName, annotationValues] of Object.entries(
        currentDisplayData.annotation_data,
      )) {
        filteredAnnotationData[annotationName] = sliceAnnotationData(annotationValues, keptIndices);
      }

      for (const [annotationName, annotationValues] of Object.entries(
        currentDisplayData.numeric_annotation_data ?? {},
      )) {
        const sliced: (number | null)[] = new Array(keptIndices.length);
        for (let k = 0; k < keptIndices.length; k++) {
          sliced[k] = annotationValues[keptIndices[k]];
        }
        filteredNumericAnnotationData[annotationName] = sliced;
      }

      return {
        ...currentDisplayData,
        protein_ids: currentProteinIds,
        annotation_data: filteredAnnotationData,
        numeric_annotation_data: filteredNumericAnnotationData,
        projections: currentDisplayData.projections.map((projection) => {
          const dim = projection.dimension;
          const out = new Float32Array(keptIndices.length * dim);
          for (let k = 0; k < keptIndices.length; k++) {
            const base = keptIndices[k] * dim;
            const o = k * dim;
            out[o] = projection.data[base];
            out[o + 1] = projection.data[base + 1];
            if (dim === 3) out[o + 2] = projection.data[base + 2];
          }
          return { ...projection, data: out, dimension: dim };
        }),
      };
    }

    return currentDisplayData;
  }

  getMaterializedData(): VisualizationData | null {
    return this._getMaterializedData();
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
    } = {},
  ): HTMLCanvasElement {
    if (!this._webglRenderer) {
      throw new Error('WebGL renderer not initialized');
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('Width and height must be positive numbers');
    }

    const { dpr = 1, backgroundColor = '#ffffff', dataDomain, pointSizeReference } = options;

    // Capture WebGL content using native off-screen rendering
    const webglCanvas = this._webglRenderer.renderToCanvas(
      width,
      height,
      dpr,
      dataDomain,
      pointSizeReference,
    );

    // Composite with badges canvas if present
    const badgesCanvas = this._badgesCanvas;
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
