import type { PlotDataPoint } from '@protspace/utils';

// ScalePair is owned by @protspace/utils (data-processor `createScales`); re-export
// it here so webgl code importing `ScalePair` from this module still resolves.
export type { ScalePair } from '@protspace/utils';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WebGLStyleGetters {
  getColors: (point: PlotDataPoint) => string[];
  getPointSize: (point: PlotDataPoint) => number;
  getOpacity: (point: PlotDataPoint) => number;
  getDepth: (point: PlotDataPoint) => number;
  getShape: (point: PlotDataPoint) => string;
  isPredicted: (point: PlotDataPoint) => boolean;
  /**
   * Whether the selected annotation stores more than one value for any protein.
   * Gates allocation of the multi-label colour atlas, which is 32 B/point and is
   * never sampled when this is false.
   */
  isMultilabel: () => boolean;
}

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

/** Attribute locations for the point shader program. */
export interface PointAttribLocations {
  dataPosition: number;
  size: number;
  color: number;
  depth: number;
  labelCount: number;
  shape: number;
  predicted: number;
}

/** Uniform locations for the point shader program. */
export interface PointUniformLocations {
  resolution: WebGLUniformLocation | null;
  transform: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
  gamma: WebGLUniformLocation | null;
  knockoutColor: WebGLUniformLocation | null;
  labelColors: WebGLUniformLocation | null;
  labelTextureSize: WebGLUniformLocation | null;
  maxLabels: WebGLUniformLocation | null;
  /** Points the label atlas covers; 0 disables the multi-label branch entirely. */
  labelAtlasCapacity: WebGLUniformLocation | null;
}

// ============================================================================
// Configuration Constants
// ============================================================================

// Last-resort staging clamp: the renderer's name for the shared cap. See
// `utils/limits.ts` for why it sits where it does and why nothing a user can
// load reaches it.
export { MAX_POINTS_PER_PROJECTION as MAX_RENDERABLE_POINTS } from '../../../utils/limits';

/** Default gamma value (standard sRGB) */
export const DEFAULT_GAMMA = 2.2;
