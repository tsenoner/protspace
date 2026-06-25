/**
 * Off-screen export rendering for the scatter plot.
 *
 * This is a behavior-preserving extraction of the off-screen subsystem that
 * previously lived inline on `WebGLRenderer`. It owns the export pipeline:
 * create a throwaway WebGL2 context sized to the requested export dimensions,
 * stage the points (painter's-algorithm depth sort + F-15 two-pass selection
 * blend), render through the gamma-correct pipeline when the float extensions
 * are available (falling back to direct rendering otherwise), and copy the
 * result into a 2D canvas for safe export.
 *
 * It consumes the B3 substrate (`resolvePointLocations`, `setupAttributes`,
 * `createLinearFramebuffer`, `destroyFramebuffer`, `bindAndClearTarget`,
 * `setPointBlendState`, `drawGammaQuad`, `QUAD_VERTICES`, `stagePoint`,
 * `drawPoints`) and the live point/gamma shader sources, so it shares no
 * resource state with the live render pipeline.
 *
 * `ExportRenderer` is stateless apart from the ephemeral off-screen `gl` it
 * creates per call: every input (source data, scales, config, style getters,
 * transform, gamma, selection state) is passed in as a method argument. The
 * pure-math seams (`getDataExtent`, `createExportScales`, `getRenderInfo`) are
 * exposed as `static` so they can be unit-tested without instantiation.
 */

import * as d3 from 'd3';
import type { PlotData, PlotDataPoint, ScatterplotConfig } from '@protspace/utils';
import {
  type WebGLStyleGetters,
  type ScalePair,
  type FramebufferResources,
  type PointUniformLocations,
  MAX_POINTS_DIRECT_RENDER,
} from '../types';
import { createProgramFromSources } from '../shader-utils';
import { resolvePointLocations } from './point-locations';
import { setupAttributes } from './point-attributes';
import { createLinearFramebuffer, destroyFramebuffer } from './framebuffer';
import {
  bindAndClearTarget,
  setPointBlendState,
  drawPoints,
  bindPointDrawState,
} from './render-target';
import { QUAD_VERTICES, drawGammaQuad } from './gamma-quad';
import { computeExtent, computePaddedExtent } from './data-extent';
import { DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT } from './viewport-defaults';
import { stagePoint, type StagePointArrays, MAX_LABELS } from './stage-point';
import { buildPaintOrder } from './point-staging';
import {
  POINT_VERTEX_SHADER,
  POINT_FRAGMENT_SHADER,
  GAMMA_VERTEX_SHADER,
  GAMMA_FRAGMENT_SHADER,
} from './export-shaders';

// Constants (moved verbatim from webgl-renderer.ts).
const MIN_CAPACITY = 1024;
const LABEL_TEXTURE_WIDTH = 2048;

// Stable reference dimensions for margin scaling at export time. Tying margin
// scaling to the live display canvas (via `config.width/height`, which track
// `clientWidth/clientHeight`) made captured plots window-size dependent — same
// data lands at slightly different pixel positions when the browser is resized,
// causing publish-modal overlays to drift relative to clusters across sessions.
// Anchoring to a fixed reference makes the export render reproducible.
const EXPORT_MARGIN_REFERENCE_WIDTH = 800;
const EXPORT_MARGIN_REFERENCE_HEIGHT = 600;

const MAX_DIMENSION = 8192;
const MAX_AREA = 268435456; // ~268M pixels

/** A data-coordinate viewport rectangle. */
interface DataDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Options for a single off-screen export render. */
interface ExportRenderOptions {
  width: number;
  height: number;
  dpr?: number;
  dataDomain?: DataDomain;
  pointSizeReference?: { width: number; height: number };
  /** Live selection state, forwarded to preserve the F-15 two-pass blend. */
  selectionActive: boolean;
  /** Current live transform; scaled to the export dimensions internally. */
  transform: d3.ZoomTransform;
  /** Live gamma value; downgraded to 1.0 when the gamma pipeline is unavailable. */
  gamma: number;
}

