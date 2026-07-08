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
  MAX_POINTS_DIRECT_RENDER,
  DEFAULT_GAMMA,
} from '../types';
import { createProgramFromSources } from '../shader-utils';
import { resolvePointLocations } from './point-locations';
import { setupAttributes } from './point-attributes';
import { buildPaintOrder } from './point-staging';
import { planRendererCapacity } from './capacity-planner';
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
import { stagePoint, stagePointStyle, type StagePointArrays, MAX_LABELS } from './stage-point';
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
const LABEL_TEXTURE_WIDTH = 2048;
const POINTS_PER_TEXTURE_ROW = LABEL_TEXTURE_WIDTH / MAX_LABELS;

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
  private labelColorData = new Uint8Array(0);

  // Zero-copy view over the parallel staging arrays above, passed to `stagePoint`.
  // Re-pointed in `refreshStageArrays()` whenever capacity is reallocated.
  private stageArrays: StagePointArrays = this.buildStageArrays();

  // State
  private capacity = 0;
  private labelTextureInitialized = false;

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
   * number of points (e.g. datasets > MAX_POINTS_DIRECT_RENDER).
   *
   * For typical datasets (<= MAX_POINTS_DIRECT_RENDER), tracking is unnecessary
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
    });
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
        maxLabels: MAX_LABELS,
        labelTextureWidth: LABEL_TEXTURE_WIDTH,
        labelColorDataLength: this.labelColorData.length,
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

    const maxPoints = Math.min(pd.length, MAX_POINTS_DIRECT_RENDER);

    if (maxPoints > this.capacity) {
      this.expandCapacity(maxPoints);
      updatePositions = true;
      updateStyles = true;
    }

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
        const newDepth = this.style.getDepth(sp);
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
        depthScratch[i] = this.style.getDepth(sp);
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

    gl.bindVertexArray(this.resources.pointVao);

    if (updatePositions) {
      this.updateBuffer(gl, this.resources.dataPositionBuffer, this.dataPositions, idx * 2);
    }

    if (updateStyles) {
      this.updateBuffer(gl, this.resources.sizeBuffer, this.sizes, idx);
      this.updateBuffer(gl, this.resources.colorBuffer, this.colors, idx * 4);
      this.updateBuffer(gl, this.resources.depthBuffer, this.depths, idx);
      this.updateBuffer(gl, this.resources.labelCountBuffer, this.labelCounts, idx);
      this.updateBuffer(gl, this.resources.shapeBuffer, this.shapes, idx);

      // Update label-color texture. Allocate storage once (and whenever capacity grew);
      // afterwards update in place with texSubImage2D — no 32 MiB reallocation per recolor.
      gl.bindTexture(gl.TEXTURE_2D, this.resources.labelColorTexture);
      const texHeight = this.labelColorData.length / 4 / LABEL_TEXTURE_WIDTH;
      if (!this.labelTextureInitialized) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          LABEL_TEXTURE_WIDTH,
          texHeight,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.labelColorData,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.labelTextureInitialized = true;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          LABEL_TEXTURE_WIDTH,
          texHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.labelColorData,
        );
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    gl.bindVertexArray(null);
    this.buffersInitialized = true;
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
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, length));
    } else {
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
      labelColorData: this.labelColorData,
    };
  }

  private expandCapacity(minCapacity: number) {
    const nextCapacity = planRendererCapacity(
      minCapacity,
      this.capacity,
      MIN_CAPACITY,
      POINTS_PER_TEXTURE_ROW,
    );
    this.capacity = nextCapacity;
    this.dataPositions = new Float32Array(nextCapacity * 2);
    this.colors = new Float32Array(nextCapacity * 4);
    this.sizes = new Float32Array(nextCapacity);
    this.depths = new Float32Array(nextCapacity);
    this.labelCounts = new Float32Array(nextCapacity);
    this.shapes = new Float32Array(nextCapacity);
    this.sortOrder = new Uint32Array(nextCapacity);
    this.sortDepths = new Float32Array(nextCapacity);
    // Align texture height to next power of 2 or just simple expansion
    // Total pixels needed = nextCapacity * MAX_LABELS
    // Texture Width = LABEL_TEXTURE_WIDTH
    // Height = ceil(Total / Width)
    const requiredPixels = nextCapacity * MAX_LABELS;
    const texHeight = Math.ceil(requiredPixels / LABEL_TEXTURE_WIDTH);
    this.labelColorData = new Uint8Array(LABEL_TEXTURE_WIDTH * texHeight * 4);
    this.labelTextureInitialized = false;

    // Re-point the staging view at the freshly reallocated arrays (zero copy).
    this.stageArrays = this.buildStageArrays();

    this.buffersInitialized = false;
  }
}
