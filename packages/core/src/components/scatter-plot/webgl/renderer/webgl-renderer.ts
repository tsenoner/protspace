/**
 * WebGL2 Renderer with Gamma-Correct Rendering Pipeline
 *
 * This renderer implements a two-pass gamma-correct rendering pipeline:
 * 1. Render points to a linear RGB framebuffer
 * 2. Apply gamma correction to convert to sRGB for display
 *
 * Falls back to direct rendering if gamma pipeline is unavailable.
 */

import * as d3 from 'd3';
import type { PlotData, PlotDataPoint, ScatterplotConfig } from '@protspace/utils';
import {
  type WebGLStyleGetters,
  type ScalePair,
  type PointAttribLocations,
  type PointUniformLocations,
  MAX_RENDERABLE_POINTS,
  DEFAULT_GAMMA,
} from '../types';
import { createProgramFromSources } from '../shader-utils';
import { resolvePointLocations } from './point-locations';
import { setupAttributes } from './point-attributes';
import { buildPaintOrder, composePaintDepth } from './point-staging';
import { planRendererCapacity, shouldReplanCapacityResource } from './capacity-planner';
import { createLinearFramebuffer, destroyFramebuffer } from './framebuffer';
import { GLResources } from './gl-resources';
import {
  bindAndClearTarget,
  setPointBlendState,
  drawPoints,
  bindPointDrawState,
} from './render-target';
import { QUAD_VERTICES, drawGammaQuad } from './gamma-quad';
import { DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT } from './viewport-defaults';
import { stagePoint, stagePointStyle, type StagePointArrays } from './stage-point';
import {
  planLabelAtlas,
  MAX_LABELS,
  MIN_MAX_TEXTURE_SIZE,
  type LabelAtlasPlan,
} from './label-atlas-plan';
import {
  readMaxTextureSize,
  drainGlErrors,
  allocateLabelAtlas,
  refreshLabelAtlas,
  uploadPlaceholderAtlas,
} from './label-atlas-texture';
import {
  createRendererDegradedDetail,
  type RendererDegradedDetail,
  type RendererDegradedReason,
} from '../../scatter-plot.events';
import { ContextLossController } from './context-loss-controller';
import { ExportRenderer } from './export-renderer';
import {
  POINT_VERTEX_SHADER,
  POINT_FRAGMENT_SHADER,
  GAMMA_VERTEX_SHADER,
  GAMMA_FRAGMENT_SHADER,
} from './export-shaders';

// Constants
const MIN_CAPACITY = 1024;
/**
 * Allocation granularity for the SoA staging arrays. 256 is the point count that
 * fills one row of the narrowest supported atlas (2048 texels / 8 slices), so a
 * snapped capacity never leaves a partial row there. It is deliberately NOT
 * derived from the live atlas plan: capacity feeds the plan, so deriving it back
 * from the plan would be circular.
 */
const CAPACITY_GRANULARITY = 256;

// ============================================================================
// WebGL2 Renderer Implementation
// ============================================================================

export class WebGLRenderer {
  private gl: WebGL2RenderingContext | null = null;

  // Owned GPU handles (programs, VAO, buffers, quad, label texture, framebuffer).
  // Resource inventory (create/validate/delete/reset) lives in GLResources; the
  // dirty-flag/signature/cache state below stays on the class.
  private resources = new GLResources();

  // Shader location maps (resolved from the live programs; not GPU-owned handles,
  // so they are NOT part of the GLResources inventory).
  private pointAttribLocations: PointAttribLocations | null = null;
  private pointUniformLocations: PointUniformLocations | null = null;
  private gammaCorrectionUniformLocations: {
    linearTexture: WebGLUniformLocation | null;
    gamma: WebGLUniformLocation | null;
  } | null = null;

  private gamma = DEFAULT_GAMMA;

  // CPU arrays
  private dataPositions = new Float32Array(0);
  private sizes = new Float32Array(0);
  private colors = new Float32Array(0);
  private depths = new Float32Array(0);
  private labelCounts = new Float32Array(0);
  private shapes = new Float32Array(0);
  private predicted = new Float32Array(0);

  // Zero-copy view over the parallel staging arrays above, passed to `stagePoint`.
  // Re-pointed in `refreshStageArrays()` whenever capacity is reallocated.
  private stageArrays: StagePointArrays = this.buildStageArrays();

  // State
  private capacity = 0;
  private labelTextureInitialized = false;

  /**
   * `gl.MAX_TEXTURE_SIZE`, read once per context. Defaults to the WebGL2
   * specification floor so a renderer that has not yet acquired a context (or
   * whose driver returns nonsense) plans conservatively rather than unbounded.
   */
  private maxTextureSize = MIN_MAX_TEXTURE_SIZE;
  /**
   * The currently allocated atlas: its geometry and the texels backing it, or
   * null when none is allocated.
   *
   * One field rather than two, because the plan and its backing array are only
   * ever meaningful together — a live plan with no texels stages nothing while
   * the shader keeps sampling. {@link syncLabelAtlas} is the sole writer.
   */
  private atlas: { plan: LabelAtlasPlan; texels: Uint8Array } | null = null;
  /** Latched after an allocation failure, so we do not retry it every populate. */
  private labelAtlasDisabled = false;
  /**
   * The multi-label answer this render pass is staging against, refreshed once
   * per `render()` from {@link WebGLStyleGetters.isMultilabel}. Single source of
   * truth for the RENDER pass: `syncLabelAtlas` allocates against it, and a
   * change from the previous pass forces a re-stage. Seeded `false`, which the
   * first render corrects before anything reads it.
   *
   * `exportLabelStride` deliberately asks the getters afresh instead — an export
   * runs outside a render pass, where this latch is the staler of the two.
   */
  private labelAtlasActive = false;
  /** Degradation reasons already reported, so each is surfaced at most once. */
  private readonly degradeReported = new Set<RendererDegradedReason>();

  private currentPointCount = 0;
  private positionsDirty = true;
  private stylesDirty = true;
  // Depth-order dirtiness is tracked separately from positionsDirty so callers
  // can signal "re-sort by depth on next render" without lying about positions.
  // Cleared inside populateBuffers once the re-sort runs.
  private depthOrderDirty = false;
  private buffersInitialized = false;

  // Store last rendered data for off-screen export rendering
  private lastRenderedData: PlotData | null = null;