export class ExportRenderer {
  /**
   * Create scales appropriate for export dimensions.
   * Scales the margin proportionally to maintain visual consistency.
   *
   * Replicates the inline `WebGLRenderer.createExportScales` exactly: when a
   * `dataDomain` is supplied (inset / geometric-zoom render) the domain fills
   * the canvas edge-to-edge (full bleed, no 5% padding, no margins); otherwise
   * the data extent gets 5% padding and the margins are scaled from a fixed
   * reference. The config + optional dataDomain are passed in (replacing the
   * former `this.getConfig()` / inline `pd` reads).
   */
  static createExportScales(
    config: ScatterplotConfig,
    pd: PlotData,
    exportWidth: number,
    exportHeight: number,
    dataDomain?: DataDomain,
  ): ScalePair | null {
    if (pd.length === 0) return null;

    // Default margin if not specified
    const margin = config.margin ?? { top: 20, right: 20, bottom: 20, left: 20 };

    // Scale margins from a fixed reference instead of the live display size,
    // so the export render is reproducible across browser-window resizes.
    const scaleX = exportWidth / EXPORT_MARGIN_REFERENCE_WIDTH;
    const scaleY = exportHeight / EXPORT_MARGIN_REFERENCE_HEIGHT;

    const scaledMargin = {
      top: margin.top * scaleY,
      right: margin.right * scaleX,
      bottom: margin.bottom * scaleY,
      left: margin.left * scaleX,
    };

    let xDomMin: number;
    let xDomMax: number;
    let yDomMin: number;
    let yDomMax: number;
    let useFullBleed = false;
    if (dataDomain) {
      // Caller supplied an exact viewport — used by inset (geometric zoom)
      // rendering. Skip the 5% padding AND skip margins so the data domain
      // fills the canvas edge-to-edge. The caller is responsible for picking
      // a domain that already accounts for the source plot's margins, so the
      // inset's data fills aligns 1:1 with the source rect's data region.
      xDomMin = dataDomain.xMin;
      xDomMax = dataDomain.xMax;
      yDomMin = dataDomain.yMin;
      yDomMax = dataDomain.yMax;
      useFullBleed = true;
    } else {
      // Compute data extent + 5% padding (ScaleManager.createScales convention).
      const e = computePaddedExtent(pd.xs, pd.ys, pd.length);
      xDomMin = e.xMin;
      xDomMax = e.xMax;
      yDomMin = e.yMin;
      yDomMax = e.yMax;
    }

    const xRangeStart = useFullBleed ? 0 : scaledMargin.left;
    const xRangeEnd = useFullBleed ? exportWidth : exportWidth - scaledMargin.right;
    const yRangeStart = useFullBleed ? exportHeight : exportHeight - scaledMargin.bottom;
    const yRangeEnd = useFullBleed ? 0 : scaledMargin.top;

    const xScale = d3.scaleLinear().domain([xDomMin, xDomMax]).range([xRangeStart, xRangeEnd]);
    const yScale = d3.scaleLinear().domain([yDomMin, yDomMax]).range([yRangeStart, yRangeEnd]);

    return { x: xScale, y: yScale };
  }

  /**
   * Display configuration the renderer would apply to a render at the given
   * export dimensions. Returned values are in *export pixel space* (i.e.
   * `marginLeft` is the pixel offset of the data area's left edge inside an
   * `exportWidth × exportHeight` canvas). Used by the publish modal to
   * translate inset source rects (canvas-norm) into data-coord viewports
   * with margin-aware accuracy. Static so it is unit-testable.
   */
  static getRenderInfo(
    config: ScatterplotConfig,
    exportWidth: number,
    exportHeight: number,
  ): { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number } {
    const margin = config.margin ?? { top: 20, right: 20, bottom: 20, left: 20 };
    // Match createExportScales: anchor to the same fixed reference so insets'
    // data-domain inversion stays consistent with the export render.
    const scaleX = exportWidth / EXPORT_MARGIN_REFERENCE_WIDTH;
    const scaleY = exportHeight / EXPORT_MARGIN_REFERENCE_HEIGHT;
    return {
      marginLeft: margin.left * scaleX,
      marginRight: margin.right * scaleX,
      marginTop: margin.top * scaleY,
      marginBottom: margin.bottom * scaleY,
    };
  }

  /**
   * Data extent of the supplied points, or null when there is nothing to
   * measure. Mirrors the inline `WebGLRenderer.getDataExtent` exactly
   * (unpadded `computeExtent`). Used by the publish modal to translate inset
   * source rects (normalized canvas coords) into data-coordinate viewports.
   */
  getDataExtent(pd: PlotData | null): DataDomain | null {
    if (!pd || pd.length === 0) return null;
    return computeExtent(pd.xs, pd.ys, pd.length);
  }

