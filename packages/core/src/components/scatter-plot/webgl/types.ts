import type * as d3 from 'd3';
import type { PlotDataPoint } from '@protspace/utils';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WebGLStyleGetters {
  getColors: (point: PlotDataPoint) => string[];
  getPointSize: (point: PlotDataPoint) => number;
  getOpacity: (point: PlotDataPoint) => number;
  getDepth: (point: PlotDataPoint) => number;
  getStrokeColor: (point: PlotDataPoint) => string;
  getStrokeWidth: (point: PlotDataPoint) => number;
  getShape: (point: PlotDataPoint) => string;
}

export type ScalePair = {
  x: d3.ScaleLinear<number, number>;
  y: d3.ScaleLinear<number, number>;
};

/**
 * Framebuffer resources for offscreen rendering
 */
export interface FramebufferResources {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthBuffer: WebGLRenderbuffer;
  width: number;
  height: number;
}

/** Attribute locations for the point shader program (six attributes). */
export interface PointAttribLocations {
  dataPosition: number;
  size: number;
  color: number;
  depth: number;
  labelCount: number;
  shape: number;
}

/** Uniform locations for the point shader program (seven uniforms). */
export interface PointUniformLocations {
  resolution: WebGLUniformLocation | null;
  transform: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
  gamma: WebGLUniformLocation | null;
  labelColors: WebGLUniformLocation | null;
  labelTextureSize: WebGLUniformLocation | null;
  maxLabels: WebGLUniformLocation | null;
}

// ============================================================================
// Configuration Constants (tuned for performance)
// ============================================================================

/** Maximum points to render directly */
export const MAX_POINTS_DIRECT_RENDER = 1_000_000;

/** Default gamma value (standard sRGB) */
export const DEFAULT_GAMMA = 2.2;