  // Reusable index-sort scratch (avoids per-render object staging + a retained mapped array).
  // `sortOrder[0..currentPointCount)` holds slot indices in far->near draw order; it indexes
  // into `sortedDataRef` (the PlotData from the last full rebuild). `sortDepths` is the
  // per-slot depth scratch, indexed by ORIGINAL slot index.
  private sortOrder = new Uint32Array(0);
  private sortDepths = new Float32Array(0);
  private sortedDataRef: PlotData | null = null;

  // Single reused scratch point for the hot loop — populated per slot, passed to style getters.
  private scratchPoint: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };

  // Selection-aware two-pass rendering
  private selectionActive = false;
  private selectedStartIndex = 0;

  // Caching
  private lastDataSignature: string | null = null;
  private lastStyleSignature: string | null = null;

  // Bytes pushed to the GPU since construction; see uploadedBytesTotal.
  private uploadedBytes = 0;

  // Track rendered point IDs for hover detection
  private trackRenderedPointIds = false;
  private renderedPointIds = new Set<string>();

  // Config
  private dpr = window.devicePixelRatio || 1;
  private styleSignature: string | null = null;
  private gammaPipelineAvailable = true;
  private warnedGammaFallback = false;

  // Context-loss lifecycle (listener + idempotent "lost" flag) lives in the
  // controller; `markContextLost`/`isContextLost` delegate to it.
  private readonly lossController: ContextLossController;

  // Off-screen export subsystem. Stateless apart from the ephemeral context it
  // creates per `renderToCanvas` call; the facade passes in the live data,
  // config, style getters, transform, gamma, and selection state.
  private readonly exportRenderer = new ExportRenderer();

  constructor(
    private canvas: HTMLCanvasElement,
    private getScales: () => ScalePair | null,
    private getTransform: () => d3.ZoomTransform,
    private getConfig: () => ScatterplotConfig,
    private style: WebGLStyleGetters,
    private onContextLost?: () => void,
    private getKnockoutColor: () => readonly [number, number, number] = () => [1, 1, 1],
    private onDegraded?: (detail: RendererDegradedDetail) => void,
  ) {
    this.lossController = new ContextLossController(this.canvas, () => {
      this.resetRendererState();
      this.onContextLost?.();
    });
  }

  destroy() {
    this.lossController.destroy();
    this.dispose();
  }

  // ============================================================================
  // Public API
  // ============================================================================

  setStyleSignature(signature: string | null) {
    if (this.styleSignature !== signature) {
      this.styleSignature = signature;
      this.stylesDirty = true;
    }
  }

  setSelectionActive(active: boolean) {
    this.selectionActive = active;
  }

  invalidateStyleCache() {
    this.stylesDirty = true;
  }

  /**
   * Enable/disable tracking of the exact set of rendered point IDs.
   *
   * This exists to guard hover/click behavior when the renderer truncates the
   * number of points (e.g. datasets > MAX_RENDERABLE_POINTS).
   *
   * For typical datasets (<= MAX_RENDERABLE_POINTS), tracking is unnecessary
   * and expensive (it adds/clears ~N string IDs on every buffer rebuild), so it
   * should be kept disabled.
   */
  setTrackRenderedPointIds(enabled: boolean) {
    this.trackRenderedPointIds = enabled;
    if (!enabled) {
      this.renderedPointIds.clear();
    }
  }

  isPointRendered(pointId: string): boolean {
    if (!this.trackRenderedPointIds) return true;
    return this.renderedPointIds.has(pointId);
  }

  /**
   * Points the last completed stage actually drew. Zero before the first stage.
   *
   * Distinct from the count handed to `render()`: they differ exactly when the
   * staging clamp truncates, which is the state that used to be invisible. The
   * perf harness records both, so a run reports its own truncation.
   */
  get drawnPointCount(): number {
    return this.currentPointCount;
  }

  /**
   * Monotonic total of bytes pushed to the GPU — every buffer upload and every
   * atlas upload — since this renderer was constructed.
   *
   * This is the deterministic instrument behind the #456 regression gate: a
   * camera move must upload zero bytes. Unlike a wall-clock threshold it is
   * machine-independent, and unlike a cache-hit counter it cannot be satisfied
   * by a memo that still re-materialises on a miss.
   */
  get uploadedBytesTotal(): number {
    return this.uploadedBytes;
  }

  invalidatePositionCache() {
    this.positionsDirty = true;
  }

  /**
   * Force a depth-order re-sort on the next render without invalidating the
   * position cache. Use when only the depth mapping changes (e.g. z-order
   * remap) and coordinates are unchanged.
   *
   * Why this exists: the renderer uses painter's algorithm — points are sorted
   * once by depth, then position/style buffers are written in sorted order. A
   * pure depth change (same points, same coords, new depth values) leaves the
   * sample-based depth-changed detection unable to compare like-for-like
   * (sampled point[i] is read from the input order; this.depths[i] is from the
   * sorted order). Without an explicit signal, the renderer can keep the stale
   * sort. This API is that signal.
   */
  invalidateDepthOrder() {
    this.depthOrderDirty = true;
  }

  /**
   * Release references to PlotData so GC can reclaim old data
   * before a new dataset is allocated. Call before processing a new dataset.
   */
  releaseDataReferences() {
    this.lastRenderedData = null;
    this.sortedDataRef = null;
  }

  resize(width: number, height: number) {
    if (this.isContextLost()) return;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const physicalWidth = Math.max(1, Math.floor(width * dpr));
    const physicalHeight = Math.max(1, Math.floor(height * dpr));

    if (this.canvas.width !== physicalWidth || this.canvas.height !== physicalHeight) {
      this.canvas.width = physicalWidth;
      this.canvas.height = physicalHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.gl?.viewport(0, 0, physicalWidth, physicalHeight);

      // Resize linear framebuffer
      if (this.gl && this.gammaPipelineAvailable) {
        const success = this.resizeLinearFramebuffer(physicalWidth, physicalHeight);
        if (!success) {
          this.handleGammaFallback('resize');
        }
      }
    }
  }

  private resizeLinearFramebuffer(width: number, height: number): boolean {
    if (!this.gl) return false;
    const gl = this.gl;

    // Reuse existing framebuffer if dimensions match
    if (this.resources.linearFramebuffer) {
      if (
        this.resources.linearFramebuffer.width === width &&
        this.resources.linearFramebuffer.height === height
      ) {
        return true;
      }
      // Clean up old framebuffer
      destroyFramebuffer(gl, this.resources.linearFramebuffer);
      this.resources.linearFramebuffer = null;
    }

    const fb = createLinearFramebuffer(gl, width, height);
    if (!fb) {
      console.error('Linear framebuffer not complete');
      return false;
    }
    this.resources.linearFramebuffer = fb;
    return true;
  }

  private handleGammaFallback(reason?: string) {
    if (!this.gammaPipelineAvailable) return;

    this.gammaPipelineAvailable = false;

    if (!this.warnedGammaFallback) {
      const suffix = reason ? ` (${reason})` : '';
      console.warn(`WebGLRenderer: falling back to direct rendering${suffix}.`);
      this.warnedGammaFallback = true;
      // A silent switch from linear-light to sRGB blending is a larger visible
      // change than a marker-fidelity reduction, and it fires on the same
      // constrained devices — so it goes to the user, not only the console.
      this.reportDegraded('gamma-pipeline-unavailable', reason);
    }

    const gl = this.gl;
    if (!gl) {
      this.cleanupGammaResources();
      return;
    }

    if (this.resources.gammaCorrectionProgram) {
      gl.deleteProgram(this.resources.gammaCorrectionProgram);
      this.resources.gammaCorrectionProgram = null;
    }

    if (this.resources.linearFramebuffer) {
      destroyFramebuffer(gl, this.resources.linearFramebuffer);
      this.resources.linearFramebuffer = null;
    }

    this.gammaCorrectionUniformLocations = null;
  }

  private cleanupGammaResources() {
    this.resources.gammaCorrectionProgram = null;
    this.gammaCorrectionUniformLocations = null;
    this.resources.linearFramebuffer = null;
  }

  private shouldUseGammaPipeline(): boolean {
    return (
      this.gammaPipelineAvailable &&
      !!this.resources.linearFramebuffer &&
      !!this.resources.gammaCorrectionProgram &&
      !!this.gammaCorrectionUniformLocations
    );
  }

  private getEffectiveGamma(): number {
    return this.shouldUseGammaPipeline() ? this.gamma : 1.0;
  }

  clear() {
    const gl = this.ensureGL();
    if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.currentPointCount = 0;
  }

  render(pd: PlotData) {
    // Store PlotData for potential off-screen export rendering
    this.lastRenderedData = pd;

    const gl = this.ensureGL();
    const scales = this.getScales();
    if (!gl || !scales || this.isContextLost()) return;

    const config = this.getConfig();
    const width = config.width ?? DEFAULT_VIEWPORT_WIDTH;
    const height = config.height ?? DEFAULT_VIEWPORT_HEIGHT;
    this.resize(width, height);

    const transform = this.getTransform();

    // A change in multi-label-ness is not observable in the style signature (it
    // samples four points' colours), but it changes what must be staged: the
    // atlas is allocated or released, and every point's slice count with it.
    // `_refreshSelectedAnnotationValues` nulls the style-getter cache without
    // calling invalidateStyleCache, so this cannot rely on that path alone.
    // Read ONCE per pass and latched into `labelAtlasActive`, which `syncLabelAtlas`
    // then allocates against — one answer per frame, so the gate and the re-stage
    // it triggers cannot disagree. See `isMultilabel` for the default's direction.
    const multilabel = this.isMultilabel();
    if (multilabel !== this.labelAtlasActive) {
      this.labelAtlasActive = multilabel;
      this.stylesDirty = true;
    }

    const dataSignature = this.computeDataSignature(pd);
    const styleSignature = this.computeStyleSignature(pd);

    const needsPositionUpdate = this.positionsDirty || dataSignature !== this.lastDataSignature;
    const needsStyleUpdate = this.stylesDirty || styleSignature !== this.lastStyleSignature;
    const needsDepthOrderUpdate = this.depthOrderDirty;

    if (needsPositionUpdate || needsStyleUpdate || needsDepthOrderUpdate) {
      this.populateBuffers(pd, scales, needsPositionUpdate, needsStyleUpdate);
      this.lastDataSignature = dataSignature;
      this.lastStyleSignature = styleSignature;
      this.positionsDirty = false;
      this.stylesDirty = false;
      // depthOrderDirty is cleared inside populateBuffers once the re-sort runs.
    }

    // Render with gamma-correct pipeline
    this.renderWithGammaCorrection(transform);
  }

  /**
   * Render using gamma-correct pipeline:
   * 1. Render points to linear RGB framebuffer
   * 2. Apply gamma correction pass to convert to sRGB for display
   * Falls back to direct rendering if pipeline is unavailable.
   */
  private renderWithGammaCorrection(transform: d3.ZoomTransform) {
    if (!this.gl) return;

    if (!this.shouldUseGammaPipeline()) {
      if (this.gammaPipelineAvailable) {
        this.handleGammaFallback('gamma pipeline unavailable during render');
      }
      this.renderDirect(transform);
      return;
    }

    const framebuffer = this.resources.linearFramebuffer;
    if (!framebuffer) {
      this.renderDirect(transform);
      return;
    }

    const gl = this.gl;

    // Pass 1: Render to linear RGB framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer.framebuffer);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.handleGammaFallback('framebuffer incomplete during render');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderDirect(transform);
      return;
    }
    gl.viewport(0, 0, framebuffer.width, framebuffer.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.renderPoints(transform);

    // Pass 2: Gamma correction to canvas
    bindAndClearTarget(gl, null, this.canvas.width, this.canvas.height);

    this.renderGammaCorrection();
  }

  private renderGammaCorrection() {
    if (
      !this.gl ||
      !this.resources.gammaCorrectionProgram ||
      !this.resources.linearFramebuffer ||
      !this.gammaCorrectionUniformLocations ||
      !this.resources.quadBuffer
    ) {
      return;
    }

    const gl = this.gl;
    gl.disable(gl.BLEND);

    drawGammaQuad(
      gl,
      this.resources.gammaCorrectionProgram,
      this.resources.linearFramebuffer.texture,
      this.gamma,
      this.resources.quadBuffer,
      this.gammaCorrectionUniformLocations,
    );
  }

  private renderDirect(transform: d3.ZoomTransform) {
    if (!this.gl) return;
    const gl = this.gl;

    bindAndClearTarget(gl, null, this.canvas.width, this.canvas.height);

    this.renderPoints(transform);
  }

  dispose() {
    if (!this.gl) return;
    const gl = this.gl;

    this.resources.deleteAll(gl);

    this.gl = null;
  }

  // ============================================================================
  // Off-Screen Export Rendering (delegated to ExportRenderer)
  // ============================================================================

  /**
   * Render visualization at arbitrary dimensions to a new off-screen canvas.
   * Creates a temporary WebGL context, renders at requested size, returns 2D canvas.
   *
   * Thin delegate over {@link ExportRenderer.renderToCanvas}: the facade supplies
   * the last-rendered data, the live config + style getters, and the live render
   * state (selection, transform, gamma) so the export equals the on-screen render
   * (incl. the F-15 two-pass selection blend).
   *
   * @param width Target width in CSS pixels (will be multiplied by DPR)
   * @param height Target height in CSS pixels
   * @param dpr Device pixel ratio to use (defaults to 1 for max resolution control)
   * @param resetView When true, ignore the live zoom/pan transform and render
   *   the default, fit-all view (identity transform) — what a double-click
   *   reset shows. The figure editor uses this so it never inherits a stale
   *   zoom. Defaults to false, preserving the current view for plain exports.
   * @returns 2D canvas containing the rendered frame
   */
  public renderToCanvas(
    width: number,
    height: number,
    dpr: number = 1,
    dataDomain?: { xMin: number; xMax: number; yMin: number; yMax: number },
    pointSizeReference?: { width: number; height: number },
    resetView: boolean = false,
    knockoutColor: readonly [number, number, number] = this.getKnockoutColor(),
  ): HTMLCanvasElement {
    return this.exportRenderer.renderToCanvas(this.lastRenderedData, this.getConfig(), this.style, {
      width,
      height,
      dpr,
      dataDomain,
      pointSizeReference,
      selectionActive: this.selectionActive,
      transform: resetView ? d3.zoomIdentity : this.getTransform(),
      gamma: this.gamma,
      knockoutColor,
      // See `exportLabelStride` for what the export inherits and why.
      labelStride: this.exportLabelStride(),
      deviceMaxTextureSize: this.maxTextureSize,
    });
  }

  /**
   * The stride the export should inherit, or null for "no atlas at all".
   *
   * The WANT question is asked of the live style getters, not of `this.atlas`:
   * the export stages through those same getters, so its atlas decision has to
   * come from the same authority as its colours. `this.atlas` records only what
   * the last completed render staged, and nothing forces a render before an
   * export, so it is wrong in both directions. It is null while a multi-label
   * annotation is selected — before the first populate, on an empty render, in
   * the window between an annotation switch and the next frame — and reading it
   * there would export dominant colours for a multi-label view: a wrong picture,
   * presented as data. It is equally non-null in the mirror window, after a
   * switch to a single-label annotation, where inheriting its stride would build
   * and upload a capacity-sized atlas (~18 MB at 573K) of texels the shader never
   * samples, because every `labelCount` is 1.
   *
   * Only once the answer is yes does the live plan matter, and then it wins: the
   * export plans against its own context's limit but never at higher fidelity
   * than the screen, so a figure cannot show eight segments where the user saw
   * four. With no plan there is no such cap to respect, and the export is free to
   * plan at full fidelity against its own device.
   */
  private exportLabelStride(): number | null {
    if (this.labelAtlasDisabled || !this.isMultilabel()) return null;
    return this.atlas?.plan.stride ?? MAX_LABELS;
  }

  /**
   * The exact data→pixel scales a reset-view (non-inset) export render maps
   * points through at the given output physical pixel dimensions. Exposed so
   * the badge capture path can project badge positions through the SAME
   * function the exported dots use — re-deriving the margin/extent math
   * elsewhere drifts (#301/#302). Uses the same inputs `renderToCanvas` hands
   * to the export pipeline (last-rendered data + live config). Returns null
   * before the first render or when the data is empty.
   */
  public createExportScales(exportWidth: number, exportHeight: number): ScalePair | null {
    if (!this.lastRenderedData) return null;
    return ExportRenderer.createExportScales(
      this.getConfig(),
      this.lastRenderedData,
      exportWidth,
      exportHeight,
    );
  }

  /**
   * Display configuration the renderer would apply to a render at the given
   * export dimensions. Returned values are in *export pixel space* (i.e.
   * `marginLeft` is the pixel offset of the data area's left edge inside an
   * `exportWidth × exportHeight` canvas). Used by the publish modal to
   * translate inset source rects (canvas-norm) into data-coord viewports
   * with margin-aware accuracy.
   */
  public getRenderInfo(
    exportWidth: number,
    exportHeight: number,
  ): { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number } {
    return ExportRenderer.getRenderInfo(this.getConfig(), exportWidth, exportHeight);
  }

  /**
   * Data extent of the most recently rendered points, or null when nothing
   * has been rendered yet. Used by the publish modal to translate inset
   * source rects (in normalized canvas coords) into data-coordinate viewports.
   */
  public getDataExtent(): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
    return this.exportRenderer.getDataExtent(this.lastRenderedData);
  }

  // ============================================================================
  // WebGL Setup
  // ============================================================================

  private ensureGL(): WebGL2RenderingContext | null {
    if (this.lossController.isLost) return null;
    if (this.gl) {
      if (this.gl.isContextLost && this.gl.isContextLost()) {
        this.markContextLost();
        return null;
      }
      if (!this.isRendererStateValid(this.gl)) {
        this.resetRendererState();
      }
    }
    if (
      this.gl &&
      this.resources.pointProgram &&
      this.pointAttribLocations &&
      this.pointUniformLocations
    ) {
      return this.gl;
    }

    const contextOptions: WebGLContextAttributes = {
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      alpha: true,
      powerPreference: 'high-performance',
    };

    const gl = this.canvas.getContext('webgl2', contextOptions);
    if (!gl) {
      console.error('WebGL2 not available');
      return null;
    }

    this.gl = gl;

    // Read the device's texture limit once per context, beside the extension
    // queries that already stall here. The label atlas is sized from point
    // capacity, so this is the only thing standing between a large dataset and
    // an over-size allocation the driver rejects without throwing.
    this.maxTextureSize = readMaxTextureSize(gl);

    // Enable extensions for float textures
    const colorBufferFloatExt = gl.getExtension('EXT_color_buffer_float');
    const floatBlendExt = gl.getExtension('EXT_float_blend');
    gl.getExtension('OES_texture_float_linear');

    this.gammaPipelineAvailable = !!colorBufferFloatExt && !!floatBlendExt;
    if (!this.gammaPipelineAvailable) {
      this.handleGammaFallback('required extensions missing');
    }

    if (!this.initializePointShaders(gl)) return null;

    if (this.gammaPipelineAvailable) {
      if (!this.initializeGammaCorrectionShaders(gl)) {
        this.handleGammaFallback('gamma shader init failed');
      }
    }

    this.resources.createAll(gl);
    this.labelTextureInitialized = false;

    this.createPointVAO();

    this.setupQuad();

    // We want overlapping points to remain visible, so we do NOT use the depth buffer to cull.
    // Z-order is preserved via painter's algorithm (CPU sorting) in populateBuffers().
    setPointBlendState(gl);

    if (
      this.gammaPipelineAvailable &&
      !this.resizeLinearFramebuffer(this.canvas.width, this.canvas.height)
    ) {
      this.handleGammaFallback('framebuffer incomplete');
    }

    return gl;
  }

  private isRendererStateValid(gl: WebGL2RenderingContext): boolean {
    return this.resources.validate(gl);
  }

  private isContextLost(): boolean {
    if (this.lossController.isLost) return true;
    const gl = this.gl;
    if (gl?.isContextLost && gl.isContextLost()) {
      this.markContextLost();
      return true;
    }
    return false;
  }

  private markContextLost() {
    // Idempotent: the controller fires the onLost callback (resetRendererState +
    // onContextLost) exactly once.
    this.lossController.markLost();
  }

  private resetRendererState() {
    this.gl = null;
    this.resources.reset();
    this.pointAttribLocations = null;
    this.pointUniformLocations = null;
    this.gammaCorrectionUniformLocations = null;
    this.labelTextureInitialized = false;
    this.atlas = null;
    this.labelAtlasDisabled = false;
    this.labelAtlasActive = false;
    this.degradeReported.clear();
    this.gammaPipelineAvailable = true;
    this.warnedGammaFallback = false;
    this.buffersInitialized = false;
    this.currentPointCount = 0;
    this.positionsDirty = true;
    this.stylesDirty = true;
    this.lastDataSignature = null;
    this.lastStyleSignature = null;
    this.renderedPointIds.clear();
    this.sortedDataRef = null;
  }

  private initializePointShaders(gl: WebGL2RenderingContext): boolean {
    this.resources.pointProgram = createProgramFromSources(
      gl,
      POINT_VERTEX_SHADER,
      POINT_FRAGMENT_SHADER,
    );
    if (!this.resources.pointProgram) return false;

    const { attribs, uniforms } = resolvePointLocations(gl, this.resources.pointProgram);
    this.pointAttribLocations = attribs;
    this.pointUniformLocations = uniforms;

    return true;
  }

  private initializeGammaCorrectionShaders(gl: WebGL2RenderingContext): boolean {
    this.resources.gammaCorrectionProgram = createProgramFromSources(
      gl,
      GAMMA_VERTEX_SHADER,
      GAMMA_FRAGMENT_SHADER,
    );
    if (!this.resources.gammaCorrectionProgram) return false;

    this.gammaCorrectionUniformLocations = {
      linearTexture: gl.getUniformLocation(
        this.resources.gammaCorrectionProgram,
        'u_linearTexture',
      ),
      gamma: gl.getUniformLocation(this.resources.gammaCorrectionProgram, 'u_gamma'),
    };

    return true;
  }

  // ============================================================================
  // VAO Setup
  // ============================================================================

  private createPointVAO() {
    const gl = this.gl;
    if (!gl || !this.pointAttribLocations) return;

    this.resources.pointVao = gl.createVertexArray();
    gl.bindVertexArray(this.resources.pointVao);

    setupAttributes(
      gl,
      {
        dataPosition: this.resources.dataPositionBuffer,
        size: this.resources.sizeBuffer,
        color: this.resources.colorBuffer,
        depth: this.resources.depthBuffer,
        labelCount: this.resources.labelCountBuffer,
        shape: this.resources.shapeBuffer,
        predicted: this.resources.predictedBuffer,
      },
      this.pointAttribLocations,
    );

    gl.bindVertexArray(null);
  }

  private setupQuad() {
    const gl = this.gl;
    if (!gl || !this.resources.quadBuffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  private renderPoints(transform: d3.ZoomTransform) {
    if (
      !this.gl ||
      this.currentPointCount === 0 ||
      !this.resources.pointProgram ||
      !this.pointUniformLocations
    ) {
      return;
    }

    const gl = this.gl;

    bindPointDrawState(
      gl,
      this.resources.pointProgram,
      this.pointUniformLocations,
      this.resources.pointVao,
      this.resources.labelColorTexture,
      {
        width: this.canvas.width,
        height: this.canvas.height,
        transform: { x: transform.x, y: transform.y, k: transform.k },
        dpr: this.dpr,
        gamma: this.getEffectiveGamma(),
        knockoutColor: this.getKnockoutColor(),
        // Null when no atlas is allocated, which makes the shader's pie branch
        // unreachable and every marker fall through to its dominant colour.
        labelAtlas: this.atlas?.plan ?? null,
      },
    );

    drawPoints(gl, this.currentPointCount, this.selectionActive, this.selectedStartIndex);

    gl.bindVertexArray(null);
  }

  // ============================================================================
  // Buffer Management
  // ============================================================================

  private computeDataSignature(pd: PlotData): string {
    if (pd.length === 0) return 'empty';
    const len = pd.length;
    const s0 = 0;
    const s1 = Math.floor(len / 2);
    const s2 = len - 1;
    return (
      `${len}|${pd.xs[s0].toFixed(2)},${pd.ys[s0].toFixed(2)}` +
      `|${pd.xs[s1].toFixed(2)},${pd.ys[s1].toFixed(2)}` +
      `|${pd.xs[s2].toFixed(2)},${pd.ys[s2].toFixed(2)}`
    );
  }

  private computeStyleSignature(pd: PlotData): string {
    if (pd.length === 0) return 'empty';

    const len = pd.length;
    const indices = [0, Math.floor(len / 4), Math.floor(len / 2), len - 1];
    const sp = this.scratchPoint;
    const oi = pd.originalIndices;
    const parts = indices
      .filter((i) => i < len)
      .map((i) => {
        const origIdx = oi ? oi[i] : i;
        sp.id = pd.proteinIds[origIdx];
        sp.x = pd.xs[i];
        sp.y = pd.ys[i];
        sp.originalIndex = origIdx;
        // Include depth to avoid missing z-order-only updates when we render via painter's algorithm.
        return `${sp.id}:${this.style.getOpacity(sp).toFixed(2)}:${this.style
          .getDepth(sp)
          .toFixed(4)}:${this.style.getColors(sp)[0]}`;
      });

    return `${this.styleSignature}|${parts.join('|')}`;
  }

  private populateBuffers(
    pd: PlotData,
    scales: ScalePair,
    updatePositions: boolean,
    updateStyles: boolean,
  ) {
    if (!this.gl) return;
    const gl = this.gl;

    const maxPoints = Math.min(pd.length, MAX_RENDERABLE_POINTS);

    // Grow to fit, and release a footprint that has become absurd for the data on
    // screen. Capacity used to be grow-only, which the old 1,000,000 clamp made
    // harmless; at a 2,000,000 cap, loading 2M and then a 5K demo would hold the
    // larger footprint for the rest of the session. The planner owns both rules,
    // so reallocating is simply "the plan changed".
    const plannedCapacity = this.planCapacity(maxPoints);
    if (plannedCapacity !== this.capacity) {
      this.resizeCapacity(plannedCapacity);
      updatePositions = true;
      updateStyles = true;
    }

    // Plan/allocate the atlas for the current capacity before anything stages into
    // it — stagePointStyle reads its stride and its backing array through
    // `this.stageArrays`.
    this.syncLabelAtlas();

    if (this.trackRenderedPointIds) {
      this.renderedPointIds.clear();
    }

    // With depth testing disabled (to ensure overlaps are drawn), we preserve z-order using
    // the painter's algorithm: draw far -> near. This requires reordering the slots, so
    // whenever styles update we must also update positions to keep all parallel buffers aligned.
    // However, if only colors changed (not depths), we can skip re-sorting and position updates.
    let needsReorder = updatePositions;
    if (this.depthOrderDirty) {
      // Caller signalled the depth mapping changed — re-sort regardless of the
      // sample-based check (which can't reliably detect category-level swaps).
      needsReorder = true;
      updatePositions = true;
      this.depthOrderDirty = false;
    }

    const sp = this.scratchPoint;
    const oi = pd.originalIndices;
    const { xs, ys } = pd;

    if (updateStyles && !updatePositions) {
      // Check if depths have actually changed by sampling first few slots
      // If depths are the same, we can skip re-sorting (color-only update optimization)
      const sampleSize = Math.min(100, pd.length);
      let depthsChanged = false;
      for (let i = 0; i < sampleSize && i < this.currentPointCount; i++) {
        const origIdx = oi ? oi[i] : i;
        sp.id = pd.proteinIds[origIdx];
        sp.x = xs[i];
        sp.y = ys[i];
        sp.originalIndex = origIdx;
        const opacity = this.style.getOpacity(sp);
        if (opacity === 0) continue;
        const newDepth = composePaintDepth(
          this.style.getDepth(sp),
          opacity,
          this.style.isPredicted(sp),
        );
        // Compare with stored depth (note: depths array is in sorted order after last render)
        if (Math.abs(newDepth - this.depths[i]) > 1e-6) {
          depthsChanged = true;
          break;
        }
      }
      if (depthsChanged) {
        needsReorder = true;
        updatePositions = true;
      }
    } else if (updateStyles) {
      needsReorder = true;
      updatePositions = true;
    }

    let idx = 0;

    if (needsReorder) {
      const count = maxPoints;
      const order = this.sortOrder;
      const depthScratch = this.sortDepths;

      // Build depth scratch indexed by original slot index, then sort indices far -> near.
      // Include hidden points (opacity=0) so sort order is preserved across visibility toggles,
      // enabling the fast color-only update path instead of a full rebuild + re-sort.
      for (let i = 0; i < count; i++) {
        const origIdx = oi ? oi[i] : i;
        sp.id = pd.proteinIds[origIdx];
        sp.x = xs[i];
        sp.y = ys[i];
        sp.originalIndex = origIdx;
        depthScratch[i] = composePaintDepth(
          this.style.getDepth(sp),
          this.style.getOpacity(sp),
          this.style.isPredicted(sp),
        );
      }
      // Canonical painter-order plan (shared with the export path via
      // buildPaintOrder): sort far->near, then locate the two-pass selection cut
      // from the first sorted slot with opacity >= 0.99. The per-slot callback
      // also performs the live side effects (ID tracking + staging) so every slot
      // — including opacity-0 — is staged exactly as before.
      const { selectedStartIndex } = buildPaintOrder(
        order,
        depthScratch,
        count,
        this.selectionActive,
        (k, srcSlot) => {
          const origIdx = oi ? oi[srcSlot] : srcSlot;
          sp.id = pd.proteinIds[origIdx];
          sp.x = xs[srcSlot];
          sp.y = ys[srcSlot];
          sp.originalIndex = origIdx;
          const opacity = this.style.getOpacity(sp);

          if (this.trackRenderedPointIds && opacity > 0) {
            this.renderedPointIds.add(sp.id);
          }

          // updatePositions is always true here (see above). Positions are
          // pre-scaled by the caller; depth uses depthScratch[srcSlot] (indexed by
          // original slot), NOT depthScratch[k]. sizeScaleFactor=1 for the live path.
          stagePoint(
            this.stageArrays,
            k,
            sp,
            scales.x(xs[srcSlot]),
            scales.y(ys[srcSlot]),
            opacity,
            depthScratch[srcSlot],
            this.style,
            this.dpr,
            1,
          );

          return opacity;
        },
      );

      idx = count;
      this.selectedStartIndex = selectedStartIndex;
      // Cache the PlotData reference so color-only / positions-only paths can index via sortOrder.
      this.sortedDataRef = pd;
    } else if (updateStyles) {
      // Color-only update: no reordering needed, just update color/shape buffers.
      // Iterate via sortOrder into sortedDataRef to match the buffer order from the last rebuild.
      const order = this.sortOrder;
      const src = this.sortedDataRef;
      if (src) {
        const srcOi = src.originalIndices;
        const srcXs = src.xs;
        const srcYs = src.ys;
        for (let i = 0; i < this.currentPointCount && idx < maxPoints; i++) {
          const slot = order[i];
          const origIdx = srcOi ? srcOi[slot] : slot;
          sp.id = src.proteinIds[origIdx];
          sp.x = srcXs[slot];
          sp.y = srcYs[slot];
          sp.originalIndex = origIdx;
          const opacity = this.style.getOpacity(sp);

          if (this.trackRenderedPointIds && opacity > 0) {
            this.renderedPointIds.add(sp.id);
          }

          // Update only style channels (color/alpha/size/shape/label texels) —
          // positions and depths are unchanged from the last rebuild. Shares the
          // exact packing the full-rebuild path uses via stagePoint (stageArrays
          // aliases this.colors/this.sizes/... so this writes the same buffers).
          stagePointStyle(this.stageArrays, idx, sp, opacity, this.style, this.dpr);

          idx++;
        }
      }
    } else {
      // No reordering and no style updates: only update positions if needed.
      // Iterate via sortOrder into sortedDataRef to match the buffer order from the last rebuild.
      const order = this.sortOrder;
      const src = this.sortedDataRef;
      if (src) {
        const srcOi = src.originalIndices;
        const srcXs = src.xs;
        const srcYs = src.ys;
        for (let i = 0; i < this.currentPointCount && idx < maxPoints; i++) {
          const slot = order[i];
          const origIdx = srcOi ? srcOi[slot] : slot;
          sp.id = src.proteinIds[origIdx];
          sp.x = srcXs[slot];
          sp.y = srcYs[slot];
          sp.originalIndex = origIdx;

          if (this.trackRenderedPointIds) {
            const opacity = this.style.getOpacity(sp);
            if (opacity > 0) {
              this.renderedPointIds.add(sp.id);
            }
          }

          if (updatePositions) {
            this.dataPositions[idx * 2] = scales.x(srcXs[slot]);
            this.dataPositions[idx * 2 + 1] = scales.y(srcYs[slot]);
          }

          idx++;
        }
      }
    }

    this.currentPointCount = idx;

    // `updateBuffer` takes the allocating bufferData branch while this is false.
    // Captured before the uploads, which set it.
    const allocating = !this.buffersInitialized;
    // The GL error flag is sticky and context-wide, so it has to start clean for
    // the check after the uploads to mean "these uploads failed" rather than
    // "something failed at some point in this context's life".
    if (allocating) drainGlErrors(gl);

    gl.bindVertexArray(this.resources.pointVao);

    if (updatePositions) {
      this.updateBuffer(gl, this.resources.dataPositionBuffer, this.dataPositions, idx * 2);
    }

    // Hoisted from `updateStyles` alone: the reorder branch above rewrites every
    // style array AND the atlas into the new slot order, so gating the upload on
    // updateStyles leaves the GPU holding the previous permutation. Reachable via
    // updatePositions and via depthOrderDirty, neither of which sets updateStyles.
    if (updateStyles || needsReorder) {
      this.updateBuffer(gl, this.resources.sizeBuffer, this.sizes, idx);
      this.updateBuffer(gl, this.resources.colorBuffer, this.colors, idx * 4);
      this.updateBuffer(gl, this.resources.depthBuffer, this.depths, idx);
      this.updateBuffer(gl, this.resources.labelCountBuffer, this.labelCounts, idx);
      this.updateBuffer(gl, this.resources.shapeBuffer, this.shapes, idx);
      this.updateBuffer(gl, this.resources.predictedBuffer, this.predicted, idx);

      // One error check per capacity change, on the allocating (bufferData) path
      // only — never on bufferSubData, so never per frame. It runs BEFORE any
      // texture call so a failed buffer allocation is neither masked by nor
      // misattributed to the atlas upload, and against a queue drained just above
      // so it cannot inherit an unrelated error. gl.isBuffer cannot see this: it
      // reports handle validity, not whether storage was allocated.
      if (allocating && gl.getError() !== gl.NO_ERROR) {
        this.reportDegraded('point-buffer-allocation-failed');
        // Give the atlas back so the retry has a chance. No second reason is
        // reported: the atlas allocation was never attempted, so claiming it ran
        // out of memory would be a fabricated second toast.
        this.disableLabelAtlas(null);
        // `disableLabelAtlas` only drops the CPU-side texels. This is what hands
        // the GPU storage back — the memory the retry actually needs — by
        // replacing a previously allocated atlas with the 1x1 placeholder. It has
        // to happen here, because every later populate takes this same early
        // return (`buffersInitialized` stays false) and never reaches the upload.
        this.uploadLabelAtlas(gl);
        gl.bindVertexArray(null);
        // buffersInitialized stays false: the retry must reallocate with
        // bufferData, because bufferSubData against a zero-sized store is
        // INVALID_VALUE forever.
        return;
      }

      this.uploadLabelAtlas(gl);
    }

    gl.bindVertexArray(null);
    this.buffersInitialized = true;
  }

  /**
   * Allocate or refresh the atlas texture.
   *
   * Storage is allocated once per plan and refreshed in place afterwards, so a
   * recolor does not reallocate. A rejected allocation is downgraded to the
   * placeholder here and now: the previous code recorded the texture as
   * initialised regardless, so every later `texSubImage2D` wrote into storage
   * that did not exist, permanently, with nothing in the console.
   *
   * The GL mechanics live in `label-atlas-texture.ts`, shared with the export
   * path so the two cannot drift on placeholder format or filter mode.
   */
  private uploadLabelAtlas(gl: WebGL2RenderingContext): void {
    const texture = this.resources.labelColorTexture;
    if (!texture) return;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    const atlas = this.atlas;

    if (atlas && this.labelTextureInitialized) {
      // Only the rows the drawn points occupy, so the accounting reflects what
      // actually crossed the bus rather than the capacity-sized backing array.
      this.uploadedBytes += refreshLabelAtlas(gl, atlas.plan, atlas.texels, this.currentPointCount);
    } else if (atlas) {
      const error = allocateLabelAtlas(gl, atlas.plan, atlas.texels);
      if (error === gl.NO_ERROR) {
        this.uploadedBytes += atlas.plan.byteLength;
        this.labelTextureInitialized = true;
      } else {
        this.disableLabelAtlas(
          error === gl.OUT_OF_MEMORY
            ? 'label-atlas-out-of-memory'
            : 'label-atlas-allocation-failed',
        );
        uploadPlaceholderAtlas(gl);
        this.labelTextureInitialized = true;
      }
    } else if (!this.labelTextureInitialized) {
      uploadPlaceholderAtlas(gl);
      this.labelTextureInitialized = true;
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private updateBuffer(
    gl: WebGL2RenderingContext,
    buffer: WebGLBuffer | null,
    data: Float32Array,
    length: number,
  ) {
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (this.buffersInitialized) {
      const view = data.subarray(0, length);
      this.uploadedBytes += view.byteLength;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
    } else {
      // Note this uploads the whole capacity-sized array, not just `length`.
      this.uploadedBytes += data.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }
  }

  /**
   * Build a fresh {@link StagePointArrays} view bound to the current parallel
   * staging arrays. Call after any reallocation so `stagePoint` writes into the
   * live buffers (zero copy — the struct only holds references).
   */
  private buildStageArrays(): StagePointArrays {
    return {
      dataPositions: this.dataPositions,
      sizes: this.sizes,
      colors: this.colors,
      depths: this.depths,
      labelCounts: this.labelCounts,
      shapes: this.shapes,
      predicted: this.predicted,
      labelColorData: this.atlas?.texels ?? null,
      maxLabels: this.atlas?.plan.stride ?? MAX_LABELS,
    };
  }

  /**
   * Report a capability reduction to the host, at most once per reason per
   * renderer instance. `resetRendererState` clears the latch, so a context loss
   * and rebuild can report again.
   */
  private reportDegraded(reason: RendererDegradedReason, detail?: string) {
    if (this.degradeReported.has(reason)) return;
    this.degradeReported.add(reason);
    this.onDegraded?.(
      createRendererDegradedDetail({
        reason,
        maxTextureSize: this.maxTextureSize,
        stride: this.atlas?.plan.stride ?? 0,
        pointCount: this.capacity,
        detail,
      }),
    );
  }

  /**
   * Release the atlas and stop trying to allocate one for this context.
   *
   * `reason` is null when the caller has already reported the real cause — the
   * atlas is collateral there, not the failure, and a second toast naming it
   * would describe something that never happened.
   */
  private disableLabelAtlas(reason: RendererDegradedReason | null) {
    this.labelAtlasDisabled = true;
    this.releaseLabelAtlas();
    if (reason) this.reportDegraded(reason);
  }

  /**
   * Hand the atlas back: drop the plan and its texels, and re-point the staging
   * view so `stagePoint` writes no label texels.
   *
   * Clearing `labelTextureInitialized` is what carries the release to the GPU —
   * the next `uploadLabelAtlas` takes the placeholder branch, which is the call
   * that actually frees the texture storage. Both reasons to release (the device
   * refused one, the annotation does not need one) run the identical sequence, so
   * it lives here rather than being spelled out at each.
   */
  private releaseLabelAtlas(): void {
    this.atlas = null;
    this.labelTextureInitialized = false;
    this.stageArrays = this.buildStageArrays();
  }

  /**
   * Bring the atlas into line with the current capacity, allocating, re-planning
   * or releasing as needed. Called once per populate, after any capacity change.
   *
   * Geometry is planned against `capacity` rather than the drawn count, like every
   * other staging array, so the colour-only fast path never has to re-plan.
   */
  private syncLabelAtlas(): void {
    // Already released by `disableLabelAtlas`, and it must stay that way.
    if (this.labelAtlasDisabled) return;
    // Nothing samples the atlas unless a point carries more than one colour, so
    // a single-label annotation pays 32 B/point — 42% of GPU residency — for a
    // feature it is not using. Release it, and allocate on the transition back.
    // Reads the value `render()` latched for this pass rather than re-asking the
    // getter, so the gate and the re-stage that follows it cannot disagree.
    // Guarded on `this.atlas`: without it every single-label frame would re-point
    // the staging view and re-upload the placeholder for a release already done.
    if (!this.labelAtlasActive) {
      if (this.atlas) this.releaseLabelAtlas();
      return;
    }
    // Nothing to cover yet. An empty render — no data loaded, or a viewport cull
    // that matched nothing — reaches here with capacity 0, and `planLabelAtlas`
    // rejects that as un-plannable. Latching the atlas off on it would kill pie
    // markers for the rest of the session and toast the user about a device that
    // "cannot hold a colour table for 0 points".
    if (this.capacity < 1) return;
    // Already sized for this capacity — the common case, including every
    // re-render. A plan that is merely *large enough* is not enough on its own:
    // capacity can shrink, and the atlas is the biggest capacity-sized resource
    // there is (64 MB of texels at a 2,000,000 plan, plus its GPU storage), so a
    // plan left far above the drawn count would be retained for the session while
    // the SoA arrays around it were released. Same hysteresis as the planner.
    if (
      this.atlas &&
      !shouldReplanCapacityResource(this.atlas.plan.pointCapacity, this.capacity, MIN_CAPACITY)
    )
      return;

    const plan = planLabelAtlas(this.capacity, this.maxTextureSize);
    if (!plan) {
      this.disableLabelAtlas('label-atlas-unsupported');
      return;
    }

    this.atlas = { plan, texels: new Uint8Array(plan.byteLength) };
    this.labelTextureInitialized = false;
    this.stageArrays = this.buildStageArrays();
    if (plan.stride < MAX_LABELS) this.reportDegraded('reduced-label-detail');
  }

  /**
   * Whether the selected annotation stores more than one value for some protein.
   *
   * Optional-called and defaulting to TRUE, in one place: the failure direction
   * matters. A consumer that omits the getter over-allocates, which wastes
   * memory; one that under-reports would silently lose pie segments. Only the
   * first is acceptable, and `WebGLStyleGetters` keeps TypeScript consumers
   * honest either way.
   */
  private isMultilabel(): boolean {
    return this.style.isMultilabel?.() ?? true;
  }

  private planCapacity(minCapacity: number): number {
    return planRendererCapacity(
      minCapacity,
      this.capacity,
      MIN_CAPACITY,
      CAPACITY_GRANULARITY,
      MAX_RENDERABLE_POINTS,
    );
  }

  private resizeCapacity(nextCapacity: number) {
    this.capacity = nextCapacity;
    this.dataPositions = new Float32Array(nextCapacity * 2);
    this.colors = new Float32Array(nextCapacity * 4);
    this.sizes = new Float32Array(nextCapacity);
    this.depths = new Float32Array(nextCapacity);
    this.labelCounts = new Float32Array(nextCapacity);
    this.shapes = new Float32Array(nextCapacity);
    this.predicted = new Float32Array(nextCapacity);
    this.sortOrder = new Uint32Array(nextCapacity);
    this.sortDepths = new Float32Array(nextCapacity);
    // The atlas is NOT touched here: its geometry depends on the device texture
    // limit, so `syncLabelAtlas` owns it and decides on this same populate pass
    // whether the existing plan still fits — which, since capacity can now shrink
    // as well as grow, it sometimes does.

    // Re-point the staging view at the freshly reallocated arrays (zero copy).
    // Still needed even though `syncLabelAtlas` also rebuilds it — that call
    // returns early once the atlas is disabled, and these arrays are new.
    this.stageArrays = this.buildStageArrays();

    this.buffersInitialized = false;
  }
}