  /**
   * Render visualization at arbitrary dimensions to a new off-screen canvas.
   * Creates a temporary WebGL context, renders at requested size, returns 2D canvas.
   *
   * Behavior-preserving move of the inline `WebGLRenderer.renderToCanvas`: the
   * source data, scales-providing config + style getters, and live render state
   * (selection, transform, gamma) are now passed in as method args.
   */
  renderToCanvas(
    pd: PlotData | null,
    config: ScatterplotConfig,
    style: WebGLStyleGetters,
    options: ExportRenderOptions,
  ): HTMLCanvasElement {
    const { width, height, dataDomain, pointSizeReference } = options;
    const dpr = options.dpr ?? 1;

    // Validate dimensions
    const physicalWidth = Math.floor(width * dpr);
    const physicalHeight = Math.floor(height * dpr);

    if (physicalWidth > MAX_DIMENSION || physicalHeight > MAX_DIMENSION) {
      throw new Error(
        `Export dimensions ${physicalWidth}×${physicalHeight} exceed browser limit of ${MAX_DIMENSION}px`,
      );
    }
    if (physicalWidth * physicalHeight > MAX_AREA) {
      throw new Error(
        `Export area ${(physicalWidth * physicalHeight).toLocaleString()} exceeds limit of ${MAX_AREA.toLocaleString()} pixels`,
      );
    }

    // Ensure we have data to render
    if (!pd || pd.length === 0) {
      throw new Error('No points available to render. Call render() first.');
    }

    // Create scales for export dimensions
    const exportScales = ExportRenderer.createExportScales(
      config,
      pd,
      physicalWidth,
      physicalHeight,
      dataDomain,
    );
    if (!exportScales) {
      throw new Error('Could not create scales for export rendering');
    }

    // Create off-screen WebGL canvas
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = physicalWidth;
    offscreenCanvas.height = physicalHeight;

    // Get WebGL2 context with same options as main canvas
    const gl = offscreenCanvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      alpha: true,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      throw new Error('Failed to create WebGL2 context for export');
    }

    try {
      // Initialize WebGL state for the off-screen context
      this.initializeOffscreenContext(
        gl,
        physicalWidth,
        physicalHeight,
        pd,
        exportScales,
        dpr,
        config,
        style,
        options,
        pointSizeReference,
      );

      // Copy WebGL canvas to 2D canvas for safe export
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = physicalWidth;
      outputCanvas.height = physicalHeight;

      const ctx = outputCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create 2D context for export');
      }

      ctx.drawImage(offscreenCanvas, 0, 0);

