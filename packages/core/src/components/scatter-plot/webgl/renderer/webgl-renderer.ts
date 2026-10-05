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
import {
  DENSITY_DEFAULT,
  type PlotData,
  type PlotDataPoint,
  type ScatterplotConfig,
} from '@protspace/utils';
import {
  type PointMarks,
  type PointStylePass,
  type WebGLStyleGetters,
  type ScalePair,
  type PointAttribLocations,
  type PointUniformLocations,
  MAX_RENDERABLE_POINTS,
  DEFAULT_GAMMA,
} from '../types';
import {
  beginProgramFromSources,
  discardProgram,
  finishProgram,
  type PendingProgram,
} from '../shader-utils';
import {
  IDENTITY_RESCALE,
  linearAxis,
  mapLinear,
  rescaleBetween,
  snapshotScales,
  type Rescale,
  type ScaleSnapshot,
} from '../../rescale';
import { resolvePointLocations } from './point-locations';
import { setupAttributes } from './point-attributes';
import { composePaintDepth } from './point-staging';
import {
  beginStylePass,
  createPassScratch,
  packRecords,
  restageStyles,
  stageInPaintOrder,
} from './pass-staging';
import {
  canRestyle,
  collectStagedRecords,
  markedFirstDrawn,
  recordTableRows,
  shownSlotCount,
  writeRecordTexels,
  type StagedRecords,
} from './record-table';
import { planRendererCapacity, shouldReplanCapacityResource } from './capacity-planner';
import { createLinearFramebuffer, destroyFramebuffer } from './framebuffer';
import { GLResources } from './gl-resources';
import {
  bindAndClearTarget,
  setPointBlendState,
  drawPoints,
  drawMarkedPoints,
  bindPointDrawState,
  MARK_TEXTURE_UNIT,
  RECORD_STYLE_TEXTURE_UNIT,
} from './render-target';
import { QUAD_VERTICES, drawGammaQuad } from './gamma-quad';
import {
  createDensityResources,
  resizeDensityTargets,
  accumulateAndBlurDensity,
  compositeDensity,
  buildSlotPalette,
  buildRecordSlotPalette,
  type DensityFrame,
  type DensityResources,
  type SlotPalette,
} from './density-pass';
import { densityFrameAlpha } from './density-crossfade';
import {
  MAX_FRAME_STEP_MS,
  drawnPositions,
  frameTime,
  morphWeight,
  repaintOrder,
  samePaintOrder,
} from './position-morph';
import { DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT } from './viewport-defaults';
import type { StagePointArrays } from './stage-point';
import { computePointScale } from './point-scale';
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
import { perfCounters } from '../../../../utils/perf-counters';
import {
  POINT_VERTEX_SHADER,
  POINT_FRAGMENT_SHADER,
  GAMMA_VERTEX_SHADER,
  GAMMA_FRAGMENT_SHADER,
  RECORD_STYLE_WIDTH,
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

/**
 * The context attributes are fixed by the first `getContext` call, so every caller passes these.
 * No MSAA: points go to a single-sample float FBO with shader-side edge AA, and the canvas only
 * receives the full-screen gamma quad.
 */
const CONTEXT_OPTIONS: WebGLContextAttributes = {
  antialias: false,
  preserveDrawingBuffer: true,
  premultipliedAlpha: false,
  alpha: true,
  powerPreference: 'high-performance',
};

/** Both programs the first draw needs, compiling but not yet read back. */
interface PendingPrograms {
  gl: WebGL2RenderingContext;
  point: PendingProgram | null;
  gamma: PendingProgram | null;
}

// ============================================================================
// WebGL2 Renderer Implementation
// ============================================================================

export class WebGLRenderer {
  private gl: WebGL2RenderingContext | null = null;
  /** Programs started by {@link prewarm} (or the first `ensureGL`) and not yet read back. */
  private pendingPrograms: PendingPrograms | null = null;

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
    position: number;
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
  private recordIds = new Float32Array(0);

  // Zero-copy view over the parallel staging arrays above, passed to the staging passes.
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
  private densityDisabled = false;
  private contourPalette: SlotPalette | null = null;
  /**
   * Bumped by every `populateBuffers`, `restyleRecords` and `applyMarks`, the
   * only writers of the position buffer and of the colours and order points draw
   * with, and the only places `contourPalette` is invalidated, so it keys the
   * density fields built from them.
   */
  private bufferGeneration = 0;
  /**
   * The per-record style table the staged points draw through, or null when the
   * last stage kept none (see record-table.ts). With it, a legend change that
   * only restyles categories rewrites the table instead of re-staging.
   */
  private stagedRecords: StagedRecords | null = null;
  /** Rows the table texture is allocated with; 0 before its first upload. */
  private recordStyleRows = 0;
  private categoryStylesDirty = false;
  /**
   * Set when a colour-only restage left slots whose paint depth moved in their
   * old order. A restyle must not keep that order: the next style update's
   * re-sort decision is staging's to make.
   */
  private stagedOrderStale = false;
  /**
   * The marks the GPU draws over the staged points (see `PointMarks`), or null.
   * The mark texture holds a byte per staged point, by draw index, and
   * `stagedMarks` is its copy, so a new selection uploads only the rows it changed.
   */
  private marks: PointMarks | null = null;
  private stagedMarks = new Uint8Array(0);
  /** Draw indices `[first, end)` around every drawn marked point; null with none drawn. */
  private markedRange: { first: number; end: number } | null = null;
  /** Set when staging or a restyle moved or hid points since the marks were applied. */
  private marksStale = false;
  /** Whether the device refused the mark texture of the current capacity; see `canDrawMarks`. */
  private markTextureRefused = false;
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
  private visibleCount = 0;
  private positionsDirty = true;
  private stylesDirty = true;
  // Depth-order dirtiness is tracked separately from positionsDirty so callers
  // can signal "re-sort by depth on next render" without lying about positions.
  // Cleared inside populateBuffers once the re-sort runs.
  private depthOrderDirty = false;
  private buffersInitialized = false;

  // Store last rendered data for off-screen export rendering
  private lastRenderedData: PlotData | null = null;

  // Positions are staged in CSS pixels, through the scales of the pass that
  // staged them. New scales move every point, but while only their ranges
  // changed (a resize) `positionRescale` moves them on the GPU, folded into
  // u_transform, instead of a re-stage: a full style pass and depth sort,
  // ~500 ms at 573K points.
  private stagedScales: ScaleSnapshot | null = null;
  private positionRescale: Rescale = IDENTITY_RESCALE;

  // Reusable index-sort scratch (avoids per-render object staging + a retained mapped array).
  // `sortOrder[0..currentPointCount)` holds slot indices in far->near draw order; it indexes
  // into `sortedDataRef` (the PlotData from the last full rebuild). `passScratch` holds what
  // a style pass resolves per slot (opacity, depth, style record), indexed by ORIGINAL slot.
  private sortOrder = new Uint32Array(0);
  private passScratch = createPassScratch(0);
  private sortedDataRef: PlotData | null = null;

  // Single reused scratch point for the hot loop — populated per slot, passed to style getters.
  private scratchPoint: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };

  // Selection-aware two-pass rendering
  private selectionActive = false;
  private selectedStartIndex = 0;

  // Projection glide (see position-morph.ts). `morph.from` holds the positions
  // the points glide from, staged like `dataPositions`, and only while they move.
  private morphRequested = false;
  private morph: { from: Float32Array; elapsed: number; last: number } | null = null;
  /** Weight of `morph.from` in the frame being drawn; 0 outside a glide. */
  private morphWeightNow = 0;

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
  /** The float extension this context lacks, which is why the gamma pipeline never ran. */
  private missingFloatExtension: string | null = null;

  // Context-loss lifecycle (listener + idempotent "lost" flag) lives in the
  // controller; `markContextLost`/`isContextLost` delegate to it.
  private readonly lossController: ContextLossController;

  // Off-screen export subsystem. Stateless apart from the ephemeral context it
  // creates per `renderToCanvas` call; the facade passes in the live data,
  // config, style getters, transform, gamma, and selection state.
  private readonly exportRenderer = new ExportRenderer();

  /**
   * @param style What the live view stages. With marks (`getPointMarks`) it styles
   *   every point as if none were marked.
   * @param exportStyle What an export stages, marks included: `style` unless the
   *   live view marks points on the GPU.
   */
  constructor(
    private canvas: HTMLCanvasElement,
    private getScales: () => ScalePair | null,
    private getTransform: () => d3.ZoomTransform,
    private getConfig: () => ScatterplotConfig,
    private style: WebGLStyleGetters,
    private onContextLost?: () => void,
    private getKnockoutColor: () => readonly [number, number, number] = () => [1, 1, 1],
    private onDegraded?: (detail: RendererDegradedDetail) => void,
    private exportStyle: WebGLStyleGetters = style,
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
   * The style of whole categories changed (legend hide, show, colour or shape)
   * and nothing per point did. The next render rewrites the per-record table
   * when the staged points draw through one, and re-stages them otherwise.
   */
  invalidateCategoryStyles() {
    this.categoryStylesDirty = true;
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

  get visiblePointCount(): number {
    return this.visibleCount;
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

  /**
   * Whether `getPointMarks` can be drawn: the mark texture holds a texel per
   * point of the capacity, so up to maxTextureSize² points, and the device did
   * not refuse it. Otherwise the live view stages the marks with every other
   * style. Known once the capacity is planned, before anything is staged.
   */
  get canDrawMarks(): boolean {
    return this.capacity <= this.maxTextureSize ** 2 && !this.markTextureRefused;
  }

  /**
   * `readPixels` cannot return until the commands ahead of it have executed,
   * which makes it the portable WebGL way to wait for the GPU.
   */
  syncGpu(): void {
    const gl = this.gl;
    if (!gl || this.isContextLost()) return;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncScratch);
  }

  private readonly syncScratch = new Uint8Array(4);

  invalidatePositionCache() {
    this.positionsDirty = true;
  }

  /**
   * Glide the points from where they are drawn to the positions the next render
   * stages, instead of jumping there. Meant for a change that keeps every point
   * in its slot (a projection or plane switch); dropped when that render stages
   * no positions or the point count changes.
   */
  morphNextPositionChange() {
    this.morphRequested = true;
  }

  /** Drop a glide request, and end a glide, so the next frame draws the staged positions. */
  cancelMorph() {
    this.morphRequested = false;
    if (this.morph) this.endMorph();
  }

  /** True while the points glide; the host keeps rendering frames until it is false. */
  get isMorphing(): boolean {
    return this.morph !== null;
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

  pointScale(): number {
    const config = this.getConfig();
    return computePointScale(
      this.getTransform().k,
      config.width ?? DEFAULT_VIEWPORT_WIDTH,
      config.height ?? DEFAULT_VIEWPORT_HEIGHT,
    );
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

  private ensureDensityResources(): DensityResources | null {
    const gl = this.gl;
    if (!gl || this.densityDisabled) return null;
    if (!this.resources.density) {
      if (!this.resources.quadBuffer || !this.pointAttribLocations) return null;

      this.resources.density = createDensityResources(gl, this.resources.quadBuffer, {
        dataPosition: this.pointAttribLocations.dataPosition,
        prevPosition: this.pointAttribLocations.prevPosition,
        color: this.pointAttribLocations.color,
        record: this.pointAttribLocations.record,
      });
      if (!this.resources.density) {
        this.disableDensity('density shaders failed to compile');
        return null;
      }
    }
    if (!resizeDensityTargets(gl, this.resources.density, this.canvas.width, this.canvas.height)) {
      this.disableDensity('density target incomplete');
      return null;
    }
    return this.resources.density;
  }

  private disableDensity(reason: string) {
    this.densityDisabled = true;
    console.warn(`WebGLRenderer: density layer disabled (${reason}).`);
    if (this.gl) this.resources.destroyDensity(this.gl);
    this.resources.density = null;
    this.reportDensityUnavailable(reason);
  }

  /**
   * Contours were asked for but cannot draw on this context. Without this the
   * Contours menu reads as on while the plot never changes. It waits for points,
   * so a `?density=on` link does not toast over the loading screen.
   */
  private reportDensityUnavailable(cause: string) {
    if ((this.getConfig().densityLayer ?? DENSITY_DEFAULT) === 'off') return;
    if (this.currentPointCount === 0) return;
    this.reportDegraded('density-unavailable', cause);
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

    this.resources.destroyDensity(gl);

    this.gammaCorrectionUniformLocations = null;
  }

  private cleanupGammaResources() {
    this.resources.gammaCorrectionProgram = null;
    this.gammaCorrectionUniformLocations = null;
    this.resources.linearFramebuffer = null;
    this.resources.density = null;
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
    // Before the first draw the plot clears an empty canvas on every size change. That needs a
    // context but no program, so a prewarmed renderer clears on its prewarm context and leaves
    // the programs compiling: reading their status here would block on the compile a frame after
    // it started. The first `render()` with points finishes them.
    const gl = this.pendingPrograms?.gl ?? this.ensureGL();
    if (!gl) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.currentPointCount = 0;
    this.visibleCount = 0;
  }

  render(pd: PlotData) {
    if (perfCounters) perfCounters.render++;
    // A glide request applies to this render only.
    const morphRequested = this.morphRequested;
    this.morphRequested = false;
    // Store PlotData for potential off-screen export rendering
    this.lastRenderedData = pd;

    // The zoom handler also renders the still-empty plot at startup. With nothing to draw and the
    // programs still compiling that is a clear, not a reason to wait for them.
    if (pd.length === 0 && this.pendingPrograms) {
      this.clear();
      return;
    }

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
    let styleSignature = this.computeStyleSignature(pd);

    const needsPositionUpdate =
      this.positionsDirty ||
      dataSignature !== this.lastDataSignature ||
      !this.rescaleStagedTo(scales);
    const needsStyleUpdate =
      this.stylesDirty || this.categoryStylesDirty || styleSignature !== this.lastStyleSignature;
    const needsDepthOrderUpdate = this.depthOrderDirty;

    if (needsPositionUpdate || needsStyleUpdate || needsDepthOrderUpdate) {
      const stageStart = perfCounters ? performance.now() : 0;
      // A category restyle explains the sampled points' new opacity and colour,
      // so the style signature may change without anything per point changing.
      const restyled =
        this.categoryStylesDirty &&
        !this.stylesDirty &&
        !needsPositionUpdate &&
        !needsDepthOrderUpdate &&
        this.restyleRecords(pd);
      if (!restyled) {
        const refused = this.markTextureRefused;
        this.populateBuffers(pd, scales, needsPositionUpdate, needsStyleUpdate, morphRequested);
        // The device refused a new mark texture, or took one after refusing: the
        // marks were staged for the other, so stage them as the live view now does.
        if (this.markTextureRefused !== refused) {
          this.populateBuffers(pd, scales, false, true, false);
          styleSignature = this.computeStyleSignature(pd);
        }
      }
      if (perfCounters) perfCounters.restageMs += performance.now() - stageStart;
      this.lastDataSignature = dataSignature;
      this.lastStyleSignature = styleSignature;
      this.positionsDirty = false;
      this.stylesDirty = false;
      this.categoryStylesDirty = false;
      // depthOrderDirty is cleared inside populateBuffers once the re-sort runs.
    }
    // After staging, which lays out the draw order the marks are written in.
    const marks = this.style.getPointMarks?.(pd) ?? null;
    if (marks !== this.marks || this.marksStale) this.applyMarks(marks);
    // Asked after staging, which may have laid the positions out afresh.
    this.positionRescale = this.rescaleStagedTo(scales) ?? IDENTITY_RESCALE;
    this.advanceMorph();

    // Render with gamma-correct pipeline
    this.renderWithGammaCorrection(transform);
    if (perfCounters) {
      perfCounters.drawn = this.drawnPointCount;
      if (this.morphWeightNow > 0) perfCounters.morphFrame++;
    }
  }

  /** Map from the staged positions to `scales`' pixels; null when there is none. */
  private rescaleStagedTo(scales: ScalePair): Rescale | null {
    return this.stagedScales && rescaleBetween(this.stagedScales, scales);
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
      // The density layer draws only in the linear-light pass.
      const missing = this.missingFloatExtension;
      this.reportDensityUnavailable(
        missing ? `${missing} missing` : 'linear-light pipeline unavailable',
      );
      this.renderDirect(transform);
      return;
    }

    const framebuffer = this.resources.linearFramebuffer;
    if (!framebuffer) {
      this.renderDirect(transform);
      return;
    }

    const gl = this.gl;

    const density = this.densityFrame(transform);
    if (density) {
      // The fields persist between frames, so a re-render that changes none of
      // their inputs (hover, tooltip) only composites them. A glide moves the
      // points every frame, so it re-accumulates them every frame.
      const {
        width,
        height,
        dpr,
        transform: t,
        rescale: r = IDENTITY_RESCALE,
        morph = 0,
      } = density.camera;
      const key = [
        this.bufferGeneration,
        this.currentPointCount,
        width,
        height,
        dpr,
        t.x,
        t.y,
        t.k,
        r.x.scale,
        r.x.offset,
        r.y.scale,
        r.y.offset,
        morph,
      ].join();
      if (density.res.fieldsKey !== key) {
        this.bindRecordStyle(gl);
        accumulateAndBlurDensity(gl, density, this.resources.pointVao, this.currentPointCount);
        density.res.fieldsKey = key;
      }
    }

    // Pass 1: Render to linear RGB framebuffer.
    bindAndClearTarget(gl, framebuffer.framebuffer, framebuffer.width, framebuffer.height);

    this.renderPoints(transform, density ? () => compositeDensity(gl, density) : undefined);

    // Pass 2: Gamma correction to canvas
    bindAndClearTarget(gl, null, this.canvas.width, this.canvas.height);

    this.renderGammaCorrection();
  }

  private densityFrame(transform: d3.ZoomTransform): DensityFrame | null {
    const config = this.getConfig();
    // Missing means Off here too, as in reportDensityUnavailable and the menu.
    const mode = config.densityLayer ?? DENSITY_DEFAULT;
    if (mode === 'off') return null;

    if (this.densityDisabled || this.currentPointCount === 0) return null;

    const viewDimensionCss = Math.max(
      config.width ?? DEFAULT_VIEWPORT_WIDTH,
      config.height ?? DEFAULT_VIEWPORT_HEIGHT,
    );
    const alpha = densityFrameAlpha(
      this.visibleCount,
      transform.k,
      viewDimensionCss,
      mode === 'on',
    );
    if (alpha <= 0) return null;

    // Points drawn through the record table have their staged alpha unhidden.
    // Drawn marked points come after every other point, as staging puts a selection.
    const marked = this.markedRange ? this.stagedMarks : null;
    const count = this.currentPointCount;
    this.contourPalette ??= this.stagedRecords
      ? buildRecordSlotPalette(
          this.stagedRecords,
          this.gamma,
          marked
            ? markedFirstDrawn(this.stagedRecords, this.recordIds, this.colors, marked, count)
            : undefined,
        )
      : buildSlotPalette(this.colors, count, this.gamma, marked);
    if (this.contourPalette.count === 0) return null;

    const res = this.ensureDensityResources();
    if (!res || !res.accum) return null;

    return {
      res,
      camera: {
        width: this.canvas.width,
        height: this.canvas.height,
        transform: { x: transform.x, y: transform.y, k: transform.k },
        dpr: this.dpr,
        rescale: this.positionRescale,
        morph: this.morphWeightNow,
      },
      alpha,
      palette: this.contourPalette,
      recordStyleOn: !!this.stagedRecords,
    };
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
    this.discardPrograms(this.pendingPrograms);
    this.pendingPrograms = null;
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
   * the last-rendered data, the live config + export style getters (which stage
   * the marks the live view draws on the GPU), and the live render state
   * (selection, transform, gamma) so the export equals the on-screen render
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
    return this.exportRenderer.renderToCanvas(
      this.lastRenderedData,
      this.getConfig(),
      this.exportStyle,
      {
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
      },
    );
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
    // Runs every frame, so it asks only what the browser answers on its own: the
    // `is*` handle queries each wait for the GPU process. Handles go stale only
    // when the context is lost. That latches the controller, and the owner then
    // rebuilds the renderer on a fresh canvas, so a restored context is never
    // drawn with the old handles.
    if (this.gl && this.gl.isContextLost && this.gl.isContextLost()) {
      this.markContextLost();
      return null;
    }
    if (
      this.gl &&
      this.resources.pointProgram &&
      this.pointAttribLocations &&
      this.pointUniformLocations
    ) {
      return this.gl;
    }

    const gl = this.canvas.getContext('webgl2', CONTEXT_OPTIONS);
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
      this.missingFloatExtension = colorBufferFloatExt
        ? 'EXT_float_blend'
        : 'EXT_color_buffer_float';
      this.handleGammaFallback('required extensions missing');
    }

    // Both programs compile at once (and, when prewarmed, already have); only now is the result read.
    const pending = this.takePendingPrograms(gl) ?? this.beginPrograms(gl);
    if (!this.initializePointShaders(gl, pending.point)) {
      if (pending.gamma) discardProgram(gl, pending.gamma);
      return null;
    }

    if (this.gammaPipelineAvailable) {
      if (!this.initializeGammaCorrectionShaders(gl, pending.gamma)) {
        this.handleGammaFallback('gamma shader init failed');
      }
    } else if (pending.gamma) {
      discardProgram(gl, pending.gamma);
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

  /** Bind the record table where the vertex shaders read it, if points draw through one. */
  private bindRecordStyle(gl: WebGL2RenderingContext) {
    gl.activeTexture(gl.TEXTURE0 + RECORD_STYLE_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.stagedRecords ? this.resources.recordStyleTexture : null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private resetRendererState() {
    this.discardPrograms(this.pendingPrograms);
    this.pendingPrograms = null;
    this.gl = null;
    this.resources.reset();
    this.pointAttribLocations = null;
    this.pointUniformLocations = null;
    this.gammaCorrectionUniformLocations = null;
    this.labelTextureInitialized = false;
    this.atlas = null;
    this.labelAtlasDisabled = false;
    this.labelAtlasActive = false;
    this.densityDisabled = false;
    this.degradeReported.clear();
    this.gammaPipelineAvailable = true;
    this.warnedGammaFallback = false;
    this.missingFloatExtension = null;
    this.buffersInitialized = false;
    this.currentPointCount = 0;
    this.visibleCount = 0;
    this.positionsDirty = true;
    this.stylesDirty = true;
    this.lastDataSignature = null;
    this.lastStyleSignature = null;
    this.renderedPointIds.clear();
    this.sortedDataRef = null;
    this.stagedScales = null;
    this.positionRescale = IDENTITY_RESCALE;
    // Its buffer went with the context, and the restore draws the staged positions.
    this.morph = null;
    this.morphWeightNow = 0;
    this.stagedRecords = null;
    this.recordStyleRows = 0;
    this.marks = null;
    this.markedRange = null;
  }

  /**
   * Create the context and start compiling both programs without waiting for them, so the compile
   * overlaps whatever the page does before its first draw (loading data) instead of stalling it.
   * The first `render()` reads the results (`clear()` does not need them). Optional, idempotent,
   * and silent when WebGL2 is unavailable: `ensureGL` reports that when a draw is attempted.
   */
  prewarm(): void {
    if (this.gl || this.pendingPrograms) return;
    const gl = this.canvas.getContext('webgl2', CONTEXT_OPTIONS);
    if (!gl) return;
    this.pendingPrograms = this.beginPrograms(gl);
  }

  private beginPrograms(gl: WebGL2RenderingContext): PendingPrograms {
    // Without this the driver compiles on first use, so the overlap above would not exist.
    gl.getExtension('KHR_parallel_shader_compile');
    return {
      gl,
      point: beginProgramFromSources(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER),
      gamma: beginProgramFromSources(gl, GAMMA_VERTEX_SHADER, GAMMA_FRAGMENT_SHADER),
    };
  }

  /** The prewarmed programs if they belong to `gl`; programs of any other context are dropped. */
  private takePendingPrograms(gl: WebGL2RenderingContext): PendingPrograms | null {
    const pending = this.pendingPrograms;
    this.pendingPrograms = null;
    if (!pending) return null;
    if (pending.gl === gl) return pending;
    this.discardPrograms(pending);
    return null;
  }

  private discardPrograms(pending: PendingPrograms | null): void {
    if (!pending) return;
    if (pending.point) discardProgram(pending.gl, pending.point);
    if (pending.gamma) discardProgram(pending.gl, pending.gamma);
  }

  private initializePointShaders(
    gl: WebGL2RenderingContext,
    pending: PendingProgram | null,
  ): boolean {
    this.resources.pointProgram = pending && finishProgram(gl, pending);
    if (!this.resources.pointProgram) return false;

    const { attribs, uniforms } = resolvePointLocations(gl, this.resources.pointProgram);
    this.pointAttribLocations = attribs;
    this.pointUniformLocations = uniforms;

    return true;
  }

  private initializeGammaCorrectionShaders(
    gl: WebGL2RenderingContext,
    pending: PendingProgram | null,
  ): boolean {
    this.resources.gammaCorrectionProgram = pending && finishProgram(gl, pending);
    if (!this.resources.gammaCorrectionProgram) return false;

    this.gammaCorrectionUniformLocations = {
      linearTexture: gl.getUniformLocation(
        this.resources.gammaCorrectionProgram,
        'u_linearTexture',
      ),
      gamma: gl.getUniformLocation(this.resources.gammaCorrectionProgram, 'u_gamma'),
      position: gl.getAttribLocation(this.resources.gammaCorrectionProgram, 'a_position'),
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
    // Live only: the export draws every point with its own style.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.recordBuffer);
    gl.enableVertexAttribArray(this.pointAttribLocations.record);
    gl.vertexAttribPointer(this.pointAttribLocations.record, 1, gl.FLOAT, false, 0, 0);
    // Left disabled, so the shader reads (0, 0), which u_morph 0 leaves out; a
    // projection glide enables it while the points move.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.prevPositionBuffer);
    gl.vertexAttribPointer(this.pointAttribLocations.prevPosition, 2, gl.FLOAT, false, 0, 0);

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

  private renderPoints(transform: d3.ZoomTransform, afterBasePass?: () => void) {
    if (
      !this.gl ||
      this.currentPointCount === 0 ||
      !this.resources.pointProgram ||
      !this.pointUniformLocations
    ) {
      return;
    }

    const gl = this.gl;
    const marks = this.marks;

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
        rescale: this.positionRescale,
        morph: this.morphWeightNow,
        pointScale: this.pointScale(),
        gamma: this.getEffectiveGamma(),
        knockoutColor: this.getKnockoutColor(),
        // Null when no atlas is allocated, which makes the shader's pie branch
        // unreachable and every marker fall through to its dominant colour.
        labelAtlas: this.atlas?.plan ?? null,
        recordStyle: this.stagedRecords ? this.resources.recordStyleTexture : null,
        marks: marks && {
          texture: this.resources.markTexture,
          marked: marks.marked,
          unmarked: marks.unmarked,
        },
      },
    );

    const between = afterBasePass && {
      run: afterBasePass,
      program: this.resources.pointProgram,
      vao: this.resources.pointVao,
      labelTexture: this.resources.labelColorTexture,
    };
    if (marks) {
      drawMarkedPoints(
        gl,
        this.pointUniformLocations.markPass,
        this.currentPointCount,
        this.markedRange,
        between,
      );
    } else {
      drawPoints(
        gl,
        this.currentPointCount,
        this.selectionActive,
        this.selectedStartIndex,
        between,
      );
    }

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
    morphRequested: boolean,
  ) {
    if (!this.gl) return;
    const gl = this.gl;
    this.bufferGeneration++;
    this.marksStale = true;
    if (perfCounters) {
      perfCounters.restage++;
      if (updatePositions) perfCounters.restagePos++;
      if (updateStyles) perfCounters.restageStyle++;
    }

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
    let morphChanged = false;

    if (needsReorder) {
      this.visibleCount = 0;
      const count = maxPoints;
      // The re-sort below permutes every buffer, so a glide crosses it by slot: a
      // new one starts where the points are drawn, and one in flight keeps its
      // start and its clock. Read from the staged copies, never from `pd`, whose
      // coordinates a projection switch may already have overwritten.
      const before =
        (morphRequested || this.morph) &&
        this.buffersInitialized &&
        count === this.currentPointCount
          ? {
              drawn: drawnPositions(
                this.dataPositions,
                this.morph?.from ?? null,
                morphRequested ? this.morphWeightNow : 1,
                this.positionRescale,
                count,
              ),
              order: this.sortOrder.slice(0, count),
            }
          : null;
      // Hidden points (opacity=0) are staged too, so sort order is preserved across
      // visibility toggles, enabling the fast color-only update path instead of a
      // full rebuild + re-sort. Shared with the export path, which stages the same
      // painter order and selection cut.
      const pass = beginStylePass(this.style);
      const table = this.prepareRecordTable(pass);
      this.selectedStartIndex = stageInPaintOrder(
        this.stageArrays,
        pass,
        this.passScratch,
        this.sortOrder,
        pd,
        scales,
        count,
        this.selectionActive,
        (slot, opacity) => this.countStagedSlot(pd, slot, opacity),
      );

      if (before || this.morph) {
        if (before && !samePaintOrder(before.order, this.sortOrder, count)) {
          repaintOrder(before.drawn, before.order, this.sortOrder, count);
        }
        const clock =
          !morphRequested && this.morph ? this.morph : { elapsed: 0, last: frameTime() };
        this.morph = before && { from: before.drawn, elapsed: clock.elapsed, last: clock.last };
        morphChanged = true;
      }

      idx = count;
      // Cache the PlotData reference so color-only / positions-only paths can index via sortOrder.
      this.sortedDataRef = pd;
      this.stagedOrderStale = false;
      this.keepRecordTable(pass, table, idx);
    } else if (updateStyles) {
      this.visibleCount = 0;
      // Color-only update: no reordering needed, just update color/shape buffers.
      // Iterate via sortOrder into sortedDataRef to match the buffer order from the last
      // rebuild. Positions and depths are unchanged from that rebuild.
      const src = this.sortedDataRef;
      if (src) {
        idx = Math.min(this.currentPointCount, maxPoints);
        const pass = beginStylePass(this.style);
        const table = this.prepareRecordTable(pass);
        restageStyles(
          this.stageArrays,
          pass,
          this.passScratch,
          this.sortOrder,
          src,
          // The count that rebuild staged, so every slot sortOrder holds is resolved.
          Math.min(src.length, MAX_RENDERABLE_POINTS),
          idx,
          (slot, opacity) => this.countStagedSlot(src, slot, opacity),
        );
        this.stagedOrderStale = this.orderOutOfDate(idx);
        this.keepRecordTable(pass, table, idx);
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
        const xAxis = linearAxis(scales.x);
        const yAxis = linearAxis(scales.y);
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
            this.dataPositions[idx * 2] = mapLinear(xAxis, srcXs[slot]);
            this.dataPositions[idx * 2 + 1] = mapLinear(yAxis, srcYs[slot]);
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
      this.stagedScales = snapshotScales(scales);
      // Staged through these scales, so drawn as they are: a glide carried by the
      // second stage a render may run (see render()) reads this.
      this.positionRescale = IDENTITY_RESCALE;
    }
    if (morphChanged) this.syncMorphAttribute(gl);

    // Hoisted from `updateStyles` alone: the reorder branch above rewrites every
    // style array AND the atlas into the new slot order, so gating the upload on
    // updateStyles leaves the GPU holding the previous permutation. Reachable via
    // updatePositions and via depthOrderDirty, neither of which sets updateStyles.
    if (updateStyles || needsReorder) {
      // Before the colours: if the table cannot be uploaded, they take the hiding back.
      if (this.stagedRecords && !this.uploadRecordTable(gl)) this.dropRecordTable(idx);
      // Only read through a table, but the attribute needs its storage regardless.
      if (allocating || this.stagedRecords) {
        this.updateBuffer(gl, this.resources.recordBuffer, this.recordIds, idx);
      }
      this.updateBuffer(gl, this.resources.sizeBuffer, this.sizes, idx);
      this.updateBuffer(gl, this.resources.colorBuffer, this.colors, idx * 4);
      this.contourPalette = null;
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

      if (allocating) this.allocateMarkTexture(gl);
      this.uploadLabelAtlas(gl);
    }

    gl.bindVertexArray(null);
    this.buffersInitialized = true;
  }

  /**
   * Upload the glide's start positions and switch their attribute on, or, with
   * no glide, switch it off and hand its storage back. Expects the point VAO bound.
   */
  private syncMorphAttribute(gl: WebGL2RenderingContext) {
    if (!this.pointAttribLocations) return;
    const location = this.pointAttribLocations.prevPosition;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.prevPositionBuffer);
    if (this.morph) {
      this.uploadedBytes += this.morph.from.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.morph.from, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
    } else {
      gl.disableVertexAttribArray(location);
      gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
    }
  }

  /** Set this frame's glide weight, and end the glide once it reaches 0. */
  private advanceMorph() {
    const morph = this.morph;
    if (morph) {
      const now = frameTime();
      morph.elapsed += Math.min(now - morph.last, MAX_FRAME_STEP_MS);
      morph.last = now;
    }
    this.morphWeightNow = morph ? morphWeight(morph.elapsed) : 0;
    if (morph && this.morphWeightNow === 0) this.endMorph();
  }

  private endMorph() {
    this.morph = null;
    this.morphWeightNow = 0;
    const gl = this.gl;
    if (!gl) return;
    gl.bindVertexArray(this.resources.pointVao);
    this.syncMorphAttribute(gl);
    gl.bindVertexArray(null);
  }

  /**
   * Whether this stage keeps a per-record table, and if so point staging at the
   * record ids it writes. It needs a pass that hides per record and keys every
   * record by category code: a single-valued annotation, so no pie markers, and
   * no rendered-id tracking, which a restyle could not keep up to date.
   */
  private prepareRecordTable(pass: PointStylePass): boolean {
    const codes = pass.records.codes;
    const table =
      !this.labelAtlasActive &&
      !this.trackRenderedPointIds &&
      !!codes &&
      !!this.resources.recordStyleTexture &&
      recordTableRows(codes.count) <= this.maxTextureSize &&
      !!pass.hiddenRecords;
    this.stageArrays.recordIds = table ? this.recordIds : null;
    return table;
  }

  /** After staging `count` slots: keep the table they were staged for, if any. */
  private keepRecordTable(pass: PointStylePass, table: boolean, count: number) {
    this.stagedRecords = null;
    if (!table) return;
    const hidden = pass.hiddenRecords!;
    const staged = collectStagedRecords(
      pass.records.codes!,
      this.recordIds,
      this.colors,
      count,
      hidden,
    );
    if (!staged) {
      this.dropRecordTable(count, hidden);
      return;
    }
    writeRecordTexels(staged, this.passScratch.packed!, hidden);
    this.stagedRecords = staged;
  }

  /**
   * Draw the first `count` staged slots without a table: a slot of a hidden
   * record was staged unhidden, so it takes opacity 0, as staging gives it.
   */
  private dropRecordTable(count: number, hidden = this.stagedRecords?.hidden ?? []) {
    this.stagedRecords = null;
    for (let k = 0; k < count; k++) {
      const r = this.recordIds[k];
      if (r >= 0 && hidden[r]) this.colors[k * 4 + 3] = 0;
    }
  }

  /**
   * Rewrite the per-record table for the current category styles, leaving every
   * staged buffer as it is. False when the staged points cannot be restyled that
   * way (see `canRestyle`); the caller then re-stages them.
   */
  private restyleRecords(pd: PlotData): boolean {
    const staged = this.stagedRecords;
    const gl = this.gl;
    if (!staged || !gl || pd !== this.sortedDataRef || this.trackRenderedPointIds) return false;
    // A style update re-sorts when it samples moved depths. Only a re-sort fixes
    // an order that is already out of date, and staging decides when to re-sort.
    if (this.stagedOrderStale || this.stagedDepthsMoved(pd)) return false;
    const pass = beginStylePass(this.style);
    const hidden = pass.hiddenRecords;
    if (!hidden || !canRestyle(staged, pass.records.codes, hidden)) return false;
    writeRecordTexels(staged, packRecords(pass.records, this.stageArrays), hidden);
    if (!this.uploadRecordTable(gl)) return false;
    this.visibleCount = shownSlotCount(staged);
    this.contourPalette = null;
    this.bufferGeneration++;
    this.marksStale = true;
    return true;
  }

  /** Upload the per-record table, allocating it when its size changed. */
  private uploadRecordTable(gl: WebGL2RenderingContext): boolean {
    const staged = this.stagedRecords;
    const texture = this.resources.recordStyleTexture;
    if (!staged || !texture) return false;
    const rows = staged.texels.length / (RECORD_STYLE_WIDTH * 4);
    gl.activeTexture(gl.TEXTURE0 + RECORD_STYLE_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    let ok = true;
    if (rows === this.recordStyleRows) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        RECORD_STYLE_WIDTH,
        rows,
        gl.RGBA,
        gl.FLOAT,
        staged.texels,
      );
    } else {
      drainGlErrors(gl);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        RECORD_STYLE_WIDTH,
        rows,
        0,
        gl.RGBA,
        gl.FLOAT,
        staged.texels,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ok = gl.getError() === gl.NO_ERROR;
      this.recordStyleRows = ok ? rows : 0;
    }
    if (ok) this.uploadedBytes += staged.texels.byteLength;
    gl.activeTexture(gl.TEXTURE0);
    return ok;
  }

  /**
   * Allocate the mark texture for the current capacity, with nothing marked, in
   * rows as wide as the device allows. Empty when the points do not fit (see
   * `canDrawMarks`), which frees what a smaller capacity held. Runs after the
   * point-buffer check, which leaves the error flag clear, so the check here
   * answers for this allocation alone.
   */
  private allocateMarkTexture(gl: WebGL2RenderingContext) {
    const width = this.maxTextureSize;
    const rows = Math.ceil(this.capacity / width);
    const fits = rows <= width;
    this.stagedMarks = new Uint8Array(fits ? rows * width : 0);
    gl.activeTexture(gl.TEXTURE0 + MARK_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.resources.markTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      width,
      fits ? rows : 0,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null,
    );
    this.markTextureRefused = gl.getError() !== gl.NO_ERROR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Write `marks` over the staged points in draw order, upload the rows of the
   * mark texture that changed, and find the draw range of the drawn marked points.
   */
  private applyMarks(marks: PointMarks | null) {
    this.marks = marks;
    this.marksStale = false;
    this.markedRange = null;
    // The contour palette ranks colours by draw position, which marks change.
    this.contourPalette = null;
    this.bufferGeneration++;
    const gl = this.gl;
    if (!marks || !gl) return;
    const staged = this.stagedMarks;
    const { slots } = marks;
    const hidden = this.stagedRecords?.hidden;
    let firstChanged = -1;
    let lastChanged = -1;
    let first = -1;
    let end = -1;
    const count = Math.min(this.currentPointCount, staged.length);
    for (let k = 0; k < count; k++) {
      const mark = slots[this.sortOrder[k]] ? 1 : 0;
      if (mark !== staged[k]) {
        staged[k] = mark;
        if (firstChanged < 0) firstChanged = k;
        lastChanged = k;
      }
      // Drawn: staged unhidden, and not hidden through the table.
      if (mark && this.colors[k * 4 + 3] > 0 && !hidden?.[this.recordIds[k]]) {
        if (first < 0) first = k;
        end = k + 1;
      }
    }
    if (first >= 0) this.markedRange = { first, end };
    if (firstChanged < 0) return;
    // The width `allocateMarkTexture` gave it.
    const width = this.maxTextureSize;
    const fromRow = Math.floor(firstChanged / width);
    const rows = Math.floor(lastChanged / width) + 1 - fromRow;
    gl.activeTexture(gl.TEXTURE0 + MARK_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.resources.markTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      fromRow,
      width,
      rows,
      gl.RED,
      gl.UNSIGNED_BYTE,
      staged,
      fromRow * width,
    );
    gl.activeTexture(gl.TEXTURE0);
    this.uploadedBytes += rows * width;
  }

  /**
   * After a colour-only restage of `count` slots: whether any slot's paint depth
   * is no longer the one it was sorted by. The restage resolved them all.
   */
  private orderOutOfDate(count: number): boolean {
    const { depth } = this.passScratch;
    for (let k = 0; k < count; k++) {
      if (depth[this.sortOrder[k]] !== this.depths[k]) return true;
    }
    return false;
  }

  /**
   * Whether the first staged slots no longer have the paint depth the style
   * getters give them: a per-point change nothing reported, which a restyle
   * would leave on screen.
   */
  private stagedDepthsMoved(pd: PlotData): boolean {
    const sp = this.scratchPoint;
    const oi = pd.originalIndices;
    const n = Math.min(100, this.currentPointCount);
    for (let k = 0; k < n; k++) {
      const slot = this.sortOrder[k];
      const origIdx = oi ? oi[slot] : slot;
      sp.id = pd.proteinIds[origIdx];
      sp.x = pd.xs[slot];
      sp.y = pd.ys[slot];
      sp.originalIndex = origIdx;
      const opacity = this.style.getOpacity(sp);
      if (opacity === 0) continue;
      const depth = composePaintDepth(this.style.getDepth(sp), opacity, this.style.isPredicted(sp));
      if (Math.abs(depth - this.depths[k]) > 1e-6) return true;
    }
    return false;
  }

  /** Count a staged slot that will be drawn, and track its id when asked to. */
  private countStagedSlot(pd: PlotData, slot: number, opacity: number): void {
    if (!(opacity > 0)) return;
    this.visibleCount++;
    if (this.trackRenderedPointIds) {
      const oi = pd.originalIndices;
      this.renderedPointIds.add(pd.proteinIds[oi ? oi[slot] : slot]);
    }
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
   * staging arrays. Call after any reallocation so staging writes into the
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
      recordIds: null,
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
   * view so staging writes no label texels.
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
    this.recordIds = new Float32Array(nextCapacity);
    this.sortOrder = new Uint32Array(nextCapacity);
    this.passScratch = createPassScratch(nextCapacity);
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