      return outputCanvas;
    } finally {
      // Clean up off-screen context
      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) {
        loseContext.loseContext();
      }
    }
  }

  /**
   * Initialize and render to an off-screen WebGL context.
   */
  private initializeOffscreenContext(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    pd: PlotData,
    scales: ScalePair,
    dpr: number,
    config: ScatterplotConfig,
    style: WebGLStyleGetters,
    options: ExportRenderOptions,
    pointSizeReference?: { width: number; height: number },
  ): void {
    // Calculate size scale factor based on export vs display dimensions.
    // For inset (zoom) renders, callers pass `pointSizeReference` set to the
    // source plot's render size so points stay visually the same size as in
    // the main plot — instead of shrinking when the inset target is small.
    const displayWidth = config.width ?? DEFAULT_VIEWPORT_WIDTH;
    const displayHeight = config.height ?? DEFAULT_VIEWPORT_HEIGHT;
    const refW = pointSizeReference?.width ?? width;
    const refH = pointSizeReference?.height ?? height;
    const sizeScaleFactor = Math.sqrt((refW * refH) / (displayWidth * displayHeight));
    // Enable extensions for float textures (needed for gamma pipeline)
    const colorBufferFloatExt = gl.getExtension('EXT_color_buffer_float');
    const floatBlendExt = gl.getExtension('EXT_float_blend');
    gl.getExtension('OES_texture_float_linear');

    const useGammaPipeline = !!colorBufferFloatExt && !!floatBlendExt;

    // Create shader programs
    const pointProgram = createProgramFromSources(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);
    if (!pointProgram) {
      throw new Error('Failed to create point shader program for export');
    }

    let gammaCorrectionProgram: WebGLProgram | null = null;
    if (useGammaPipeline) {
      gammaCorrectionProgram = createProgramFromSources(
        gl,
        GAMMA_VERTEX_SHADER,
        GAMMA_FRAGMENT_SHADER,
      );
    }

    // Get attribute and uniform locations
    const { attribs, uniforms } = resolvePointLocations(gl, pointProgram);

    // Prepare point data using existing CPU arrays (reuse from main renderer)
    const maxPoints = Math.min(pd.length, MAX_POINTS_DIRECT_RENDER);

    // Populate buffers for off-screen rendering
    const {
      dataPositions,
      sizes,
      colors,
      depths,
      labelCounts,
      shapes,
      labelColorData,
      pointCount,
      selectedStartIndex,
    } = this.prepareOffscreenBufferData(
      pd,
      scales,
      maxPoints,
      dpr,
      style,
      options.selectionActive,
      sizeScaleFactor,
    );

    // Create and upload buffers
    const dataPositionBuffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    const depthBuffer = gl.createBuffer();
    const labelCountBuffer = gl.createBuffer();
    const shapeBuffer = gl.createBuffer();
    const labelColorTexture = gl.createTexture();

    gl.bindBuffer(gl.ARRAY_BUFFER, dataPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, dataPositions.subarray(0, pointCount * 2), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sizes.subarray(0, pointCount), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors.subarray(0, pointCount * 4), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, depthBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, depths.subarray(0, pointCount), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, labelCountBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, labelCounts.subarray(0, pointCount), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, shapes.subarray(0, pointCount), gl.STATIC_DRAW);

    // Setup label color texture
    gl.bindTexture(gl.TEXTURE_2D, labelColorTexture);
    const texHeight = labelColorData.length / 4 / LABEL_TEXTURE_WIDTH;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      LABEL_TEXTURE_WIDTH,
      texHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      labelColorData,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Create VAO
    const pointVao = gl.createVertexArray();
    gl.bindVertexArray(pointVao);

    setupAttributes(
      gl,
      {
        dataPosition: dataPositionBuffer,
        size: sizeBuffer,
        color: colorBuffer,
        depth: depthBuffer,
        labelCount: labelCountBuffer,
        shape: shapeBuffer,
      },
      attribs,
    );

    gl.bindVertexArray(null);

    // Get current transform and scale it for export dimensions
    const displayTransform = options.transform;
    // Scale transform's translation to export dimensions
    const scaleFactorX = width / displayWidth;
    const scaleFactorY = height / displayHeight;
    // Create a scaled transform that preserves the current view at export resolution
    const exportTransform = {
      x: displayTransform.x * scaleFactorX,
      y: displayTransform.y * scaleFactorY,
      k: displayTransform.k, // Zoom level stays the same
    } as d3.ZoomTransform;
    const gamma = useGammaPipeline ? options.gamma : 1.0;

    // Setup linear framebuffer if using gamma pipeline
    let linearFramebuffer: FramebufferResources | null = null;
    if (useGammaPipeline && gammaCorrectionProgram) {
      linearFramebuffer = createLinearFramebuffer(gl, width, height);
    }

    // Render
    if (linearFramebuffer && gammaCorrectionProgram) {
      // Gamma-correct pipeline
      bindAndClearTarget(gl, linearFramebuffer.framebuffer, width, height);
      setPointBlendState(gl);

      this.renderOffscreenPoints(
        gl,
        pointProgram,
        pointVao,
        uniforms,
        width,
        height,
        dpr,
        gamma,
        exportTransform,
        labelColorTexture,
        labelColorData.length,
        pointCount,
        options.selectionActive,
        selectedStartIndex,
      );

      // Apply gamma correction
      bindAndClearTarget(gl, null, width, height);
      gl.disable(gl.BLEND);

      const quadBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
      // One-shot export pass: resolve the gamma uniforms inline (no per-frame cost here).
      drawGammaQuad(gl, gammaCorrectionProgram, linearFramebuffer.texture, gamma, quadBuffer, {
        linearTexture: gl.getUniformLocation(gammaCorrectionProgram, 'u_linearTexture'),
        gamma: gl.getUniformLocation(gammaCorrectionProgram, 'u_gamma'),
      });
      gl.deleteBuffer(quadBuffer);
    } else {
      // Direct rendering
      bindAndClearTarget(gl, null, width, height);
      setPointBlendState(gl);

      this.renderOffscreenPoints(
        gl,
        pointProgram,
        pointVao,
        uniforms,
        width,
        height,
        dpr,
        gamma,
        exportTransform,
        labelColorTexture,
        labelColorData.length,
        pointCount,
        options.selectionActive,
        selectedStartIndex,
      );
    }

    // Cleanup
    gl.deleteVertexArray(pointVao);
    gl.deleteBuffer(dataPositionBuffer);
    gl.deleteBuffer(sizeBuffer);
    gl.deleteBuffer(colorBuffer);
    gl.deleteBuffer(depthBuffer);
    gl.deleteBuffer(labelCountBuffer);
    gl.deleteBuffer(shapeBuffer);
    gl.deleteTexture(labelColorTexture);
    gl.deleteProgram(pointProgram);
    if (gammaCorrectionProgram) gl.deleteProgram(gammaCorrectionProgram);
    if (linearFramebuffer) {
      destroyFramebuffer(gl, linearFramebuffer);
    }
  }

  /**
   * Prepare buffer data for off-screen rendering.
   */
  private prepareOffscreenBufferData(
    pd: PlotData,
    scales: ScalePair,
    maxPoints: number,
    dpr: number,
    style: WebGLStyleGetters,
    selectionActive: boolean,
    sizeScaleFactor: number = 1,
  ): {
    dataPositions: Float32Array;
    sizes: Float32Array;
    colors: Float32Array;
    depths: Float32Array;
    labelCounts: Float32Array;
    shapes: Float32Array;
    labelColorData: Uint8Array;
    pointCount: number;
    selectedStartIndex: number;
  } {
    const capacity = Math.max(MIN_CAPACITY, maxPoints);
    const dataPositions = new Float32Array(capacity * 2);
    const sizes = new Float32Array(capacity);
    const colors = new Float32Array(capacity * 4);
    const depths = new Float32Array(capacity);
    const labelCounts = new Float32Array(capacity);
    const shapes = new Float32Array(capacity);
    const requiredPixels = capacity * MAX_LABELS;
    const texHeight = Math.ceil(requiredPixels / LABEL_TEXTURE_WIDTH);
    const labelColorData = new Uint8Array(LABEL_TEXTURE_WIDTH * texHeight * 4);

    // Stage slots by depth using the SAME canonical painter-order plan as the
    // live path (buildPaintOrder): the live path is canonical, so the export
    // includes opacity-0 slots (invisible — F-15 pixels unchanged) and uses the
    // identical stable far->near sort and the same sorted-k selectedStartIndex.
    const { xs, ys } = pd;
    const oi = pd.originalIndices;
    const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
    const count = maxPoints;

    const target: StagePointArrays = {
      dataPositions,
      sizes,
      colors,
      depths,
      labelCounts,
      shapes,
      labelColorData,
    };

    // Per-slot depth scratch indexed by ORIGINAL slot index, then the index order
    // sorted far->near in place. Sized to the staged count (export has no persistent
    // scratch, so allocate locally per call).
    const order = new Uint32Array(count);
    const depthScratch = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const origIdx = oi ? oi[i] : i;
      sp.id = pd.proteinIds[origIdx];
      sp.x = xs[i];
      sp.y = ys[i];
      sp.originalIndex = origIdx;
      depthScratch[i] = style.getDepth(sp);
    }

    const { selectedStartIndex } = buildPaintOrder(
      order,
      depthScratch,
      count,
      selectionActive,
      (k, srcSlot) => {
        const origIdx = oi ? oi[srcSlot] : srcSlot;
        sp.id = pd.proteinIds[origIdx];
        sp.x = xs[srcSlot];
        sp.y = ys[srcSlot];
        sp.originalIndex = origIdx;
        const opacity = style.getOpacity(sp);

        // Depth uses depthScratch[srcSlot] (indexed by original slot), NOT
        // depthScratch[k], matching the live path.
        stagePoint(
          target,
          k,
          sp,
          scales.x(xs[srcSlot]),
          scales.y(ys[srcSlot]),
          opacity,
          depthScratch[srcSlot],
          style,
          dpr,
          sizeScaleFactor,
        );

        return opacity;
      },
    );

    return {
      dataPositions,
      sizes,
      colors,
      depths,
      labelCounts,
      shapes,
      labelColorData,
      pointCount: count,
      selectedStartIndex,
    };
  }

  /**
   * Render points in off-screen context.
   */
  private renderOffscreenPoints(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    vao: WebGLVertexArrayObject,
    uniforms: PointUniformLocations,
    width: number,
    height: number,
    dpr: number,
    gamma: number,
    transform: d3.ZoomTransform,
    labelColorTexture: WebGLTexture | null,
    labelColorDataLength: number,
    pointCount: number,
    selectionActive: boolean,
    selectedStartIndex: number,
  ): void {
    bindPointDrawState(gl, program, uniforms, vao, labelColorTexture, {
      width,
      height,
      transform: { x: transform.x, y: transform.y, k: transform.k },
      dpr,
      gamma,
      maxLabels: MAX_LABELS,
      labelTextureWidth: LABEL_TEXTURE_WIDTH,
      labelColorDataLength,
    });

    drawPoints(gl, pointCount, selectionActive, selectedStartIndex);
    gl.bindVertexArray(null);
  }
}
